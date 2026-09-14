import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain } from '@/__tests__/api/test-helpers';

// ═══════════════════════════════════════════════════════════════════
// RBAC resolver (getUserPermissions) — deny-override + dead/expired-role
// skipping. Exercises the REAL resolver in @/lib/permissions with a mocked
// getDb (three-query flow) and drizzle operator spies so we can assert the
// exact filter conditions and the computed granted-permission set.
// ═══════════════════════════════════════════════════════════════════

const { mockGetDb, mockEq, mockAnd, mockOr, mockIsNull, mockGt, mockInArray } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockEq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  mockAnd: vi.fn((...a: unknown[]) => ({ op: 'and', a })),
  mockOr: vi.fn((...a: unknown[]) => ({ op: 'or', a })),
  mockIsNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
  mockGt: vi.fn((a: unknown, b: unknown) => ({ op: 'gt', a, b })),
  mockInArray: vi.fn((a: unknown, b: unknown) => ({ op: 'inArray', a, b })),
}));

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
  and: mockAnd,
  or: mockOr,
  isNull: mockIsNull,
  gt: mockGt,
  inArray: mockInArray,
}));

vi.mock('@workmanagement/database', () => ({
  getDb: mockGetDb,
  schema: {
    userRoles: { userId: 'ur.userId', roleId: 'ur.roleId', expiresAt: 'ur.expiresAt' },
    roles: { id: 'roles.id', isActive: 'roles.isActive', deletedAt: 'roles.deletedAt' },
    rolePermissions: { roleId: 'rp.roleId', permissionId: 'rp.permissionId', allow: 'rp.allow' },
    permissions: { id: 'perm.id', code: 'perm.code', name: 'perm.name', module: 'perm.module' },
  },
}));

import { getUserPermissions } from '@/lib/permissions';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── deny-override ──────────────────────────────────────────────

describe('getUserPermissions — deny-override (allow=false wins)', () => {
  it('excludes a permission that any role denies, even if another role allows it', async () => {
    mockGetDb.mockReturnValue(
      createChain([
        [{ roleId: 'r1' }, { roleId: 'r2' }], // active roles
        // p1 allowed by r1 but denied by r2 → must be dropped; p2 stays
        [
          { permissionId: 'p1', allow: true },
          { permissionId: 'p1', allow: false },
          { permissionId: 'p2', allow: true },
        ],
        [{ id: 'p2', code: 'task:view', name: 'View Tasks', module: 'task' }], // details for granted only
      ]),
    );

    const perms = await getUserPermissions('user-1');

    expect(perms).toEqual([{ id: 'p2', code: 'task:view', name: 'View Tasks', module: 'task' }]);
    // The details query must have been asked ONLY for p2 (p1 excluded by deny).
    expect(mockInArray).toHaveBeenCalledWith('perm.id', ['p2']);
    expect(mockInArray).not.toHaveBeenCalledWith('perm.id', expect.arrayContaining(['p1']));
  });

  it('returns [] when every allowed permission is also denied', async () => {
    mockGetDb.mockReturnValue(
      createChain([
        [{ roleId: 'r1' }],
        [
          { permissionId: 'p1', allow: true },
          { permissionId: 'p1', allow: false },
        ],
        // details query should never run
      ]),
    );

    const perms = await getUserPermissions('user-1');

    expect(perms).toEqual([]);
    // No details lookup because grantedIds was empty.
    expect(mockInArray).not.toHaveBeenCalledWith('perm.id', expect.anything());
  });
});

// ─── dead / expired role skipping ───────────────────────────────

describe('getUserPermissions — dead/expired roles grant nothing', () => {
  it('scopes the role query to active, non-deleted, non-expired assignments', async () => {
    mockGetDb.mockReturnValue(createChain([[], [], []]));

    await getUserPermissions('user-1');

    // isActive = true and deletedAt IS NULL on the joined role
    expect(mockEq).toHaveBeenCalledWith('roles.isActive', true);
    expect(mockIsNull).toHaveBeenCalledWith('roles.deletedAt');
    // expiresAt IS NULL OR expiresAt > now  (unexpired assignments only)
    expect(mockIsNull).toHaveBeenCalledWith('ur.expiresAt');
    expect(mockGt).toHaveBeenCalledWith('ur.expiresAt', expect.any(Date));
    expect(mockOr).toHaveBeenCalled();
  });

  it('returns [] and short-circuits when no live roles remain', async () => {
    mockGetDb.mockReturnValue(createChain([[]])); // role query filtered everything out

    const perms = await getUserPermissions('user-1');

    expect(perms).toEqual([]);
    // Never looked at role_permissions or permission details.
    expect(mockInArray).not.toHaveBeenCalled();
  });

  it('returns [] when live roles exist but carry no permissions', async () => {
    mockGetDb.mockReturnValue(createChain([[{ roleId: 'r1' }], []]));

    const perms = await getUserPermissions('user-1');

    expect(perms).toEqual([]);
    // Asked for r1's permissions, but never for permission details.
    expect(mockInArray).toHaveBeenCalledWith('rp.roleId', ['r1']);
    expect(mockInArray).not.toHaveBeenCalledWith('perm.id', expect.anything());
  });
});
