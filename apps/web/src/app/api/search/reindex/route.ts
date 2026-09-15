import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { getDb, schema } from '@workmanagement/database';
import { eq, and, isNull } from 'drizzle-orm';
import {
  initializeSearchIndexes,
  indexTasks,
  indexProjects,
  purgeStaleTasks,
  purgeStaleProjects,
} from '@/lib/search';

export const runtime = 'nodejs';

interface ReindexResult {
  tasksIndexed: number;
  tasksRemoved: number;
  projectsIndexed: number;
  projectsRemoved: number;
  indexesConfigured: boolean;
  errors: string[];
}

// ─── POST /api/search/reindex — Re-index all searchable data ───

async function reindexHandler(
  _req: NextRequest,
  ctx: { user: { id: string }; orgId: string | null },
) {
  // Re-indexing is an admin/maintenance operation — gate it (bubbles to withAuth → 403).
  await requirePermission(ctx.user.id, 'settings:manage');

  if (!ctx.orgId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'No organization context' } },
      { status: 400 },
    );
  }

  const result: ReindexResult = {
    tasksIndexed: 0,
    tasksRemoved: 0,
    projectsIndexed: 0,
    projectsRemoved: 0,
    indexesConfigured: false,
    errors: [],
  };

  try {
    // 1. Initialize/update Meilisearch index settings
    await initializeSearchIndexes();
    result.indexesConfigured = true;

    const db = getDb();

    // 2. Re-index all active tasks for this org
    try {
      const tasks = await db
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          description: schema.tasks.description,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          assignedTo: schema.tasks.assignedTo,
          projectId: schema.tasks.projectId,
          organizationId: schema.tasks.organizationId,
          labels: schema.tasks.labels,
          tags: schema.tasks.tags,
          createdAt: schema.tasks.createdAt,
          updatedAt: schema.tasks.updatedAt,
        })
        .from(schema.tasks)
        .where(
          and(
            isNull(schema.tasks.deletedAt),
            eq(schema.tasks.organizationId, ctx.orgId),
          ),
        );

      const docs = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        taskIdDisplay: t.taskIdDisplay,
        status: t.status,
        priority: t.priority ?? 'medium',
        assignedTo: t.assignedTo ?? null,
        projectId: t.projectId ?? null,
        organizationId: t.organizationId,
        labels: (t.labels as string[] | null) ?? null,
        tags: (t.tags as string[] | null) ?? null,
        createdAt: (t.createdAt as Date).toISOString(),
        updatedAt: (t.updatedAt as Date).toISOString(),
      }));

      if (docs.length > 0) {
        await indexTasks(docs);
      }
      result.tasksIndexed = docs.length;

      // Purge tasks indexed for this org that are no longer active in the DB
      // (deleted/soft-deleted). Org-scoped — never touches other tenants.
      result.tasksRemoved = await purgeStaleTasks(
        ctx.orgId,
        docs.map((d) => d.id),
      );
    } catch (err) {
      result.errors.push(`Task reindex failed: ${err instanceof Error ? err.message : err}`);
    }

    // 3. Re-index all projects for this org
    try {
      const projects = await db
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          code: schema.projects.code,
          description: schema.projects.description,
          status: schema.projects.status,
          ownerId: schema.projects.ownerId,
          organizationId: schema.projects.organizationId,
          tags: schema.projects.tags,
          createdAt: schema.projects.createdAt,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(
          and(
            isNull(schema.projects.deletedAt),
            eq(schema.projects.organizationId, ctx.orgId),
          ),
        );

      const docs = projects.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code ?? null,
        description: p.description ?? null,
        status: p.status ?? 'active',
        ownerId: p.ownerId,
        organizationId: p.organizationId,
        tags: (p.tags as string[] | null) ?? null,
        createdAt: (p.createdAt as Date).toISOString(),
        updatedAt: (p.updatedAt as Date).toISOString(),
      }));

      if (docs.length > 0) {
        await indexProjects(docs);
      }
      result.projectsIndexed = docs.length;

      // Purge projects indexed for this org no longer active in the DB.
      result.projectsRemoved = await purgeStaleProjects(
        ctx.orgId,
        docs.map((d) => d.id),
      );
    } catch (err) {
      result.errors.push(`Project reindex failed: ${err instanceof Error ? err.message : err}`);
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'REINDEX_FAILED',
          message: error instanceof Error ? error.message : 'Reindex failed',
        },
        result,
      },
      { status: 500 },
    );
  }
}

export const POST = withAuth(reindexHandler, {
  windowMs: 300_000,
  max: 5,
  namespace: 'search:reindex',
});
