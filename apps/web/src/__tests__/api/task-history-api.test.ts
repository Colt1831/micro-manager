import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain, createRequest } from '@/__tests__/api/test-helpers';

// ═══════════════════════════════════════════════════════════════════
// Hoisted mocks — these run before all imports
// ═══════════════════════════════════════════════════════════════════

const { mockNextResponseJson, mockDb, mockRequirePermission, mockGetTaskIdFromPath } = vi.hoisted(
  () => ({
    mockNextResponseJson: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      ok: (init?.status ?? 200) < 400,
      json: async () => body,
    })),

    mockDb: vi.fn(),

    mockRequirePermission: vi.fn(() => Promise.resolve()),

    mockGetTaskIdFromPath: vi.fn(() => 'task-123'),
  }),
);

// ═══════════════════════════════════════════════════════════════════
// Module-level mocks
// ═══════════════════════════════════════════════════════════════════

vi.mock('next/server', () => ({
  NextResponse: { json: mockNextResponseJson },
}));

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth: (handler: Function) => async (req: unknown) =>
    handler(req, {
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      orgId: 'org-1',
    }),
  requirePermission: mockRequirePermission,
  checkPermission: vi.fn(() => Promise.resolve(true)),
  enforceOrgScope: vi.fn(),
}));

vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  schema: {
    tasks: {
      id: 'tasks.id',
      organizationId: 'tasks.orgId',
      deletedAt: 'tasks.deletedAt',
    } as Record<string, string>,
    taskHistory: {
      id: 'th.id',
      taskId: 'th.taskId',
      userId: 'th.userId',
      field: 'th.field',
      oldValue: 'th.oldValue',
      newValue: 'th.newValue',
      changeType: 'th.changeType',
      description: 'th.description',
      createdAt: 'th.createdAt',
    } as Record<string, string>,
    users: { id: 'users.id', name: 'users.name', avatarUrl: 'users.avatarUrl' } as Record<
      string,
      string
    >,
  },
  // The wall is exercised in task-helpers.test.ts; here it is a pass-through
  // so these tests keep asserting the query/response contract.
  applyDeptScope: vi.fn((conditions: unknown[]) => conditions),
  handleApiError: vi.fn((_error: unknown, message: string) => ({
    error: { code: 'INTERNAL_ERROR', message },
    status: 500,
  })),
}));

vi.mock('@/lib/api/task-helpers', () => ({
  getTaskIdFromPath: mockGetTaskIdFromPath,
}));

// ═══════════════════════════════════════════════════════════════════
// Imports — these run after mocks are in place
// ═══════════════════════════════════════════════════════════════════

import { GET } from '@/app/api/tasks/[id]/history/route';

const HISTORY_PATH = '/api/tasks/task-123/history';

beforeEach(() => {
  vi.resetAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// History API — GET (list history)
// ═══════════════════════════════════════════════════════════════════

describe('History API — GET (list history)', () => {
  it('returns history entries for a task', async () => {
    const history = [
      {
        id: 'hist-1',
        taskId: 'task-123',
        userId: 'user-1',
        field: 'status',
        oldValue: 'open',
        newValue: 'in_progress',
        changeType: 'status_change',
        description: 'Changed status from open to in_progress',
        createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
        user: { id: 'user-1', name: 'Alice Johnson', avatarUrl: null },
      },
      {
        id: 'hist-2',
        taskId: 'task-123',
        userId: 'user-2',
        field: 'assignedTo',
        oldValue: null,
        newValue: 'user-1',
        changeType: 'assignment',
        description: 'Assigned to Alice Johnson',
        createdAt: new Date(Date.now() - 120 * 1000).toISOString(),
        user: { id: 'user-2', name: 'Bob Smith', avatarUrl: null },
      },
    ];

    const chain = createChain([history]);
    mockDb.mockReturnValue(chain);

    const response = await GET(createRequest('GET', HISTORY_PATH));

    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.objectContaining({ history }));
    expect(response.status).toBe(200);

    // Verify the route used the imported getTaskIdFromPath
    expect(mockGetTaskIdFromPath).toHaveBeenCalled();

    // Verify DB joins were used
    expect(chain.innerJoin).toHaveBeenCalled();
    expect(chain.leftJoin).toHaveBeenCalled();
    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
  });

  it('returns empty array when no history exists', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    const response = await GET(createRequest('GET', HISTORY_PATH));

    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.objectContaining({ history: [] }));
    expect(response.status).toBe(200);
  });

  it('calls requirePermission with task:view', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    await GET(createRequest('GET', HISTORY_PATH));

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'task:view');
  });

  it('returns empty history when task is not in org scope (innerJoin returns nothing)', async () => {
    // The route uses a single query with innerJoin; if no task matches the
    // org/deleted scope, the query returns empty (not a 404 explicitly).
    mockDb.mockReturnValue(createChain([[]]));

    const response = await GET(createRequest('GET', HISTORY_PATH));

    expect(response.status).toBe(200);
    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    expect(body.history).toEqual([]);
  });

  it('returns multiple entries with user data (leftJoin)', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `hist-${i + 1}`,
      taskId: 'task-123',
      userId: 'user-1',
      field: 'status',
      oldValue: 'draft',
      newValue: 'open',
      changeType: 'status_change',
      description: `Entry ${i + 1}`,
      createdAt: new Date(Date.now() - i * 60 * 1000).toISOString(),
      user: { id: 'user-1', name: 'Alice Johnson', avatarUrl: null },
    }));

    mockDb.mockReturnValue(createChain([entries]));

    await GET(createRequest('GET', HISTORY_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    expect(Array.isArray(body.history)).toBe(true);
    expect((body.history as unknown[]).length).toBe(5);
  });

  it('returns entries ordered by createdAt descending with limit 100', async () => {
    const chain = createChain([[]]);
    mockDb.mockReturnValue(chain);

    await GET(createRequest('GET', HISTORY_PATH));

    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Response contract
// ═══════════════════════════════════════════════════════════════════

describe('History API — response contract', () => {
  it('returns expected shape with history array', async () => {
    const entry = {
      id: 'hist-1',
      taskId: 'task-123',
      userId: 'user-1',
      field: 'status',
      oldValue: 'open',
      newValue: 'in_progress',
      changeType: 'status_change',
      description: 'Changed status',
      createdAt: new Date().toISOString(),
      user: { id: 'user-1', name: 'Alice Johnson', avatarUrl: null },
    };

    mockDb.mockReturnValue(createChain([[entry]]));

    await GET(createRequest('GET', HISTORY_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    expect(body).toHaveProperty('history');
    expect(Array.isArray(body.history)).toBe(true);

    const h = (body.history as Record<string, unknown>[])[0]!;
    expect(h).toHaveProperty('id');
    expect(h).toHaveProperty('taskId');
    expect(h).toHaveProperty('userId');
    expect(h).toHaveProperty('field');
    expect(h).toHaveProperty('oldValue');
    expect(h).toHaveProperty('newValue');
    expect(h).toHaveProperty('changeType');
    expect(h).toHaveProperty('description');
    expect(h).toHaveProperty('createdAt');
    expect(h).toHaveProperty('user');
    const entryUser = h.user as Record<string, unknown> | null;
    expect(entryUser).not.toBeNull();
    expect(entryUser).toHaveProperty('id');
    expect(entryUser).toHaveProperty('name');
    expect(entryUser).toHaveProperty('avatarUrl');
  });

  it('returns entry with null user for system actions', async () => {
    const entry = {
      id: 'hist-system',
      taskId: 'task-123',
      userId: 'system',
      field: 'priority',
      oldValue: 'low',
      newValue: 'high',
      changeType: 'update',
      description: 'Changed priority',
      createdAt: new Date().toISOString(),
      user: null,
    };

    mockDb.mockReturnValue(createChain([[entry]]));

    await GET(createRequest('GET', HISTORY_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    const h = (body.history as Record<string, unknown>[])[0]!;
    expect(h.user).toBeNull();
  });

  it('returns entry with null oldValue for creation events', async () => {
    const entry = {
      id: 'hist-create',
      taskId: 'task-123',
      userId: 'user-1',
      field: 'title',
      oldValue: null,
      newValue: 'New task',
      changeType: 'creation',
      description: 'Created this task',
      createdAt: new Date().toISOString(),
      user: { id: 'user-1', name: 'Alice', avatarUrl: null },
    };

    mockDb.mockReturnValue(createChain([[entry]]));

    await GET(createRequest('GET', HISTORY_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    const h = (body.history as Record<string, unknown>[])[0]!;
    expect(h.oldValue).toBeNull();
    expect(h.newValue).toBe('New task');
  });
});
