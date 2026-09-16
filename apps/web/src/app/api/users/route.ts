import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { render } from '@react-email/components';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { WelcomeEmail } from '@/lib/email/components/welcome';
import logger from '@/lib/logger';
import { eq, like, or, desc, and, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export const runtime = 'nodejs';

/** Hash a password with the same scrypt params Better Auth uses. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const buf = scryptSync(password, salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${buf.toString('hex')}`;
}

// GET /api/users - List users (org-scoped, rate limited: 100 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'user:view');

      const { searchParams } = new URL(request.url);
      const search = searchParams.get('search');
      const departmentId = searchParams.get('departmentId');
      const teamId = searchParams.get('teamId');
      const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
      const offset = Number(searchParams.get('offset')) || 0;

      const filters: SQL[] = [
        isNull(schema.users.deletedAt),
        eq(schema.users.organizationId, orgId!),
      ];

      if (departmentId) filters.push(eq(schema.users.departmentId, departmentId));
      if (teamId) filters.push(eq(schema.users.teamId, teamId));

      if (search) {
        const searchClause = or(
          like(schema.users.firstName, `%${search}%`),
          like(schema.users.lastName, `%${search}%`),
          like(schema.users.email, `%${search}%`),
          like(schema.users.displayName, `%${search}%`),
        );
        if (searchClause) filters.push(searchClause);
      }

      const users = await db()
        .select({
          id: schema.users.id,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          name: schema.users.name,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          designation: schema.users.designation,
          departmentId: schema.users.departmentId,
          teamId: schema.users.teamId,
          reportingManagerId: schema.users.reportingManagerId,
          employmentStatus: schema.users.employmentStatus,
          isActive: schema.users.isActive,
          createdAt: schema.users.createdAt,
        })
        .from(schema.users)
        .where(and(...filters))
        .orderBy(desc(schema.users.createdAt))
        .limit(limit)
        .offset(offset);

      return NextResponse.json({ users });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch users');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'users:list' },
);

// POST /api/users - Invite/create a user in the org (admin, rate limited: 30 req/min)
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'user:create');

      const body = await request.json().catch(() => ({}));
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const designation = typeof body.designation === 'string' ? body.designation.trim() : '';
      const roleSlug = typeof body.roleSlug === 'string' ? body.roleSlug.trim() : 'member';

      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'A valid email is required' } },
          { status: 400 },
        );
      }

      // Reject duplicates
      const [existing] = await db()
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'A user with this email already exists' } },
          { status: 409 },
        );
      }

      // Resolve the requested role within the org; fall back to "member".
      const resolveRole = async (slug: string) => {
        const [r] = await db()
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(and(eq(schema.roles.slug, slug), eq(schema.roles.organizationId, orgId!)))
          .limit(1);
        return r?.id;
      };
      const roleId = (await resolveRole(roleSlug)) ?? (await resolveRole('member'));

      const userId = randomUUID();
      const parts = name ? name.split(/\s+/) : [email.split('@')[0]!];
      const firstName = parts[0] ?? '';
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
      const displayName = name || email.split('@')[0]!;

      await db().insert(schema.users).values({
        id: userId,
        email,
        name: displayName,
        firstName,
        lastName,
        displayName,
        designation: designation || null,
        emailVerified: true,
        organizationId: orgId!,
        isActive: true,
        isSuspended: false,
      });

      // Credential account with a random temp password. The invitee sets their
      // own password via the "Forgot password" flow on the login page.
      const tempPassword = randomBytes(24).toString('base64url');
      await db().insert(schema.accounts).values({
        id: randomUUID(),
        userId,
        accountId: email,
        providerId: 'credential',
        password: hashPassword(tempPassword),
      });

      if (roleId) {
        await db()
          .insert(schema.userRoles)
          .values({ id: randomUUID(), userId, roleId })
          .onConflictDoNothing();
      }

      // Welcome email — best-effort, and a graceful no-op when Resend is unset.
      let emailSent = false;
      try {
        const unsubscribeUrl =
          process.env.EMAIL_UNSUBSCRIBE_URL ??
          'https://app.workmanager.com/settings/notifications';
        const html = await render(WelcomeEmail({ userName: displayName, unsubscribeUrl }));
        const result = await sendEmail({ to: email, subject: 'Welcome to WorkManager', html });
        emailSent = result !== null;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'welcome email failed (user still created)',
        );
      }

      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'user.created',
        entityType: 'user',
        entityId: userId,
        newValues: { email, roleSlug },
      });

      const [created] = await db()
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      return NextResponse.json({ user: created, emailSent }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to create user');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'users:create' },
);
