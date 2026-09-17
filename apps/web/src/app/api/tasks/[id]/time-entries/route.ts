import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, recalcTaskHours, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull , type SQL } from 'drizzle-orm';
import { TimeEntryCreateSchema, validationError } from '@/lib/api/validation';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';
import { isUniqueViolation } from '@/lib/db-errors';

/** Partial unique index guaranteeing at most one running timer per user. */
const RUNNING_TIMER_INDEX = 'idx_time_entries_one_running_timer';

export const runtime = 'nodejs';

// GET /api/tasks/[id]/time-entries — List time entries for a task
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);

      await requirePermission(user.id, 'task:view');

      // Wall first: a cross-department task must 404 here exactly as it does on
      // /api/tasks/[id]. Scoping only the list query would answer 200 with an
      // empty array, which still confirms the id exists.
      const [parentTask] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      const accessError = checkTaskAccessOrRespond(parentTask, orgId, { scope });
      if (accessError) return accessError;

      const entries = await db()
        .select({
          id: schema.timeEntries.id,
          taskId: schema.timeEntries.taskId,
          userId: schema.timeEntries.userId,
          startTime: schema.timeEntries.startTime,
          endTime: schema.timeEntries.endTime,
          durationMinutes: schema.timeEntries.durationMinutes,
          entryType: schema.timeEntries.entryType,
          description: schema.timeEntries.description,
          createdAt: schema.timeEntries.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .leftJoin(schema.users, eq(schema.timeEntries.userId, schema.users.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.timeEntries.taskId, taskId), eq(schema.tasks.organizationId, orgId!),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .orderBy(desc(schema.timeEntries.startTime));

      return NextResponse.json({ entries });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch time entries');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'time-entries:list' },
);

// POST /api/tasks/[id]/time-entries — Start a timer or log manual time
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = TimeEntryCreateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { entryType, durationMinutes, description, startTime, endTime } = parsed.data;

      // Verify task exists, belongs to org, and is not read-only
      const [task] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
          status: schema.tasks.status,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      // Shared helper checks task existence + org scope
      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Block time entries on archived/closed tasks
      if (task!.status === 'archived' || task!.status === 'closed') {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: 'Cannot log time on archived or closed tasks',
            },
          },
          { status: 422 },
        );
      }

      if (entryType === 'timer') {
        // A task timer requires an open shift (attendance envelope + guard).
        const [openShift] = await db()
          .select({ id: schema.shifts.id })
          .from(schema.shifts)
          .where(and(eq(schema.shifts.userId, user.id), isNull(schema.shifts.clockOut)))
          .limit(1);

        if (!openShift) {
          return NextResponse.json(
            { error: { code: 'NO_OPEN_SHIFT', message: 'Clock in first to start a timer.' } },
            { status: 422 },
          );
        }

        // Check no other running timer exists for this user. Filter entry_type =
        // 'timer' to match the partial unique index (WHERE end_time IS NULL AND
        // entry_type = 'timer'); an open manual entry must not count here.
        const [existing] = await db()
          .select({ id: schema.timeEntries.id })
          .from(schema.timeEntries)
          .where(
            and(
              eq(schema.timeEntries.userId, user.id),
              isNull(schema.timeEntries.endTime),
              eq(schema.timeEntries.entryType, 'timer'),
            ),
          )
          .limit(1);

        if (existing) {
          return NextResponse.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'You already have a running timer. Stop it first.',
              },
            },
            { status: 409 },
          );
        }
      }

      const now = new Date();
      let entry;
      try {
        [entry] = await db()
          .insert(schema.timeEntries)
          .values({
            taskId,
            userId: user.id,
            startTime: entryType === 'timer' ? now : (startTime ?? now),
            endTime: entryType === 'timer' ? null : (endTime ?? (startTime ? now : null)),
            durationMinutes: entryType === 'timer' ? null : (durationMinutes ?? null),
            entryType,
            description: description ?? null,
          })
          .returning();
      } catch (insertError) {
        // A DB partial unique index guarantees one running timer per user. If a
        // concurrent "start timer" slipped past the check above, the second
        // insert violates it here — surface the same friendly 409 instead of 500.
        if (isUniqueViolation(insertError, RUNNING_TIMER_INDEX)) {
          return NextResponse.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'You already have a running timer. Stop it first.',
              },
            },
            { status: 409 },
          );
        }
        throw insertError;
      }

      if (!entry) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create time entry' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'time_entry.created',
        entityType: 'task',
        entityId: taskId,
        newValues: { entryId: entry.id, entryType },
      });

      // Update task actual hours
      await recalcTaskHours(taskId);

      // Fetch with user info
      const [entryWithUser] = await db()
        .select({
          id: schema.timeEntries.id,
          taskId: schema.timeEntries.taskId,
          userId: schema.timeEntries.userId,
          startTime: schema.timeEntries.startTime,
          endTime: schema.timeEntries.endTime,
          durationMinutes: schema.timeEntries.durationMinutes,
          entryType: schema.timeEntries.entryType,
          description: schema.timeEntries.description,
          createdAt: schema.timeEntries.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.timeEntries)
        .leftJoin(schema.users, eq(schema.timeEntries.userId, schema.users.id))
        .where(eq(schema.timeEntries.id, entry.id))
        .limit(1);

      return NextResponse.json({ entry: entryWithUser }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create time entry');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'time-entries:create' },
);

// PATCH /api/tasks/[id]/time-entries — Stop a running timer or update an existing entry
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const entryId = request.nextUrl.searchParams.get('entryId');
      const body = await request.json().catch(() => ({}));

      if (!entryId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'entryId is required' } },
          { status: 400 },
        );
      }

      // Find the entry and verify ownership + org scope
      const [existing] = await db()
        .select({
          id: schema.timeEntries.id,
          userId: schema.timeEntries.userId,
          endTime: schema.timeEntries.endTime,
          startTime: schema.timeEntries.startTime,
          durationMinutes: schema.timeEntries.durationMinutes,
          entryType: schema.timeEntries.entryType,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.timeEntries.id, entryId),
            eq(schema.timeEntries.taskId, taskId),
            eq(schema.tasks.organizationId, orgId!),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Time entry not found' } },
          { status: 404 },
        );
      }

      // Only the owner can modify their entries
      if (existing.userId !== user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You can only modify your own time entries' } },
          { status: 403 },
        );
      }

      const now = new Date();

      // If entry is stopped and body has durationMinutes, update the duration (drag-to-resize)
      if (existing.endTime && body.durationMinutes !== undefined) {
        // Timer-produced entries are the "exact and correct" record — their
        // duration is not freely editable. A change must go through the
        // time-correction approval workflow (POST /api/time-corrections).
        // Manual entries remain directly editable; stopping a running timer and
        // description edits (handled below) stay allowed.
        if (existing.entryType === 'timer') {
          return NextResponse.json(
            {
              error: {
                code: 'CORRECTION_REQUIRED',
                message:
                  'Timer durations cannot be edited directly. Submit a time-correction request for approval.',
              },
            },
            { status: 422 },
          );
        }

        const durationMinutes = Math.max(1, Math.round(Number(body.durationMinutes)));
        if (isNaN(durationMinutes)) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid durationMinutes' } },
            { status: 400 },
          );
        }

        const [updated] = await db()
          .update(schema.timeEntries)
          .set({
            durationMinutes,
            updatedAt: now,
          })
          .where(eq(schema.timeEntries.id, entryId))
          .returning();

        if (!updated) {
          return NextResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Failed to update time entry' } },
            { status: 500 },
          );
        }

        // Update task actual hours
        await recalcTaskHours(taskId);

        return NextResponse.json({ entry: updated });
      }

      // If entry has endTime and no durationMinutes in body, allow description update
      if (existing.endTime && body.description !== undefined) {
        const [updated] = await db()
          .update(schema.timeEntries)
          .set({ description: body.description ?? null, updatedAt: now })
          .where(eq(schema.timeEntries.id, entryId))
          .returning();

        return NextResponse.json({ entry: updated });
      }

      // Otherwise: stop a running timer (original behavior)
      if (existing.endTime) {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Timer is already stopped' } },
          { status: 422 },
        );
      }

      const elapsedMs = now.getTime() - new Date(existing.startTime).getTime();
      const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));
      const description = body.description ?? null;

      const [updated] = await db()
        .update(schema.timeEntries)
        .set({
          endTime: now,
          durationMinutes,
          description,
          updatedAt: now,
        })
        .where(eq(schema.timeEntries.id, entryId))
        .returning();

      if (!updated) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to stop timer' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'time_entry.stopped',
        entityType: 'task',
        entityId: taskId,
        newValues: { entryId: updated.id, durationMinutes },
      });

      await recalcTaskHours(taskId);

      const [entryWithUser] = await db()
        .select({
          id: schema.timeEntries.id,
          taskId: schema.timeEntries.taskId,
          userId: schema.timeEntries.userId,
          startTime: schema.timeEntries.startTime,
          endTime: schema.timeEntries.endTime,
          durationMinutes: schema.timeEntries.durationMinutes,
          entryType: schema.timeEntries.entryType,
          description: schema.timeEntries.description,
          createdAt: schema.timeEntries.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.timeEntries)
        .leftJoin(schema.users, eq(schema.timeEntries.userId, schema.users.id))
        .where(eq(schema.timeEntries.id, updated.id))
        .limit(1);

      return NextResponse.json({ entry: entryWithUser });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update time entry');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'time-entries:update' },
);

// DELETE /api/tasks/[id]/time-entries — Delete a time entry
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const entryId = request.nextUrl.searchParams.get('entryId');

      if (!entryId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'entryId is required' } },
          { status: 400 },
        );
      }

      const [existing] = await db()
        .select({
          id: schema.timeEntries.id,
          userId: schema.timeEntries.userId,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.timeEntries.id, entryId),
            eq(schema.timeEntries.taskId, taskId),
            eq(schema.tasks.organizationId, orgId!),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Time entry not found' } },
          { status: 404 },
        );
      }

      // Only owner can delete their entries
      if (existing.userId !== user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You can only delete your own time entries' } },
          { status: 403 },
        );
      }

      await db().delete(schema.timeEntries).where(eq(schema.timeEntries.id, entryId));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'time_entry.deleted',
        entityType: 'task',
        entityId: taskId,
        oldValues: { entryId },
      });

      // Update task actual hours
      await recalcTaskHours(taskId);

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete time entry');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'time-entries:delete' },
);

