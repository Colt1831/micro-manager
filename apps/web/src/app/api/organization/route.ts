import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { and, eq, isNull } from 'drizzle-orm';

export const runtime = 'nodejs';

// GET /api/organization - Get the current user's organization (rate limited: 100 req/min per user)
export const GET = withAuth(
  async (_request: Request, { orgId }) => {
    try {
      if (!orgId) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'No organization found for this user' } },
          { status: 404 },
        );
      }

      const [org] = await db()
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
          logoUrl: schema.organizations.logoUrl,
          domain: schema.organizations.domain,
          settings: schema.organizations.settings,
          maxUsers: schema.organizations.maxUsers,
          isActive: schema.organizations.isActive,
          createdAt: schema.organizations.createdAt,
          updatedAt: schema.organizations.updatedAt,
        })
        .from(schema.organizations)
        .where(and(eq(schema.organizations.id, orgId), isNull(schema.organizations.deletedAt)))
        .limit(1);

      if (!org) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Organization not found' } },
          { status: 404 },
        );
      }

      return NextResponse.json({ organization: org });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch organization');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'organization:get' },
);

// PATCH /api/organization - Update general org fields (name, domain).
// Slug is the immutable identity and is not editable here. Gated by 'org:edit'.
export const PATCH = withAuth(
  async (request: Request, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'org:edit');

      if (!orgId) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'No organization found for this user' } },
          { status: 404 },
        );
      }

      const body = await request.json().catch(() => ({}));
      const { name, domain } = body as {
        name?: unknown;
        domain?: unknown;
      };

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0 || name.length > 255) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Name must be 1–255 characters' } },
            { status: 400 },
          );
        }
        updateData.name = name.trim();
      }
      if (domain !== undefined) {
        // Nullable free-text host; empty string clears it.
        if (domain !== null && (typeof domain !== 'string' || domain.length > 255)) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Domain must be a string up to 255 characters' } },
            { status: 400 },
          );
        }
        updateData.domain = domain === null || domain === '' ? null : (domain as string).trim();
      }

      const [updated] = await db()
        .update(schema.organizations)
        .set(updateData)
        .where(and(eq(schema.organizations.id, orgId), isNull(schema.organizations.deletedAt)))
        .returning({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
          logoUrl: schema.organizations.logoUrl,
          domain: schema.organizations.domain,
          settings: schema.organizations.settings,
          maxUsers: schema.organizations.maxUsers,
          isActive: schema.organizations.isActive,
          createdAt: schema.organizations.createdAt,
          updatedAt: schema.organizations.updatedAt,
        });

      if (!updated) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Organization not found' } },
          { status: 404 },
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'organization.updated',
        entityType: 'organization',
        entityId: orgId,
        newValues: updateData,
      });

      return NextResponse.json({ organization: updated });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update organization');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'organization:update' },
);
