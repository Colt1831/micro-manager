import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { computeProgress } from '../progress';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { ProjectUpdateSchema, validationError } from '@/lib/api/validation';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { indexProject, removeProjectFromIndex } from '@/lib/search';
import { assertUserSameOrg, assertDepartmentSameOrg, assertTeamSameOrg } from '@/lib/api/cross-ref';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

// GET /api/projects/[id] - Get single project with owner/task info (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);

      await requirePermission(user.id, 'project:view');

      const [project] = await db()
        .select({
          id: schema.projects.id,
          organizationId: schema.projects.organizationId,
          name: schema.projects.name,
          code: schema.projects.code,
          description: schema.projects.description,
          ownerId: schema.projects.ownerId,
          departmentId: schema.projects.departmentId,
          teamId: schema.projects.teamId,
          status: schema.projects.status,
          priority: schema.projects.priority,
          progress: schema.projects.progress,
          completionPercentage: schema.projects.completionPercentage,
          startDate: schema.projects.startDate,
          endDate: schema.projects.endDate,
          actualEndDate: schema.projects.actualEndDate,
          budgetAmount: schema.projects.budgetAmount,
          budgetCurrency: schema.projects.budgetCurrency,
          tags: schema.projects.tags,
          isActive: schema.projects.isActive,
          createdAt: schema.projects.createdAt,
          updatedAt: schema.projects.updatedAt,
          owner: {
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
          },
        })
        .from(schema.projects)
        .leftJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
        .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)))
        .limit(1);

      if (!project) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(project.organizationId, orgId);

      // Department wall: a walled user must not read a project outside their dept.
      if (!canAccessDept(scope, project.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      // Get task stats for the project
      const taskCounts = await db()
        .select({
          status: schema.tasks.status,
          count: sql<number>`COUNT(*)::int`.as('count'),
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, id), isNull(schema.tasks.deletedAt)))
        .groupBy(schema.tasks.status);

      // Get milestone count
      const [milestoneCount] = await db()
        .select({ count: sql<number>`COUNT(*)::int`.as('count') })
        .from(schema.milestones)
        .where(and(eq(schema.milestones.projectId, id), isNull(schema.milestones.deletedAt)));

      const totalTasks = taskCounts.reduce((sum, t) => sum + t.count, 0);
      const completedTasks = taskCounts.find((t) => t.status === 'completed')?.count ?? 0;
      const inProgressTasks = taskCounts.find((t) => t.status === 'in_progress')?.count ?? 0;
      const overdueTasks = taskCounts.find((t) => t.status === 'overdue')?.count ?? 0;

      return NextResponse.json({
        // Derive progress from task counts, same as the list route. The stored
        // projects.progress column is never written, so it always read 0%.
        project: { ...project, progress: computeProgress(totalTasks, completedTasks) },
        taskStats: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: inProgressTasks,
          overdue: overdueTasks,
          byStatus: taskCounts,
        },
        milestones: {
          total: milestoneCount?.count ?? 0,
        },
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch project');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'projects:get' },
);

// PATCH /api/projects/[id] - Update project (rate limited: 60 req/min per user)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'project:edit');

      const body = await request.json();
      const parsed = ProjectUpdateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const {
        name,
        code,
        description,
        ownerId,
        departmentId,
        teamId,
        status,
        priority,
        progress,
        startDate,
        endDate,
        isActive,
        tags,
      } = parsed.data;

      const [existing] = await db()
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot mutate a project outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      // Cross-tenant guards: replacement owner/department/team must be same-org.
      for (const denial of [
        ownerId != null ? await assertUserSameOrg(ownerId, orgId) : null,
        departmentId != null ? await assertDepartmentSameOrg(departmentId, orgId) : null,
        teamId != null ? await assertTeamSameOrg(teamId, orgId) : null,
      ]) {
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }
      }

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      if (name !== undefined) {
        oldValues.name = existing.name;
        newValues.name = name;
      }
      if (code !== undefined) {
        oldValues.code = existing.code;
        newValues.code = code;
      }
      if (description !== undefined) {
        oldValues.description = existing.description;
        newValues.description = description;
      }
      if (ownerId !== undefined) {
        oldValues.ownerId = existing.ownerId;
        newValues.ownerId = ownerId;
      }
      if (departmentId !== undefined) {
        oldValues.departmentId = existing.departmentId;
        newValues.departmentId = departmentId;
      }
      if (teamId !== undefined) {
        oldValues.teamId = existing.teamId;
        newValues.teamId = teamId;
      }
      if (status !== undefined) {
        oldValues.status = existing.status;
        newValues.status = status;
      }
      if (priority !== undefined) {
        oldValues.priority = existing.priority;
        newValues.priority = priority;
      }
      if (progress !== undefined) {
        oldValues.progress = existing.progress;
        newValues.progress = progress;
      }
      if (startDate !== undefined) {
        oldValues.startDate = existing.startDate;
        newValues.startDate = startDate;
      }
      if (endDate !== undefined) {
        oldValues.endDate = existing.endDate;
        newValues.endDate = endDate;
      }
      if (isActive !== undefined) {
        oldValues.isActive = existing.isActive;
        newValues.isActive = isActive;
      }
      if (tags !== undefined) {
        oldValues.tags = existing.tags;
        newValues.tags = tags;
      }

      if (Object.keys(newValues).length > 0) {
        await db()
          .update(schema.projects)
          .set({ ...newValues, updatedBy: user.id, updatedAt: new Date() })
          .where(eq(schema.projects.id, id));

        // Re-index in Meilisearch (non-blocking)
        indexProject({
          id: existing.id,
          name: (newValues.name as string) ?? existing.name,
          code: (newValues.code as string) ?? existing.code,
          description: (newValues.description as string) ?? existing.description,
          status: (newValues.status as string) ?? existing.status,
          ownerId: (newValues.ownerId as string) ?? existing.ownerId,
          organizationId: orgId!,
          tags: (newValues.tags as string[] | null) ?? (existing.tags as string[] | null),
          createdAt: (existing.createdAt as Date).toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      if (Object.keys(oldValues).length > 0) {
        await createAuditEntry({
          organizationId: orgId,
          userId: user.id,
          action: 'project.updated',
          entityType: 'project',
          entityId: id,
          oldValues,
          newValues,
        });

        // Fire-and-forget webhook dispatch — never block the API response
        dispatchWebhookEvent('project.updated', orgId!, {
          projectId: id,
          name: existing.name,
          code: existing.code,
          status: existing.status,
          updatedBy: user.id,
          changes: Object.keys(newValues).filter(
            (k) => k !== 'updatedBy' && k !== 'updatedAt',
          ),
        });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update project');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'projects:update' },
);

// DELETE /api/projects/[id] - Soft delete project (rate limited: 30 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'project:delete');

      const [existing] = await db()
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot delete a project outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          { status: 404 },
        );
      }

      await db()
        .update(schema.projects)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
        .where(eq(schema.projects.id, id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'project.deleted',
        entityType: 'project',
        entityId: id,
        oldValues: { name: existing.name, status: existing.status },
      });

      // Remove from Meilisearch index (non-blocking)
      removeProjectFromIndex(id);

      // Fire-and-forget webhook dispatch — never block the API response
      dispatchWebhookEvent('project.deleted', orgId!, {
        projectId: id,
        name: existing.name,
        code: existing.code,
        status: existing.status,
        deletedBy: user.id,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete project');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'projects:delete' },
);
