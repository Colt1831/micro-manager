import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { proxy } from '../proxy';

// Minimal NextRequest stub: cookies.get + nextUrl + url are all proxy() reads.
function req(path: string, cookie?: { name: string; value: string }): NextRequest {
  const url = `https://app.example.com${path}`;
  return {
    url,
    nextUrl: new URL(url),
    cookies: {
      get: (name: string) => (cookie && cookie.name === name ? { value: cookie.value } : undefined),
    },
  } as unknown as NextRequest;
}

const SECURE = '__Secure-better-auth.session_token';
const PLAIN = 'better-auth.session_token';

describe('proxy (auth middleware)', () => {
  it('lets a request through when authenticated via the HTTPS __Secure- cookie', () => {
    const res = proxy(req('/calendar', { name: SECURE, value: 'tok' }));
    // NextResponse.next() has no Location redirect header.
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets a request through with the plain (http) cookie name', () => {
    const res = proxy(req('/calendar', { name: PLAIN, value: 'tok' }));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects an unauthenticated request to /auth/login with a redirect param', () => {
    const res = proxy(req('/calendar'));
    const loc = res.headers.get('location');
    expect(loc).toContain('/auth/login');
    expect(loc).toContain('redirect=%2Fcalendar');
  });

  it('bounces an already-authenticated user off /auth/login', () => {
    const res = proxy(req('/auth/login', { name: SECURE, value: 'tok' }));
    expect(res.headers.get('location')).toContain('/');
  });
});
