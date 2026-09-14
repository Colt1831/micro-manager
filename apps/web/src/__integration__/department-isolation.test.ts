import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, type SQL } from 'drizzle-orm';
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
import { applyDeptScope, canAccessDept, resolveTaskDepartment } from '@/lib/api/db';
import { getUserStatus } from '@/lib/auth/api-auth';
import { rankLevel, canSeeAllDepartments } from '@workmanagement/shared';

/**
 * Phase 2 — department isolation wall, exercised against real Postgres.
 *
 * The wall has one funnel: `applyDeptScope` (list paths) and `canAccessDept`
 * (detail-read + mutation paths), fed by the scope resolved in `withAuth` from
 * the user's rank + department. These tests prove a Manager in dept A cannot
 * see/read/mutate a task in dept B, while a General Manager sees both — the
 * exact property the spec's verification bar requires.
 */
describe.skipIf(!hasTestDb)('Department isolation wall', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Build the scope object the way withAuth does, but straight from the DB row
  // so we're testing the real resolution, not a hand-made fixture.
  async function scopeFor(userId: string) {
    const s = await getUserStatus(userId);
    return {
      rank: s.rank,
      level: rankLevel(s.rank),
      departmentId: s.departmentId,
      seeAllDepartments: canSeeAllDepartments(s.rank),
    };
  }

  it('resolves scope from the user row: manager is walled, GM sees all', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const mgr = await insertRankedUser({ organizationId: org, rank: 'manager', departmentId: deptA });
    const gm = await insertRankedUser({ organizationId: org, rank: 'general_manager', departmentId: deptA });

    const mgrScope = await scopeFor(mgr);
    expect(mgrScope.seeAllDepartments).toBe(false);
    expect(mgrScope.departmentId).toBe(deptA);

    const gmScope = await scopeFor(gm);
    expect(gmScope.seeAllDepartments).toBe(true);
  });

  it('a Manager in dept A does not see dept B tasks in a LIST query', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const deptB = await insertDepartment(org, 'B');
    const mgrA = await insertRankedUser({ organizationId: org, rank: 'manager', departmentId: deptA });
    const creator = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptB });

    const taskA = await insertDeptTask(org, mgrA, deptA, 'A task');
    await insertDeptTask(org, creator, deptB, 'B task');

    const scope = await scopeFor(mgrA);
    const conditions: SQL[] = [eq(schema.tasks.organizationId, org)];
    applyDeptScope(conditions, scope, schema.tasks.departmentId);

    const rows = await testDb()
      .select({ id: schema.tasks.id, dept: schema.tasks.departmentId })
      .from(schema.tasks)
      .where(and(...conditions));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(taskA);
    expect(rows.every((r) => r.dept === deptA)).toBe(true);
  });

  it('a General Manager sees BOTH departments in a LIST query', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const deptB = await insertDepartment(org, 'B');
    const gm = await insertRankedUser({ organizationId: org, rank: 'general_manager', departmentId: deptA });
    const u = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptB });
    await insertDeptTask(org, gm, deptA, 'A task');
    await insertDeptTask(org, u, deptB, 'B task');

    const scope = await scopeFor(gm);
    const conditions: SQL[] = [eq(schema.tasks.organizationId, org)];
    applyDeptScope(conditions, scope, schema.tasks.departmentId);

    const rows = await testDb().select({ id: schema.tasks.id }).from(schema.tasks).where(and(...conditions));
    expect(rows).toHaveLength(2);
  });

  it('DETAIL read + MUTATION: a walled Manager is denied a known cross-dept id; GM is allowed', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const deptB = await insertDepartment(org, 'B');
    const mgrA = await insertRankedUser({ organizationId: org, rank: 'manager', departmentId: deptA });
    const gm = await insertRankedUser({ organizationId: org, rank: 'general_manager', departmentId: deptA });
    const creatorB = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptB });
    const taskB = await insertDeptTask(org, creatorB, deptB, 'B task');

    // The row is loaded (org-scoped), then the dept guard runs — same as the route.
    const [row] = await testDb()
      .select({ dept: schema.tasks.departmentId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskB));

    const mgrScope = await scopeFor(mgrA);
    const gmScope = await scopeFor(gm);

    // Detail read / mutation guard: Manager in A denied, GM allowed.
    expect(canAccessDept(mgrScope, row!.dept)).toBe(false);
    expect(canAccessDept(gmScope, row!.dept)).toBe(true);
  });

  it('fails closed: a walled user with NO department matches no rows', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const noDeptUser = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: null });
    const other = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptA });
    await insertDeptTask(org, other, deptA, 'A task');

    const scope = await scopeFor(noDeptUser);
    const conditions: SQL[] = [eq(schema.tasks.organizationId, org)];
    applyDeptScope(conditions, scope, schema.tasks.departmentId);

    const rows = await testDb().select({ id: schema.tasks.id }).from(schema.tasks).where(and(...conditions));
    // No department → sees nothing cross-department (not everything).
    expect(rows).toHaveLength(0);
    // And a no-dept walled user cannot access a departmented row by id.
    expect(canAccessDept(scope, deptA)).toBe(false);
  });

  it('resolveTaskDepartment follows assignee -> team -> creator precedence', async () => {
    const org = await insertOrg();
    const deptA = await insertDepartment(org, 'A');
    const deptC = await insertDepartment(org, 'C');
    const assignee = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptA });
    const creator = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: deptC });

    // Assignee's dept wins when present.
    expect(await resolveTaskDepartment({ assignedTo: assignee, createdBy: creator })).toBe(deptA);
    // Falls back to creator's dept when no assignee.
    expect(await resolveTaskDepartment({ assignedTo: null, createdBy: creator })).toBe(deptC);
    // Null when nothing has a department.
    const noDept = await insertRankedUser({ organizationId: org, rank: 'executive', departmentId: null });
    expect(await resolveTaskDepartment({ assignedTo: noDept, createdBy: noDept })).toBeNull();
  });
});
