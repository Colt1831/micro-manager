import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth';
import { checkRateLimit, rateLimitKey, ipFromRequest } from '@/lib/api/rate-limit';
import { getDb, schema } from '@workmanagement/database';
import { eq, and } from 'drizzle-orm';
import logger from '@/lib/logger';

let _handler: {
  POST: (req: Request) => Promise<Response>;
  GET: (req: Request) => Promise<Response>;
} | null = null;

async function getHandler() {
  if (!_handler) {
    const { toNextJsHandler } = await import('better-auth/next-js');
    _handler = toNextJsHandler(getAuth());
  }
  return _handler;
}

// ─── New User Org Assignment ────────────────────────────────────

/**
 * Assign a newly registered user to the default organization and grant a
 * role so they can immediately access org-scoped data. The FIRST user to
 * sign up into an org that has no administrator yet becomes the admin
 * (workspace owner); everyone after that gets the standard "member" role.
 *
 * Runs fire-and-forget after a successful signup — never blocks
 * the auth response.
 */
async function assignNewUserToOrg(userId: string): Promise<void> {
  try {
    const db = getDb();

    // Find the default organization (created by db:seed)
    const [org] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, 'default'))
      .limit(1);

    if (!org) {
      console.warn('[auth] No default organization found — new user will have no org context');
      return;
    }

    // Update the user's organization_id
    await db
      .update(schema.users)
      .set({ organizationId: org.id })
      .where(eq(schema.users.id, userId));

    // ── Role assignment (with first-admin bootstrap) ──────────
    // If this org has no administrator yet, the FIRST user to sign up
    // becomes the Administrator (they own the workspace). Everyone who
    // registers after that gets the standard "member" role.
    const [adminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.slug, 'admin'), eq(schema.roles.organizationId, org.id)))
      .limit(1);

    let existingAdmin: { userId: string } | undefined;
    if (adminRole) {
      [existingAdmin] = await db
        .select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, adminRole.id))
        .limit(1);
    }

    const bootstrapAsAdmin = Boolean(adminRole) && !existingAdmin;
    const targetSlug = bootstrapAsAdmin ? 'admin' : 'member';

    let roleId: string | undefined = bootstrapAsAdmin ? adminRole!.id : undefined;
    if (!roleId) {
      const [memberRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(and(eq(schema.roles.slug, 'member'), eq(schema.roles.organizationId, org.id)))
        .limit(1);
      roleId = memberRole?.id;
    }

    if (roleId) {
      await db
        .insert(schema.userRoles)
        .values({ userId, roleId })
        .onConflictDoNothing();
    }

    logger.info(
      `[auth] New user ${userId} assigned to default org with '${targetSlug}' role` +
        (bootstrapAsAdmin ? ' (bootstrap: first user → admin)' : ''),
    );
  } catch (err) {
    // Log but never fail the signup — this is a best-effort assignment
    console.error('[auth] Failed to assign org/role to new user:', err);
  }
}

// ─── Login History Recording ────────────────────────────────────

/**
 * Record a successful sign-in in login_history. Fire-and-forget after a
 * successful email/password sign-in — a logging failure must never break
 * login, so everything is wrapped in try/catch (fail-open).
 *
 * IP is derived from x-forwarded-for / x-real-ip (via ipFromRequest); the
 * ip_address column is a NOT NULL inet, so an unknown IP falls back to
 * '0.0.0.0' rather than dropping the row on a constraint violation.
 */
async function recordLogin(userId: string, request: Request): Promise<void> {
  try {
    const db = getDb();
    const ip = ipFromRequest(request);
    await db.insert(schema.loginHistory).values({
      userId,
      ipAddress: ip === 'unknown' ? '0.0.0.0' : ip,
      userAgent: request.headers.get('user-agent') ?? null,
      loginMethod: 'email',
      success: true,
    });
  } catch (err) {
    // Best-effort only — never fail the login on a logging error.
    logger.error({ err, userId }, '[auth] Failed to record login history');
  }
}

// ─── Rate-limited Auth Handler ───────────────────────────────────

/**
 * Rate limit login attempts by IP: 5 req / 60s window.
 * We only apply this to POST requests that look like login attempts
 * (i.e. have a body with email/password). Other auth endpoints like
 * register, forgot-password get a more lenient limit.
 */
async function rateLimitAuthRequest(request: Request): Promise<Response | null> {
  try {
    // Only rate limit POST requests
    if (request.method !== 'POST') return null;

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    // Determine which auth action this is based on the URL path
    const isSignIn = /\/auth\/sign-in\/email$/.test(path) || /\/auth\/sign-in$/.test(path);
    const isSignUp = /\/auth\/register$/.test(path) || /\/sign-up\/email$/.test(path);

    if (isSignIn) {
      // Strict rate limiting for login: 5 req/min per IP
      const ip = ipFromRequest(request);
      const key = rateLimitKey('auth:login', ip);
      const result = await checkRateLimit(key, { windowMs: 60_000, max: 5 });
      if (!result.ok) {
        return NextResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many login attempts. Please try again later.',
              retryAfter: Math.max(1, result.reset - Math.floor(Date.now() / 1000)),
            },
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.max(1, result.reset - Math.floor(Date.now() / 1000))),
            },
          },
        );
      }
    } else if (isSignUp) {
      // Moderate rate limiting for registration: 3 req/min per IP
      const ip = ipFromRequest(request);
      const key = rateLimitKey('auth:register', ip);
      const result = await checkRateLimit(key, { windowMs: 60_000, max: 3 });
      if (!result.ok) {
        return NextResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many registration attempts. Please try again later.',
              retryAfter: Math.max(1, result.reset - Math.floor(Date.now() / 1000)),
            },
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.max(1, result.reset - Math.floor(Date.now() / 1000))),
            },
          },
        );
      }
    }
    // For password reset, forgot-password, etc., we don't apply strict rate limiting
    // (Better Auth's built-in 100 req/min global rate limit is sufficient)
  } catch (err) {
    // Log but don't block — fail open
    console.error('[rate-limit] Auth rate limit check failed:', err);
  }
  return null;
}

export async function POST(request: Request) {
  const blocked = await rateLimitAuthRequest(request);
  if (blocked) return blocked;
  const h = await getHandler();
  const response = await h.POST(request);

  // ── Auto-assign new users to default org ────────────────
  // Only runs for successful signups (not sign-ins or other auth actions).
  // Assigns the user to the default organization and member role so
  // they can immediately access org-scoped data without manual admin intervention.
  if (response.status === 200) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const isSignUp = /\/auth\/register$/.test(path) || /\/sign-up\/email$/.test(path);
    const isSignIn = /\/auth\/sign-in\/email$/.test(path) || /\/auth\/sign-in$/.test(path);

    if (isSignUp) {
      try {
        const body = await response.clone().json();
        if (body?.user?.id) {
          // Fire-and-forget — never block the auth response
          assignNewUserToOrg(body.user.id);
        }
      } catch {
        // Response body may not be parseable (e.g. non-JSON)
      }
    } else if (isSignIn) {
      // ── Record successful sign-in in login_history ────────
      // Fire-and-forget — never block or fail the auth response.
      try {
        const body = await response.clone().json();
        if (body?.user?.id) {
          recordLogin(body.user.id, request);
        }
      } catch {
        // Response body may not be parseable (e.g. non-JSON)
      }
    }
  }

  return response;
}

export async function GET(request: Request) {
  const h = await getHandler();
  return h.GET(request);
}
