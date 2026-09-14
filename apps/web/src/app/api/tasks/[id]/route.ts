import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept, resolveTaskDepartment } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { eq, and, isNull } from 'drizzle-orm';
import {
  TaskUpdateSchema,
  validationError,
  isValidTransition,
  READONLY_STATUSES,
} from '@/lib/api/validation';
import { sanitizeRichText } from '@/lib/sanitize';
import type { AutomationContext } from '@/lib/automation/engine';
import { indexTask, removeTaskFromIndex } from '@/lib/search';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { extractAndResolveMentions } from '@/lib/mentions';
import { validateAssignment } from '@/lib/api/assignment';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  return request.nextUrl.pathname.split('/').pop()!;
}

// GET /api/tasks/[id] - Get single task (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'task:view');

      const [task] = await db()
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (!task) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(task.organizationId, orgId);

      // Department wall: a walled user must not read a task outside their dept.
      // 404 (not 403) so a cross-dept id is indistinguishable from a missing one.
      if (!canAccessDept(scope, task.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      return NextResponse.json({ task });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'tasks:get' },
);

// PATCH /api/tasks/[id] - Update task (rate limited: 60 req/min per user)
export const PATCH = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = TaskUpdateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const {
        title,
        description: rawDescription,
        status,
        priority,
        assignedTo,
        dueDate,
        projectId,
      } = parsed.data;
      // Preserve `undefined` when description is not in the update body,
      // so the `if (description !== undefined)` check below skips it correctly.
      const description =
        rawDescription !== undefined ? sanitizeRichText(rawDescription) : rawDescription;

      const [existing] = await db()
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot mutate a task outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      // ── Readonly enforcement: closed/archived tasks are locked for generic
      // edits, but a VALID status transition out of them must still work
      // (e.g. closed → reopened, closed → archived per TASK_STATUS_TRANSITIONS).
      // So the only mutation permitted on a readonly task is a status change to
      // a valid target — any other field, or an invalid/absent transition, is
      // rejected. This runs BEFORE the transition check below, which validates
      // the target itself.
      if (READONLY_STATUSES.has(existing.status)) {
        const otherFieldChanged =
          title !== undefined ||
          description !== undefined ||
          priority !== undefined ||
          assignedTo !== undefined ||
          projectId !== undefined ||
          dueDate !== undefined;
        const isStatusTransition =
          status !== undefined &&
          status !== existing.status &&
          isValidTransition(existing.status, status);

        if (otherFieldChanged || !isStatusTransition) {
          return NextResponse.json(
            {
              error: {
                code: 'INVALID_STATE',
                message: `Tasks with status '${existing.status}' cannot be edited`,
              },
            },
            { status: 422 },
          );
        }
      }

      // ── Status transition enforcement ──
      if (status !== undefined && status !== existing.status) {
        if (!isValidTransition(existing.status, status)) {
          return NextResponse.json(
            {
              error: {
                code: 'INVALID_STATE',
                message: `Invalid status transition from '${existing.status}' to '${status}'`,
              },
            },
            { status: 422 },
          );
        }

        // Require 'task:close' permission for closing tasks
        if (status === 'closed') {
          await requirePermission(user.id, 'task:close');
        }
        // Require 'task:reopen' for reopening
        if (status === 'reopened') {
          await requirePermission(user.id, 'task:reopen');
        }
      }

      // ── Validate assignedTo via the shared downward+department rule (§4) ──
      if (assignedTo !== undefined && assignedTo !== null) {
        const denial = await validateAssignment(scope, assignedTo, orgId);
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }
      }

      // ── Validate projectId belongs to same org (if changing) ──
      if (projectId !== undefined && projectId !== null) {
        const [project] = await db()
          .select({ id: schema.projects.id, organizationId: schema.projects.organizationId })
          .from(schema.projects)
          .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
          .limit(1);
        if (!project) {
          return NextResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Project not found' } },
            { status: 404 },
          );
        }
        if (project.organizationId !== orgId) {
          return NextResponse.json(
            { error: { code: 'FORBIDDEN', message: 'Cross-organization project access denied' } },
            { status: 403 },
          );
        }
      }

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};

      if (title !== undefined) {
        oldValues.title = existing.title;
        newValues.title = title;
      }
      if (description !== undefined) {
        oldValues.description = existing.description;
        newValues.description = description;
      }
      if (status !== undefined) {
        oldValues.status = existing.status;
        newValues.status = status;
      }
      if (priority !== undefined) {
        oldValues.priority = existing.priority;
        newValues.priority = priority;
      }
      if (assignedTo !== undefined) {
        oldValues.assignedTo = existing.assignedTo;
        newValues.assignedTo = assignedTo;
        newValues.assignedBy = user.id;
      }
      if (projectId !== undefined) {
        oldValues.projectId = existing.projectId;
        newValues.projectId = projectId;
      }
      if (dueDate !== undefined) {
        oldValues.dueDate = existing.dueDate;
        newValues.dueDate = dueDate;
      }

      const updateData: Record<string, unknown> = {
        ...newValues,
        updatedBy: user.id,
        updatedAt: new Date(),
      };

      // Track assigned_by if assignee changed
      if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
        updateData.assignedBy = user.id;
        // Keep the denormalized department in sync so the wall follows the task
        // to its new assignee: new assignee's dept -> existing team -> creator.
        updateData.departmentId = await resolveTaskDepartment({
          assignedTo,
          teamId: existing.teamId,
          createdBy: existing.createdBy,
        });
      }

      // Track completion time
      if (status === 'completed' && existing.status !== 'completed') {
        updateData.completedAt = new Date();
        updateData.completionSummary = `${existing.title} completed by ${user.id}`;
      }

      // Track closure time
      if (status === 'closed' && existing.status !== 'closed') {
        updateData.closedAt = new Date();
        updateData.closedBy = user.id;
      }

      // ── Detect @mention changes in description BEFORE the write so the new
      // mention set actually persists (previously assigned after the update). ──
      let newMentionedIds: string[] = [];
      if (description !== undefined) {
        newMentionedIds = await extractAndResolveMentions(orgId!, description, user.id);
        const currentMentioned = (existing.mentionedUserIds as string[] | null) ?? [];
        const allMentioned = Array.from(new Set([...currentMentioned, ...newMentionedIds]));
        updateData.mentionedUserIds = allMentioned;
      }

      const [task] = await db()
        .update(schema.tasks)
        .set(updateData)
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)))
        .returning();

      if (!task) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      if (Object.keys(oldValues).length > 0) {
        const auditAction =
          status && status !== existing.status ? 'task.status_changed' : 'task.updated';
        await createAuditEntry({
          organizationId: orgId,
          userId: user.id,
          action: auditAction,
          entityType: 'task',
          entityId: id,
          oldValues,
          newValues,
        });

        if (status && status !== existing.status) {
          await db()
            .insert(schema.taskHistory)
            .values({
              taskId: id,
              userId: user.id,
              field: 'status',
              oldValue: existing.status,
              newValue: status,
              changeType: 'status_change',
              description: `Status changed from ${existing.status} to ${status}`,
            });
        }
      }

      // ── Create notifications for assignment changes ────────────
      if (assignedTo !== undefined && assignedTo !== existing.assignedTo && assignedTo !== null) {
        await createNotification({
          organizationId: orgId!,
          userId: assignedTo,
          type: 'task.assigned',
          title: `You've been assigned: ${existing.title}`,
          message: `Task #${existing.taskIdDisplay} was assigned to you`,
          link: `/tasks/${id}`,
          actorId: user.id,
          entityType: 'task',
          entityId: id,
        });
      }

      // ── Notify newly mentioned users ──────────────────────────
      if (newMentionedIds.length > 0) {
        const currentMentioned = (existing.mentionedUserIds as string[] | null) ?? [];
        const newlyMentioned = newMentionedIds.filter((id) => !currentMentioned.includes(id));
        for (const mentionedId of newlyMentioned) {
          if (mentionedId === user.id) continue;
          if (mentionedId === assignedTo && assignedTo === existing.assignedTo) continue;

          await createNotification({
            organizationId: orgId!,
            userId: mentionedId,
            type: 'task.mention',
            title: `You were mentioned in: ${existing.title}`,
            message: description?.substring(0, 200) ?? '',
            link: `/tasks/${id}`,
            actorId: user.id,
            entityType: 'task',
            entityId: id,
          });
        }
      }

      // ── Create notifications for status changes ───────────────
      if (status !== undefined && status !== existing.status && existing.assignedTo && existing.assignedTo !== user.id) {
        const statusLabels: Record<string, string> = {
          todo: 'To Do',
          'in_progress': 'In Progress',
          'in_review': 'In Review',
          completed: 'Completed',
          closed: 'Closed',
          reopened: 'Reopened',
          archived: 'Archived',
        };
        const fromLabel = statusLabels[existing.status] ?? existing.status;
        const toLabel = statusLabels[status] ?? status;

        await createNotification({
          organizationId: orgId!,
          userId: existing.assignedTo,
          type: status === 'completed' ? 'task.completed' : status === 'closed' ? 'task.closed' : status === 'reopened' ? 'task.reopened' : 'task.status_changed',
          title: `${existing.title} moved to ${toLabel}`,
          message: `Status changed from ${fromLabel} to ${toLabel}`,
          link: `/tasks/${id}`,
          actorId: user.id,
          entityType: 'task',
          entityId: id,
        });
      }

      // Re-index in Meilisearch (non-blocking)
      indexTask({
        id: task.id,
        title: task.title,
        description: task.description ?? null,
        taskIdDisplay: task.taskIdDisplay,
        status: task.status,
        priority: task.priority ?? 'medium',
        assignedTo: task.assignedTo ?? null,
        projectId: task.projectId ?? null,
        organizationId: orgId!,
        labels: (task.labels as string[] | null) ?? null,
        tags: (task.tags as string[] | null) ?? null,
        createdAt: (task.createdAt as Date).toISOString(),
        updatedAt: (task.updatedAt as Date).toISOString(),
      });

      // Fire-and-forget webhook dispatch
      const webhookEventType =
        status !== undefined && status !== existing.status
          ? 'task.status_changed'
          : 'task.updated';
      dispatchWebhookEvent(webhookEventType, orgId!, {
        taskId: task.id,
        title: task.title,
        taskIdDisplay: task.taskIdDisplay,
        status: task.status,
        priority: task.priority ?? 'medium',
        assignedTo: task.assignedTo ?? null,
        projectId: task.projectId ?? null,
        updatedBy: user.id,
        previousStatus: status !== undefined && status !== existing.status ? existing.status : undefined,
        newStatus: status !== undefined && status !== existing.status ? status : undefined,
      });

      // Fire-and-forget automation rule evaluation
      import('@/lib/automation/engine').then(({ evaluateAutomationRules }) => {
        const te = evaluateAutomationRules as (event: string, context: AutomationContext) => Promise<unknown>;
        const automationData = {
          id: task.id,
          title: task.title,
          taskIdDisplay: task.taskIdDisplay,
          status: task.status,
          priority: task.priority ?? 'medium',
          assignedTo: task.assignedTo ?? null,
          projectId: task.projectId ?? null,
          dueDate: task.dueDate,
          updatedBy: user.id,
        };

        // Evaluate the specific change event based on what changed
        if (status !== undefined && status !== existing.status) {
          // Status changed - determine the specific event
          const statusEvent =
            status === 'completed' ? 'task.completed' :
            status === 'closed' ? 'task.closed' :
            status === 'reopened' ? 'task.reopened' :
            'task.status_changed';

          te(statusEvent, {
            organizationId: orgId!,
            triggeredByUserId: user.id,
            entityType: 'task',
            entityId: task.id,
            data: automationData,
            previousValues: { status: existing.status },
          });
        }

        if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
          te('task.assigned', {
            organizationId: orgId!,
            triggeredByUserId: user.id,
            entityType: 'task',
            entityId: task.id,
            data: { ...automationData, previousAssignee: existing.assignedTo, newAssignee: assignedTo },
          });
        }

        // Always evaluate task.updated for any update
        te('task.updated', {
          organizationId: orgId!,
          triggeredByUserId: user.id,
          entityType: 'task',
          entityId: task.id,
          data: automationData,
          previousValues: Object.keys(parsed.data).reduce((acc, key) => {
            (acc as Record<string, unknown>)[key] = (existing as Record<string, unknown>)[key];
            return acc;
          }, {} as Record<string, unknown>),
        });
      }).catch(() => {});

      // Dispatch separate task.assigned event if assignment changed
      if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
        dispatchWebhookEvent('task.assigned', orgId!, {
          taskId: task.id,
          title: task.title,
          taskIdDisplay: task.taskIdDisplay,
          assignedTo: assignedTo,
          previousAssignee: existing.assignedTo,
          assignedBy: user.id,
        });
      }

      return NextResponse.json({ task });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'tasks:update' },
);

// DELETE /api/tasks/[id] - Soft delete task (rate limited: 30 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const id = getIdFromPath(request);
      await requirePermission(user.id, 'task:delete');

      const [existing] = await db()
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot delete a task outside their dept.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      await db()
        .update(schema.tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.deleted',
        entityType: 'task',
        entityId: id,
        oldValues: { title: existing.title, status: existing.status },
      });

      // Remove from Meilisearch index (non-blocking)
      removeTaskFromIndex(id);

      // Fire-and-forget webhook dispatch
      dispatchWebhookEvent('task.deleted', orgId!, {
        taskId: id,
        title: existing.title,
        taskIdDisplay: existing.taskIdDisplay,
        status: existing.status,
        deletedBy: user.id,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'tasks:delete' },
);
