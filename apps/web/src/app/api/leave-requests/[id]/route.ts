import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth, checkPermission } from '@/lib/auth/api-auth';
import { eq, and } from 'drizzle-orm';
import { handleApiError, canAccessDept } from '@/lib/api/db';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
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
      const updates: Record<string, string | boolean | Date> = {};

      if (body.reason) updates.reason = body.reason;
      if (body.startDate) updates.startDate = body.startDate;
      if (body.endDate) updates.endDate = body.endDate;
      if (typeof body.isHalfDay === 'boolean') updates.isHalfDay = body.isHalfDay;

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: { code: 'NO_UPDATES', message: 'No valid fields to update' } },
          { status: 400 },
        );
      }

      updates.updatedAt = new Date();

      const [updated] = await db
        .update(schema.leaveRequests)
        .set(updates)
        .where(eq(schema.leaveRequests.id, id))
        .returning();

      return NextResponse.json({ request: updated });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'leave:update' },
);

// DELETE /api/leave-requests/[id] — Cancel a leave request
export const DELETE = withAuth(
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
          { error: { code: 'FORBIDDEN', message: 'You can only cancel your own requests' } },
          { status: 403 },
        );
      }

      if (existing.status !== 'pending') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Can only cancel pending requests' } },
          { status: 400 },
        );
      }

      const [cancelled] = await db
        .update(schema.leaveRequests)
        .set({
          status: 'cancelled',
          cancelledBy: user.id,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.leaveRequests.id, id))
        .returning();

      // Remove pending days from balance
      const year = new Date(existing.startDate).getFullYear();
      const balance = await db
        .select()
        .from(schema.leaveBalances)
        .where(
          and(
            eq(schema.leaveBalances.userId, user.id),
            eq(schema.leaveBalances.leaveTypeId, existing.leaveTypeId),
            eq(schema.leaveBalances.year, year),
            eq(schema.leaveBalances.organizationId, orgId!),
          ),
        )
        .limit(1);

      if (balance.length > 0) {
        await db
          .update(schema.leaveBalances)
          .set({
            pendingDays: Math.max(0, balance[0]!.pendingDays - existing.daysCount),
            updatedAt: new Date(),
          })
          .where(eq(schema.leaveBalances.id, balance[0]!.id));
      }

      return NextResponse.json({ request: cancelled });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to cancel leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'leave:cancel' },
);
