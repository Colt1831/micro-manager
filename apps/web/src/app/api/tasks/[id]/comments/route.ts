import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { CommentCreateSchema, validationError, READONLY_STATUSES } from '@/lib/api/validation';
import { sanitizeRichText } from '@/lib/sanitize';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { extractAndResolveMentions } from '@/lib/mentions';

export const runtime = 'nodejs';

// GET /api/tasks/[id]/comments - List comments for a task (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      const taskId = getTaskIdFromPath(request);

      await requirePermission(user.id, 'task:view');

      const comments = await db()
        .select({
          id: schema.taskComments.id,
          taskId: schema.taskComments.taskId,
          userId: schema.taskComments.userId,
          content: schema.taskComments.content,
          isInternalNote: schema.taskComments.isInternalNote,
          parentId: schema.taskComments.parentId,
          isEdited: schema.taskComments.isEdited,
          editedAt: schema.taskComments.editedAt,
          createdAt: schema.taskComments.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.taskComments)
        .innerJoin(schema.tasks, eq(schema.taskComments.taskId, schema.tasks.id))
        .leftJoin(schema.users, eq(schema.taskComments.userId, schema.users.id))
        .where(
          and(
            eq(schema.taskComments.taskId, taskId),
            isNull(schema.taskComments.deletedAt),
            eq(schema.tasks.organizationId, orgId!),
          ),
        )
        .orderBy(desc(schema.taskComments.createdAt));

      return NextResponse.json({ comments });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch comments');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'comments:list' },
);

// POST /api/tasks/[id]/comments - Create a comment (rate limited: 20 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      const body = await request.json();
      const parsed = CommentCreateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { content: rawContent } = parsed.data;
      const content = sanitizeRichText(rawContent) ?? '';

      // Verify task exists, belongs to org, and is not read-only
      const [task] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          status: schema.tasks.status,
          title: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          assignedTo: schema.tasks.assignedTo,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      // Shared helper checks task existence + org scope
      const accessError = checkTaskAccessOrRespond(task, orgId);
      if (accessError) return accessError;

      // Block comments on closed/archived (read-only) tasks
      if (READONLY_STATUSES.has(task!.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot comment on a '${task!.status}' task`,
            },
          },
          { status: 422 },
        );
      }

      const [comment] = await db()
        .insert(schema.taskComments)
        .values({
          taskId,
          userId: user.id,
          content,
          contentPlain: content,
        })
        .returning();

      if (!comment) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create comment' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'task.comment_added',
        entityType: 'task',
        entityId: taskId,
        newValues: { commentId: comment.id },
      });

      // ── Notify the task assignee about the new comment ─────────
      if (task && task.assignedTo && task.assignedTo !== user.id) {
        await createNotification({
          organizationId: orgId!,
          userId: task.assignedTo,
          type: 'task.comment',
          title: `New comment on: ${task.title}`,
          message: content.substring(0, 200),
          link: `/tasks/${taskId}`,
          actorId: user.id,
          entityType: 'task',
          entityId: taskId,
        });
      }

      // ── Detect @mentions in comments and notify mentioned users ─
      if (content) {
        const mentionedUserIds = await extractAndResolveMentions(orgId!, content, user.id);
        for (const mentionedId of mentionedUserIds) {
          // Skip if already notified as assignee
          if (mentionedId === task?.assignedTo) continue;

          await createNotification({
            organizationId: orgId!,
            userId: mentionedId,
            type: 'task.mention',
            title: `You were mentioned in: ${task!.title}`,
            message: content.substring(0, 200),
            link: `/tasks/${taskId}`,
            actorId: user.id,
            entityType: 'task',
            entityId: taskId,
          });
        }
      }

      // Fire-and-forget webhook dispatch — never block the API response
      dispatchWebhookEvent('task.comment_added', orgId!, {
        taskId,
        commentId: comment.id,
        taskTitle: task!.title,
        taskIdDisplay: task!.taskIdDisplay,
        commentPreview: content.substring(0, 200),
        createdBy: user.id,
      });

      // Fetch the comment with user info
      const [commentWithUser] = await db()
        .select({
          id: schema.taskComments.id,
          taskId: schema.taskComments.taskId,
          userId: schema.taskComments.userId,
          content: schema.taskComments.content,
          isInternalNote: schema.taskComments.isInternalNote,
          parentId: schema.taskComments.parentId,
          isEdited: schema.taskComments.isEdited,
          editedAt: schema.taskComments.editedAt,
          createdAt: schema.taskComments.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.taskComments)
        .leftJoin(schema.users, eq(schema.taskComments.userId, schema.users.id))
        .where(eq(schema.taskComments.id, comment.id))
        .limit(1);

      return NextResponse.json({ comment: commentWithUser }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create comment');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'comments:create' },
);

// DELETE /api/tasks/[id]/comments/[commentId] - Delete a comment (rate limited: 60 req/min per user)
export const DELETE = withAuth(
  async (request: NextRequest, { user }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const commentId = request.nextUrl.searchParams.get('commentId');

      if (!commentId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'commentId is required' } },
          { status: 400 },
        );
      }

      const [existing] = await db()
        .select()
        .from(schema.taskComments)
        .where(
          and(
            eq(schema.taskComments.id, commentId),
            eq(schema.taskComments.taskId, taskId),
            isNull(schema.taskComments.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Comment not found' } },
          { status: 404 },
        );
      }

      // Only comment owner can delete
      if (existing.userId !== user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You can only delete your own comments' } },
          { status: 403 },
        );
      }

      // Block deletion when the parent task is closed/archived (read-only).
      const [parentTask] = await db()
        .select({ status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .limit(1);
      if (parentTask && READONLY_STATUSES.has(parentTask.status)) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: `Cannot modify comments on a '${parentTask.status}' task`,
            },
          },
          { status: 422 },
        );
      }

      await db()
        .update(schema.taskComments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.taskComments.id, commentId));

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete comment');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'comments:delete' },
);
