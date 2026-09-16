import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain, createRequest } from '@/__tests__/api/test-helpers';

// ═══════════════════════════════════════════════════════════════════
// Phase 1 — rank/RBAC route gates.
//   1. POST /api/users/[id]/roles — grant ceiling: you may only assign a
//      role strictly BELOW your own highest role priority.
//   2. PATCH /api/users/[id]    — rank change gate: downward-only via the
//      real canGrantRank, and no self-rank-change.
// The shared rank helpers are NOT mocked — the gate is exercised for real.
// ═══════════════════════════════════════════════════════════════════

const { mockNextResponseJson, mockDb, mockRequirePermission, mockCreateAuditEntry, mockGetUserRank } =
  vi.hoisted(() => ({
    mockNextResponseJson: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      ok: (init?.status ?? 200) < 400,
      json: async () => body,
    })),
    mockDb: vi.fn(),
    mockRequirePermission: vi.fn(() => Promise.resolve()),
    mockCreateAuditEntry: vi.fn(() => Promise.resolve()),
    mockGetUserRank: vi.fn(),
  }));

vi.mock('next/server', () => ({
  NextResponse: { json: mockNextResponseJson },
}));

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth:
    (handler: Function) =>
    async (req: unknown) =>
      handler(req, {
        user: { id: 'actor-1', email: 'a@test.com', name: 'Actor' },
        orgId: 'org-1',
        // The user detail routes now gate on the department wall too; give the
        // actor org-wide sight so these tests exercise the RANK gate only.
        scope: { rank: 'super_admin', level: 100, departmentId: null, seeAllDepartments: true },
      }),
  requirePermission: mockRequirePermission,
  enforceOrgScope: vi.fn(), // no-op: org match is asserted separately, not under test here
  getUserRank: mockGetUserRank,
}));

vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  // Real signature: seeAllDepartments short-circuits to true. Mirrored here so
  // the rank tests aren't accidentally gated by the department wall.
  canAccessDept: (scope: { seeAllDepartments?: boolean; departmentId?: string | null }, dept: string | null) =>
    scope?.seeAllDepartments === true || (dept != null && dept === scope?.departmentId),
  schema: {
    users: { id: 'users.id', organizationId: 'users.orgId', deletedAt: 'users.deletedAt', rank: 'users.rank' },
    roles: { id: 'roles.id', organizationId: 'roles.orgId', priority: 'roles.priority', isActive: 'roles.isActive', deletedAt: 'roles.deletedAt' },
    userRoles: { id: 'ur.id', userId: 'ur.userId', roleId: 'ur.roleId' },
  } as Record<string, Record<string, string>>,
  handleApiError: vi.fn((_error: unknown, message: string) => ({
    error: { code: 'INTERNAL_ERROR', message },
    status: 500,
  })),
}));

vi.mock('@/lib/audit', () => ({ createAuditEntry: mockCreateAuditEntry }));

import { POST as ASSIGN_ROLE } from '@/app/api/users/[id]/roles/route';
import { PATCH as UPDATE_USER } from '@/app/api/users/[id]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Grant ceiling on role assignment ───────────────────────────

describe('POST /api/users/[id]/roles — grant ceiling', () => {
  const ROLES_PATH = '/api/users/user-2/roles';

  it('rejects assigning a role at or above the actor’s own authority level', async () => {
    // role priority 60 (Owner), actor ceiling 40 (Manager) → 60 >= 40 → denied
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'r-owner', organizationId: 'org-1', priority: 60, name: 'Owner' }], // role lookup
        [{ id: 'user-2', organizationId: 'org-1' }], // target user
        [{ priority: 40 }], // actorMaxRolePriority
      ]),
    );

    const res = await ASSIGN_ROLE(createRequest('POST', ROLES_PATH, '', { roleId: 'r-owner' }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(mockCreateAuditEntry).not.toHaveBeenCalled();
  });

  it('rejects assigning a role EQUAL to the actor’s level (no minting peers)', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'r-mgr', organizationId: 'org-1', priority: 40, name: 'Manager' }],
        [{ id: 'user-2', organizationId: 'org-1' }],
        [{ priority: 40 }],
      ]),
    );

    const res = await ASSIGN_ROLE(createRequest('POST', ROLES_PATH, '', { roleId: 'r-mgr' }));
    expect(res.status).toBe(403);
  });

  it('allows assigning a role strictly below the actor’s level', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'r-exec', organizationId: 'org-1', priority: 10, name: 'Executive' }],
        [{ id: 'user-2', organizationId: 'org-1' }],
        [{ priority: 40 }], // ceiling
        [], // existing assignment check → none
        [{ id: 'ur-1', userId: 'user-2', roleId: 'r-exec' }], // insert returning
      ]),
    );

    const res = await ASSIGN_ROLE(createRequest('POST', ROLES_PATH, '', { roleId: 'r-exec' }));
    expect(res.status).toBe(201);
    expect(mockCreateAuditEntry).toHaveBeenCalledOnce();
  });

  it('defaults the ceiling to deny when the actor has no roles', async () => {
    // ceiling query returns nothing → -1 → even priority 0 role (0 >= -1) denied
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'r-exec', organizationId: 'org-1', priority: 10, name: 'Executive' }],
        [{ id: 'user-2', organizationId: 'org-1' }],
        [], // no roles for actor
      ]),
    );

    const res = await ASSIGN_ROLE(createRequest('POST', ROLES_PATH, '', { roleId: 'r-exec' }));
    expect(res.status).toBe(403);
  });
});

// ─── Rank change gate on user PATCH ─────────────────────────────

describe('PATCH /api/users/[id] — rank change gate', () => {
  it('rejects raising a user to a rank at/above the actor’s own (manager → general_manager)', async () => {
    mockGetUserRank.mockResolvedValue('manager'); // level 40
    mockDb.mockReturnValue(
      createChain([[{ id: 'user-2', organizationId: 'org-1', rank: 'executive', firstName: 'A', lastName: 'B' }]]),
    );

    const res = await UPDATE_USER(createRequest('PATCH', '/api/users/user-2', '', { rank: 'general_manager' }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('rejects a non-super_admin granting owner', async () => {
    mockGetUserRank.mockResolvedValue('owner'); // owner may NOT mint owner — only super_admin can
    mockDb.mockReturnValue(
      createChain([[{ id: 'user-2', organizationId: 'org-1', rank: 'executive' }]]),
    );

    const res = await UPDATE_USER(createRequest('PATCH', '/api/users/user-2', '', { rank: 'owner' }));
    expect(res.status).toBe(403);
  });

  it('rejects changing your OWN rank even when the level check would pass', async () => {
    mockGetUserRank.mockResolvedValue('super_admin');
    mockDb.mockReturnValue(
      createChain([[{ id: 'actor-1', organizationId: 'org-1', rank: 'executive' }]]),
    );

    const res = await UPDATE_USER(createRequest('PATCH', '/api/users/actor-1', '', { rank: 'owner' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/your own rank/i);
  });

  it('rejects an invalid rank value', async () => {
    mockGetUserRank.mockResolvedValue('super_admin');
    mockDb.mockReturnValue(
      createChain([[{ id: 'user-2', organizationId: 'org-1', rank: 'executive' }]]),
    );

    const res = await UPDATE_USER(createRequest('PATCH', '/api/users/user-2', '', { rank: 'wizard' }));
    expect(res.status).toBe(400);
  });

  it('allows a super_admin to set a downward rank on another user', async () => {
    mockGetUserRank.mockResolvedValue('super_admin');
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'user-2', organizationId: 'org-1', rank: 'executive', firstName: 'A', lastName: 'B' }], // existing
        [{ id: 'user-2', organizationId: 'org-1', rank: 'manager' }], // update returning
      ]),
    );

    const res = await UPDATE_USER(createRequest('PATCH', '/api/users/user-2', '', { rank: 'manager' }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.rank).toBe('manager');
  });
});
