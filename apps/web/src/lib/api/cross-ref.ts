import { db, schema } from '@/lib/api/db';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Cross-tenant reference guards (Phase 3, spec §Phase 3 last bullet).
 *
 * Update/create routes accept FKs supplied by the client (ownerId, leadUserId,
 * headUserId, departmentId, teamId, milestoneId, …). Without a check a caller
 * can point a row at an entity in ANOTHER org. Each helper returns a structured
 * denial (code/message/status) when the reference is missing or cross-org, or
 * `null` when it is valid — mirroring `validateAssignment`.
 */
export type RefDenial = { code: string; message: string; status: number };

function notFound(label: string): RefDenial {
  return { code: 'NOT_FOUND', message: `${label} not found`, status: 404 };
}
function crossOrg(label: string): RefDenial {
  return { code: 'FORBIDDEN', message: `Cross-organization ${label} reference denied`, status: 403 };
}

/** A referenced user must exist (not deleted) and belong to the same org. */
export async function assertUserSameOrg(
  userId: string,
  orgId: string | null,
): Promise<RefDenial | null> {
  const [row] = await db()
    .select({ organizationId: schema.users.organizationId })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!row) return notFound('User');
  if (!orgId || row.organizationId !== orgId) return crossOrg('user');
  return null;
}

/** A referenced department must exist (not deleted) and belong to the same org. */
export async function assertDepartmentSameOrg(
  departmentId: string,
  orgId: string | null,
): Promise<RefDenial | null> {
  const [row] = await db()
    .select({ organizationId: schema.departments.organizationId })
    .from(schema.departments)
    .where(and(eq(schema.departments.id, departmentId), isNull(schema.departments.deletedAt)))
    .limit(1);
  if (!row) return notFound('Department');
  if (!orgId || row.organizationId !== orgId) return crossOrg('department');
  return null;
}

/** A referenced team must exist (not deleted) and belong to the same org. */
export async function assertTeamSameOrg(
  teamId: string,
  orgId: string | null,
): Promise<RefDenial | null> {
  const [row] = await db()
    .select({ organizationId: schema.teams.organizationId })
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), isNull(schema.teams.deletedAt)))
    .limit(1);
  if (!row) return notFound('Team');
  if (!orgId || row.organizationId !== orgId) return crossOrg('team');
  return null;
}

/**
 * A referenced milestone must exist (not deleted), belong to the same org (via
 * its project), and — when a projectId is given — belong to THAT project.
 */
export async function assertMilestoneSameOrg(
  milestoneId: string,
  orgId: string | null,
  projectId?: string | null,
): Promise<RefDenial | null> {
  const [row] = await db()
    .select({
      projectId: schema.milestones.projectId,
      organizationId: schema.projects.organizationId,
    })
    .from(schema.milestones)
    .innerJoin(schema.projects, eq(schema.milestones.projectId, schema.projects.id))
    .where(and(eq(schema.milestones.id, milestoneId), isNull(schema.milestones.deletedAt)))
    .limit(1);
  if (!row) return notFound('Milestone');
  if (!orgId || row.organizationId !== orgId) return crossOrg('milestone');
  if (projectId && row.projectId !== projectId) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Milestone does not belong to the specified project',
      status: 422,
    };
  }
  return null;
}
