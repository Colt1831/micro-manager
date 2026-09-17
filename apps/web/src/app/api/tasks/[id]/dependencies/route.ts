import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { isUniqueViolation } from '@/lib/db-errors';
import { wouldCreateCycle } from '@/lib/api/dependency-cycle';
import { eq, and, or, isNull, inArray, sql , type SQL } from 'drizzle-orm';
import { READONLY_STATUSES } from '@/lib/api/validation';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';
import { z } from 'zod';

export const runtime = 'nodejs';

/** Internal sentinel: adding the edge would make the dependency graph cyclic. */
class DependencyCycleError extends Error {}

const DependencyCreateSchema = z
  .object({
    dependsOnTaskId: z.string().uuid('Invalid task ID'),
    dependencyType: z.enum(['blocks', 'relates_to', 'duplicates']).default('blocks'),
  })
  .strict('Unexpected fields');

// GET /api/tasks/[id]/dependencies - List dependencies
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);

      await requirePermission(user.id, 'task:view');

      // Tasks this task depends on (blocked_by)
      const blockedBy = await db()
        .select({
          id: schema.taskDependencies.id,
          taskId: schema.taskDependencies.taskId,
          dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
          dependencyType: schema.taskDependencies.dependencyType,
          createdAt: schema.taskDependencies.createdAt,
          dependsOnTask: {
            id: schema.tasks.id,
            title: schema.tasks.title,
            taskIdDisplay: schema.tasks.taskIdDisplay,
            status: schema.tasks.status,
          },
        })
        .from(schema.taskDependencies)
        .innerJoin(schema.tasks, eq(schema.taskDependencies.dependsOnTaskId, schema.tasks.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.taskDependencies.taskId, taskId),
            eq(schema.tasks.organizationId, orgId!),
            isNull(schema.tasks.deletedAt),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        );

      // Tasks that depend on this task (blocking)
      const blocking = await db()
        .select({
          id: schema.taskDependencies.id,
          taskId: schema.taskDependencies.taskId,
          dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
          dependencyType: schema.taskDependencies.dependencyType,
          createdAt: schema.taskDependencies.createdAt,
          blockingTask: {
            id: schema.tasks.id,
            title: schema.tasks.title,
            taskIdDisplay: schema.tasks.taskIdDisplay,
            status: schema.tasks.status,
          },
        })
        .from(schema.taskDependencies)
        .innerJoin(schema.tasks, eq(schema.taskDependencies.taskId, schema.tasks.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.taskDependencies.dependsOnTaskId, taskId),
            eq(schema.tasks.organizationId, orgId!),
            isNull(schema.tasks.deletedAt),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        );

      return NextResponse.json({ blockedBy, blocking });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch dependencies');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'dependencies:list' },
);

// POST /api/tasks/[id]/dependencies - Add a dependency
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = DependencyCreateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid dependency data',
              details: parsed.error.flatten().fieldErrors,
            },
          },
          { status: 400 },
        );
      }

      const { dependsOnTaskId, dependencyType } = parsed.data;

      // Prevent self-dependency
      if (dependsOnTaskId === taskId) {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'A task cannot depend on itself' } },
          { status: 422 },
        );
      }

      // Check both tasks exist and belong to the same org
      const [sourceTask, targetTask] = await Promise.all([
        db()
          .select({
            id: schema.tasks.id,
            organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
            status: schema.tasks.status,
          })
          .from(schema.tasks)
          .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
          .limit(1),
        db()
          .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          departmentId: schema.tasks.departmentId,
        })
          .from(schema.tasks)
          .where(and(eq(schema.tasks.id, dependsOnTaskId), isNull(schema.tasks.deletedAt)))
          .limit(1),
      ]);

      // Shared helper checks task existence + org scope for both tasks
      const sourceError = checkTaskAccessOrRespond(sourceTask[0], orgId, { scope });
      if (sourceError) return sourceError;
      const targetError = checkTaskAccessOrRespond(targetTask[0], orgId, { scope });
      if (targetError) return targetError;

      // Block dependency changes on read-only tasks
      if (READONLY_STATUSES.has(sourceTask[0]!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify dependencies on tasks with status '${sourceTask[0]!.status}'`,
            },
          },
          { status: 422 },
        );
      }

      // Check for duplicate dependency
      const [existing] = await db()
        .select({ id: schema.taskDependencies.id })
        .from(schema.taskDependencies)
        .where(
          and(
            eq(schema.taskDependencies.taskId, taskId),
            eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId),
          ),
        )
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Dependency already exists' } },
          { status: 409 },
        );
      }

      let dependency;
      try {
        dependency = await db().transaction(async (tx) => {
          // Serialize dependency mutations for this org so a concurrent add
          // can't race a cycle past the check below (TOCTOU). The lock is held
          // until the transaction commits/rolls back.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`taskdeps:${orgId}`}))`);

          // Reject an edge that would make the depends-on graph cyclic (WM-013).
          const fetchDeps = async (taskIds: string[]): Promise<string[]> => {
            const rows = await tx
              .select({ dependsOnTaskId: schema.taskDependencies.dependsOnTaskId })
              .from(schema.taskDependencies)
              .innerJoin(schema.tasks, eq(schema.taskDependencies.dependsOnTaskId, schema.tasks.id))
              .where(
          and(
            ...applyDeptScope(
              [
inArray(schema.taskDependencies.taskId, taskIds),
                  // orgId is guaranteed non-null past checkTaskAccessOrRespond above.
                  eq(schema.tasks.organizationId, orgId!),
                  isNull(schema.tasks.deletedAt),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        );
            return rows.map((r) => r.dependsOnTaskId);
          };
          if (await wouldCreateCycle(taskId, dependsOnTaskId, fetchDeps)) {
            throw new DependencyCycleError();
          }

          const [row] = await tx
            .insert(schema.taskDependencies)
            .values({ taskId, dependsOnTaskId, dependencyType })
            .returning();
          return row;
        });
      } catch (txError) {
        if (txError instanceof DependencyCycleError) {
          return NextResponse.json(
            {
              error: {
                code: 'INVALID_STATE',
                message: 'This dependency would create a circular dependency',
              },
            },
            { status: 422 },
          );
        }
        // A unique index guards against duplicates; a concurrent add that raced
        // past the check above lands here — return the same 409, not a 500.
        if (isUniqueViolation(txError, 'idx_task_deps_unique')) {
          return NextResponse.json(
            { error: { code: 'CONFLICT', message: 'Dependency already exists' } },
            { status: 409 },
          );
        }
        throw txError;
      }

      if (!dependency) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create dependency' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.dependency_added',
        entityType: 'task',
        entityId: taskId,
        newValues: { dependsOnTaskId, dependencyType },
      });

      // Fetch with task title for response
      const [depWithTask] = await db()
        .select({
          id: schema.taskDependencies.id,
          taskId: schema.taskDependencies.taskId,
          dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
          dependencyType: schema.taskDependencies.dependencyType,
          createdAt: schema.taskDependencies.createdAt,
          dependsOnTask: {
            id: schema.tasks.id,
            title: schema.tasks.title,
            taskIdDisplay: schema.tasks.taskIdDisplay,
            status: schema.tasks.status,
          },
        })
        .from(schema.taskDependencies)
        .innerJoin(schema.tasks, eq(schema.taskDependencies.dependsOnTaskId, schema.tasks.id))
        .where(eq(schema.taskDependencies.id, dependency.id))
        .limit(1);

      return NextResponse.json({ dependency: depWithTask }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to add dependency');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'dependencies:create' },
);

// DELETE /api/tasks/[id]/dependencies - Remove a dependency
export const DELETE = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const dependencyId = request.nextUrl.searchParams.get('dependencyId');
      if (!dependencyId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'dependencyId is required' } },
          { status: 400 },
        );
      }

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

      // Shared helper checks task existence + org scope
      const accessError = checkTaskAccessOrRespond(task, orgId, { scope });
      if (accessError) return accessError;

      if (READONLY_STATUSES.has(task!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify dependencies on tasks with status '${task!.status}'`,
            },
          },
          { status: 422 },
        );
      }

      const [existing] = await db()
        .select()
        .from(schema.taskDependencies)
        .where(
          and(
            eq(schema.taskDependencies.id, dependencyId),
            or(
              eq(schema.taskDependencies.taskId, taskId),
              eq(schema.taskDependencies.dependsOnTaskId, taskId),
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Dependency not found' } },
          { status: 404 },
        );
      }

      await db()
        .delete(schema.taskDependencies)
        .where(eq(schema.taskDependencies.id, dependencyId));

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete dependency');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'dependencies:delete' },
);
