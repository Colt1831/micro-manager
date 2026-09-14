import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from './session';
import { hasPermission, permissionStorage } from '../permissions';
import { getDb, schema } from '@workmanagement/database';
import { eq, and, isNull } from 'drizzle-orm';
import {
  checkRateLimit,
  rateLimitKey,
  rateLimitResponse,
  addRateLimitHeaders,
  ipFromRequest,
} from '@/lib/api/rate-limit';
import {
  getAllowedOrigins,
  validateOrigin,
  validateReferer,
  csrfErrorResponse,
} from '@/lib/api/csrf';

// HTTP methods that change state — CSRF protection applies to these only
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export type ApiHandlerContext = {
  user: Awaited<ReturnType<typeof requireAuth>>;
  orgId: string | null;
};

export interface WithAuthRateLimit {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests within the window */
  max: number;
  /** Namespace for the Redis key */
  namespace: string;
  /**
   * Rate limit key strategy.
   * - 'user': keyed by user ID (default for authenticated routes)
   * - 'ip': keyed by client IP
   */
  key?: 'user' | 'ip';
}

/**
 * Wrap an API route handler with authentication.
 * Provides the authenticated user and org context.
 *
 * Optionally accepts a `rateLimit` config to apply Redis-backed
 * rate limiting after successful authentication.
 *
 * @example
 * // No rate limiting
 * export const GET = withAuth(handler);
 *
 * @example
 * // User-based rate limiting (30 req/min)
 * export const POST = withAuth(handler, { windowMs: 60000, max: 30, namespace: 'task:create' });
 *
 * @example
 * // IP-based rate limiting
 * export const GET = withAuth(handler, { windowMs: 60000, max: 100, namespace: 'api', key: 'ip' });
 */
export function withAuth(
  handler: (req: NextRequest, context: ApiHandlerContext) => Promise<NextResponse>,
  rateLimit?: WithAuthRateLimit,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    try {
      const user = await requireAuth();

      // ── CSRF check for state-changing methods ────────────
      // Defense-in-depth: validate Origin/Referer headers on
      // mutations. This catches edge cases where SameSite=Lax
      // may not apply (subdomain attacks, older browsers).
      if (MUTATION_METHODS.has(req.method)) {
        const allowedOrigins = getAllowedOrigins();
        const originResult = validateOrigin(req, allowedOrigins);

        if (!originResult.valid) {
          // Fall back to Referer if Origin failed
          const refererResult = validateReferer(req, allowedOrigins);
          if (!refererResult.valid) {
            return csrfErrorResponse(refererResult.reason ?? originResult.reason);
          }
        }
      }

      // Check user status and resolve orgId in a single DB query
      const userStatus = await getUserStatus(user.id);
      if (!userStatus.isActive) {
        return NextResponse.json(
          {
            error: { code: 'USER_NOT_ACTIVE', message: 'Your account is suspended or deactivated' },
          },
          { status: 403 },
        );
      }

      const orgId = userStatus.organizationId;

      // Initialize request-scoped permission cache and run the handler
      // inside the AsyncLocalStorage context so all requirePermission() calls
      // within this request share the 3-query result.
      //
      // `await` is required: without it a rejection thrown inside the handler
      // (e.g. requirePermission → AuthError 403) escapes this try/catch and
      // surfaces as a generic 500 instead of the intended status.
      return await permissionStorage.run(new Map(), async () => {
        // Apply rate limiting after authentication if configured
        if (rateLimit) {
          const identifier = rateLimit.key === 'ip' ? ipFromRequest(req) : user.id;

          const key = rateLimitKey(rateLimit.namespace, identifier);
          const result = await checkRateLimit(key, {
            windowMs: rateLimit.windowMs,
            max: rateLimit.max,
          });

          if (!result.ok) {
            return rateLimitResponse(result);
          }

          const response = await handler(req, { user, orgId });
          return addRateLimitHeaders(response, result);
        }

        return handler(req, { user, orgId });
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
      console.error('Auth error:', error);
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' } },
        { status: 500 },
      );
    }
  };
}

/**
 * Check if a user has a specific permission within their organization.
 */
export async function checkPermission(userId: string, permissionCode: string): Promise<boolean> {
  return hasPermission(userId, permissionCode);
}

/**
 * Require a specific permission. Throws if not authorized.
 */
export async function requirePermission(userId: string, permissionCode: string): Promise<void> {
  const hasPerm = await checkPermission(userId, permissionCode);
  if (!hasPerm) {
    throw new AuthError(`Forbidden: requires '${permissionCode}' permission`, 'FORBIDDEN', 403);
  }
}

/**
 * Get user status (active/suspended check) and organization ID in a single query.
 * Consolidates what was previously two separate DB round-trips.
 */
interface UserStatus {
  isActive: boolean;
  organizationId: string | null;
}

export async function getUserStatus(userId: string): Promise<UserStatus> {
  try {
    const db = getDb();
    const [user] = await db
      .select({
        isActive: schema.users.isActive,
        isSuspended: schema.users.isSuspended,
        organizationId: schema.users.organizationId,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!user) return { isActive: false, organizationId: null };
    return {
      isActive: user.isActive === true && user.isSuspended !== true,
      organizationId: user.organizationId ?? null,
    };
  } catch {
    return { isActive: false, organizationId: null };
  }
}

/**
 * Fetch a user's organizational rank (authority level). Returns null if the
 * user is missing. Used by the sensitive role/rank assignment routes to
 * enforce the downward-only hierarchy.
 */
export async function getUserRank(userId: string): Promise<string | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ rank: schema.users.rank })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    return row?.rank ?? null;
  } catch {
    return null;
  }
}

/**
 * Enforce that a record's organization_id matches the user's org.
 */
export function enforceOrgScope(recordOrgId: string | null, userOrgId: string | null): void {
  if (!userOrgId || !recordOrgId) {
    throw new AuthError('Organization scope mismatch', 'FORBIDDEN', 403);
  }
  if (recordOrgId !== userOrgId) {
    throw new AuthError('Cross-organization access denied', 'FORBIDDEN', 403);
  }
}

/**
 * Check if a user is active (not suspended or deactivated).
 */
export async function checkUserActive(userId: string): Promise<boolean> {
  const status = await getUserStatus(userId);
  return status.isActive;
}
