import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission, getUserRank } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { canGrantRank, isRank } from '@workmanagement/shared';
import { assertDepartmentSameOrg, assertTeamSameOrg, assertUserSameOrg } from '@/lib/api/cross-ref';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

// GET /api/users/[id] - Get single user (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'user:view');
      const id = getIdFromPath(request);

      const [found] = await db()
        .select({
          id: schema.users.id,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          name: schema.users.name,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          phone: schema.users.phone,
          designation: schema.users.designation,
          employeeId: schema.users.employeeId,
          employmentStatus: schema.users.employmentStatus,
          departmentId: schema.users.departmentId,
          teamId: schema.users.teamId,
          reportingManagerId: schema.users.reportingManagerId,
          location: schema.users.location,
          timezone: schema.users.timezone,
          organizationId: schema.users.organizationId,
          isActive: schema.users.isActive,
          createdAt: schema.users.createdAt,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!found) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(found.organizationId, orgId);

      return NextResponse.json({ user: found });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch user');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'users:get' },
);

// PATCH /api/users/[id] - Update user (rate limited: 60 req/min per user)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'user:edit');
      const id = getIdFromPath(request);
      const body = await request.json();
      const {
        firstName,
        lastName,
        displayName,
        phone,
        designation,
        departmentId,
        teamId,
        location,
        timezone,
        rank,
        reportingManagerId,
      } = body;

      // Fetch existing for org scope check
      const [existing] = await db()
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Cross-tenant guards: replacement department/team/manager must be same-org.
      for (const denial of [
        departmentId != null ? await assertDepartmentSameOrg(departmentId, orgId) : null,
        teamId != null ? await assertTeamSameOrg(teamId, orgId) : null,
        reportingManagerId != null ? await assertUserSameOrg(reportingManagerId, orgId) : null,
      ]) {
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }
      }

      // A user cannot be their own reporting manager (would break the chain).
      if (reportingManagerId != null && reportingManagerId === id) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'A user cannot report to themselves' } },
          { status: 400 },
        );
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (displayName !== undefined) updateData.displayName = displayName;
      if (phone !== undefined) updateData.phone = phone;
      if (designation !== undefined) updateData.designation = designation;
      if (departmentId !== undefined) updateData.departmentId = departmentId;
      if (teamId !== undefined) updateData.teamId = teamId;
      if (location !== undefined) updateData.location = location;
      if (timezone !== undefined) updateData.timezone = timezone;
      if (reportingManagerId !== undefined) updateData.reportingManagerId = reportingManagerId;

      // ── Rank change: downward-only, gated by the actor's own rank ──────
      // Changing a person's rank is authority-granting, so it is NOT covered
      // by plain user:edit. The actor must out-rank BOTH the new rank and the
      // target's current rank (can't demote someone above you either).
      if (rank !== undefined && rank !== existing.rank) {
        if (!isRank(rank)) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid rank' } },
            { status: 400 },
          );
        }
        const actorRank = await getUserRank(user.id);
        if (!canGrantRank(actorRank, rank) || !canGrantRank(actorRank, existing.rank)) {
          return NextResponse.json(
            {
              error: {
                code: 'FORBIDDEN',
                message: 'You cannot set a rank at or above your own authority level',
              },
            },
            { status: 403 },
          );
        }
        if (id === user.id) {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'You cannot change your own rank' } },
            { status: 403 },
          );
        }
        updateData.rank = rank;
      }

      const [updated] = await db()
        .update(schema.users)
        .set(updateData)
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .returning();

      if (!updated) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        oldValues: { firstName: existing.firstName, lastName: existing.lastName },
        newValues: updateData,
      });

      return NextResponse.json({ user: updated });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update user');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'users:update' },
);

// DELETE /api/users/[id] - Deactivate/soft-delete a user (admin, 30 req/min)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'user:delete');
      const id = getIdFromPath(request);

      if (id === user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You cannot deactivate your own account' } },
          { status: 403 },
        );
      }

      const [target] = await db()
        .select({
          id: schema.users.id,
          email: schema.users.email,
          organizationId: schema.users.organizationId,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!target) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }
      if (target.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization access denied' } },
          { status: 403 },
        );
      }

      // Soft-delete + deactivate, then revoke all active sessions.
      await db()
        .update(schema.users)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(schema.users.id, id));
      await db().delete(schema.sessions).where(eq(schema.sessions.userId, id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'user.deactivated',
        entityType: 'user',
        entityId: id,
        oldValues: { email: target.email },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to deactivate user');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'users:delete' },
);
