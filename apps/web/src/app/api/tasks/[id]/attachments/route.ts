import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull , type SQL } from 'drizzle-orm';
import { uploadFile, deleteFile, getPresignedDownloadUrl } from '@/lib/storage';
import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES, BLOCKED_EXTENSIONS } from '@/lib/api/validation';
import { getTaskIdFromPath, checkTaskAccessOrRespond } from '@/lib/api/task-helpers';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

// GET /api/tasks/[id]/attachments - List attachments for a task
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

      const attachments = await db()
        .select({
          id: schema.taskAttachments.id,
          taskId: schema.taskAttachments.taskId,
          userId: schema.taskAttachments.userId,
          fileName: schema.taskAttachments.fileName,
          fileSize: schema.taskAttachments.fileSize,
          mimeType: schema.taskAttachments.mimeType,
          storageKey: schema.taskAttachments.storageKey,
          createdAt: schema.taskAttachments.createdAt,
          user: {
            id: schema.users.id,
            name: schema.users.name,
            avatarUrl: schema.users.avatarUrl,
          },
        })
        .from(schema.taskAttachments)
        .innerJoin(schema.tasks, eq(schema.taskAttachments.taskId, schema.tasks.id))
        .leftJoin(schema.users, eq(schema.taskAttachments.userId, schema.users.id))
        .where(
          and(
            ...applyDeptScope(
              [
eq(schema.taskAttachments.taskId, taskId),
            isNull(schema.taskAttachments.deletedAt),
            eq(schema.tasks.organizationId, orgId!),
              ] as SQL[],
              scope,
              schema.tasks.departmentId,
            ),
          ),
        )
        .orderBy(desc(schema.taskAttachments.createdAt));

      // Generate presigned download URLs
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (att) => {
          try {
            const downloadUrl = await getPresignedDownloadUrl(att.storageKey);
            return { ...att, downloadUrl };
          } catch {
            return { ...att, downloadUrl: null };
          }
        }),
      );

      return NextResponse.json({ attachments: attachmentsWithUrls });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch attachments');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'attachments:list' },
);

// POST /api/tasks/[id]/attachments - Upload a file attachment
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:edit');

      // Parse multipart form data
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'File is required' } },
          { status: 400 },
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'File exceeds maximum size of 50MB' } },
          { status: 400 },
        );
      }

      // Enforce MIME type (trust boundary): reject when missing or not allowed.
      if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: `File type '${file.type || 'unknown'}' is not allowed`,
            },
          },
          { status: 400 },
        );
      }

      // Validate file extension
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        return NextResponse.json(
          {
            error: { code: 'VALIDATION_ERROR', message: `File extension '${ext}' is not allowed` },
          },
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

      // Block attachments on archived tasks
      if (task!.status === 'archived') {
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Cannot add attachments to archived tasks' } },
          { status: 422 },
        );
      }

      // Sanitize the storage key: use only the basename (strip any path
      // components a crafted filename could include) + a random UUID prefix so
      // keys are unique and never traversable.
      const baseName = (file.name.split(/[\\/]/).pop() ?? 'file').replace(/[^\w.\-]/g, '_');
      const storageKey = `tasks/${taskId}/${randomUUID()}-${baseName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadFile({
        key: storageKey,
        body: buffer,
        contentType: file.type || 'application/octet-stream',
      });

      // Store metadata in database. If the insert fails (throws OR returns no
      // row) AFTER a successful upload, best-effort delete the orphaned object
      // so it doesn't leak in storage.
      let attachment;
      try {
        [attachment] = await db()
          .insert(schema.taskAttachments)
          .values({
            taskId,
            userId: user.id,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || null,
            storageKey,
            isFinal: true,
          })
          .returning();
      } catch (dbError) {
        await deleteFile(storageKey).catch(() => {});
        throw dbError;
      }

      if (!attachment) {
        await deleteFile(storageKey).catch(() => {});
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to record attachment' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'file.uploaded',
        entityType: 'task',
        entityId: taskId,
        newValues: { attachmentId: attachment.id, fileName: file.name, fileSize: file.size },
      });

      // Generate download URL
      const downloadUrl = await getPresignedDownloadUrl(storageKey);

      return NextResponse.json(
        {
          attachment: {
            ...attachment,
            downloadUrl,
            user: { id: user.id, name: null },
          },
        },
        { status: 201 },
      );
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to upload attachment');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'attachments:create' },
);

// DELETE /api/tasks/[id]/attachments - Delete an attachment
export const DELETE = withAuth(
  async (request: NextRequest, { user }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      const attachmentId = request.nextUrl.searchParams.get('attachmentId');

      if (!attachmentId) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'attachmentId is required' } },
          { status: 400 },
        );
      }

      const [existing] = await db()
        .select()
        .from(schema.taskAttachments)
        .where(
          and(
            eq(schema.taskAttachments.id, attachmentId),
            eq(schema.taskAttachments.taskId, taskId),
            isNull(schema.taskAttachments.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Attachment not found' } },
          { status: 404 },
        );
      }

      // Only attachment owner or the user who owns the task can delete
      if (existing.userId !== user.id) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You can only delete your own attachments' } },
          { status: 403 },
        );
      }

      // Delete from S3
      try {
        await deleteFile(existing.storageKey);
      } catch (s3Error) {
        console.error('Failed to delete file from S3:', s3Error);
        // Continue even if S3 delete fails — the DB record should still be removed
      }

      // Soft delete the DB record
      await db()
        .update(schema.taskAttachments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.taskAttachments.id, attachmentId));

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete attachment');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'attachments:delete' },
);
