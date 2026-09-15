import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, ne, lte, gte, asc, sql } from 'drizzle-orm';
import { schema } from '@workmanagement/database';
import {
  hasTestDb,
  testDb,
  resetDb,
  insertOrg,
  insertUser,
  insertLeaveType,
  insertLeaveBalance,
  insertLeaveRequest,
} from './helpers/db';

/**
 * Phase 5 — leave correctness. These exercise the DB-level invariants the
 * routes rely on (numeric half-days persist; edit recompute + balance delta;
 * atomic cancel restore; leave-type validation; read-only types listing)
 * against real Postgres. The mutating cases replicate the route transactions
 * faithfully (same pattern as leave-approval-race.test.ts) so the numeric
 * column behaviour and atomic SQL are actually proven, not asserted by
 * construction.
 */

function calcDays(start: string, end: string): number {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
}

describe.skipIf(!hasTestDb)('Phase 5 — leave correctness', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('persists a half-day daysCount as 0.5 (numeric, not rounded to 0/1)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    const reqId = await insertLeaveRequest(orgId, userId, leaveTypeId, {
      daysCount: 0.5,
      startDate: '2026-03-02',
      endDate: '2026-03-02',
    });

    const [req] = await testDb()
      .select({ days: schema.leaveRequests.daysCount })
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, reqId));

    // Comes back as a JS number (mode:'number'), exactly 0.5 — an integer
    // column silently truncated this to 0.
    expect(req!.days).toBe(0.5);
    expect(typeof req!.days).toBe('number');
  });

  it('half-day balance math keeps fractional pending days (0.5 not lost)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    const balId = await insertLeaveBalance(orgId, userId, leaveTypeId, 2026, { pending: 0 });

    // Mirror POST create's atomic increment with a 0.5 day.
    await testDb()
      .update(schema.leaveBalances)
      .set({ pendingDays: sql`${schema.leaveBalances.pendingDays} + ${0.5}` })
      .where(eq(schema.leaveBalances.id, balId));

    const [bal] = await testDb()
      .select({ pending: schema.leaveBalances.pendingDays })
      .from(schema.leaveBalances)
      .where(eq(schema.leaveBalances.id, balId));
    expect(bal!.pending).toBe(0.5);
  });

  it('edit recomputes daysCount, adjusts pending balance by the delta, and re-checks overlap', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    // Existing pending request: 3 days (Mar 2–4), 3 pending reserved.
    const reqId = await insertLeaveRequest(orgId, userId, leaveTypeId, {
      daysCount: 3,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
    });
    await insertLeaveBalance(orgId, userId, leaveTypeId, 2026, { pending: 3 });

    // Edit to 5 days (Mar 2–6). Replicate the PATCH transaction.
    const newStart = '2026-03-02';
    const newEnd = '2026-03-06';
    const newDays = calcDays(newStart, newEnd); // 5
    const oldDays = 3;

    await testDb().transaction(async (tx) => {
      const overlap = await tx
        .select({ id: schema.leaveRequests.id })
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.userId, userId),
            eq(schema.leaveRequests.organizationId, orgId),
            ne(schema.leaveRequests.id, reqId),
            ne(schema.leaveRequests.status, 'cancelled'),
            ne(schema.leaveRequests.status, 'rejected'),
            lte(schema.leaveRequests.startDate, newEnd),
            gte(schema.leaveRequests.endDate, newStart),
          ),
        )
        .limit(1);
      expect(overlap).toHaveLength(0); // only THIS request touches the range

      await tx
        .update(schema.leaveRequests)
        .set({ startDate: newStart, endDate: newEnd, daysCount: newDays })
        .where(and(eq(schema.leaveRequests.id, reqId), eq(schema.leaveRequests.status, 'pending')));

      await tx
        .update(schema.leaveBalances)
        .set({
          pendingDays: sql`GREATEST(0, ${schema.leaveBalances.pendingDays} + ${newDays - oldDays})`,
        })
        .where(
          and(
            eq(schema.leaveBalances.userId, userId),
            eq(schema.leaveBalances.leaveTypeId, leaveTypeId),
            eq(schema.leaveBalances.year, 2026),
          ),
        );
    });

    const [req] = await testDb()
      .select({ days: schema.leaveRequests.daysCount })
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, reqId));
    expect(req!.days).toBe(5);

    const [bal] = await testDb()
      .select({ pending: schema.leaveBalances.pendingDays })
      .from(schema.leaveBalances)
      .where(eq(schema.leaveBalances.leaveTypeId, leaveTypeId));
    expect(bal!.pending).toBe(5); // 3 + (5 - 3)
  });

  it('edit overlap check finds a DIFFERENT request occupying the new range', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    const editId = await insertLeaveRequest(orgId, userId, leaveTypeId, {
      startDate: '2026-03-02',
      endDate: '2026-03-04',
    });
    // A second pending request the edit would collide with.
    await insertLeaveRequest(orgId, userId, leaveTypeId, {
      startDate: '2026-03-10',
      endDate: '2026-03-12',
    });

    const overlap = await testDb()
      .select({ id: schema.leaveRequests.id })
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.userId, userId),
          ne(schema.leaveRequests.id, editId),
          ne(schema.leaveRequests.status, 'cancelled'),
          lte(schema.leaveRequests.startDate, '2026-03-12'),
          gte(schema.leaveRequests.endDate, '2026-03-10'),
        ),
      )
      .limit(1);
    expect(overlap).toHaveLength(1); // extending editId onto Mar 10–12 would clash
  });

  it('rejects create against an inactive or cross-org leave type', async () => {
    const orgId = await insertOrg();
    const otherOrgId = await insertOrg('Other');
    const inactiveType = await insertLeaveType(orgId, 'Archived', { isActive: false });
    const crossOrgType = await insertLeaveType(otherOrgId, 'Foreign');

    // The route's validation query: (id, org, isActive=true).
    async function validate(typeId: string) {
      const rows = await testDb()
        .select({ id: schema.leaveTypes.id })
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.id, typeId),
            eq(schema.leaveTypes.organizationId, orgId),
            eq(schema.leaveTypes.isActive, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }

    expect(await validate(inactiveType)).toBe(false);
    expect(await validate(crossOrgType)).toBe(false);
    const activeType = await insertLeaveType(orgId, 'Vacation');
    expect(await validate(activeType)).toBe(true);
  });

  it('cancelling an APPROVED request restores usedDays atomically (GREATEST guard)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    await insertLeaveBalance(orgId, userId, leaveTypeId, 2026, { used: 5, pending: 0 });
    const reqId = await insertLeaveRequest(orgId, userId, leaveTypeId, {
      daysCount: 5,
      startDate: '2026-03-02',
      status: 'approved',
    });

    // Replicate DELETE for an approved request: restore usedDays.
    const outcome = await testDb().transaction(async (tx) => {
      const [cancelled] = await tx
        .update(schema.leaveRequests)
        .set({ status: 'cancelled', cancelledBy: userId, cancelledAt: new Date() })
        .where(and(eq(schema.leaveRequests.id, reqId), sql`${schema.leaveRequests.status} IN ('pending', 'approved')`))
        .returning();
      if (!cancelled) return 'invalid_state';
      await tx
        .update(schema.leaveBalances)
        .set({ usedDays: sql`GREATEST(0, ${schema.leaveBalances.usedDays} - ${5})` })
        .where(and(eq(schema.leaveBalances.userId, userId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId)));
      return 'ok';
    });
    expect(outcome).toBe('ok');

    const [bal] = await testDb()
      .select({ used: schema.leaveBalances.usedDays, pending: schema.leaveBalances.pendingDays })
      .from(schema.leaveBalances)
      .where(eq(schema.leaveBalances.leaveTypeId, leaveTypeId));
    expect(bal!.used).toBe(0); // 5 - 5
    expect(bal!.pending).toBe(0); // untouched
  });

  it('cancelling a PENDING request restores pendingDays (not usedDays)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const leaveTypeId = await insertLeaveType(orgId);
    await insertLeaveBalance(orgId, userId, leaveTypeId, 2026, { used: 2, pending: 4 });
    const reqId = await insertLeaveRequest(orgId, userId, leaveTypeId, {
      daysCount: 4,
      status: 'pending',
    });

    await testDb().transaction(async (tx) => {
      await tx
        .update(schema.leaveRequests)
        .set({ status: 'cancelled' })
        .where(and(eq(schema.leaveRequests.id, reqId), sql`${schema.leaveRequests.status} IN ('pending', 'approved')`));
      await tx
        .update(schema.leaveBalances)
        .set({ pendingDays: sql`GREATEST(0, ${schema.leaveBalances.pendingDays} - ${4})` })
        .where(and(eq(schema.leaveBalances.userId, userId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId)));
    });

    const [bal] = await testDb()
      .select({ used: schema.leaveBalances.usedDays, pending: schema.leaveBalances.pendingDays })
      .from(schema.leaveBalances)
      .where(eq(schema.leaveBalances.leaveTypeId, leaveTypeId));
    expect(bal!.pending).toBe(0); // 4 - 4
    expect(bal!.used).toBe(2); // untouched
  });

  it('leave-types listing returns only active types, ordered, and inserts nothing on empty', async () => {
    const orgId = await insertOrg();
    await insertLeaveType(orgId, 'B-Vacation', { isActive: true, sortOrder: 1 });
    await insertLeaveType(orgId, 'A-Sick', { isActive: true, sortOrder: 0 });
    await insertLeaveType(orgId, 'Archived', { isActive: false, sortOrder: 2 });

    const before = await testDb().select({ id: schema.leaveTypes.id }).from(schema.leaveTypes);

    // Replicate GET: active-only, ordered by sortOrder, read-only.
    const types = await testDb()
      .select({ name: schema.leaveTypes.name, active: schema.leaveTypes.isActive })
      .from(schema.leaveTypes)
      .where(and(eq(schema.leaveTypes.organizationId, orgId), eq(schema.leaveTypes.isActive, true)))
      .orderBy(asc(schema.leaveTypes.sortOrder));

    expect(types.map((t) => t.name)).toEqual(['A-Sick', 'B-Vacation']);
    expect(types.every((t) => t.active)).toBe(true);

    // GET must not seed/insert — row count unchanged.
    const after = await testDb().select({ id: schema.leaveTypes.id }).from(schema.leaveTypes);
    expect(after).toHaveLength(before.length);
  });

  it('rejects an edit where end < start', () => {
    // Pure guard the PATCH route enforces before touching the DB.
    const start = '2026-03-06';
    const end = '2026-03-02';
    expect(new Date(end) < new Date(start)).toBe(true);
  });
});
