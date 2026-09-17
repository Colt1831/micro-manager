import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, asc, desc, and, isNull , type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { READONLY_STATUSES } from '@/lib/api/validation';
import { checkTaskAccessOrRespond } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

function getTaskIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/');
  const idIndex = segments.indexOf('tasks');
  return segments[idIndex + 1]!;
}

const ChecklistItemCreateSchema = z
  .object({
    content: z.string().min(1, 'Content is required').max(1000, 'Content too long'),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict('Unexpected fields');

const ChecklistItemUpdateSchema = z
  .object({
    content: z.string().min(1).max(1000).optional(),
    isChecked: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict('Unexpected fields');

// GET /api/tasks/[id]/checklist - List checklist items
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

      const items = await db()
        .select({
          id: schema.taskChecklistItems.id,
          taskId: schema.taskChecklistItems.taskId,
          content: schema.taskChecklistItems.content,
          isChecked: schema.taskChecklistItems.isChecked,
          checkedBy: schema.taskChecklistItems.checkedBy,
          checkedAt: schema.taskChecklistItems.checkedAt,
          sortOrder: schema.taskChecklistItems.sortOrder,
          createdAt: schema.taskChecklistItems.createdAt,
        })
        .from(schema.taskChecklistItems)
        .innerJoin(schema.tasks, eq(schema.taskChecklistItems.taskId, schema.tasks.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.taskChecklistItems.taskId, taskId),
            eq(schema.tasks.organizationId, orgId!),
            isNull(schema.tasks.deletedAt),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .orderBy(
          asc(schema.taskChecklistItems.sortOrder),
          asc(schema.taskChecklistItems.createdAt),
        );

      return NextResponse.json({ items });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch checklist');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'checklist:list' },
);

// POST /api/tasks/[id]/checklist - Create a checklist item
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = ChecklistItemCreateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid checklist item data',
              details: parsed.error.flatten().fieldErrors,
            },
          },
          { status: 400 },
        );
      }

      const { content, sortOrder } = parsed.data;

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

      // Existence + org scope + department wall, same guard the other task
      // sub-routes use (a walled user must not mutate another dept's checklist).
      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Block checklist mutations on closed/archived (read-only) tasks.
      if (READONLY_STATUSES.has(task!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify checklist on a '${task!.status}' task`,
            },
          },
          { status: 422 },
        );
      }

      // Determine next sort order if not provided
      let finalSortOrder = sortOrder;
      if (finalSortOrder === undefined) {
        const lastItem = await db()
          .select({ sortOrder: schema.taskChecklistItems.sortOrder })
          .from(schema.taskChecklistItems)
          .where(eq(schema.taskChecklistItems.taskId, taskId))
          .orderBy(desc(schema.taskChecklistItems.sortOrder))
          .limit(1);

        const lastOrder = lastItem[0]?.sortOrder ?? -1;
        finalSortOrder = lastOrder + 1;
      }

      const [item] = await db()
        .insert(schema.taskChecklistItems)
        .values({
          taskId,
          content,
          sortOrder: finalSortOrder,
        })
        .returning();

      if (!item) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create checklist item' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.checklist_item_added',
        entityType: 'task',
        entityId: taskId,
        newValues: { itemId: item.id, content },
      });

      return NextResponse.json({ item }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create checklist item');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'checklist:create' },
);

// PATCH /api/tasks/[id]/checklist - Update a checklist item (toggle, edit, reorder)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const itemId = request.nextUrl.searchParams.get('itemId');

      if (!itemId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'itemId is required' } },
          { status: 400 },
        );
      }

      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = ChecklistItemUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid update data',
              details: parsed.error.flatten().fieldErrors,
            },
          },
          { status: 400 },
        );
      }

      const { content, isChecked, sortOrder } = parsed.data;

      // Verify task exists and belongs to org
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

      // Existence + org scope + department wall, same guard the other task
      // sub-routes use (a walled user must not mutate another dept's checklist).
      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Block checklist mutations on closed/archived (read-only) tasks.
      if (READONLY_STATUSES.has(task!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify checklist on a '${task!.status}' task`,
            },
          },
          { status: 422 },
        );
      }

      // Verify item exists
      const [existing] = await db()
        .select()
        .from(schema.taskChecklistItems)
        .where(
          and(
            eq(schema.taskChecklistItems.id, itemId),
            eq(schema.taskChecklistItems.taskId, taskId),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Checklist item not found' } },
          { status: 404 },
        );
      }

      const updateData: Record<string, unknown> = {};

      if (content !== undefined) updateData.content = content;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

      if (isChecked !== undefined) {
        updateData.isChecked = isChecked;
        updateData.checkedBy = isChecked ? user.id : null;
        updateData.checkedAt = isChecked ? new Date() : null;
      }

      const [item] = await db()
        .update(schema.taskChecklistItems)
        .set(updateData)
        .where(eq(schema.taskChecklistItems.id, itemId))
        .returning();

      if (!item) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to update checklist item' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action:
          isChecked !== undefined
            ? isChecked
              ? 'task.checklist_item_checked'
              : 'task.checklist_item_unchecked'
            : 'task.checklist_item_updated',
        entityType: 'task',
        entityId: taskId,
        oldValues: { itemId, wasChecked: existing.isChecked },
        newValues: { itemId, isChecked: item.isChecked ?? false, content: item.content },
      });

      return NextResponse.json({ item });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update checklist item');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'checklist:update' },
);

// DELETE /api/tasks/[id]/checklist - Delete a checklist item
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const itemId = request.nextUrl.searchParams.get('itemId');

      if (!itemId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'itemId is required' } },
          { status: 400 },
        );
      }

      await requirePermission(user.id, 'task:edit');

      // Verify task exists and belongs to org
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

      // Existence + org scope + department wall, same guard the other task
      // sub-routes use (a walled user must not mutate another dept's checklist).
      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Block checklist mutations on closed/archived (read-only) tasks.
      if (READONLY_STATUSES.has(task!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify checklist on a '${task!.status}' task`,
            },
          },
          { status: 422 },
        );
      }

      const [existing] = await db()
        .select()
        .from(schema.taskChecklistItems)
        .where(
          and(
            eq(schema.taskChecklistItems.id, itemId),
            eq(schema.taskChecklistItems.taskId, taskId),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Checklist item not found' } },
          { status: 404 },
        );
      }

      await db().delete(schema.taskChecklistItems).where(eq(schema.taskChecklistItems.id, itemId));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.checklist_item_removed',
        entityType: 'task',
        entityId: taskId,
        oldValues: { itemId, content: existing.content },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete checklist item');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'checklist:delete' },
);
