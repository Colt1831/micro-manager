import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Hoisted mocks ──────────────────────────────────────────
const { mockGetDb, mockApplyDeptScope } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockApplyDeptScope: vi.fn((c: unknown[]) => c),
}));

// withAuth passes through, injecting an unwalled scope (GM+).
vi.mock('@/lib/auth/api-auth', () => ({
  withAuth: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; scope: { seeAllDepartments: boolean; departmentId: string | null } },
    ) => Promise<Response>,
  ) => (req: NextRequest) =>
    handler(req, { orgId: 'org-1', scope: { seeAllDepartments: true, departmentId: null } }),
}));

// Column stubs — drizzle helpers only need truthy objects to build SQL.
const col = (name: string) => ({ name });
vi.mock('@workmanagement/database', () => ({
  getDb: mockGetDb,
  schema: {
    taskComments: {
      id: col('tc.id'),
      content: col('tc.content'),
      taskId: col('tc.task_id'),
      isInternalNote: col('tc.is_internal_note'),
      deletedAt: col('tc.deleted_at'),
      createdAt: col('tc.created_at'),
    },
    tasks: {
      id: col('t.id'),
      title: col('t.title'),
      taskIdDisplay: col('t.task_id_display'),
      organizationId: col('t.organization_id'),
      departmentId: col('t.department_id'),
      deletedAt: col('t.deleted_at'),
    },
    projects: {}, users: {},
  },
}));

vi.mock('@/lib/api/db', () => ({ applyDeptScope: mockApplyDeptScope }));
vi.mock('@/lib/search', () => ({ searchTasks: vi.fn(), searchProjects: vi.fn() }));

// A thenable drizzle chain that resolves to `rows`.
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    c[m] = vi.fn(() => c);
  }
  c.limit = vi.fn(() => Promise.resolve(rows));
  return c;
}

async function callSearch(url: string) {
  const { GET } = await import('../route');
  return GET({ url } as NextRequest);
}

describe('GET /api/search — comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApplyDeptScope.mockImplementation((c: unknown[]) => c);
  });

  it('maps comment rows to hits with truncated body and anchored url', async () => {
    const longBody = 'x'.repeat(250);
    mockGetDb.mockReturnValue(
      chain([
        { id: 'c1', content: longBody, taskId: 't1', taskTitle: 'Fix login', taskIdDisplay: 'TASK-1' },
      ]),
    );

    const res = await callSearch('http://localhost/api/search?type=comments&q=login');
    const body = await res.json();
    const hit = body.results.comments.hits[0];

    expect(body.results.comments.total).toBe(1);
    expect(hit.type).toBe('comment');
    expect(hit.title).toBe('Fix login');
    expect(hit.subtitle).toBe('TASK-1');
    expect(hit.url).toBe('/tasks/t1#comment-c1');
    // 200 chars + ellipsis
    expect(hit.description).toBe(`${'x'.repeat(200)}…`);
    expect(body.total).toBe(1);
  });

  it('applies department scope to the comment query', async () => {
    mockGetDb.mockReturnValue(chain([]));
    await callSearch('http://localhost/api/search?type=comments&q=x');
    expect(mockApplyDeptScope).toHaveBeenCalledWith(
      expect.any(Array),
      { seeAllDepartments: true, departmentId: null },
      expect.anything(),
    );
  });

  it('returns empty comments for a blank query', async () => {
    mockGetDb.mockReturnValue(chain([]));
    const res = await callSearch('http://localhost/api/search?type=comments&q=');
    const body = await res.json();
    expect(body.results.comments.total).toBe(0);
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
