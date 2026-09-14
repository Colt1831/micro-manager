import { describe, it, expect } from 'vitest';
import { validateOrigin, validateReferer, csrfErrorResponse } from '@/lib/api/csrf';

const ALLOWED_ORIGINS = [
  'https://app.example.com',
  'https://admin.example.com',
  'http://localhost:3000',
];

// ─── Test helper ────────────────────────────────────────────────

/**
 * Create a minimal request-like object with custom headers.
 * Avoids the Fetch API forbidden header restriction (Origin and Referer
 * cannot be set via the Request constructor in spec-compliant runtimes
 * like happy-dom, but jsdom was lenient about this).
 */
function mockRequest(origin?: string, referer?: string): Request {
  return {
    headers: {
      get: (name: string) => {
        if (name === 'origin') return origin ?? null;
        if (name === 'referer') return referer ?? null;
        return null;
      },
    },
  } as unknown as Request;
}

// ─── validateOrigin ────────────────────────────────────────────

describe('validateOrigin', () => {
  it('allows requests from allowed origins', () => {
    const req = mockRequest('https://app.example.com');
    expect(validateOrigin(req, ALLOWED_ORIGINS)).toEqual({ valid: true });
  });

  it('allows requests from localhost in allowed list', () => {
    const req = mockRequest('http://localhost:3000');
    expect(validateOrigin(req, ALLOWED_ORIGINS)).toEqual({ valid: true });
  });

  it('rejects requests from unknown origins', () => {
    const req = mockRequest('https://evil.com');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('evil.com');
  });

  it('rejects requests from null origin string', () => {
    // Some browsers send 'null' for file:// or data:// origins
    const req = mockRequest('null');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
  });

  it('allows requests with no Origin header', () => {
    // Same-origin requests and non-browser clients may omit Origin
    const req = mockRequest();
    expect(validateOrigin(req, ALLOWED_ORIGINS)).toEqual({ valid: true });
  });

  it('is case-sensitive in origin matching', () => {
    const req = mockRequest('HTTPS://APP.EXAMPLE.COM');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
  });

  it('handles trailing slashes in origin', () => {
    const req = mockRequest('https://app.example.com/');
    expect(validateOrigin(req, ALLOWED_ORIGINS)).toEqual({ valid: true });
  });

  it('rejects origin with path components', () => {
    const req = mockRequest('https://app.example.com/evil-path');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
  });

  it('rejects origin with port mismatch', () => {
    const req = mockRequest('http://localhost:8080');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
  });

  it('rejects subdomain attacks when subdomain not in allowed list', () => {
    const req = mockRequest('https://evil.app.example.com');
    const result = validateOrigin(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
  });
});

// ─── validateReferer ───────────────────────────────────────────

describe('validateReferer', () => {
  it('allows requests with matching referer origin', () => {
    const req = mockRequest(undefined, 'https://app.example.com/dashboard');
    expect(validateReferer(req, ALLOWED_ORIGINS)).toEqual({ valid: true });
  });

  it('rejects requests with unknown referer origin', () => {
    const req = mockRequest(undefined, 'https://evil.com/dashboard');
    const result = validateReferer(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('evil.com');
  });

  it('rejects requests with no Referer header (fallback after Origin failed → no same-origin proof)', () => {
    const req = mockRequest();
    expect(validateReferer(req, ALLOWED_ORIGINS).valid).toBe(false);
  });

  it('handles invalid Referer URL gracefully', () => {
    const req = mockRequest(undefined, 'not-a-valid-url');
    const result = validateReferer(req, ALLOWED_ORIGINS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not-a-valid-url');
  });

  it('rejects an empty Referer header (no same-origin proof)', () => {
    const req = mockRequest(undefined, '');
    expect(validateReferer(req, ALLOWED_ORIGINS).valid).toBe(false);
  });
});

// ─── csrfErrorResponse ─────────────────────────────────────────

describe('csrfErrorResponse', () => {
  it('returns 403 with structured error', () => {
    const res = csrfErrorResponse('Origin not allowed');
    expect(res.status).toBe(403);

    // Response.json() returns a NextResponse — we can check its body
    // by parsing the response after serialisation
  });

  it('includes the reason in the error message', async () => {
    const res = csrfErrorResponse('Custom reason');
    const body = await res.json();
    expect(body.error.code).toBe('CSRF_VALIDATION_FAILED');
    expect(body.error.message).toBe('Custom reason');
  });

  it('provides default message when no reason given', async () => {
    const res = csrfErrorResponse();
    const body = await res.json();
    expect(body.error.code).toBe('CSRF_VALIDATION_FAILED');
    expect(body.error.message).toBe('Cross-site request forbidden');
  });
});

// ─── Integration: Origin + Referer fallback ────────────────────

describe('CSRF validation flow (Origin → Referer fallback)', () => {
  const allowed = ALLOWED_ORIGINS;

  it('passes when Origin is missing but Referer matches', () => {
    // Some CDNs strip the Origin header but preserve Referer
    const req = mockRequest(undefined, 'https://app.example.com/dashboard');
    // Origin check passes (missing Origin)
    expect(validateOrigin(req, allowed)).toEqual({ valid: true });
    // If we needed to fall back, Referer would also pass
    expect(validateReferer(req, allowed)).toEqual({ valid: true });
  });

  it('fails when Origin and Referer both point to attacker', () => {
    const req = mockRequest('https://evil.com', 'https://evil.com/dashboard');
    expect(validateOrigin(req, allowed).valid).toBe(false);
    expect(validateReferer(req, allowed).valid).toBe(false);
  });

  it('fails when bad Origin is present but good Referer is absent', () => {
    const req = mockRequest('https://evil.com');
    expect(validateOrigin(req, allowed).valid).toBe(false);
    // Fallback must also reject — no Referer means no same-origin proof.
    expect(validateReferer(req, allowed).valid).toBe(false);
  });
});
