import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { DepartmentUpdateSchema, validationError } from '@/lib/api/validation';
import { assertUserSameOrg } from '@/lib/api/cross-ref';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

// GET /api/departments/[id] - Get department with sub-teams, members, and task stats (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { orgId }) => {
    try {
      const id = getIdFromPath(request);

      const [dept] = await db()
        .select({
          id: schema.departments.id,
          organizationId: schema.departments.organizationId,
          name: schema.departments.name,
          code: schema.departments.code,
          description: schema.departments.description,
          headUserId: schema.departments.headUserId,
          isActive: schema.departments.isActive,
          parentId: schema.departments.parentId,
          sortOrder: schema.departments.sortOrder,
          createdAt: schema.departments.createdAt,
          updatedAt: schema.departments.updatedAt,
          headUser: {
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            designation: schema.users.designation,
          },
        })
        .from(schema.departments)
        .leftJoin(schema.users, eq(schema.departments.headUserId, schema.users.id))
        .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)))
        .limit(1);

      if (!dept) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Department not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(dept.organizationId, orgId);

      // Get sub-teams
      const teams = await db()
        .select({
          id: schema.teams.id,
          name: schema.teams.name,
          code: schema.teams.code,
          description: schema.teams.description,
          leadUserId: schema.teams.leadUserId,
          isActive: schema.teams.isActive,
          memberCount: sql<number>`(
            SELECT COUNT(*) FROM ${schema.teamMembers}
            WHERE ${schema.teamMembers.teamId} = ${schema.teams.id}
          )`,
        })
        .from(schema.teams)
        .where(and(eq(schema.teams.departmentId, id), isNull(schema.teams.deletedAt)))
        .orderBy(desc(schema.teams.createdAt));

      // Get department members (users with this departmentId)
      const members = await db()
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          designation: schema.users.designation,
          isActive: schema.users.isActive,
          teamId: schema.users.teamId,
        })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.departmentId, id),
            isNull(schema.users.deletedAt),
            eq(schema.users.isArchived, false),
          ),
        );

      // Get task stats for tasks belonging to teams in this department
      const taskStats = await db()
        .select({
          status: schema.tasks.status,
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(schema.tasks)
        .innerJoin(schema.teams, eq(schema.tasks.teamId, schema.teams.id))
        .where(and(eq(schema.teams.departmentId, id), isNull(schema.tasks.deletedAt)))
        .groupBy(schema.tasks.status);

      const totalTasks = taskStats.reduce((sum, t) => sum + t.count, 0);
      const completedTasks = taskStats.find((t) => t.status === 'completed')?.count ?? 0;

      return NextResponse.json({
        department: dept,
        teams,
        members,
        taskStats: {
          total: totalTasks,
          completed: completedTasks,
          byStatus: taskStats,
        },
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch department');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'departments:get' },
);

// PATCH /api/departments/[id] - Update department (rate limited: 60 req/min per user)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'department:edit');

      const body = await request.json();
      const parsed = DepartmentUpdateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { name, description, headUserId, isActive } = parsed.data;

      const [existing] = await db()
        .select()
        .from(schema.departments)
        .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Department not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user must not edit another department. The
      // row's own id is the scope key here. 404 to match the sibling routes.
      if (!canAccessDept(scope, existing.id)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Department not found' } },
          { status: 404 },
        );
      }

      // Cross-tenant guard: replacement head user must be same-org.
      if (headUserId != null) {
        const denial = await assertUserSameOrg(headUserId, orgId);
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
      if (headUserId !== undefined) {
        oldValues.headUserId = existing.headUserId;
        newValues.headUserId = headUserId;
      }
      if (isActive !== undefined) {
        oldValues.isActive = existing.isActive;
        newValues.isActive = isActive;
      }

      if (Object.keys(newValues).length > 0) {
        await db()
          .update(schema.departments)
          .set({ ...newValues, updatedBy: user.id, updatedAt: new Date() })
          .where(eq(schema.departments.id, id));
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        oldValues,
        newValues,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update department');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'departments:update' },
);

// DELETE /api/departments/[id] - Soft-delete a department (admin, 30 req/min)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'department:delete');
      const id = getIdFromPath(request);

      const [dept] = await db()
        .select({
          id: schema.departments.id,
          name: schema.departments.name,
          organizationId: schema.departments.organizationId,
        })
        .from(schema.departments)
        .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)))
        .limit(1);

      if (!dept) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Department not found' } },
          { status: 404 },
        );
      }
      if (dept.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization access denied' } },
          { status: 403 },
        );
      }

      // Detach child teams (they become unassigned rather than orphaned), then soft-delete.
      await db()
        .update(schema.teams)
        .set({ departmentId: null })
        .where(and(eq(schema.teams.departmentId, id), isNull(schema.teams.deletedAt)));
      await db()
        .update(schema.departments)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(schema.departments.id, id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'department.deleted',
        entityType: 'department',
        entityId: id,
        oldValues: { name: dept.name },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete department');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'departments:delete' },
);
