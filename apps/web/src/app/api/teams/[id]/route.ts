import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TeamUpdateSchema, validationError } from '@/lib/api/validation';
import { assertUserSameOrg, assertDepartmentSameOrg } from '@/lib/api/cross-ref';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

// GET /api/teams/[id] - Get team with members, department info, and task stats (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);

      await requirePermission(user.id, 'team:view');

      const [team] = await db()
        .select({
          id: schema.teams.id,
          organizationId: schema.teams.organizationId,
          name: schema.teams.name,
          code: schema.teams.code,
          description: schema.teams.description,
          departmentId: schema.teams.departmentId,
          leadUserId: schema.teams.leadUserId,
          isActive: schema.teams.isActive,
          createdAt: schema.teams.createdAt,
          updatedAt: schema.teams.updatedAt,
          department: {
            id: schema.departments.id,
            name: schema.departments.name,
          },
          leadUser: {
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
          },
        })
        .from(schema.teams)
        .leftJoin(schema.departments, eq(schema.teams.departmentId, schema.departments.id))
        .leftJoin(schema.users, eq(schema.teams.leadUserId, schema.users.id))
        .where(and(eq(schema.teams.id, id), isNull(schema.teams.deletedAt)))
        .limit(1);

      if (!team) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(team.organizationId ?? null, orgId);

      // Department wall: a walled user must not read a team outside their dept.
      if (!canAccessDept(scope, team.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      // Get members
      const members = await db()
        .select({
          id: schema.teamMembers.id,
          userId: schema.teamMembers.userId,
          role: schema.teamMembers.role,
          joinedAt: schema.teamMembers.joinedAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            avatarUrl: schema.users.avatarUrl,
            designation: schema.users.designation,
            isActive: schema.users.isActive,
          },
        })
        .from(schema.teamMembers)
        .leftJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id))
        .where(eq(schema.teamMembers.teamId, id));

      // Get task stats
      const taskCounts = await db()
        .select({
          status: schema.tasks.status,
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.teamId, id), isNull(schema.tasks.deletedAt)))
        .groupBy(schema.tasks.status);

      // Get member task counts
      const memberTaskCounts = await db()
        .select({
          userId: schema.tasks.assignedTo,
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.teamId, id), isNull(schema.tasks.deletedAt)))
        .groupBy(schema.tasks.assignedTo);

      const totalTasks = taskCounts.reduce((sum, t) => sum + t.count, 0);
      const completedTasks = taskCounts.find((t) => t.status === 'completed')?.count ?? 0;
      const inProgressTasks = taskCounts.find((t) => t.status === 'in_progress')?.count ?? 0;
      const openTasks =
        taskCounts.find((t) => t.status === 'open' || t.status === 'draft')?.count ?? 0;

      return NextResponse.json({
        team,
        members,
        taskStats: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: inProgressTasks,
          open: openTasks,
          byStatus: taskCounts,
          byMember: memberTaskCounts,
        },
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch team');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'teams:get' },
);

// PATCH /api/teams/[id] - Update team (rate limited: 60 req/min per user)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'team:edit');

      const body = await request.json();
      const parsed = TeamUpdateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { name, description, departmentId, leadUserId, isActive } = parsed.data;

      const [existing] = await db()
        .select()
        .from(schema.teams)
        .where(and(eq(schema.teams.id, id), isNull(schema.teams.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot mutate a team outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      // Cross-tenant guards: replacement lead/department must be same-org.
      for (const denial of [
        leadUserId != null ? await assertUserSameOrg(leadUserId, orgId) : null,
        departmentId != null ? await assertDepartmentSameOrg(departmentId, orgId) : null,
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
      if (description !== undefined) {
        oldValues.description = existing.description;
        newValues.description = description;
      }
      if (departmentId !== undefined) {
        oldValues.departmentId = existing.departmentId;
        newValues.departmentId = departmentId;
      }
      if (leadUserId !== undefined) {
        oldValues.leadUserId = existing.leadUserId;
        newValues.leadUserId = leadUserId;
      }
      if (isActive !== undefined) {
        oldValues.isActive = existing.isActive;
        newValues.isActive = isActive;
      }

      if (Object.keys(newValues).length > 0) {
        await db()
          .update(schema.teams)
          .set({ ...newValues, updatedBy: user.id, updatedAt: new Date() })
          .where(eq(schema.teams.id, id));
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'team.updated',
        entityType: 'team',
        entityId: id,
        oldValues,
        newValues,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update team');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'teams:update' },
);

// DELETE /api/teams/[id] - Soft delete team (rate limited: 60 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'team:delete');

      const [existing] = await db()
        .select()
        .from(schema.teams)
        .where(and(eq(schema.teams.id, id), isNull(schema.teams.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot delete a team outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      await db()
        .update(schema.teams)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
        .where(eq(schema.teams.id, id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'team.deleted',
        entityType: 'team',
        entityId: id,
        oldValues: { name: existing.name },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete team');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'teams:delete' },
);
