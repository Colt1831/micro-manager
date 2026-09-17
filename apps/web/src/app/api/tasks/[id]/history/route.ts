import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { eq, desc, and, isNull, type SQL } from 'drizzle-orm';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

// GET /api/tasks/[id]/history - List task history entries
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

      const history = await db()
        .select({
          id: schema.taskHistory.id,
          taskId: schema.taskHistory.taskId,
          userId: schema.taskHistory.userId,
          field: schema.taskHistory.field,
          oldValue: schema.taskHistory.oldValue,
          newValue: schema.taskHistory.newValue,
          changeType: schema.taskHistory.changeType,
          description: schema.taskHistory.description,
          createdAt: schema.taskHistory.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.taskHistory)
        .innerJoin(schema.tasks, eq(schema.taskHistory.taskId, schema.tasks.id))
        .leftJoin(schema.users, eq(schema.taskHistory.userId, schema.users.id))
        // The wall rides on the existing tasks join: a walled user gets an empty
        // history for a cross-department task, same as being refused the task.
        .where(
          and(
            ...applyDeptScope(
              [
                eq(schema.taskHistory.taskId, taskId),
                eq(schema.tasks.organizationId, orgId!),
                isNull(schema.tasks.deletedAt),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .orderBy(desc(schema.taskHistory.createdAt))
        .limit(100);

      return NextResponse.json({ history });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch task history');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'history:list' },
);
