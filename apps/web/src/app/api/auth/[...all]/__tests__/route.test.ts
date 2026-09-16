import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════
// The sign-in hook records a login_history row (fire-and-forget).
// We mock the better-auth handler to return a successful sign-in
// response and assert the DB insert happens on the sign-in path.
// ═══════════════════════════════════════════════════════════════════

const { mockValues, mockInsert, mockGetDb } = vi.hoisted(() => {
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockValues, mockInsert, mockGetDb: vi.fn(() => ({ insert: mockInsert })) };
});

const mockAuthPost = vi.fn();

vi.mock('@workmanagement/database', () => ({
  getDb: mockGetDb,
  schema: { loginHistory: {} },
}));

vi.mock('@/lib/auth', () => ({ getAuth: vi.fn(() => ({})) }));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({ POST: mockAuthPost, GET: vi.fn() })),
}));

// Rate limit + logger are incidental — keep them inert.
vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitKey: vi.fn(() => 'k'),
  ipFromRequest: vi.fn(() => '9.9.9.9'),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { POST } from '../route';

function signInRequest(): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth handler — login history hook', () => {
  it('records a login_history row on successful sign-in', async () => {
    mockAuthPost.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'user-42' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await POST(signInRequest());
    // recordLogin is fire-and-forget; let the microtask flush.
    await new Promise((r) => setImmediate(r));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-42',
        ipAddress: '9.9.9.9',
        userAgent: 'Mozilla/5.0 (Test)',
        loginMethod: 'email',
        success: true,
      }),
    );
  });

  it('does not throw the login when recording fails (fail-open)', async () => {
    mockValues.mockRejectedValueOnce(new Error('db down'));
    mockAuthPost.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'user-7' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await POST(signInRequest());
    await new Promise((r) => setImmediate(r));

    // Login response is still returned successfully.
    expect(res.status).toBe(200);
  });
});
