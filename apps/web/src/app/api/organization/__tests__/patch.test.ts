import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────
const { mockDb, mockRequirePermission, mockCreateAuditEntry } = vi.hoisted(() => ({
  mockDb: vi.fn(),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
  mockCreateAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  schema: { organizations: new Proxy({}, { get: (_t, p) => String(p) }) },
  // Mirror the real handleApiError's AuthError re-map so the permission-gate
  // test exercises the true 403 path instead of a blanket 500.
  handleApiError: (e: unknown) => {
    if (e instanceof Error && e.name === 'AuthError' && typeof (e as { status?: unknown }).status === 'number') {
      const a = e as Error & { status: number; code?: string };
      return { error: { code: a.code ?? 'FORBIDDEN', message: a.message }, status: a.status };
    }
    return { error: { code: 'INTERNAL', message: String(e) }, status: 500 };
  },
}));

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth: (handler: (req: Request, ctx: unknown) => unknown) => (req: Request) =>
    handler(req, { user: { id: 'actor-1' }, orgId: 'org-1' }),
  requirePermission: mockRequirePermission,
}));

vi.mock('@/lib/audit', () => ({ createAuditEntry: mockCreateAuditEntry }));

import { PATCH } from '../route';
import type { NextRequest } from 'next/server';

function dbReturning(updated: Record<string, unknown> | undefined) {
  const chain = {
    update: () => chain,
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(updated ? [updated] : []),
  };
  return () => chain;
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('PATCH /api/organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
  });

  it('updates name and returns the org', async () => {
    mockDb.mockImplementation(dbReturning({ id: 'org-1', name: 'New Co', slug: 'orig', domain: null }));
    const res = await PATCH(req({ name: 'New Co' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organization.name).toBe('New Co');
    expect(mockCreateAuditEntry).toHaveBeenCalledOnce();
  });

  it('rejects an empty name', async () => {
    mockDb.mockImplementation(dbReturning(undefined));
    const res = await PATCH(req({ name: '   ' }));
    expect(res.status).toBe(400);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('rejects a name over 255 chars', async () => {
    const res = await PATCH(req({ name: 'x'.repeat(256) }));
    expect(res.status).toBe(400);
  });

  it('clears domain when given an empty string', async () => {
    let captured: Record<string, unknown> | undefined;
    const chain = {
      update: () => chain,
      set: (v: Record<string, unknown>) => {
        captured = v;
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve([{ id: 'org-1', name: 'C', slug: 's', domain: null }]),
    };
    mockDb.mockImplementation(() => chain);
    const res = await PATCH(req({ domain: '' }));
    expect(res.status).toBe(200);
    expect(captured?.domain).toBeNull();
  });

  it('is gated by org:edit (403 when permission denied)', async () => {
    // Mirror the real AuthError: name 'AuthError' + numeric status, which
    // handleApiError re-maps to the true 403 (not a generic 500).
    const authErr = Object.assign(new Error('Forbidden'), { name: 'AuthError', status: 403, code: 'FORBIDDEN' });
    mockRequirePermission.mockRejectedValue(authErr);
    mockDb.mockImplementation(dbReturning(undefined));
    const res = await PATCH(req({ name: 'X' }));
    expect(res.status).toBe(403);
    expect(mockRequirePermission).toHaveBeenCalledWith('actor-1', 'org:edit');
    expect(mockDb).not.toHaveBeenCalled();
  });
});
