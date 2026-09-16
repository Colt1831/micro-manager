import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, isNull } from 'drizzle-orm';
import {
  TaskUpdateSchema,
  validationError,
} from '@/lib/api/validation';
import { sanitizeRichText } from '@/lib/sanitize';
import { removeTaskFromIndex } from '@/lib/search';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { extractAndResolveMentions } from '@/lib/mentions';
import { mutateTask } from '@/lib/tasks/mutate';

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

      // Join the assignee so the detail panel can show a name instead of the
      // raw user id (same contract as the list route's assignedToName).
      const [row] = await db()
        .select({ task: schema.tasks, assignedToName: schema.users.name })
        .from(schema.tasks)
        .leftJoin(schema.users, eq(schema.users.id, schema.tasks.assignedTo))
        .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)))
        .limit(1);

      const task = row ? { ...row.task, assignedToName: row.assignedToName } : undefined;

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

      // ── Permission checks for close/reopen must run before mutateTask ──
      if (status !== undefined && status !== existing.status) {
        if (status === 'closed') {
          await requirePermission(user.id, 'task:close');
        }
        if (status === 'reopened') {
          await requirePermission(user.id, 'task:reopen');
        }
      }

      // ── Detect @mention changes in description BEFORE the write ──
      let newMentionedIds: string[] = [];
      if (description !== undefined) {
        newMentionedIds = await extractAndResolveMentions(orgId!, description, user.id);
      }

      // ── Delegate to the shared task-mutation service (single funnel for
      // validation/transition/history/audit/search/webhook/notification/
      // automation — the automation engine calls the same service). ──
      const result = await mutateTask({
        existing,
        changes: { title, description, status, priority, assignedTo, dueDate, projectId },
        actorUserId: user.id,
        actorScope: scope,
        orgId,
        newMentionedIds,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      return NextResponse.json({ task: result.task });
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
