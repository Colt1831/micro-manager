import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { isUniqueViolation } from '@/lib/db-errors';
import { eq, and, isNull } from 'drizzle-orm';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

// GET /api/tasks/[id]/watchers - List watchers for a task
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:view');

      // Verify task exists and belongs to org
      const [task] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Fetch watchers with user info
      const watchers = await db()
        .select({
          id: schema.taskWatchers.id,
          taskId: schema.taskWatchers.taskId,
          userId: schema.taskWatchers.userId,
          watchType: schema.taskWatchers.watchType,
          createdAt: schema.taskWatchers.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.taskWatchers)
        .leftJoin(schema.users, eq(schema.taskWatchers.userId, schema.users.id))
        .where(eq(schema.taskWatchers.taskId, taskId));

      // Check if current user is watching
      const isWatching = watchers.some((w) => w.userId === user.id);
      const watcherCount = watchers.length;

      return NextResponse.json({ watchers, isWatching, watcherCount });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch watchers');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'watchers:list' },
);

// POST /api/tasks/[id]/watchers - Watch a task
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);

      // Verify task exists and belongs to org
      const [task] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      // Check if already watching
      const [existing] = await db()
        .select({ id: schema.taskWatchers.id })
        .from(schema.taskWatchers)
        .where(and(eq(schema.taskWatchers.taskId, taskId), eq(schema.taskWatchers.userId, user.id)))
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Already watching this task' } },
          { status: 409 },
        );
      }

      let watcher;
      try {
        [watcher] = await db()
          .insert(schema.taskWatchers)
          .values({
            taskId,
            userId: user.id,
            watchType: 'watching',
          })
          .returning();
      } catch (insertError) {
        // A unique index guards against duplicates; a concurrent watch that
        // raced past the check above lands here — return the same 409, not 500.
        if (isUniqueViolation(insertError, 'idx_task_watchers_unique')) {
          return NextResponse.json(
            { error: { code: 'CONFLICT', message: 'Already watching this task' } },
            { status: 409 },
          );
        }
        throw insertError;
      }

      if (!watcher) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to add watcher' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.watcher_added',
        entityType: 'task',
        entityId: taskId,
        newValues: { watcherId: watcher.id },
      });

      return NextResponse.json({ watcher, isWatching: true }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to watch task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'watchers:create' },
);

// DELETE /api/tasks/[id]/watchers - Unwatch a task
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);

      // Verify task exists and belongs to org
      const [task] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      const accessError = checkTaskAccessOrRespond(task ?? undefined, orgId, { scope });
      if (accessError) return accessError;

      const [existing] = await db()
        .select({ id: schema.taskWatchers.id })
        .from(schema.taskWatchers)
        .where(and(eq(schema.taskWatchers.taskId, taskId), eq(schema.taskWatchers.userId, user.id)))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Not watching this task' } },
          { status: 404 },
        );
      }

      await db().delete(schema.taskWatchers).where(eq(schema.taskWatchers.id, existing.id));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.watcher_removed',
        entityType: 'task',
        entityId: taskId,
        oldValues: { watcherId: existing.id },
      });

      return NextResponse.json({ success: true, isWatching: false });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to unwatch task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'watchers:delete' },
);
