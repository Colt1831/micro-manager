import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, recalcTaskHours } from '@/lib/api/db';
import { withAuth } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { isUniqueViolation } from '@/lib/db-errors';

/** Partial unique index guaranteeing at most one open shift per user. */
const OPEN_SHIFT_INDEX = 'idx_shifts_one_open_per_user';

export const runtime = 'nodejs';

// ─── GET /api/shifts/current — the user's currently-open shift (or null) ──

export const GET = withAuth(
  async (_request: NextRequest, { user }) => {
    try {
      const [shift] = await db()
        .select({
          id: schema.shifts.id,
          userId: schema.shifts.userId,
          clockIn: schema.shifts.clockIn,
          clockOut: schema.shifts.clockOut,
          source: schema.shifts.source,
        })
        .from(schema.shifts)
        .where(and(eq(schema.shifts.userId, user.id), isNull(schema.shifts.clockOut)))
        .limit(1);

      return NextResponse.json({ open: !!shift, shift: shift ?? null });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch current shift');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'shifts:current' },
);

// ─── POST /api/shifts/current — clock in (open a shift) ──
// 409 if one is already open. The partial unique index closes the race.

export const POST = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      const [existing] = await db()
        .select({ id: schema.shifts.id })
        .from(schema.shifts)
        .where(and(eq(schema.shifts.userId, user.id), isNull(schema.shifts.clockOut)))
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'You are already clocked in.' } },
          { status: 409 },
        );
      }

      let shift;
      try {
        [shift] = await db()
          .insert(schema.shifts)
          .values({ userId: user.id, organizationId: orgId!, clockIn: new Date(), source: 'web' })
          .returning();
      } catch (insertError) {
        if (isUniqueViolation(insertError, OPEN_SHIFT_INDEX)) {
          return NextResponse.json(
            { error: { code: 'CONFLICT', message: 'You are already clocked in.' } },
            { status: 409 },
          );
        }
        throw insertError;
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'shift.clocked_in',
        entityType: 'shift',
        entityId: shift!.id,
      });

      return NextResponse.json({ shift }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to clock in');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'shifts:clock-in' },
);

// ─── DELETE /api/shifts/current — clock out (close the open shift) ──
// Auto-stops any running task timer first so no timer bleeds past the shift,
// then closes the shift. All timestamps are server now().

export const DELETE = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      const [shift] = await db()
        .select({ id: schema.shifts.id })
        .from(schema.shifts)
        .where(and(eq(schema.shifts.userId, user.id), isNull(schema.shifts.clockOut)))
        .limit(1);

      if (!shift) {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'You are not clocked in.' } },
          { status: 422 },
        );
      }

      const now = new Date();

      // Auto-stop a running task timer (entry_type = 'timer', no end_time) so
      // worked time never extends beyond the shift. Duration is elapsed minutes.
      const [running] = await db()
        .select({
          id: schema.timeEntries.id,
          taskId: schema.timeEntries.taskId,
          startTime: schema.timeEntries.startTime,
        })
        .from(schema.timeEntries)
        .where(
          and(
            eq(schema.timeEntries.userId, user.id),
            isNull(schema.timeEntries.endTime),
            eq(schema.timeEntries.entryType, 'timer'),
          ),
        )
        .limit(1);

      if (running) {
        const durationMinutes = Math.max(
          1,
          Math.round((now.getTime() - new Date(running.startTime).getTime()) / 60000),
        );
        await db()
          .update(schema.timeEntries)
          .set({ endTime: now, durationMinutes, updatedAt: now })
          .where(eq(schema.timeEntries.id, running.id));
        await recalcTaskHours(running.taskId);
      }

      const [closed] = await db()
        .update(schema.shifts)
        .set({ clockOut: now })
        .where(and(eq(schema.shifts.id, shift.id), isNull(schema.shifts.clockOut)))
        .returning();

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'shift.clocked_out',
        entityType: 'shift',
        entityId: shift.id,
        newValues: running ? { autoStoppedTimerId: running.id } : undefined,
      });

      return NextResponse.json({ shift: closed, autoStoppedTimer: running?.id ?? null });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to clock out');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'shifts:clock-out' },
);
