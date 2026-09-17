import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { isUniqueViolation } from '@/lib/db-errors';
import { eq, and, isNull } from 'drizzle-orm';
import { TeamMemberAddSchema, validationError } from '@/lib/api/validation';

export const runtime = 'nodejs';

function getIdsFromPath(request: NextRequest): { teamId: string } {
  const segments = request.nextUrl.pathname.split('/');
  const idIndex = segments.indexOf('teams');
  return { teamId: segments[idIndex + 1]! };
}

// POST /api/teams/[id]/members - Add a member to the team (rate limited: 30 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const { teamId } = getIdsFromPath(request);
      await requirePermission(user.id, 'team:manage');

      const body = await request.json();
      const parsed = TeamMemberAddSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { userId: targetUserId, role } = parsed.data;

      // Verify team exists and belongs to org
      const [team] = await db()
        .select()
        .from(schema.teams)
        .where(and(eq(schema.teams.id, teamId), isNull(schema.teams.deletedAt)))
        .limit(1);

      if (!team) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      if (team.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Access denied' } },
          { status: 403 },
        );
      }

      // Department wall: a walled user must not alter another department's team.
      // 404 so a cross-dept team id is indistinguishable from a missing one.
      if (!canAccessDept(scope, team.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      // Validate target user is in same org
      const [targetUser] = await db()
        .select({
          id: schema.users.id,
          organizationId: schema.users.organizationId,
          isActive: schema.users.isActive,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, targetUserId), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!targetUser) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }

      if (targetUser.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization member addition denied' } },
          { status: 403 },
        );
      }

      if (!targetUser.isActive) {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Cannot add inactive user to team' } },
          { status: 422 },
        );
      }

      // Check if already a member
      const [existing] = await db()
        .select()
        .from(schema.teamMembers)
        .where(
          and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)),
        )
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'User is already a member of this team' } },
          { status: 409 },
        );
      }

      let member;
      try {
        [member] = await db()
          .insert(schema.teamMembers)
          .values({
            teamId,
            userId: targetUserId,
            role,
          })
          .returning();
      } catch (insertError) {
        // A unique index guards against duplicates; a concurrent add that raced
        // past the check above lands here — return the same 409, not a 500.
        if (isUniqueViolation(insertError, 'idx_team_members_unique')) {
          return NextResponse.json(
            { error: { code: 'CONFLICT', message: 'User is already a member of this team' } },
            { status: 409 },
          );
        }
        throw insertError;
      }

      if (!member) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to add member' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'team.member_added',
        entityType: 'team',
        entityId: teamId,
        newValues: { userId: targetUserId, role },
      });

      // Fetch member with user info
      const [memberWithUser] = await db()
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
        .where(eq(schema.teamMembers.id, member.id))
        .limit(1);

      return NextResponse.json({ member: memberWithUser }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to add member');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'teams:members:add' },
);

// DELETE /api/teams/[id]/members - Remove a member from the team (rate limited: 60 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const { teamId } = getIdsFromPath(request);
      await requirePermission(user.id, 'team:manage');

      const targetUserId = request.nextUrl.searchParams.get('userId');

      if (!targetUserId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'userId is required' } },
          { status: 400 },
        );
      }

      // Verify team exists and belongs to org
      const [team] = await db()
        .select({
          id: schema.teams.id,
          organizationId: schema.teams.organizationId,
          departmentId: schema.teams.departmentId,
          leadUserId: schema.teams.leadUserId,
        })
        .from(schema.teams)
        .where(and(eq(schema.teams.id, teamId), isNull(schema.teams.deletedAt)))
        .limit(1);

      if (!team) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      if (team.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Access denied' } },
          { status: 403 },
        );
      }

      // Department wall (see POST).
      if (!canAccessDept(scope, team.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Team not found' } },
          { status: 404 },
        );
      }

      // Prevent removing the team lead
      if (team.leadUserId === targetUserId) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: 'Cannot remove the team lead. Reassign lead first.',
            },
          },
          { status: 422 },
        );
      }

      const [existing] = await db()
        .select()
        .from(schema.teamMembers)
        .where(
          and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Member not found in this team' } },
          { status: 404 },
        );
      }

      await db().delete(schema.teamMembers).where(eq(schema.teamMembers.id, existing.id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'team.member_removed',
        entityType: 'team',
        entityId: teamId,
        oldValues: { userId: targetUserId },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to remove member');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'teams:members:remove' },
);
