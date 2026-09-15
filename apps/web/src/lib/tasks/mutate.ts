import { db, schema, canAccessDept, resolveTaskDepartment } from '@/lib/api/db';
import { createAuditEntry } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { eq, and, isNull } from 'drizzle-orm';
import { isValidTransition, READONLY_STATUSES } from '@/lib/api/validation';
import type { AutomationContext } from '@/lib/automation/engine';
import { indexTask } from '@/lib/search';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { validateAssignment } from '@/lib/api/assignment';
import type { DeptScope } from '@/lib/auth/api-auth';

// ─── Shared task-mutation service ──────────────────────────────
//
// The single funnel for mutating a task's core fields. BOTH the
// PATCH /api/tasks/[id] route and the automation engine's actions call this so
// the validation / transition / history / audit / search / webhook / notification
// side effects can't diverge (previously automation wrote straight to the tasks
// table, bypassing all of it).
//
// `suppressAutomation` lets the automation engine mutate without re-triggering
// automation (loop prevention) while still emitting every other side effect.

/**
 * A system-safe actor scope for engine-driven mutations. Sees all departments
 * and outranks everyone (so downward-only assignment doesn't block system
 * actions), but validateAssignment still enforces org + active/unsuspended.
 */
export const SYSTEM_SCOPE: DeptScope = {
  rank: 'super_admin',
  level: 100,
  departmentId: null,
  seeAllDepartments: true,
};

export interface TaskFieldChanges {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assignedTo?: string | null;
  projectId?: string | null;
  dueDate?: string | Date | null;
  labels?: string[];
}

export interface MutateTaskParams {
  /** The already-loaded, non-deleted task being mutated. */
  existing: typeof schema.tasks.$inferSelect;
  changes: TaskFieldChanges;
  actorUserId: string;
  actorScope: DeptScope;
  orgId: string | null;
  /** Precomputed newly-resolved mentions (PATCH only); notified after write. */
  newMentionedIds?: string[];
  /** When true, do NOT re-trigger automation rules (engine-initiated). */
  suppressAutomation?: boolean;
}

export type MutateTaskResult =
  | { ok: true; task: typeof schema.tasks.$inferSelect }
  | { ok: false; error: { code: string; message: string }; status: number };

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  completed: 'Completed',
  closed: 'Closed',
  reopened: 'Reopened',
  archived: 'Archived',
};

/**
 * Validate + apply a task field mutation and emit all side effects.
 * Callers must have already loaded `existing`, enforced org scope, and (for a
 * user actor) checked task:edit permission. Assignment/transition/readonly
 * rules, department wall, history, audit, reindex, webhook, notifications, and
 * (unless suppressed) automation are handled here.
 */
export async function mutateTask(params: MutateTaskParams): Promise<MutateTaskResult> {
  const { existing, changes, actorUserId, actorScope, orgId, newMentionedIds = [] } = params;
  const { title, description, status, priority, assignedTo, projectId, dueDate, labels } = changes;

  // Department wall.
  if (!canAccessDept(actorScope, existing.departmentId)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' }, status: 404 };
  }

  // Readonly enforcement: only a valid status transition is allowed out of a
  // closed/archived task; any other field or an invalid transition is rejected.
  if (READONLY_STATUSES.has(existing.status)) {
    const otherFieldChanged =
      title !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assignedTo !== undefined ||
      projectId !== undefined ||
      labels !== undefined ||
      dueDate !== undefined;
    const isStatusTransition =
      status !== undefined && status !== existing.status && isValidTransition(existing.status, status);
    if (otherFieldChanged || !isStatusTransition) {
      return {
        ok: false,
        error: { code: 'INVALID_STATE', message: `Tasks with status '${existing.status}' cannot be edited` },
        status: 422,
      };
    }
  }

  // Status transition enforcement.
  if (status !== undefined && status !== existing.status) {
    if (!isValidTransition(existing.status, status)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: `Invalid status transition from '${existing.status}' to '${status}'`,
        },
        status: 422,
      };
    }
  }

  // Assignment validation via the shared downward+department rule.
  if (assignedTo !== undefined && assignedTo !== null) {
    const denial = await validateAssignment(actorScope, assignedTo, orgId);
    if (denial) {
      return { ok: false, error: { code: denial.code, message: denial.message }, status: denial.status };
    }
  }

  // Project must belong to same org (if changing).
  if (projectId !== undefined && projectId !== null) {
    const [project] = await db()
      .select({ id: schema.projects.id, organizationId: schema.projects.organizationId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
      .limit(1);
    if (!project) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' }, status: 404 };
    }
    if (project.organizationId !== orgId) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Cross-organization project access denied' },
        status: 403,
      };
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
    newValues.assignedBy = actorUserId;
  }
  if (projectId !== undefined) {
    oldValues.projectId = existing.projectId;
    newValues.projectId = projectId;
  }
  if (dueDate !== undefined) {
    oldValues.dueDate = existing.dueDate;
    newValues.dueDate = dueDate;
  }
  if (labels !== undefined) {
    oldValues.labels = existing.labels;
    newValues.labels = labels;
  }

  const updateData: Record<string, unknown> = {
    ...newValues,
    updatedBy: actorUserId,
    updatedAt: new Date(),
  };

  if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
    updateData.assignedBy = actorUserId;
    updateData.departmentId = await resolveTaskDepartment({
      assignedTo,
      teamId: existing.teamId,
      createdBy: existing.createdBy,
    });
  }

  if (status === 'completed' && existing.status !== 'completed') {
    updateData.completedAt = new Date();
    updateData.completionSummary = `${existing.title} completed by ${actorUserId}`;
  }
  if (status === 'closed' && existing.status !== 'closed') {
    updateData.closedAt = new Date();
    updateData.closedBy = actorUserId;
  }

  if (description !== undefined && newMentionedIds.length > 0) {
    const currentMentioned = (existing.mentionedUserIds as string[] | null) ?? [];
    updateData.mentionedUserIds = Array.from(new Set([...currentMentioned, ...newMentionedIds]));
  }

  const [task] = await db()
    .update(schema.tasks)
    .set(updateData)
    .where(and(eq(schema.tasks.id, existing.id), isNull(schema.tasks.deletedAt)))
    .returning();

  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' }, status: 404 };
  }

  // ── Audit + history ──
  if (Object.keys(oldValues).length > 0) {
    const auditAction = status && status !== existing.status ? 'task.status_changed' : 'task.updated';
    await createAuditEntry({
      organizationId: orgId,
      userId: actorUserId,
      action: auditAction,
      entityType: 'task',
      entityId: existing.id,
      oldValues,
      newValues,
    });

    if (status && status !== existing.status) {
      await db().insert(schema.taskHistory).values({
        taskId: existing.id,
        userId: actorUserId,
        field: 'status',
        oldValue: existing.status,
        newValue: status,
        changeType: 'status_change',
        description: `Status changed from ${existing.status} to ${status}`,
      });
    }
  }

  // ── Assignment notification ──
  if (assignedTo !== undefined && assignedTo !== existing.assignedTo && assignedTo !== null) {
    await createNotification({
      organizationId: orgId!,
      userId: assignedTo,
      type: 'task.assigned',
      title: `You've been assigned: ${existing.title}`,
      message: `Task #${existing.taskIdDisplay} was assigned to you`,
      link: `/tasks/${existing.id}`,
      actorId: actorUserId,
      entityType: 'task',
      entityId: existing.id,
    });
  }

  // ── Mention notifications ──
  if (newMentionedIds.length > 0) {
    const currentMentioned = (existing.mentionedUserIds as string[] | null) ?? [];
    const newlyMentioned = newMentionedIds.filter((mid) => !currentMentioned.includes(mid));
    for (const mentionedId of newlyMentioned) {
      if (mentionedId === actorUserId) continue;
      if (mentionedId === assignedTo && assignedTo === existing.assignedTo) continue;
      await createNotification({
        organizationId: orgId!,
        userId: mentionedId,
        type: 'task.mention',
        title: `You were mentioned in: ${existing.title}`,
        message: description?.substring(0, 200) ?? '',
        link: `/tasks/${existing.id}`,
        actorId: actorUserId,
        entityType: 'task',
        entityId: existing.id,
      });
    }
  }

  // ── Status-change notification ──
  if (
    status !== undefined &&
    status !== existing.status &&
    existing.assignedTo &&
    existing.assignedTo !== actorUserId
  ) {
    const fromLabel = STATUS_LABELS[existing.status] ?? existing.status;
    const toLabel = STATUS_LABELS[status] ?? status;
    await createNotification({
      organizationId: orgId!,
      userId: existing.assignedTo,
      type:
        status === 'completed'
          ? 'task.completed'
          : status === 'closed'
            ? 'task.closed'
            : status === 'reopened'
              ? 'task.reopened'
              : 'task.status_changed',
      title: `${existing.title} moved to ${toLabel}`,
      message: `Status changed from ${fromLabel} to ${toLabel}`,
      link: `/tasks/${existing.id}`,
      actorId: actorUserId,
      entityType: 'task',
      entityId: existing.id,
    });
  }

  // ── Reindex (non-blocking) ──
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

  // ── Webhooks ──
  const webhookEventType =
    status !== undefined && status !== existing.status ? 'task.status_changed' : 'task.updated';
  dispatchWebhookEvent(webhookEventType, orgId!, {
    taskId: task.id,
    title: task.title,
    taskIdDisplay: task.taskIdDisplay,
    status: task.status,
    priority: task.priority ?? 'medium',
    assignedTo: task.assignedTo ?? null,
    projectId: task.projectId ?? null,
    updatedBy: actorUserId,
    previousStatus: status !== undefined && status !== existing.status ? existing.status : undefined,
    newStatus: status !== undefined && status !== existing.status ? status : undefined,
  });

  if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
    dispatchWebhookEvent('task.assigned', orgId!, {
      taskId: task.id,
      title: task.title,
      taskIdDisplay: task.taskIdDisplay,
      assignedTo,
      previousAssignee: existing.assignedTo,
      assignedBy: actorUserId,
    });
  }

  // ── Automation (suppressed for engine-initiated mutations to prevent loops) ──
  if (!params.suppressAutomation) {
    const automationData = {
      id: task.id,
      title: task.title,
      taskIdDisplay: task.taskIdDisplay,
      status: task.status,
      priority: task.priority ?? 'medium',
      assignedTo: task.assignedTo ?? null,
      projectId: task.projectId ?? null,
      dueDate: task.dueDate,
      updatedBy: actorUserId,
    };

    import('@/lib/automation/engine')
      .then(({ evaluateAutomationRules }) => {
        const te = evaluateAutomationRules as (event: string, ctx: AutomationContext) => Promise<unknown>;

        if (status !== undefined && status !== existing.status) {
          const statusEvent =
            status === 'completed'
              ? 'task.completed'
              : status === 'closed'
                ? 'task.closed'
                : status === 'reopened'
                  ? 'task.reopened'
                  : 'task.status_changed';
          te(statusEvent, {
            organizationId: orgId!,
            triggeredByUserId: actorUserId,
            entityType: 'task',
            entityId: task.id,
            data: automationData,
            previousValues: { status: existing.status },
          });
        }

        if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
          te('task.assigned', {
            organizationId: orgId!,
            triggeredByUserId: actorUserId,
            entityType: 'task',
            entityId: task.id,
            data: { ...automationData, previousAssignee: existing.assignedTo, newAssignee: assignedTo },
          });
        }

        te('task.updated', {
          organizationId: orgId!,
          triggeredByUserId: actorUserId,
          entityType: 'task',
          entityId: task.id,
          data: automationData,
          previousValues: oldValues,
        });
      })
      .catch(() => {});
  }

  return { ok: true, task };
}
