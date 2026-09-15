import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth, checkPermission } from '@/lib/auth/api-auth';
import { eq, desc, and, lte, gte, ne, or, sql } from 'drizzle-orm';
import { handleApiError } from '@/lib/api/db';
import { z } from 'zod';

export const runtime = 'nodejs';

const RequestCreateSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isHalfDay: z.boolean().optional().default(false),
    reason: z.string().min(1).max(1000),
    attachmentUrl: z.string().url().optional().nullable(),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

const RequestFilterSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

type RequestFilter = z.infer<typeof RequestFilterSchema>;

function calculateDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

// GET /api/leave-requests
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const url = new URL(request.url);
      const parsed = RequestFilterSchema.safeParse(Object.fromEntries(url.searchParams));
      const filters: RequestFilter = parsed.success ? parsed.data : { limit: 50 };

      const db = getDb();
      const conditions = [
        eq(schema.leaveRequests.organizationId, orgId!),
      ];

      // Visibility (was a bug: any authenticated user saw ALL org leave):
      //  - self: always sees own requests
      //  - a manager with `time:manage`: sees their department's requests
      //    (GM+/super_admin see all departments)
      //  - everyone else: only their own
      // Leave has no dept column; scope via the requester's user.departmentId.
      const canManageLeave = await checkPermission(user.id, 'time:manage');
      if (canManageLeave && scope.seeAllDepartments) {
        // sees everything in the org — no extra visibility filter
      } else if (canManageLeave) {
        // own requests OR same-department requests (joined via requester's dept).
        // A manager with no department only ever sees their own.
        conditions.push(
          scope.departmentId != null
            ? or(
                eq(schema.leaveRequests.userId, user.id),
                eq(schema.users.departmentId, scope.departmentId),
              )!
            : eq(schema.leaveRequests.userId, user.id),
        );
      } else {
        conditions.push(eq(schema.leaveRequests.userId, user.id));
      }

      if (filters.status) {
        conditions.push(eq(schema.leaveRequests.status, filters.status));
      }
      if (filters.userId) {
        conditions.push(eq(schema.leaveRequests.userId, filters.userId));
      }

      const requests = await db
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
          createdAt: schema.leaveRequests.createdAt,
          updatedAt: schema.leaveRequests.updatedAt,
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
        .where(and(...conditions))
        .orderBy(desc(schema.leaveRequests.createdAt))
        .limit(filters.limit);

      return NextResponse.json({ requests });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch leave requests');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'leave:list' },
);

// POST /api/leave-requests
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      const body = await request.json();
      const parsed = RequestCreateSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: parsed.error.errors.map(e => e.message).join(', ') } },
          { status: 400 },
        );
      }

      const { leaveTypeId, startDate, endDate, isHalfDay, reason, attachmentUrl } = parsed.data;
      const daysCount = isHalfDay ? 0.5 : calculateDays(startDate, endDate);

      const db = getDb();

      // Leave type must belong to THIS org and be active — otherwise a user
      // could submit against an archived or cross-org type.
      const [leaveType] = await db
        .select({ id: schema.leaveTypes.id })
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.id, leaveTypeId),
            eq(schema.leaveTypes.organizationId, orgId!),
            eq(schema.leaveTypes.isActive, true),
          ),
        )
        .limit(1);

      if (!leaveType) {
        return NextResponse.json(
          { error: { code: 'INVALID_LEAVE_TYPE', message: 'Leave type not found or inactive' } },
          { status: 400 },
        );
      }

      // Check for overlapping requests — new range overlaps existing if:
      // newStart <= existingEnd AND newEnd >= existingStart
      const newStart = new Date(startDate).toISOString().split('T')[0]!;
      const newEnd = new Date(endDate).toISOString().split('T')[0]!;

      const overlapping = await db
        .select({ id: schema.leaveRequests.id })
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.userId, user.id),
            eq(schema.leaveRequests.organizationId, orgId!),
            ne(schema.leaveRequests.status, 'cancelled'),
            ne(schema.leaveRequests.status, 'rejected'),
            lte(schema.leaveRequests.startDate, newEnd),
            gte(schema.leaveRequests.endDate, newStart),
          ),
        )
        .limit(1);

      if (overlapping.length > 0) {
        return NextResponse.json(
          { error: { code: 'OVERLAP', message: 'You already have a pending or approved request that overlaps with these dates' } },
          { status: 409 },
        );
      }

      const [created] = await db
        .insert(schema.leaveRequests)
        .values({
          organizationId: orgId!,
          userId: user.id,
          leaveTypeId,
          startDate,
          endDate,
          isHalfDay,
          daysCount,
          reason,
          attachmentUrl: attachmentUrl ?? null,
        })
        .returning();

      // Increment pending days in balance (create balance if not exists)
      const year = new Date(startDate).getFullYear();
      const existing = await db
        .select()
        .from(schema.leaveBalances)
        .where(
          and(
            eq(schema.leaveBalances.userId, user.id),
            eq(schema.leaveBalances.leaveTypeId, leaveTypeId),
            eq(schema.leaveBalances.year, year),
            eq(schema.leaveBalances.organizationId, orgId!),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(schema.leaveBalances)
          .set({
            pendingDays: sql`${schema.leaveBalances.pendingDays} + ${daysCount}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.leaveBalances.id, existing[0]!.id));
      }

      return NextResponse.json({ request: created }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create leave request');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'leave:create' },
);
