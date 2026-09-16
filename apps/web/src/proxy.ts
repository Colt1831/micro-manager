import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/api/auth',
  '/api/health',
  '/api/email/preview',
  '/api/cron',
  '/api/automation',
];

/**
 * Better Auth names the session cookie 'better-auth.session_token', but over
 * HTTPS it prefixes it with '__Secure-' (secure cookies). This middleware runs
 * on both http (local dev) and https (any real deployment / tunnel), so it must
 * accept either name — checking only the bare name breaks auth behind HTTPS:
 * every protected route bounces to /auth/login despite a valid session, an
 * infinite redirect loop that makes the deployed app unusable.
 */
const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_COOKIE_NAME_SECURE = '__Secure-better-auth.session_token';

export function proxy(request: NextRequest) {
  const sessionToken =
    request.cookies.get(SESSION_COOKIE_NAME)?.value ??
    request.cookies.get(SESSION_COOKIE_NAME_SECURE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    if (pathname === '/auth/login' && sessionToken) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/fonts') ||
    pathname.startsWith('/images')
  ) {
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!sessionToken) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
