import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ─── CSRF Protection Strategy ───────────────────────────────────
//
// This module provides defense-in-depth against Cross-Site Request
// Forgery (CSRF) for custom API routes.
//
// Protection layers:
//   1. SameSite=Lax cookies (configured in Better Auth) — the browser
//      will not send session cookies on cross-site POST requests.
//   2. Origin / Referer header validation (this module) — verifies
//      that state-changing requests originate from our own origin.
//   3. Better Auth's built-in CSRF checks (trustedOrigins + fetch
//      metadata headers) for auth routes.
//
// Since SameSite=Lax already blocks session cookies on cross-site
// POST requests, `requireAuth()` inside `withAuth` will reject most
// CSRF attempts with a 401. This module adds a second layer that
// catches edge cases (e.g. subdomain attacks, older browsers).

// ─── Allowed Origins ────────────────────────────────────────────

/**
 * Get the list of allowed origins for CSRF validation.
 * Reads from environment variable or defaults to the APP_URL.
 */
export function getAllowedOrigins(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const customOrigins = process.env.CSRF_TRUSTED_ORIGINS;

  const origins: string[] = [];

  // Always include localhost for development
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000');
    origins.push('http://127.0.0.1:3000');
  }

  if (appUrl) {
    origins.push(appUrl.replace(/\/+$/, ''));
  }

  if (customOrigins) {
    for (const origin of customOrigins.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) origins.push(trimmed);
    }
  }

  return origins;
}

// ─── Header Validation ──────────────────────────────────────────

/**
 * Validate the Origin header of a request.
 *
 * Returns `{ valid: true }` if the Origin matches an allowed origin
 * or if no Origin is present (for same-origin requests from browsers
 * that don't send it, or non-browser clients like curl).
 *
 * Returns `{ valid: false, reason }` if the Origin is present and
 * does not match any allowed origin.
 */
export function validateOrigin(
  request: NextRequest | Request,
  allowedOrigins: string[],
): { valid: boolean; reason?: string } {
  const origin = request.headers.get('origin');

  // No Origin header — could be a same-origin request from a browser
  // that doesn't send it (some older browsers) or a non-browser client.
  // We allow it but the authentication check will still apply.
  if (!origin) {
    return { valid: true };
  }

  // Normalise: strip trailing slash
  const normalisedOrigin = origin.replace(/\/+$/, '');

  if (allowedOrigins.includes(normalisedOrigin)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Origin '${origin}' is not allowed`,
  };
}

/**
 * Validate the Referer header. This is only ever called as the fallback after
 * the Origin header already failed validation, so an ABSENT Referer here means
 * we have no proof the request is same-origin — reject it (no silent pass).
 * The Referer is otherwise less reliable than Origin (Referrer-Policy can strip
 * it), which is why Origin is checked first.
 */
export function validateReferer(
  request: NextRequest | Request,
  allowedOrigins: string[],
): { valid: boolean; reason?: string } {
  const referer = request.headers.get('referer');
  if (!referer) {
    // Origin failed AND no Referer to fall back on → cannot prove same-origin.
    return { valid: false, reason: 'Origin invalid and no Referer header present' };
  }

  try {
    const refererUrl = new URL(referer);
    const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;

    if (allowedOrigins.includes(refererOrigin)) {
      return { valid: true };
    }

    return {
      valid: false,
      reason: `Referer origin '${refererOrigin}' is not allowed`,
    };
  } catch {
    return {
      valid: false,
      reason: `Invalid Referer header: '${referer}'`,
    };
  }
}

// ─── CSRF Response ──────────────────────────────────────────────

/**
 * Create a 403 Forbidden response for CSRF violations.
 */
export function csrfErrorResponse(reason?: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'CSRF_VALIDATION_FAILED',
        message: reason ?? 'Cross-site request forbidden',
      },
    },
    { status: 403 },
  );
}

// ─── High-Level Wrapper ─────────────────────────────────────────

/** HTTP methods that change state and need CSRF protection */
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Options for the `withCsrf` wrapper.
 */
export interface WithCsrfOptions {
  /**
   * Whether to skip the Origin check (default: false).
   * Set to true for webhook endpoints that expect external callers.
   */
  skip?: boolean;
}

/**
 * Wrap an API route handler with CSRF origin validation.
 *
 * Only applies to state-changing methods (POST, PATCH, PUT, DELETE).
 * GET and HEAD requests are not checked (they should not mutate state).
 *
 * This is designed to be composed WITHIN `withAuth`:
 *
 * @example
 * ```ts
 * export const POST = withAuth(
 *   withCsrf(async (request, { user, orgId }) => {
 *     // handler body
 *   }),
 * );
 * ```
 *
 * @example
 * ```ts
 * // Skip CSRF for webhooks
 * export const POST = withAuth(
 *   withCsrf(handler, { skip: true }),
 * );
 * ```
 */
export function withCsrf<T extends (req: NextRequest, ...args: unknown[]) => Promise<NextResponse>>(
  handler: T,
  options?: WithCsrfOptions,
): T {
  if (options?.skip) return handler;

  const wrapped = async (request: NextRequest, ...args: unknown[]) => {
    // Only check mutations
    if (MUTATION_METHODS.has(request.method)) {
      const allowedOrigins = getAllowedOrigins();
      const originResult = validateOrigin(request, allowedOrigins);

      if (!originResult.valid) {
        // Fall back to Referer if Origin failed validation
        const refererResult = validateReferer(request, allowedOrigins);
        if (!refererResult.valid) {
          return csrfErrorResponse(refererResult.reason ?? originResult.reason);
        }
      }
    }

    return handler(request, ...args);
  };

  return wrapped as T;
}
