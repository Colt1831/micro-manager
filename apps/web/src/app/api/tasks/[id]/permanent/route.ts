import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, and, sql } from 'drizzle-orm';
import { removeTaskFromIndex } from '@/lib/search';
import { getTaskIdFromPath } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

// DELETE /api/tasks/[id]/permanent - Permanently delete a task from the database (rate limited: 10 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      // The last path segment is 'permanent', not the id — parse the id after 'tasks'.
      const id = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:delete');

      // Find the deleted task (allow deletedAt IS NOT NULL)
      const [existing] = await db()
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          status: schema.tasks.status,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, id), sql`${schema.tasks.deletedAt} IS NOT NULL`))
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Deleted task not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(existing.organizationId, orgId);

      // Department wall: a walled user cannot permanently delete a cross-dept task.
      if (!canAccessDept(scope, existing.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Deleted task not found' } },
          { status: 404 },
        );
      }

      // Hard-delete from the database (cascading deletes will handle related records)
      await db()
        .delete(schema.tasks)
        .where(and(eq(schema.tasks.id, id), sql`${schema.tasks.deletedAt} IS NOT NULL`));

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.permanently_deleted',
        entityType: 'task',
        entityId: id,
        oldValues: { title: existing.title, status: existing.status },
      });

      // Remove from Meilisearch index (non-blocking)
      removeTaskFromIndex(id);

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to permanently delete task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 10, namespace: 'tasks:permanent-delete' },
);
