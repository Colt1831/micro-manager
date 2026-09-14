/**
 * Real-Postgres integration-test helpers (WM-002).
 *
 * Unlike the unit suite (which mocks `@/lib/api/db`), these helpers connect to
 * a real PostgreSQL instance via `DATABASE_URL` so DB-level invariants —
 * constraints, transactions, and concurrency behaviour — are actually exercised.
 *
 * The harness is opt-in: it only runs when `DATABASE_URL` is set (see
 * `hasTestDb`), so the normal mocked suite is unaffected.
 */
import { getDb, schema } from '@workmanagement/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export const hasTestDb = Boolean(process.env.DATABASE_URL);

export type TestDb = ReturnType<typeof getDb>;

export function testDb(): TestDb {
  if (!hasTestDb) throw new Error('DATABASE_URL is not set — integration DB unavailable');
  return getDb();
}

/**
 * Truncate the tables these tests touch. CASCADE also clears anything that
 * FK-references them, giving each test a clean slate.
 */
export async function resetDb(): Promise<void> {
  await testDb().execute(
    sql`TRUNCATE TABLE organizations, users, tasks, time_entries, task_dependencies RESTART IDENTITY CASCADE`,
  );
}

// ─── Fixtures ───────────────────────────────────────────────

export async function insertOrg(name = 'Test Org'): Promise<string> {
  const slug = `test-${randomUUID().slice(0, 8)}`;
  const [row] = await testDb()
    .insert(schema.organizations)
    .values({ name, slug })
    .returning({ id: schema.organizations.id });
  return row!.id;
}

export async function insertUser(email?: string): Promise<string> {
  const id = randomUUID();
  const [row] = await testDb()
    .insert(schema.users)
    .values({ id, email: email ?? `u-${id.slice(0, 8)}@test.local` })
    .returning({ id: schema.users.id });
  return row!.id;
}

// ─── Department fixtures (Phase 2 isolation wall) ───────────

export async function insertDepartment(organizationId: string, name = 'Dept'): Promise<string> {
  const [row] = await testDb()
    .insert(schema.departments)
    .values({ organizationId, name })
    .returning({ id: schema.departments.id });
  return row!.id;
}

/** A user with an explicit rank + department, for wall tests. */
export async function insertRankedUser(opts: {
  organizationId: string;
  rank?: string;
  departmentId?: string | null;
  email?: string;
}): Promise<string> {
  const id = randomUUID();
  const [row] = await testDb()
    .insert(schema.users)
    .values({
      id,
      email: opts.email ?? `u-${id.slice(0, 8)}@test.local`,
      organizationId: opts.organizationId,
      rank: opts.rank ?? 'executive',
      departmentId: opts.departmentId ?? null,
    })
    .returning({ id: schema.users.id });
  return row!.id;
}

/** A task pinned to a specific department, for wall tests. */
export async function insertDeptTask(
  organizationId: string,
  createdBy: string,
  departmentId: string | null,
  title = 'Dept task',
): Promise<string> {
  const [row] = await testDb()
    .insert(schema.tasks)
    .values({
      organizationId,
      createdBy,
      title,
      departmentId,
      taskIdDisplay: `T-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning({ id: schema.tasks.id });
  return row!.id;
}

export async function insertTask(
  organizationId: string,
  createdBy: string,
  title = 'Test task',
): Promise<string> {
  const [row] = await testDb()
    .insert(schema.tasks)
    .values({
      organizationId,
      createdBy,
      title,
      taskIdDisplay: `T-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning({ id: schema.tasks.id });
  return row!.id;
}

/** A minimal org + user + task, the common starting point for most tests. */
export async function seedBase(): Promise<{ orgId: string; userId: string; taskId: string }> {
  const orgId = await insertOrg();
  const userId = await insertUser();
  const taskId = await insertTask(orgId, userId);
  return { orgId, userId, taskId };
}

// ─── Leave fixtures ─────────────────────────────────────────

export async function insertLeaveType(organizationId: string, name = 'Annual'): Promise<string> {
  const [row] = await testDb()
    .insert(schema.leaveTypes)
    .values({ organizationId, name, slug: `lt-${randomUUID().slice(0, 8)}` })
    .returning({ id: schema.leaveTypes.id });
  return row!.id;
}

export async function insertLeaveBalance(
  organizationId: string,
  userId: string,
  leaveTypeId: string,
  year: number,
  opts: { allocated?: number; used?: number; pending?: number } = {},
): Promise<string> {
  const [row] = await testDb()
    .insert(schema.leaveBalances)
    .values({
      organizationId,
      userId,
      leaveTypeId,
      year,
      allocatedDays: opts.allocated ?? 20,
      usedDays: opts.used ?? 0,
      pendingDays: opts.pending ?? 0,
    })
    .returning({ id: schema.leaveBalances.id });
  return row!.id;
}

export async function insertLeaveRequest(
  organizationId: string,
  userId: string,
  leaveTypeId: string,
  opts: { daysCount?: number; startDate?: string; endDate?: string; status?: string } = {},
): Promise<string> {
  const start = opts.startDate ?? '2026-03-02';
  const [row] = await testDb()
    .insert(schema.leaveRequests)
    .values({
      organizationId,
      userId,
      leaveTypeId,
      startDate: start,
      endDate: opts.endDate ?? '2026-03-06',
      daysCount: opts.daysCount ?? 5,
      reason: 'Integration test',
      status: opts.status ?? 'pending',
    })
    .returning({ id: schema.leaveRequests.id });
  return row!.id;
}
