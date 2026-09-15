import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@workmanagement/database';
import {
  hasTestDb,
  testDb,
  resetDb,
  insertOrg,
  insertUser,
  insertTask,
  insertShift,
} from './helpers/db';
import { isUniqueViolation } from '@/lib/db-errors';

/**
 * Phase 4 — shift-based time tracking. These exercise the DB-level invariants
 * and the exact queries the shift/timer routes rely on, against real Postgres.
 */
describe.skipIf(!hasTestDb)('Phase 4 — shifts + timer accuracy', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enforces one open shift per user (partial unique index)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const db = testDb();

    const open = () =>
      db.insert(schema.shifts).values({ organizationId: orgId, userId, clockIn: new Date() });

    const results = await Promise.allSettled([open(), open()]);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      isUniqueViolation(rejected[0]!.reason, 'idx_shifts_one_open_per_user'),
    ).toBe(true);
  });

  it('allows a new shift once the previous one is closed', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const db = testDb();

    const first = await insertShift(orgId, userId);
    await db.update(schema.shifts).set({ clockOut: new Date() }).where(eq(schema.shifts.id, first));

    await expect(
      db.insert(schema.shifts).values({ organizationId: orgId, userId, clockIn: new Date() }),
    ).resolves.toBeDefined();
  });

  it('NO_OPEN_SHIFT precheck: no open shift found when user has not clocked in', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const db = testDb();

    // The check the timer-start route runs.
    const openShift = async () =>
      db
        .select({ id: schema.shifts.id })
        .from(schema.shifts)
        .where(and(eq(schema.shifts.userId, userId), isNull(schema.shifts.clockOut)))
        .limit(1);

    expect(await openShift()).toHaveLength(0); // → route returns 422 NO_OPEN_SHIFT

    await insertShift(orgId, userId);
    expect(await openShift()).toHaveLength(1); // clocked in → timer allowed
  });

  it('clock-out auto-stops the running timer, then closes the shift', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const taskId = await insertTask(orgId, userId);
    const db = testDb();

    const shiftId = await insertShift(orgId, userId);
    const startTime = new Date(Date.now() - 30 * 60_000); // 30 min ago
    const [timer] = await db
      .insert(schema.timeEntries)
      .values({ taskId, userId, startTime, entryType: 'timer' })
      .returning({ id: schema.timeEntries.id });

    // Replica of the clock-out route: stop the running timer, then close shift.
    const now = new Date();
    const [running] = await db
      .select({ id: schema.timeEntries.id, startTime: schema.timeEntries.startTime })
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.userId, userId),
          isNull(schema.timeEntries.endTime),
          eq(schema.timeEntries.entryType, 'timer'),
        ),
      )
      .limit(1);
    expect(running!.id).toBe(timer!.id);

    const durationMinutes = Math.max(
      1,
      Math.round((now.getTime() - new Date(running!.startTime).getTime()) / 60000),
    );
    await db
      .update(schema.timeEntries)
      .set({ endTime: now, durationMinutes })
      .where(eq(schema.timeEntries.id, running!.id));
    await db.update(schema.shifts).set({ clockOut: now }).where(eq(schema.shifts.id, shiftId));

    const [entry] = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.id, timer!.id));
    expect(entry!.endTime).not.toBeNull();
    expect(entry!.durationMinutes).toBe(30);

    const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
    expect(shift!.clockOut).not.toBeNull();
    // No timer bleeds past the shift: timer end <= shift close.
    expect(entry!.endTime!.getTime()).toBeLessThanOrEqual(shift!.clockOut!.getTime());
  });

  it('running precheck matches only timer entries, not open manual entries', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const taskId = await insertTask(orgId, userId);
    const db = testDb();

    // An open manual entry must NOT count as a running timer.
    await db
      .insert(schema.timeEntries)
      .values({ taskId, userId, startTime: new Date(), entryType: 'manual' });

    const running = await db
      .select({ id: schema.timeEntries.id })
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.userId, userId),
          isNull(schema.timeEntries.endTime),
          eq(schema.timeEntries.entryType, 'timer'),
        ),
      );
    expect(running).toHaveLength(0);
  });
});
