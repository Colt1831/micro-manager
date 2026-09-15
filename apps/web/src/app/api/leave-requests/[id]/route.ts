import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth, checkPermission } from '@/lib/auth/api-auth';
import { eq, and, ne, lte, gte, sql } from 'drizzle-orm';
import { handleApiError, canAccessDept } from '@/lib/api/db';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

function calculateDays(startDate: string, endDate: string): number {
  const diffTime = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// GET /api/leave-requests/[id]
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      const db = getDb();
      const [leaveRequest] = await db
        .select({
          id: schema.leaveRequests.id,
          userId: schema.leaveRequests.userId,
          leaveTypeId: schema.leaveRequests.leaveTypeId,
          startDate: schema.leaveRequests.startDate,
          endDate: schema.leaveRequests.endDate,
          isHalfDay: schema.leaveRequests.isHalfDay,
          daysCount: schema.leaveRequests.daysCount,
          reason: schema.leaveRequests.reason,
          status: schema.leaveRequests.status,
          reviewedBy: schema.leaveRequests.reviewedBy,
          reviewedAt: schema.leaveRequests.reviewedAt,
          reviewNote: schema.leaveRequests.reviewNote,
          attachmentUrl: schema.leaveRequests.attachmentUrl,
          createdAt: schema.leaveRequests.createdAt,
          updatedAt: schema.leaveRequests.updatedAt,
          requesterDepartmentId: schema.users.departmentId,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
          leaveType: {
            id: schema.leaveTypes.id,
            name: schema.leaveTypes.name,
            slug: schema.leaveTypes.slug,
            color: schema.leaveTypes.color,
            icon: schema.leaveTypes.icon,
          },
        })
        .from(schema.leaveRequests)
        .leftJoin(schema.users, eq(schema.leaveRequests.userId, schema.users.id))
        .leftJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
        .where(
          and(
            eq(schema.leaveRequests.id, id),
            eq(schema.leaveRequests.organizationId, orgId!),
          ),
        )
        .limit(1);

      if (!leaveRequest) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Leave request not found' } },
          { status: 404 },
        );
      }

      // Visibility wall (was a bug: any authenticated user could read any
      // request by id). Allowed: the requester themselves, OR a manager with
      // `time:manage` whose department scope covers the requester's dept.
      const isOwn = leaveRequest.userId === user.id;
      if (!isOwn) {
        const canManageLeave = await checkPermission(user.id, 'time:manage');
        if (!canManageLeave || !canAccessDept(scope, leaveRequest.requesterDepartmentId)) {
          return NextResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Leave request not found' } },
            { status: 404 },
          );
        }
      }

      const { requesterDepartmentId: _omit, ...requestOut } = leaveRequest;
      return NextResponse.json({ request: requestOut });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'leave:get' },
);

// PATCH /api/leave-requests/[id]
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      const id = getIdFromPath(request);
      const db = getDb();
      const [existing] = await db
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.id, id),
            eq(schema.leaveRequests.organizationId, orgId!),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Leave request not found' } },
          { status: 404 },
        );
      }

      if (existing.userId !== user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You can only update your own requests' } },
          { status: 403 },
        );
      }

      if (existing.status !== 'pending') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Can only update pending requests' } },
          { status: 400 },
        );
      }

      const body = await request.json();

      // Only these fields are editable on a pending request. leaveTypeId is NOT
      // editable here (matches prior behavior).
      const newReason: string | undefined =
        typeof body.reason === 'string' ? body.reason : undefined;
      const newStartDate: string = typeof body.startDate === 'string' ? body.startDate : existing.startDate;
      const newEndDate: string = typeof body.endDate === 'string' ? body.endDate : existing.endDate;
      const newIsHalfDay: boolean =
        typeof body.isHalfDay === 'boolean' ? body.isHalfDay : (existing.isHalfDay ?? false);

      const datesOrHalfChanged =
        newStartDate !== existing.startDate ||
        newEndDate !== existing.endDate ||
        newIsHalfDay !== (existing.isHalfDay ?? false);

      if (newReason === undefined && !datesOrHalfChanged) {
        return NextResponse.json(
          { error: { code: 'NO_UPDATES', message: 'No valid fields to update' } },
          { status: 400 },
        );
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(newStartDate) === false || /^\d{4}-\d{2}-\d{2}$/.test(newEndDate) === false) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Dates must be YYYY-MM-DD' } },
          { status: 400 },
        );
      }

      if (new Date(newEndDate) < new Date(newStartDate)) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'End date must be on or after start date' } },
          { status: 400 },
        );
      }

      // Recompute daysCount/overlap/balance atomically when dates or isHalfDay
      // change. A read-modify-write across separate statements would race with a
      // concurrent approve/cancel, so the overlap re-check + balance delta live
      // in one transaction (mirrors the approve route).
      const oldDaysCount = existing.daysCount;
      const newDaysCount = newIsHalfDay ? 0.5 : calculateDays(newStartDate, newEndDate);

      const outcome = await db.transaction(async (tx) => {
        if (datesOrHalfChanged) {
          const start = new Date(newStartDate).toISOString().split('T')[0]!;
          const end = new Date(newEndDate).toISOString().split('T')[0]!;
          const overlapping = await tx
            .select({ id: schema.leaveRequests.id })
            .from(schema.leaveRequests)
            .where(
              and(
                eq(schema.leaveRequests.userId, existing.userId),
                eq(schema.leaveRequests.organizationId, orgId!),
                ne(schema.leaveRequests.id, id),
                ne(schema.leaveRequests.status, 'cancelled'),
                ne(schema.leaveRequests.status, 'rejected'),
                lte(schema.leaveRequests.startDate, end),
                gte(schema.leaveRequests.endDate, start),
              ),
            )
            .limit(1);

          if (overlapping.length > 0) return { kind: 'overlap' as const };
        }

        const [updated] = await tx
          .update(schema.leaveRequests)
          .set({
            ...(newReason !== undefined ? { reason: newReason } : {}),
            startDate: newStartDate,
            endDate: newEndDate,
            isHalfDay: newIsHalfDay,
            daysCount: newDaysCount,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.status, 'pending')))
          .returning();

        if (!updated) return { kind: 'invalid_state' as const };

        // Adjust the reserved pending days by the delta. GREATEST guards against
        // a stale/under-counted balance going negative.
        if (datesOrHalfChanged && newDaysCount !== oldDaysCount) {
          const year = new Date(existing.startDate).getFullYear();
          await tx
            .update(schema.leaveBalances)
            .set({
              pendingDays: sql`GREATEST(0, ${schema.leaveBalances.pendingDays} + ${newDaysCount - oldDaysCount})`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.leaveBalances.userId, existing.userId),
                eq(schema.leaveBalances.leaveTypeId, existing.leaveTypeId),
                eq(schema.leaveBalances.year, year),
                eq(schema.leaveBalances.organizationId, orgId!),
              ),
            );
        }

        return { kind: 'ok' as const, updated };
      });

      if (outcome.kind === 'overlap') {
        return NextResponse.json(
          { error: { code: 'OVERLAP', message: 'You already have a pending or approved request that overlaps with these dates' } },
          { status: 409 },
        );
      }
      if (outcome.kind === 'invalid_state') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Can only update pending requests' } },
          { status: 400 },
        );
      }

      return NextResponse.json({ request: outcome.updated });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'leave:update' },
);

// DELETE /api/leave-requests/[id] — Cancel a leave request
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      const db = getDb();
      // Fetch the request plus the requester's department (for manager scope).
      const [existing] = await db
        .select({
          id: schema.leaveRequests.id,
          userId: schema.leaveRequests.userId,
          leaveTypeId: schema.leaveRequests.leaveTypeId,
          startDate: schema.leaveRequests.startDate,
          daysCount: schema.leaveRequests.daysCount,
          status: schema.leaveRequests.status,
          requesterDepartmentId: schema.users.departmentId,
        })
        .from(schema.leaveRequests)
        .leftJoin(schema.users, eq(schema.leaveRequests.userId, schema.users.id))
        .where(
          and(
            eq(schema.leaveRequests.id, id),
            eq(schema.leaveRequests.organizationId, orgId!),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Leave request not found' } },
          { status: 404 },
        );
      }

      // Who can cancel: the owner, OR a `time:manage` manager whose department
      // scope covers the requester's department.
      const isOwn = existing.userId === user.id;
      if (!isOwn) {
        const canManageLeave = await checkPermission(user.id, 'time:manage');
        if (!canManageLeave || !canAccessDept(scope, existing.requesterDepartmentId)) {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'You can only cancel your own requests' } },
            { status: 403 },
          );
        }
      }

      if (existing.status !== 'pending' && existing.status !== 'approved') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Only pending or approved requests can be cancelled' } },
          { status: 400 },
        );
      }

      // Atomic + race-safe: the conditional UPDATE re-checks the status under
      // Postgres' row lock, so a concurrent approve+cancel can't both move the
      // balance. Whichever column was reserved (pending for a pending request,
      // used for an approved one) is released with atomic SQL (GREATEST guards
      // against underflow) — no read-modify-write lost update.
      const daysCount = existing.daysCount;
      const year = new Date(existing.startDate).getFullYear();

      const outcome = await db.transaction(async (tx) => {
        const [cancelled] = await tx
          .update(schema.leaveRequests)
          .set({
            status: 'cancelled',
            cancelledBy: user.id,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.leaveRequests.id, id),
              sql`${schema.leaveRequests.status} IN ('pending', 'approved')`,
            ),
          )
          .returning();

        if (!cancelled) return { kind: 'invalid_state' as const };

        // Restore the column that WAS reserved for the pre-cancel status.
        const col =
          existing.status === 'approved'
            ? schema.leaveBalances.usedDays
            : schema.leaveBalances.pendingDays;
        await tx
          .update(schema.leaveBalances)
          .set({
            [existing.status === 'approved' ? 'usedDays' : 'pendingDays']: sql`GREATEST(0, ${col} - ${daysCount})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.leaveBalances.userId, existing.userId),
              eq(schema.leaveBalances.leaveTypeId, existing.leaveTypeId),
              eq(schema.leaveBalances.year, year),
              eq(schema.leaveBalances.organizationId, orgId!),
            ),
          );

        return { kind: 'ok' as const, cancelled };
      });

      if (outcome.kind === 'invalid_state') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Only pending or approved requests can be cancelled' } },
          { status: 400 },
        );
      }

      return NextResponse.json({ request: outcome.cancelled });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to cancel leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'leave:cancel' },
);
