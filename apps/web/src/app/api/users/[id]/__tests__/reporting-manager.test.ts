import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Hoisted mocks ──────────────────────────────────────────
const {
  mockDb,
  mockRequirePermission,
  mockGetUserRank,
  mockEnforceOrgScope,
  mockAssertUserSameOrg,
  mockAssertDeptSameOrg,
  mockAssertTeamSameOrg,
  mockCreateAuditEntry,
} = vi.hoisted(() => ({
  mockDb: vi.fn(),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
  mockGetUserRank: vi.fn().mockResolvedValue('manager'),
  mockEnforceOrgScope: vi.fn(),
  mockAssertUserSameOrg: vi.fn().mockResolvedValue(null),
  mockAssertDeptSameOrg: vi.fn().mockResolvedValue(null),
  mockAssertTeamSameOrg: vi.fn().mockResolvedValue(null),
  mockCreateAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  schema: { users: new Proxy({}, { get: (_t, p) => String(p) }), sessions: {} },
  handleApiError: (e: unknown) => ({ error: { code: 'INTERNAL', message: String(e) }, status: 500 }),
}));

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth: (handler: (req: NextRequest, ctx: unknown) => unknown) => (req: NextRequest) =>
    handler(req, { user: { id: 'actor-1' }, orgId: 'org-1' }),
  enforceOrgScope: mockEnforceOrgScope,
  requirePermission: mockRequirePermission,
  getUserRank: mockGetUserRank,
}));

vi.mock('@/lib/audit', () => ({ createAuditEntry: mockCreateAuditEntry }));
vi.mock('@workmanagement/shared', () => ({ canGrantRank: () => true, isRank: () => true }));
vi.mock('@/lib/api/cross-ref', () => ({
  assertUserSameOrg: mockAssertUserSameOrg,
  assertDepartmentSameOrg: mockAssertDeptSameOrg,
  assertTeamSameOrg: mockAssertTeamSameOrg,
}));

import { PATCH } from '../route';

const EXISTING = {
  id: 'target-1',
  organizationId: 'org-1',
  rank: 'employee',
  firstName: 'A',
  lastName: 'B',
};

// A thenable drizzle chain: select→limit resolves to [EXISTING]; update→returning to [updated].
function dbForUpdate(updated: Record<string, unknown>) {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([EXISTING]),
  };
  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve([updated]),
  };
  return () => ({ select: () => selectChain, update: () => updateChain });
}

function req(id: string, body: unknown): NextRequest {
  return {
    nextUrl: { pathname: `/api/users/${id}` },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('PATCH /api/users/[id] — reportingManagerId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertUserSameOrg.mockResolvedValue(null);
  });

  it('rejects a user managing themselves', async () => {
    mockDb.mockImplementation(dbForUpdate({ ...EXISTING, reportingManagerId: 'target-1' }));
    const res = await PATCH(req('target-1', { reportingManagerId: 'target-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/report to themselves/i);
  });

  it('rejects a cross-org manager', async () => {
    mockAssertUserSameOrg.mockResolvedValue({ code: 'CROSS_ORG', message: 'cross', status: 403 });
    mockDb.mockImplementation(dbForUpdate(EXISTING));
    const res = await PATCH(req('target-1', { reportingManagerId: 'other-org-user' }));
    expect(res.status).toBe(403);
  });

  it('sets a valid same-org manager', async () => {
    mockDb.mockImplementation(dbForUpdate({ ...EXISTING, reportingManagerId: 'mgr-1' }));
    const res = await PATCH(req('target-1', { reportingManagerId: 'mgr-1' }));
    expect(res.status).toBe(200);
    expect(mockAssertUserSameOrg).toHaveBeenCalledWith('mgr-1', 'org-1');
    const body = await res.json();
    expect(body.user.reportingManagerId).toBe('mgr-1');
  });

  it('clears the manager with null (no same-org check)', async () => {
    mockDb.mockImplementation(dbForUpdate({ ...EXISTING, reportingManagerId: null }));
    const res = await PATCH(req('target-1', { reportingManagerId: null }));
    expect(res.status).toBe(200);
    expect(mockAssertUserSameOrg).not.toHaveBeenCalled();
  });
});
