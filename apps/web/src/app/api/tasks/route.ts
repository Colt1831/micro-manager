import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope, resolveTaskDepartment } from '@/lib/api/db';
import { withAuth, requirePermission, checkPermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull, like, or, sql, inArray } from 'drizzle-orm';
import { TaskCreateSchema, validationError } from '@/lib/api/validation';
import { sanitizeRichText } from '@/lib/sanitize';
import { indexTask } from '@/lib/search';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { extractAndResolveMentions } from '@/lib/mentions';
import { createNotification } from '@/lib/notifications';
import { validateAssignment } from '@/lib/api/assignment';
import { assertMilestoneSameOrg } from '@/lib/api/cross-ref';

export const runtime = 'nodejs';

// GET /api/tasks - List tasks (rate limited: 100 req/min per user)
// Role-aware visibility:
// - Users with 'task:view' permission see:
//   - tasks assigned to them
//   - tasks they created
//   - tasks where they are mentioned (mentionedUserIds contains user.id)
// - Users with 'task:view_all' permission see all tasks in the org
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'task:view');

      const canViewAll = await checkPermission(user.id, 'task:view_all');
      const { searchParams } = new URL(request.url);
      const projectId = searchParams.get('projectId');
      const status = searchParams.get('status');
      const assignedTo = searchParams.get('assignedTo');
      const priority = searchParams.get('priority');
      const searchParam = searchParams.get('search');
      const watchedBy = searchParams.get('watchedBy');
      const showDeleted = searchParams.get('deleted') === 'true';
      const deletedBy = searchParams.get('deletedBy');
      const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);
      const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
      const fieldsOnly = searchParams.get('fields') === 'id';

      const conditions = [eq(schema.tasks.organizationId, orgId!)];

      // Department wall: GM+/super_admin see all departments; everyone below is
      // scoped to their own department. Orthogonal to task:view_all (that governs
      // org-wide row visibility WITHIN the department the wall allows).
      applyDeptScope(conditions, scope, schema.tasks.departmentId);

      if (showDeleted) {
        // Show only soft-deleted tasks
        conditions.push(sql`${schema.tasks.deletedAt} IS NOT NULL`);
      } else {
        // Normal view: hide deleted tasks
        conditions.push(isNull(schema.tasks.deletedAt));
      }

      if (deletedBy) conditions.push(eq(schema.tasks.updatedBy, deletedBy));

      // Role-aware data scoping: without task:view_all, only see tasks
      // that are assigned to the user, created by the user, or mention the user
      if (!canViewAll) {
        const scopeFilter = or(
          eq(schema.tasks.assignedTo, user.id),
          eq(schema.tasks.createdBy, user.id),
          sql`${user.id} = ANY(${schema.tasks.mentionedUserIds})`,
        );
        if (scopeFilter) conditions.push(scopeFilter);
      }

      if (projectId) conditions.push(eq(schema.tasks.projectId, projectId));
      if (status) conditions.push(eq(schema.tasks.status, status));
      if (assignedTo) conditions.push(eq(schema.tasks.assignedTo, assignedTo));
      if (priority) conditions.push(eq(schema.tasks.priority, priority));
      if (searchParam) {
        const searchClause = or(
          like(schema.tasks.title, `%${searchParam}%`),
          like(schema.tasks.description, `%${searchParam}%`),
          like(schema.tasks.taskIdDisplay, `%${searchParam}%`),
        );
        if (searchClause) conditions.push(searchClause);
      }

      // Filter by watched tasks — find all task IDs watched by this user
      if (watchedBy === 'me') {
        const watchedTaskIds = await db()
          .select({ taskId: schema.taskWatchers.taskId })
          .from(schema.taskWatchers)
          .where(eq(schema.taskWatchers.userId, user.id));

        const ids = watchedTaskIds.map((w) => w.taskId);
        if (ids.length > 0) {
          conditions.push(inArray(schema.tasks.id, ids));
        } else {
          return NextResponse.json({ tasks: [] });
        }
      }

      // Get total count (ignoring pagination)
      const [countResult] = await db()
        .select({ count: sql<number>`count(*)` })
        .from(schema.tasks)
        .where(and(...conditions));
      const total = Number(countResult?.count ?? 0);

      // fields=id mode: return just IDs for cross-page batch selection
      if (fieldsOnly) {
        const idRows = await db()
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(and(...conditions))
          .orderBy(desc(schema.tasks.createdAt))
          .limit(limit)
          .offset(offset);

        return NextResponse.json({ ids: idRows.map((r) => r.id), total });
      }

      let tasks;

      if (showDeleted) {
        // Include the name of the user who deleted the task (via updatedBy)
        const rows = await db()
          .select({
            task: schema.tasks,
            updatedByName: schema.users.name,
          })
          .from(schema.tasks)
          .leftJoin(schema.users, eq(schema.tasks.updatedBy, schema.users.id))
          .where(and(...conditions))
          .orderBy(desc(schema.tasks.updatedAt))
          .limit(limit)
          .offset(offset);

        tasks = rows.map((r) => ({
          ...r.task,
          updatedByName: r.updatedByName,
        }));
      } else {
        // Join the assignee so the UI can show a name. Without this the list
        // only had assignedTo (a user id) and rendered a raw UUID.
        const rows = await db()
          .select({
            task: schema.tasks,
            assignedToName: schema.users.name,
          })
          .from(schema.tasks)
          .leftJoin(schema.users, eq(schema.tasks.assignedTo, schema.users.id))
          .where(and(...conditions))
          .orderBy(desc(schema.tasks.createdAt))
          .limit(limit)
          .offset(offset);

        tasks = rows.map((r) => ({ ...r.task, assignedToName: r.assignedToName }));
      }

      return NextResponse.json({ tasks, total });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch tasks');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'tasks:list' },
);

// POST /api/tasks - Create task (rate limited: 30 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'task:create');

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
          { status: 400 },
        );
      }
      const parsed = TaskCreateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const {
        title,
        description: rawDescription,
        projectId,
        milestoneId,
        priority,
        assignedTo,
        dueDate,
      } = parsed.data;
      const description = sanitizeRichText(rawDescription);

      // Validate project org scope if projectId provided
      if (projectId) {
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

      // Validate assignedTo via the shared downward+department rule (§4)
      if (assignedTo) {
        const denial = await validateAssignment(scope, assignedTo, orgId);
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }
      }

      // Cross-tenant guard: a milestone must be same-org and (if a project is
      // given) belong to that project.
      if (milestoneId) {
        const denial = await assertMilestoneSameOrg(milestoneId, orgId, projectId);
        if (denial) {
          return NextResponse.json(
            { error: { code: denial.code, message: denial.message } },
            { status: denial.status },
          );
        }
      }

      // ── Detect @mentions in description ───────────────────────
      const mentionedUserIds = await extractAndResolveMentions(orgId!, description, user.id);

      // Resolve the department for the isolation wall: assignee -> creator
      // (no team on create). Denormalized so cross-dept reads filter cheaply.
      const departmentId = await resolveTaskDepartment({ assignedTo, createdBy: user.id });

      const [task] = await db()
        .insert(schema.tasks)
        .values({
          title,
          description,
          projectId,
          milestoneId,
          priority,
          assignedTo,
          assignedBy: assignedTo ? user.id : null,
          departmentId,
          dueDate: dueDate ? new Date(dueDate) : null,
          organizationId: orgId!,
          createdBy: user.id,
          updatedBy: user.id,
          taskIdDisplay: `TASK-${Date.now().toString(36).toUpperCase()}`,
          status: 'open',
          mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
        })
        .returning();

      if (!task) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create task' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        newValues: { title, priority, status: 'open', assignedTo },
      });

      // Index in Meilisearch (non-blocking)
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

      // Fire-and-forget webhook dispatch — never block the API response
      dispatchWebhookEvent('task.created', orgId!, {
        taskId: task.id,
        title: task.title,
        taskIdDisplay: task.taskIdDisplay,
        status: task.status,
        priority: task.priority ?? 'medium',
        assignedTo: task.assignedTo ?? null,
        projectId: task.projectId ?? null,
        createdBy: user.id,
      });

      // ── Notify assignee on creation ──────────────────────────
      if (assignedTo && assignedTo !== user.id) {
        await createNotification({
          organizationId: orgId!,
          userId: assignedTo,
          type: 'task.assigned',
          title: `You've been assigned: ${task.title}`,
          message: `Task #${task.taskIdDisplay} was assigned to you`,
          link: `/tasks/${task.id}`,
          actorId: user.id,
          entityType: 'task',
          entityId: task.id,
        });
      }

      // ── Notify mentioned users ──────────────────────────────
      for (const mentionedId of mentionedUserIds) {
        if (mentionedId === assignedTo) continue; // Already notified as assignee

        await createNotification({
          organizationId: orgId!,
          userId: mentionedId,
          type: 'task.mention',
          title: `You were mentioned in: ${task.title}`,
          message: description?.substring(0, 200) ?? '',
          link: `/tasks/${task.id}`,
          actorId: user.id,
          entityType: 'task',
          entityId: task.id,
        });
      }

      // Fire-and-forget automation rule evaluation
      import('@/lib/automation/engine').then(({ evaluateAutomationRules }) => {
        evaluateAutomationRules('task.created', {
          organizationId: orgId!,
          triggeredByUserId: user.id,
          entityType: 'task',
          entityId: task.id,
          data: {
            id: task.id,
            title: task.title,
            description: task.description,
            taskIdDisplay: task.taskIdDisplay,
            status: task.status,
            priority: task.priority ?? 'medium',
            assignedTo: task.assignedTo ?? null,
            projectId: task.projectId ?? null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            createdBy: user.id,
          },
        });
      }).catch(() => {});

      return NextResponse.json({ task }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create task');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'tasks:create' },
);
