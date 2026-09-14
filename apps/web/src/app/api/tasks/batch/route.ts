import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  VALID_PRIORITIES,
  READONLY_STATUSES,
  isValidTransition,
} from '@/lib/api/validation';
import { validateAssignment } from '@/lib/api/assignment';
import { indexTask, removeTaskFromIndex } from '@/lib/search';

export const runtime = 'nodejs';

export const BatchUpdateSchema = z
  .object({
    taskIds: z
      .array(z.string().uuid())
      .min(1, 'At least one task ID is required')
      .max(100, 'Maximum 100 tasks per batch operation'),
    action: z.enum([
      'change_status',
      'change_priority',
      'assign',
      'delete',
      'restore',
      'permanent_delete',
    ]),
    value: z.string().min(1, 'Value is required'),
  })
  .strict('Unexpected fields');

// POST /api/tasks/batch - Perform batch operations on tasks
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const body = await request.json();
      const parsed = BatchUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid batch operation data',
              details: parsed.error.flatten().fieldErrors,
            },
          },
          { status: 400 },
        );
      }

      const { taskIds, action, value } = parsed.data;

      // For restore/permanent_delete, find deleted tasks; for other actions, find active tasks
      const deletedCondition =
        action === 'restore' || action === 'permanent_delete'
          ? sql`${schema.tasks.deletedAt} IS NOT NULL`
          : isNull(schema.tasks.deletedAt);

      // Verify all tasks exist and belong to the org. Load status + department so
      // the same transition + dept-wall rules single updates enforce apply here.
      const tasks = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          status: schema.tasks.status,
          title: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          assignedTo: schema.tasks.assignedTo,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(inArray(schema.tasks.id, taskIds), deletedCondition));

      if (tasks.length !== taskIds.length) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'One or more tasks not found' } },
          { status: 404 },
        );
      }

      // Verify all tasks belong to the same org AND are within the actor's
      // department wall (a walled user cannot batch-touch cross-dept tasks).
      for (const task of tasks) {
        if (task.organizationId !== orgId) {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'Cross-organization operation denied' } },
            { status: 403 },
          );
        }
        if (!canAccessDept(scope, task.departmentId)) {
          return NextResponse.json(
            { error: { code: 'NOT_FOUND', message: 'One or more tasks not found' } },
            { status: 404 },
          );
        }
      }

      // Check for read-only tasks (skip for restore and permanent_delete actions)
      if (action !== 'restore' && action !== 'permanent_delete') {
        const readOnlyTasks = tasks.filter((t) => READONLY_STATUSES.has(t.status));
        if (readOnlyTasks.length > 0) {
          return NextResponse.json(
            {
              error: {
                code: 'INVALID_STATE',
                message: `Cannot modify ${readOnlyTasks.length} task(s) with closed or archived status`,
              },
            },
            { status: 422 },
          );
        }
      }

      let updatedCount = 0;

      if (action === 'restore') {
        // Batch restore soft-deleted tasks
        await requirePermission(user.id, 'task:delete');

        await db()
          .update(schema.tasks)
          .set({ deletedAt: null, updatedAt: new Date(), updatedBy: user.id })
          .where(inArray(schema.tasks.id, taskIds));

        for (const task of tasks) {
          indexTask({
            id: task.id,
            title: task.title,
            description: null,
            taskIdDisplay: task.taskIdDisplay,
            status: task.status,
            priority: 'medium',
            assignedTo: task.assignedTo ?? null,
            projectId: null,
            organizationId: orgId!,
            labels: null,
            tags: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        updatedCount = taskIds.length;
      } else if (action === 'delete') {
        // Bulk soft delete
        await requirePermission(user.id, 'task:delete');

        await db()
          .update(schema.tasks)
          .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
          .where(inArray(schema.tasks.id, taskIds));

        for (const task of tasks) removeTaskFromIndex(task.id);

        updatedCount = taskIds.length;
      } else if (action === 'change_status') {
        await requirePermission(user.id, 'task:edit');

        // Same state machine as the single-update path: every task must have a
        // VALID transition to the target status — no bypass, no direct write.
        for (const task of tasks) {
          if (task.status === value) continue;
          if (!isValidTransition(task.status, value)) {
            return NextResponse.json(
              {
                error: {
                  code: 'INVALID_STATE',
                  message: `Invalid status transition from '${task.status}' to '${value}' for task ${task.taskIdDisplay}`,
                },
              },
              { status: 422 },
            );
          }
        }

        // Per-status permission parity with the single-update path.
        if (value === 'closed') await requirePermission(user.id, 'task:close');
        if (value === 'reopened') await requirePermission(user.id, 'task:reopen');

        const now = new Date();
        for (const task of tasks) {
          if (task.status === value) continue;

          const patch: Record<string, unknown> = {
            status: value,
            updatedBy: user.id,
            updatedAt: now,
          };
          if (value === 'completed') {
            patch.completedAt = now;
            patch.completionSummary = `${task.title} completed by ${user.id}`;
          }
          if (value === 'closed') {
            patch.closedAt = now;
            patch.closedBy = user.id;
          }

          await db().update(schema.tasks).set(patch).where(eq(schema.tasks.id, task.id));

          // History parity with single update.
          await db()
            .insert(schema.taskHistory)
            .values({
              taskId: task.id,
              userId: user.id,
              field: 'status',
              oldValue: task.status,
              newValue: value,
              changeType: 'status_change',
              description: `Status changed from ${task.status} to ${value}`,
            });

          // Reindex parity.
          indexTask({
            id: task.id,
            title: task.title,
            description: null,
            taskIdDisplay: task.taskIdDisplay,
            status: value,
            priority: 'medium',
            assignedTo: task.assignedTo ?? null,
            projectId: null,
            organizationId: orgId!,
            labels: null,
            tags: null,
            createdAt: new Date().toISOString(),
            updatedAt: now.toISOString(),
          });

          // Notification parity: notify the assignee (unless they made the change).
          if (task.assignedTo && task.assignedTo !== user.id) {
            await createNotification({
              organizationId: orgId!,
              userId: task.assignedTo,
              type:
                value === 'completed'
                  ? 'task.completed'
                  : value === 'closed'
                    ? 'task.closed'
                    : value === 'reopened'
                      ? 'task.reopened'
                      : 'task.status_changed',
              title: `${task.title} moved to ${value}`,
              message: `Status changed from ${task.status} to ${value}`,
              link: `/tasks/${task.id}`,
              actorId: user.id,
              entityType: 'task',
              entityId: task.id,
            });
          }
        }

        updatedCount = taskIds.length;
      } else if (action === 'change_priority') {
        if (!VALID_PRIORITIES.includes(value as (typeof VALID_PRIORITIES)[number])) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: `Invalid priority: '${value}'` } },
            { status: 400 },
          );
        }

        await requirePermission(user.id, 'task:edit');

        await db()
          .update(schema.tasks)
          .set({ priority: value, updatedBy: user.id, updatedAt: new Date() })
          .where(inArray(schema.tasks.id, taskIds));

        updatedCount = taskIds.length;
      } else if (action === 'permanent_delete') {
        // Batch permanent delete
        await requirePermission(user.id, 'task:delete');

        await db().delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));

        for (const task of tasks) removeTaskFromIndex(task.id);

        updatedCount = taskIds.length;
      } else if (action === 'assign') {
        await requirePermission(user.id, 'task:assign');

        // Same downward+department rule as single-assign (§4), via the shared helper.
        const denial = await validateAssignment(scope, value, orgId);
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }

        await db()
          .update(schema.tasks)
          .set({
            assignedTo: value,
            assignedBy: user.id,
            updatedBy: user.id,
            updatedAt: new Date(),
          })
          .where(inArray(schema.tasks.id, taskIds));

        // History + notification parity for each newly assigned task.
        for (const task of tasks) {
          if (task.assignedTo === value) continue;

          await db()
            .insert(schema.taskHistory)
            .values({
              taskId: task.id,
              userId: user.id,
              field: 'assignedTo',
              oldValue: task.assignedTo ?? null,
              newValue: value,
              changeType: 'assignment',
              description: `Assigned to ${value}`,
            });

          await createNotification({
            organizationId: orgId!,
            userId: value,
            type: 'task.assigned',
            title: `You've been assigned: ${task.title}`,
            message: `Task #${task.taskIdDisplay} was assigned to you (batch)`,
            link: `/tasks/${task.id}`,
            actorId: user.id,
            entityType: 'task',
            entityId: task.id,
          });
        }

        updatedCount = taskIds.length;
      }

      // Audit the batch operation
      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: `tasks.batch_${action}`,
        entityType: 'task',
        newValues: { taskIds, action, value, updatedCount },
      });

      return NextResponse.json({
        success: true,
        updatedCount,
        action,
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to perform batch operation');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'tasks:batch' },
);
