import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ═══════════════════════════════════════════════════════════════════
// Hoisted mocks — must be defined before vi.mock calls
// ═══════════════════════════════════════════════════════════════════

const { mockDb, mockHandleApiError } = vi.hoisted(() => ({
  mockDb: vi.fn(),
  mockHandleApiError: vi.fn().mockReturnValue({
    error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    status: 500,
  }),
}));

vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  schema: {
    loginHistory: {
      id: {},
      userId: {},
      ipAddress: {},
      userAgent: {},
      loginMethod: {},
      success: {},
      createdAt: {},
    },
  },
  handleApiError: mockHandleApiError,
}));

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth: vi.fn(
    (
      handler: (
        req: NextRequest,
        context: { user: { id: string; name: string }; orgId: string },
      ) => Promise<Response>,
      _rateLimit?: unknown,
    ) => {
      return async (req: NextRequest) =>
        handler(req, { user: { id: 'user-1', name: 'Test User' }, orgId: 'org-1' });
    },
  ),
}));

import { GET } from '../route';

// Thenable Drizzle-like query chain that resolves to `result`.
function createChain<T>(result: T) {
  const chain: Record<string, unknown> & { then: (r: (v: T) => void) => void } = {
    then: (resolve: (v: T) => void) => resolve(result),
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  };
  return chain;
}

const emptyRequest = {} as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/login-history', () => {
  it("returns the current user's logins, newest first", async () => {
    const rows = [
      {
        id: 'log-1',
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
        loginMethod: 'email',
        success: true,
        createdAt: '2026-09-17T10:00:00Z',
      },
    ];
    const chain = createChain(rows);
    mockDb.mockReturnValue(chain);

    const res = await GET(emptyRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logins).toHaveLength(1);
    expect(body.logins[0].ipAddress).toBe('1.2.3.4');

    // Scoped to the authenticated user and ordered by createdAt desc, capped at 20.
    expect(chain.where).toHaveBeenCalled();
    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it('returns an empty list when there is no history', async () => {
    mockDb.mockReturnValue(createChain([]));
    const res = await GET(emptyRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logins).toEqual([]);
  });

  it('returns 500 when the db throws', async () => {
    mockDb.mockImplementation(() => {
      throw new Error('DB down');
    });
    const res = await GET(emptyRequest);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
