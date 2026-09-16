import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { TeamCreateSchema, validationError } from '@/lib/api/validation';

export const runtime = 'nodejs';

// GET /api/teams - List teams and departments (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (_request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'team:view');

      const teamConditions = [
        isNull(schema.teams.deletedAt),
        eq(schema.teams.organizationId, orgId!),
      ];
      // Department wall: GM+/super_admin see all teams; others only their own dept's.
      applyDeptScope(teamConditions, scope, schema.teams.departmentId);

      // Join the lead user so the UI can show a name. Without this the teams
      // list only had leadUserId and rendered a truncated raw UUID.
      const teamRows = await db()
        .select({ team: schema.teams, leadUserName: schema.users.name })
        .from(schema.teams)
        .leftJoin(schema.users, eq(schema.users.id, schema.teams.leadUserId))
        .where(and(...teamConditions))
        .orderBy(desc(schema.teams.createdAt));

      const teams = teamRows.map((r) => ({ ...r.team, leadUserName: r.leadUserName }));

      const departments = await db()
        .select()
        .from(schema.departments)
        .where(
          and(isNull(schema.departments.deletedAt), eq(schema.departments.organizationId, orgId!)),
        )
        .orderBy(desc(schema.departments.createdAt));

      return NextResponse.json({ teams, departments });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch teams');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'teams:list' },
);

// POST /api/teams - Create team (rate limited: 30 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'team:create');

      const body = await request.json();
      const parsed = TeamCreateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { name, code, description, departmentId: departmentIdInput, leadUserId } = parsed.data;
      // Department wall on create: a walled user can only create teams in their
      // OWN department; GM+/super_admin may target any (or none).
      const departmentId = scope.seeAllDepartments
        ? (departmentIdInput ?? null)
        : (scope.departmentId ?? null);

      // Validate department belongs to same org if provided
      if (departmentId) {
        const [dept] = await db()
          .select({ id: schema.departments.id, organizationId: schema.departments.organizationId })
          .from(schema.departments)
          .where(and(eq(schema.departments.id, departmentId), isNull(schema.departments.deletedAt)))
          .limit(1);
        if (!dept) {
          return NextResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Department not found' } },
            { status: 404 },
          );
        }
        if (dept.organizationId !== orgId) {
          return NextResponse.json(
            {
              error: { code: 'FORBIDDEN', message: 'Cross-organization department access denied' },
            },
            { status: 403 },
          );
        }
      }

      // Validate lead user is in same org if provided
      if (leadUserId) {
        const [lead] = await db()
          .select({ id: schema.users.id, organizationId: schema.users.organizationId })
          .from(schema.users)
          .where(and(eq(schema.users.id, leadUserId), isNull(schema.users.deletedAt)))
          .limit(1);
        if (!lead) {
          return NextResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Lead user not found' } },
            { status: 404 },
          );
        }
        if (lead.organizationId !== orgId) {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'Cross-organization lead assignment denied' } },
            { status: 403 },
          );
        }
      }

      const [team] = await db()
        .insert(schema.teams)
        .values({
          name,
          code,
          description: description ?? null,
          organizationId: orgId!,
          departmentId: departmentId ?? null,
          leadUserId: leadUserId ?? null,
          createdBy: user.id,
          updatedBy: user.id,
          isActive: true,
        })
        .returning();

      if (!team) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create team' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'team.created',
        entityType: 'team',
        entityId: team.id,
        newValues: { name, code },
      });

      return NextResponse.json({ team }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create team');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'teams:create' },
);
