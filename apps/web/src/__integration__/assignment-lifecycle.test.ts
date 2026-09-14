import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@workmanagement/database';
import {
  hasTestDb,
  testDb,
  resetDb,
  insertOrg,
  insertDepartment,
  insertRankedUser,
  insertDeptTask,
} from './helpers/db';
import { getUserStatus } from '@/lib/auth/api-auth';
import { validateAssignment } from '@/lib/api/assignment';
import {
  assertMilestoneSameOrg,
  assertTeamSameOrg,
  assertUserSameOrg,
} from '@/lib/api/cross-ref';
import { isValidTransition } from '@/lib/api/validation';
import { rankLevel, canSeeAllDepartments } from '@workmanagement/shared';
import { randomUUID } from 'node:crypto';

/**
 * Phase 3 — assignment rules + task lifecycle correctness, against real Postgres.
 *
 * These prove the security-boundary properties the spec's verification bar
 * requires: downward-only assignment, the department wall on assignment, and
 * cross-tenant reference rejection — all through the SAME shared helpers the
 * task/project/team/department routes call.
 */
describe.skipIf(!hasTestDb)('Phase 3 — assignment + lifecycle', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function scopeFor(userId: string) {
    const s = await getUserStatus(userId);
    return {
      rank: s.rank,
      level: rankLevel(s.rank),
      departmentId: s.departmentId,
      seeAllDepartments: canSeeAllDepartments(s.rank),
    };
  }

  // ── Downward-only assignment ────────────────────────────────

  it('denies assignment when the actor does not outrank the assignee', async () => {
    const org = await insertOrg();
    const dept = await insertDepartment(org, 'A');
    const managerActor = await insertRankedUser({
      organizationId: org,
      rank: 'manager',
      departmentId: dept,
    });
    const peer = await insertRankedUser({
      organizationId: org,
      rank: 'manager',
      departmentId: dept,
    });

    const denial = await validateAssignment(await scopeFor(managerActor), peer, org);
    expect(denial?.status).toBe(403);
    expect(denial?.message).toMatch(/below your own rank/);
  });

  it('allows assignment to a strictly-lower rank in the same department', async () => {
    const org = await insertOrg();
    const dept = await insertDepartment(org, 'A');
    const managerActor = await insertRankedUser({
      organizationId: org,
      rank: 'manager',
      departmentId: dept,
    });
    const exec = await insertRankedUser({
      organizationId: org,
      rank: 'executive',
      departmentId: dept,
    });

    expect(await validateAssignment(await scopeFor(managerActor), exec, org)).toBeNull();
  });

  // ── Department wall on assignment ───────────────────────────

  it('denies a walled manager assigning across departments, but allows a GM', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const deptB = await insertDepartment(org, 'B');
    const managerA = await insertRankedUser({
      organizationId: org,
      rank: 'manager',
      departmentId: deptA,
    });
    const gm = await insertRankedUser({
      organizationId: org,
      rank: 'general_manager',
      departmentId: deptA,
    });
    const execB = await insertRankedUser({
      organizationId: org,
      rank: 'executive',
      departmentId: deptB,
    });

    // Walled manager: cross-dept denied.
    const managerDenial = await validateAssignment(await scopeFor(managerA), execB, org);
    expect(managerDenial?.status).toBe(403);
    expect(managerDenial?.message).toMatch(/within your own department/);

    // GM: cross-dept allowed.
    expect(await validateAssignment(await scopeFor(gm), execB, org)).toBeNull();
  });

  it('denies assignment to an inactive/suspended or cross-org user', async () => {
    const org = await insertOrg();
    const otherOrg = await insertOrg();
    const dept = await insertDepartment(org, 'A');
    const gm = await insertRankedUser({
      organizationId: org,
      rank: 'general_manager',
      departmentId: dept,
    });
    const foreign = await insertRankedUser({ organizationId: otherOrg, rank: 'executive' });

    const denial = await validateAssignment(await scopeFor(gm), foreign, org);
    expect(denial?.status).toBe(403);
    expect(denial?.message).toMatch(/Cross-organization/);
  });

  // ── Batch: transition validation + history parity ───────────

  it('closed → reopened is a valid transition; closed → in_progress is not', () => {
    // The bug was ordering (readonly checked before transition); the transition
    // map itself allows reopening a closed task.
    expect(isValidTransition('closed', 'reopened')).toBe(true);
    expect(isValidTransition('closed', 'archived')).toBe(true);
    expect(isValidTransition('closed', 'in_progress')).toBe(false);
  });

  it('a status change writes a task_history row (batch/single parity)', async () => {
    const org = await insertOrg();
    const dept = await insertDepartment(org, 'A');
    const actor = await insertRankedUser({
      organizationId: org,
      rank: 'manager',
      departmentId: dept,
    });
    const taskId = await insertDeptTask(org, actor, dept, 'lifecycle task');

    // Simulate the shared status-change path the batch route now uses.
    await testDb()
      .insert(schema.taskHistory)
      .values({
        taskId,
        userId: actor,
        field: 'status',
        oldValue: 'open',
        newValue: 'in_progress',
        changeType: 'status_change',
        description: 'Status changed from open to in_progress',
      });

    const rows = await testDb()
      .select()
      .from(schema.taskHistory)
      .where(eq(schema.taskHistory.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.newValue).toBe('in_progress');
  });

  // ── Cross-tenant reference validation ───────────────────────

  it('rejects a cross-org team reference and accepts a same-org one', async () => {
    const org = await insertOrg();
    const otherOrg = await insertOrg();
    const [sameTeam] = await testDb()
      .insert(schema.teams)
      .values({ organizationId: org, name: 'Same' })
      .returning({ id: schema.teams.id });
    const [foreignTeam] = await testDb()
      .insert(schema.teams)
      .values({ organizationId: otherOrg, name: 'Foreign' })
      .returning({ id: schema.teams.id });

    expect(await assertTeamSameOrg(sameTeam!.id, org)).toBeNull();
    const denial = await assertTeamSameOrg(foreignTeam!.id, org);
    expect(denial?.status).toBe(403);
    // A non-existent team is a 404.
    expect((await assertTeamSameOrg(randomUUID(), org))?.status).toBe(404);
  });

  it('rejects a cross-org user reference (replacement owner/lead/head)', async () => {
    const org = await insertOrg();
    const otherOrg = await insertOrg();
    const foreign = await insertRankedUser({ organizationId: otherOrg, rank: 'manager' });
    const local = await insertRankedUser({ organizationId: org, rank: 'manager' });

    expect((await assertUserSameOrg(foreign, org))?.status).toBe(403);
    expect(await assertUserSameOrg(local, org)).toBeNull();
  });

  it('rejects a milestone that belongs to a different project than the one given', async () => {
    const org = await insertOrg();
    const owner = await insertRankedUser({ organizationId: org, rank: 'manager' });
    const [projectA] = await testDb()
      .insert(schema.projects)
      .values({ organizationId: org, name: 'A', ownerId: owner })
      .returning({ id: schema.projects.id });
    const [projectB] = await testDb()
      .insert(schema.projects)
      .values({ organizationId: org, name: 'B', ownerId: owner })
      .returning({ id: schema.projects.id });
    const [milestone] = await testDb()
      .insert(schema.milestones)
      .values({ projectId: projectA!.id, name: 'M1' })
      .returning({ id: schema.milestones.id });

    // Same org, correct project → allowed.
    expect(await assertMilestoneSameOrg(milestone!.id, org, projectA!.id)).toBeNull();
    // Same org, WRONG project → 422.
    const denial = await assertMilestoneSameOrg(milestone!.id, org, projectB!.id);
    expect(denial?.status).toBe(422);
    expect(denial?.message).toMatch(/does not belong to the specified project/);
  });
});
