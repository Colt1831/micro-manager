import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * The caller's highest capability-role priority — their grant ceiling.
 * A user may only assign a role strictly below this. Missing/roleless → -1
 * (can assign nothing), which is the safe default.
 */
async function actorMaxRolePriority(userId: string): Promise<number> {
  const [top] = await db()
    .select({ priority: schema.roles.priority })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.userRoles.userId, userId),
        eq(schema.roles.isActive, true),
        isNull(schema.roles.deletedAt),
      ),
    )
    .orderBy(desc(schema.roles.priority))
    .limit(1);
  return top?.priority ?? -1;
}

function getUserIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/');
  const idIndex = segments.indexOf('users');
  return segments[idIndex + 1]!;
}

// GET /api/users/[id]/roles - Get roles assigned to a user (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'role:view');

      const userId = getUserIdFromPath(request);

      const userRoles = await db()
        .select({
          id: schema.userRoles.id,
          roleId: schema.userRoles.roleId,
          userId: schema.userRoles.userId,
          assignedAt: schema.userRoles.assignedAt,
          role: {
            id: schema.roles.id,
            name: schema.roles.name,
            slug: schema.roles.slug,
            description: schema.roles.description,
            isSystem: schema.roles.isSystem,
          },
        })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
        .where(
          and(
            eq(schema.userRoles.userId, userId),
            eq(schema.roles.organizationId, orgId!),
            isNull(schema.roles.deletedAt),
          ),
        );

      return NextResponse.json({ userRoles });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch user roles');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'users:roles:list' },
);

// POST /api/users/[id]/roles - Assign a role to a user (rate limited: 30 req/min per user — sensitive)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'role:assign');

      const userId = getUserIdFromPath(request);
      const body = await request.json();
      const { roleId } = body;

      if (!roleId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'roleId is required' } },
          { status: 400 },
        );
      }

      // Verify role exists and belongs to same org
      const [role] = await db()
        .select()
        .from(schema.roles)
        .where(and(eq(schema.roles.id, roleId), isNull(schema.roles.deletedAt)))
        .limit(1);

      if (!role) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Role not found' } },
          { status: 404 },
        );
      }

      if (role.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization role assignment denied' } },
          { status: 403 },
        );
      }

      // Target user must exist and be in the SAME org (audit gap: previously
      // only the role's org was checked, letting a role be pinned onto a user
      // in another org).
      const [targetUser] = await db()
        .select({ id: schema.users.id, organizationId: schema.users.organizationId })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!targetUser) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          { status: 404 },
        );
      }
      if (targetUser.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization role assignment denied' } },
          { status: 403 },
        );
      }

      // Grant ceiling: you may only assign a role strictly BELOW your own
      // highest role priority — no self-escalation, no minting peers/admins.
      // (Closes the seeded-manager-assigns-admin escalation.)
      const ceiling = await actorMaxRolePriority(user.id);
      if ((role.priority ?? 0) >= ceiling) {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'You cannot assign a role at or above your own authority level',
            },
          },
          { status: 403 },
        );
      }

      // Check if already assigned
      const [existing] = await db()
        .select()
        .from(schema.userRoles)
        .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.roleId, roleId)))
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'User already has this role' } },
          { status: 409 },
        );
      }

      const [userRole] = await db()
        .insert(schema.userRoles)
        .values({
          userId,
          roleId,
          assignedBy: user.id,
        })
        .returning();

      if (!userRole) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to assign role' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'role.assigned',
        entityType: 'user',
        entityId: userId,
        newValues: { roleId, roleName: role.name },
      });

      return NextResponse.json({ userRole }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to assign role');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'users:roles:assign' },
);

// DELETE /api/users/[id]/roles - Remove a role from a user (rate limited: 30 req/min per user — sensitive)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'role:assign');

      const userId = getUserIdFromPath(request);
      const roleId = request.nextUrl.searchParams.get('roleId');

      if (!roleId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'roleId is required' } },
          { status: 400 },
        );
      }

      const [existing] = await db()
        .select({
          id: schema.userRoles.id,
          roleId: schema.userRoles.roleId,
          role: { name: schema.roles.name },
        })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
        .where(
          and(
            eq(schema.userRoles.userId, userId),
            eq(schema.userRoles.roleId, roleId),
            eq(schema.roles.organizationId, orgId!),
            isNull(schema.roles.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Role assignment not found' } },
          { status: 404 },
        );
      }

      await db().delete(schema.userRoles).where(eq(schema.userRoles.id, existing.id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'role.unassigned',
        entityType: 'user',
        entityId: userId,
        oldValues: { roleId, roleName: existing.role.name },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to remove role');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'users:roles:remove' },
);
