import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { ProjectCreateSchema, validationError } from '@/lib/api/validation';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { indexProject } from '@/lib/search';

export const runtime = 'nodejs';

// GET /api/projects - List projects (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'project:view');

      const { searchParams } = new URL(request.url);
      const status = searchParams.get('status');
      const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);
      const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

      const conditions = [
        isNull(schema.projects.deletedAt),
        eq(schema.projects.organizationId, orgId!),
      ];
      // Department wall: GM+/super_admin see all; others only their department.
      applyDeptScope(conditions, scope, schema.projects.departmentId);
      if (status) conditions.push(eq(schema.projects.status, status));

      const projects = await db()
        .select()
        .from(schema.projects)
        .where(and(...conditions))
        .orderBy(desc(schema.projects.createdAt))
        .limit(limit)
        .offset(offset);

      return NextResponse.json({ projects });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch projects');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'projects:list' },
);

// POST /api/projects - Create project (rate limited: 30 req/min per user)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'project:create');

      const body = await request.json();
      const parsed = ProjectCreateSchema.safeParse(body);
      if (!parsed.success) {
        const { error: err, status } = validationError(parsed.error);
        return NextResponse.json(err, { status });
      }

      const { name, code, description, ownerId: ownerIdInput, departmentId: departmentIdInput, teamId, startDate, endDate } =
        parsed.data;
      // Owner defaults to the creating user (the create UI has no owner picker).
      const ownerId = ownerIdInput ?? user.id;
      // Department wall on create: a walled user can only create projects in
      // their OWN department (ignore any other dept they pass). GM+/super_admin
      // may target any department, defaulting to none.
      const departmentId = scope.seeAllDepartments
        ? (departmentIdInput ?? null)
        : (scope.departmentId ?? null);

      // Validate owner is in same org
      const [owner] = await db()
        .select({ id: schema.users.id, organizationId: schema.users.organizationId })
        .from(schema.users)
        .where(and(eq(schema.users.id, ownerId), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!owner) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Owner user not found' } },
          { status: 404 },
        );
      }

      if (owner.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-organization owner assignment denied' } },
          { status: 403 },
        );
      }

      const [project] = await db()
        .insert(schema.projects)
        .values({
          name,
          code,
          description,
          organizationId: orgId!,
          ownerId,
          departmentId,
          teamId,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          createdBy: user.id,
          updatedBy: user.id,
          status: 'active',
        })
        .returning();

      if (!project) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create project' } },
          { status: 500 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'project.created',
        entityType: 'project',
        entityId: project.id,
        newValues: { name, code, status: 'active', ownerId },
      });

      // Index in Meilisearch (non-blocking)
      indexProject({
        id: project.id,
        name: project.name,
        code: project.code ?? null,
        description: project.description ?? null,
        status: project.status ?? 'active',
        ownerId: project.ownerId,
        organizationId: orgId!,
        tags: (project.tags as string[] | null) ?? null,
        createdAt: (project.createdAt as Date).toISOString(),
        updatedAt: (project.updatedAt as Date).toISOString(),
      });

      // Fire-and-forget webhook dispatch — never block the API response
      dispatchWebhookEvent('project.created', orgId!, {
        projectId: project.id,
        name: project.name,
        code: project.code,
        status: project.status,
        ownerId: project.ownerId,
        createdBy: user.id,
      });

      return NextResponse.json({ project }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create project');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'projects:create' },
);
