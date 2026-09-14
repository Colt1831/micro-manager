import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, sql } from 'drizzle-orm';
import { indexTask } from '@/lib/search';
import { getTaskIdFromPath } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

// POST /api/tasks/[id]/restore - Restore a soft-deleted task (rate limited: 30 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      // The last path segment is 'restore', not the id — parse the id after 'tasks'.
      const id = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:delete');

      // Find the deleted task (allow deletedAt IS NOT NULL)
      const [task] = await db()
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, id), sql`${schema.tasks.deletedAt} IS NOT NULL`))
        .limit(1);

      if (!task) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Deleted task not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(task.organizationId, orgId);

      // Department wall: a walled user cannot restore a task outside their dept.
      if (!canAccessDept(scope, task.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Deleted task not found' } },
          { status: 404 },
        );
      }

      // Restore by setting deletedAt to null
      const [restored] = await db()
        .update(schema.tasks)
        .set({ deletedAt: null, updatedAt: new Date(), updatedBy: user.id })
        .where(and(eq(schema.tasks.id, id), sql`${schema.tasks.deletedAt} IS NOT NULL`))
        .returning();

      if (!restored) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to restore task' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.restored',
        entityType: 'task',
        entityId: id,
        newValues: { title: task.title, status: task.status },
        oldValues: { deletedAt: task.deletedAt },
      });

      // Re-index in Meilisearch (non-blocking)
      indexTask({
        id: restored.id,
        title: restored.title,
        description: restored.description ?? null,
        taskIdDisplay: restored.taskIdDisplay,
        status: restored.status,
        priority: restored.priority ?? 'medium',
        assignedTo: restored.assignedTo ?? null,
        projectId: restored.projectId ?? null,
        organizationId: orgId!,
        labels: (restored.labels as string[] | null) ?? null,
        tags: (restored.tags as string[] | null) ?? null,
        createdAt: (restored.createdAt as Date).toISOString(),
        updatedAt: (restored.updatedAt as Date).toISOString(),
      });

      return NextResponse.json({ task: restored });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to restore task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'tasks:restore' },
);
