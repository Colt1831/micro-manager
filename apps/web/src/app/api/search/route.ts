import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/api-auth';
import { getDb, schema } from '@workmanagement/database';
import { eq, like, or, and, isNull, desc } from 'drizzle-orm';
import { searchTasks, searchProjects } from '@/lib/search';
import { applyDeptScope } from '@/lib/api/db';

export const runtime = 'nodejs';

// ─── Types ──────────────────────────────────────────────────

interface SearchHit {
  id: string;
  type: 'task' | 'project' | 'user';
  title: string;
  subtitle: string | null;
  description: string | null;
  status: string | null;
  url: string;
  metadata: Record<string, unknown>;
}

interface SearchResponse {
  results: {
    tasks: { hits: SearchHit[]; total: number };
    projects: { hits: SearchHit[]; total: number };
    users: { hits: SearchHit[]; total: number };
  };
  total: number;
  query: string;
}

// ─── GET /api/search?q=...&type=all ────────────────────────

export const GET = withAuth(
  async (request: NextRequest, { orgId, scope }) => {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') ?? '';
    const searchType = searchParams.get('type') ?? 'all'; // tasks | projects | users | all
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 10, 1), 50);
    const filterStatus = searchParams.get('status');
    const filterPriority = searchParams.get('priority');

    const response: SearchResponse = {
      results: { tasks: { hits: [], total: 0 }, projects: { hits: [], total: 0 }, users: { hits: [], total: 0 } },
      total: 0,
      query,
    };

    if (!query || query.length < 1) {
      return NextResponse.json(response);
    }

    const db = getDb();

    // ── Search tasks ─────────────────────────────────────
    // Meilisearch is org-scoped only (no department field), so a walled user
    // MUST use the dept-scoped DB path instead — forcing the fallback avoids
    // leaking cross-department tasks through the search index.
    if (searchType === 'all' || searchType === 'tasks') {
      try {
        if (!scope.seeAllDepartments) throw new Error('walled: use dept-scoped DB search');
        const filter: Record<string, string> = {};
        if (filterStatus) filter.status = filterStatus;
        if (filterPriority) filter.priority = filterPriority;

        const result = await searchTasks({
          query,
          organizationId: orgId!,
          limit,
          offset: 0,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        });
        response.results.tasks = {
          hits: result.hits.map((h) => ({
            id: h.id,
            type: 'task' as const,
            title: h.title,
            subtitle: h.taskIdDisplay,
            description: h.description,
            status: h.status,
            url: `/tasks/${h.id}`,
            metadata: { priority: h.priority, assignedTo: h.assignedTo, projectId: h.projectId, labels: h.labels },
          })),
          total: result.total,
        };
      } catch {
        // Meilisearch unavailable OR walled user — DB search with dept scope.
        const searchPattern = `%${query}%`;
        const dbConditions = [
          isNull(schema.tasks.deletedAt),
          eq(schema.tasks.organizationId, orgId!),
          or(
            like(schema.tasks.title, searchPattern),
            like(schema.tasks.taskIdDisplay, searchPattern),
            like(schema.tasks.description ?? '', searchPattern),
          )!,
        ];
        applyDeptScope(dbConditions, scope, schema.tasks.departmentId);
        if (filterStatus) dbConditions.push(eq(schema.tasks.status, filterStatus));
        if (filterPriority) dbConditions.push(eq(schema.tasks.priority, filterPriority));

        const tasks = await db
          .select({
            id: schema.tasks.id,
            title: schema.tasks.title,
            taskIdDisplay: schema.tasks.taskIdDisplay,
            description: schema.tasks.description,
            status: schema.tasks.status,
            priority: schema.tasks.priority,
          })
          .from(schema.tasks)
          .where(and(...dbConditions))
          .orderBy(desc(schema.tasks.updatedAt))
          .limit(limit);

        response.results.tasks = {
          hits: tasks.map((t) => ({
            id: t.id,
            type: 'task' as const,
            title: t.title,
            subtitle: t.taskIdDisplay,
            description: t.description,
            status: t.status,
            url: `/tasks/${t.id}`,
            metadata: { priority: t.priority },
          })),
          total: tasks.length,
        };
      }
    }

    // ── Search projects (Meilisearch for GM+, dept-scoped DB otherwise) ─
    if (searchType === 'all' || searchType === 'projects') {
      try {
        if (!scope.seeAllDepartments) throw new Error('walled: use dept-scoped DB search');
        const result = await searchProjects({
          query,
          organizationId: orgId!,
          limit,
          offset: 0,
          filter: filterStatus ? { status: filterStatus } : undefined,
        });
        response.results.projects = {
          hits: result.hits.map((p) => ({
            id: p.id,
            type: 'project' as const,
            title: p.name,
            subtitle: p.code,
            description: p.description,
            status: p.status,
            url: `/projects/${p.id}`,
            metadata: { ownerId: p.ownerId },
          })),
          total: result.total,
        };
      } catch {
        // Meilisearch unavailable OR walled user — DB search with dept scope.
        const searchPattern = `%${query}%`;
        const projConditions = [
          isNull(schema.projects.deletedAt),
          eq(schema.projects.organizationId, orgId!),
          or(
            like(schema.projects.name, searchPattern),
            like(schema.projects.code ?? '', searchPattern),
            like(schema.projects.description ?? '', searchPattern),
          )!,
        ];
        applyDeptScope(projConditions, scope, schema.projects.departmentId);
        const projects = await db
          .select({
            id: schema.projects.id,
            name: schema.projects.name,
            code: schema.projects.code,
            description: schema.projects.description,
            status: schema.projects.status,
          })
          .from(schema.projects)
          .where(and(...projConditions))
          .orderBy(desc(schema.projects.updatedAt))
          .limit(limit);

        response.results.projects = {
          hits: projects.map((p) => ({
            id: p.id,
            type: 'project' as const,
            title: p.name,
            subtitle: p.code,
            description: p.description,
            status: p.status,
            url: `/projects/${p.id}`,
            metadata: {},
          })),
          total: projects.length,
        };
      }
    }

    // ── Search users via DB ILIKE ────────────────────────
    if (searchType === 'all' || searchType === 'users') {
      const searchPattern = `%${query}%`;
      const users = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          displayName: schema.users.displayName,
          name: schema.users.name,
          designation: schema.users.designation,
          isActive: schema.users.isActive,
        })
        .from(schema.users)
        .where(
          and(
            isNull(schema.users.deletedAt),
            eq(schema.users.organizationId, orgId!),
            or(
              like(schema.users.firstName ?? '', searchPattern),
              like(schema.users.lastName ?? '', searchPattern),
              like(schema.users.email, searchPattern),
              like(schema.users.displayName ?? '', searchPattern),
              like(schema.users.name ?? '', searchPattern),
            ),
          ),
        )
        .orderBy(desc(schema.users.lastLoginAt))
        .limit(limit);

      response.results.users = {
        hits: users.map((u) => ({
          id: u.id,
          type: 'user' as const,
          title: u.displayName ?? u.name ?? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email),
          subtitle: u.email,
          description: u.designation,
          status: u.isActive ? 'active' : 'inactive',
          url: `/users/${u.id}`,
          metadata: {},
        })),
        total: users.length,
      };
    }

    // ── Compute total ────────────────────────────────────
    response.total = response.results.tasks.total + response.results.projects.total + response.results.users.total;

    return NextResponse.json(response);
  },
  { windowMs: 60_000, max: 60, namespace: 'search:query' },
);
