import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────────
// The assignment helper is the SINGLE funnel single-assign and
// batch-assign share (spec §4). These tests pin its rules with a
// mocked DB so the downward + department logic is verified without
// a live Postgres.
// ──────────────────────────────────────────────────────────────

const { mockDb, assigneeRow } = vi.hoisted(() => {
  const state: { current: unknown } = { current: undefined };
  function createChain() {
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => resolve(state.current),
    };
    for (const m of ['select', 'from', 'where', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    return chain;
  }
  return { mockDb: vi.fn(() => createChain()), assigneeRow: state };
});

vi.mock('@/lib/api/db', () => {
  const schemaProxy = new Proxy({}, { get: () => new Proxy({}, { get: () => 'col' }) });
  return { db: mockDb, schema: schemaProxy };
});

import { validateAssignment } from '@/lib/api/assignment';
import type { DeptScope } from '@/lib/auth/api-auth';

function scope(partial: Partial<DeptScope>): DeptScope {
  return {
    rank: 'manager',
    level: 40,
    departmentId: 'dept-A',
    seeAllDepartments: false,
    ...partial,
  };
}

// Assignee returned by the mocked DB.
function setAssignee(row: Record<string, unknown> | undefined) {
  assigneeRow.current = row ? [row] : [];
}

const activeExecInA = {
  id: 'assignee-1',
  organizationId: 'org-1',
  isActive: true,
  isSuspended: false,
  rank: 'executive',
  departmentId: 'dept-A',
};

beforeEach(() => {
  vi.clearAllMocks();
  setAssignee(activeExecInA);
});

describe('validateAssignment — downward-only', () => {
  it('allows a manager to assign to an executive below them (same dept)', async () => {
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial).toBeNull();
  });

  it('denies assigning to a peer of equal rank (not strictly downward)', async () => {
    setAssignee({ ...activeExecInA, rank: 'manager' });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(403);
    expect(denial?.message).toMatch(/below your own rank/);
  });

  it('denies assigning to someone of higher rank', async () => {
    setAssignee({ ...activeExecInA, rank: 'general_manager' });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(403);
  });

  it('super_admin may assign to anyone (downward rule exempt)', async () => {
    setAssignee({ ...activeExecInA, rank: 'owner', departmentId: 'dept-Z' });
    const denial = await validateAssignment(
      scope({ rank: 'super_admin', level: 100, seeAllDepartments: true }),
      'assignee-1',
      'org-1',
    );
    expect(denial).toBeNull();
  });
});

describe('validateAssignment — department wall', () => {
  it('denies a walled manager assigning across departments', async () => {
    setAssignee({ ...activeExecInA, departmentId: 'dept-B' });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(403);
    expect(denial?.message).toMatch(/within your own department/);
  });

  it('allows a GM to assign across departments (sees all depts)', async () => {
    setAssignee({ ...activeExecInA, departmentId: 'dept-B' });
    const denial = await validateAssignment(
      scope({ rank: 'general_manager', level: 50, seeAllDepartments: true }),
      'assignee-1',
      'org-1',
    );
    expect(denial).toBeNull();
  });

  it('allows an Owner to assign across departments', async () => {
    setAssignee({ ...activeExecInA, departmentId: 'dept-B' });
    const denial = await validateAssignment(
      scope({ rank: 'owner', level: 60, seeAllDepartments: true }),
      'assignee-1',
      'org-1',
    );
    expect(denial).toBeNull();
  });
});

describe('validateAssignment — existence / org / status', () => {
  it('404 when the assignee does not exist', async () => {
    setAssignee(undefined);
    const denial = await validateAssignment(scope({}), 'ghost', 'org-1');
    expect(denial?.status).toBe(404);
  });

  it('403 when the assignee is in a different org', async () => {
    setAssignee({ ...activeExecInA, organizationId: 'org-2' });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(403);
    expect(denial?.message).toMatch(/Cross-organization/);
  });

  it('422 when the assignee is inactive', async () => {
    setAssignee({ ...activeExecInA, isActive: false });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(422);
  });

  it('422 when the assignee is suspended', async () => {
    setAssignee({ ...activeExecInA, isSuspended: true });
    const denial = await validateAssignment(scope({}), 'assignee-1', 'org-1');
    expect(denial?.status).toBe(422);
  });
});
