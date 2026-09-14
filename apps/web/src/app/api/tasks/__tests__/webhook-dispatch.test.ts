import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { NextRequest } from 'next/server';

// ──────────────────────────────────────────────────────────────
// vi.hoisted — runs BEFORE the vi.mock factory factories.
// This lets us reference these variables inside vi.mock() calls
// without hitting the temporal dead zone.
// `vi` is available as a global via vitest's `globals: true`.
// ──────────────────────────────────────────────────────────────

const { mockDbChainResolveValue, mockDb, mockDispatchWebhookEvent } = vi.hoisted(() => {
  const resolveState: { current: unknown } = { current: [] };

  /**
   * Build a mock Drizzle query-builder chain.
   *
   * Every method (select, from, where, insert, update, set, values, …)
   * returns the chain itself.  Awaiting the chain resolves to `resolveValue`.
   *
   * The key implementation detail: the chain is a *thenable* object (has a
   * `.then()` method) rather than an async function.  The JavaScript `await`
   * keyword checks for a `.then()` method on the awaited value — if it finds
   * one it delegates to it, otherwise it wraps the value in
   * `Promise.resolve()`.  Since a chain query like
   * `const [row] = await db().select().from(...).where(...)` ends with an
   * `await` on the chain itself (not a `.returning()` call), the chain MUST
   * be a thenable so that `await chain` resolves to the configured data
   * rather than returning the chain function object.
   *
   * `.returning()` returns a real Promise that resolves to the value directly,
   * matching the standard Drizzle behaviour for INSERT / UPDATE … RETURNING.
   */
  function createChain<T>(resolveValue: T) {
    // Thenable: `await chain` calls chain.then(resolve) -> resolve(resolveValue)
    const chain: Record<string, unknown> = {
      then: (resolve: (value: T) => void) => {
        resolve(resolveValue);
      },
    };

    const METHODS = [
      'select', 'from', 'where', 'limit', 'offset', 'orderBy',
      'leftJoin', 'innerJoin', 'values', 'set',
      'insert', 'update', 'delete',
    ] as const;

    for (const method of METHODS) {
      (chain as unknown as Record<string, unknown>)[method] = vi.fn(() => chain);
    }

    // .returning() returns a resolved Promise (standard Drizzle behaviour)
    (chain as unknown as Record<string, unknown>).returning = vi.fn(() => Promise.resolve(resolveValue));

    return chain as unknown as Record<string, (...args: unknown[]) => unknown> & { then: (resolve: (value: T) => void) => void };
  }

  return {
    mockDbChainResolveValue: resolveState,
    mockDb: vi.fn(() => createChain(resolveState.current)),
    mockDispatchWebhookEvent: vi.fn(),
  };
});

// ──────────────────────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/api-auth', () => ({
  withAuth:
    (
      handler: (
        req: Request,
        ctx: {
          user: { id: string };
          orgId: string;
          scope: { rank: string | null; level: number; departmentId: string | null; seeAllDepartments: boolean };
        },
      ) => Promise<Response>,
    ) =>
    (req: Request) =>
      handler(req, {
        user: { id: 'user-1' },
        orgId: 'org-1',
        // GM-level scope: bypasses the department wall so these webhook tests
        // exercise the mutation paths unchanged.
        scope: { rank: 'general_manager', level: 50, departmentId: null, seeAllDepartments: true },
      }),
  requirePermission: vi.fn().mockResolvedValue(undefined),
  checkPermission: vi.fn().mockResolvedValue(true),
  enforceOrgScope: vi.fn(),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: mockDispatchWebhookEvent,
}));

vi.mock('@/lib/audit', () => ({
  createAuditEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/search', () => ({
  indexTask: vi.fn().mockResolvedValue(undefined),
  removeTaskFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeRichText: vi.fn((content: string | null | undefined) => content ?? null),
}));

vi.mock('@/lib/api/task-helpers', () => ({
  getTaskIdFromPath: vi.fn(() => 'task-1'),
  checkTaskAccessOrRespond: vi.fn(() => undefined),
}));

/**
 * Proxy-based schema mock ensures every property access
 * (e.g. schema.tasks.organizationId) returns a safe sentinel,
 * preventing Drizzle's eq() from receiving undefined.
 */
vi.mock('@/lib/api/db', () => {
  const schemaProxy = new Proxy(
    {},
    {
      get: () =>
        new Proxy(
          {},
          { get: () => 'col-ref' },
        ),
    },
  );

  return {
    db: mockDb,
    schema: schemaProxy,
    handleApiError: vi.fn((error: unknown, message: string) => {
      console.error(`[handleApiError] ${message}:`, error);
      return {
        error: { code: 'INTERNAL_ERROR', message },
        status: 500,
      };
    }),
    // Phase 2 dept-wall helpers — not under test here; resolve to no-dept / allow.
    resolveTaskDepartment: vi.fn().mockResolvedValue(null),
    canAccessDept: vi.fn(() => true),
    applyDeptScope: vi.fn((conditions: unknown[]) => conditions),
  };
});

// ──────────────────────────────────────────────────────────────
// Static imports
// ──────────────────────────────────────────────────────────────

import { POST as CreateTask } from '../route';
import { PATCH as UpdateTask, DELETE as DeleteTask } from '../[id]/route';
import { POST as CreateComment } from '../[id]/comments/route';

// ──────────────────────────────────────────────────────────────
// Fixtures & helpers
// ──────────────────────────────────────────────────────────────

const TASK_FIXTURE = {
  id: 'task-1',
  title: 'Test Task',
  description: 'A test task description',
  taskIdDisplay: 'TASK-1',
  status: 'open',
  priority: 'medium',
  assignedTo: null,
  assignedBy: null,
  projectId: null,
  milestoneId: null,
  organizationId: 'org-1',
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
  completedAt: null,
  closedAt: null,
  closedBy: null,
  dueDate: null,
  labels: [],
  tags: [],
  mentionedUserIds: [],
  deletedAt: null,
  actualHours: null,
  completionSummary: null,
  isActive: true,
  isSuspended: false,
  email: 'user@example.com',
  name: 'Test User',
  avatarUrl: null,
  code: 'TEST',
};

function setDbData(data: unknown): void {
  mockDbChainResolveValue.current = data;
}

/**
 * Build a minimal request-like object the route handlers can work with.
 *
 * We avoid `new NextRequest()` because NextRequest.nextUrl / NextURL
 * may have compatibility issues in the happy-dom environment. Instead
 * we use the standard Request API (which happy-dom supports) and attach
 * a minimal `nextUrl` polyfill.
 */
function mockRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init);
  const parsedUrl = new URL(url);

  Object.defineProperty(request, 'nextUrl', {
    value: {
      pathname: parsedUrl.pathname,
      searchParams: parsedUrl.searchParams,
    },
    writable: false,
  });

  return request as unknown as NextRequest;
}

interface WebhookCall {
  event: string;
  orgId: string;
  data: Record<string, unknown>;
}

function webhookCalls(): WebhookCall[] {
  return (mockDispatchWebhookEvent as Mock).mock.calls.map((call) => ({
    event: call[0] as string,
    orgId: call[1] as string,
    data: call[2] as Record<string, unknown>,
  }));
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setDbData([TASK_FIXTURE]);
});

// ── POST /api/tasks ─────────────────────────────────────────

describe('POST /api/tasks', () => {
  it('dispatches task.created webhook on successful creation', async () => {
    const req = mockRequest('http://n:3000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Task', description: 'A new task' }),
    });

    const res = await CreateTask(req);
    expect(res.status).toBe(201);

    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);

    const calls = webhookCalls();
    expect(calls[0]!.event).toBe('task.created');
    expect(calls[0]!.orgId).toBe('org-1');
    expect(calls[0]!.data).toMatchObject({
      taskId: 'task-1',
      title: 'Test Task',
      taskIdDisplay: 'TASK-1',
      status: 'open',
      createdBy: 'user-1',
    });
  });

  it('dispatches task.created with assignedTo when assignee is provided', async () => {
    // Configure the mock DB to return a task with the assigned user
    setDbData([{ ...TASK_FIXTURE, assignedTo: 'user-2' }]);

    const req = mockRequest('http://n:3000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Assigned Task', assignedTo: 'user-2' }),
    });

    const res = await CreateTask(req);
    expect(res.status).toBe(201);

    const calls = webhookCalls();
    const createCall = calls.find((c) => c.event === 'task.created');
    expect(createCall).toBeDefined();
    expect(createCall!.data.assignedTo).toBe('user-2');
    expect(createCall!.data.createdBy).toBe('user-1');
  });

  it('does not dispatch any webhook on validation failure', async () => {
    const req = mockRequest('http://n:3000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await CreateTask(req);
    expect(res.status).toBe(400);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});

// ── PATCH /api/tasks/[id] ───────────────────────────────────

describe('PATCH /api/tasks/[id]', () => {
  it('dispatches task.updated on metadata change', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    });

    const res = await UpdateTask(req);
    expect(res.status).toBe(200);

    const calls = webhookCalls();
    const updatedCall = calls.find((c) => c.event === 'task.updated');
    expect(updatedCall).toBeDefined();
    expect(updatedCall!.data).toMatchObject({
      taskId: 'task-1',
      updatedBy: 'user-1',
    });
  });

  it('dispatches task.status_changed on valid status transition', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    const res = await UpdateTask(req);
    expect(res.status).toBe(200);

    const calls = webhookCalls();
    const statusCall = calls.find((c) => c.event === 'task.status_changed');
    expect(statusCall).toBeDefined();
    expect(statusCall!.data).toMatchObject({
      taskId: 'task-1',
      previousStatus: 'open',
      newStatus: 'in_progress',
    });
  });

  it('dispatches task.assigned when assignment changes', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedTo: 'user-2' }),
    });

    const res = await UpdateTask(req);
    expect(res.status).toBe(200);

    const calls = webhookCalls();
    const assignedCall = calls.find((c) => c.event === 'task.assigned');
    expect(assignedCall).toBeDefined();
    expect(assignedCall!.data).toMatchObject({
      taskId: 'task-1',
      assignedTo: 'user-2',
      previousAssignee: null,
      assignedBy: 'user-1',
    });

    const updatedCall = calls.find((c) => c.event === 'task.updated');
    expect(updatedCall).toBeDefined();
  });

  it('dispatches both task.updated and task.assigned together', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title', assignedTo: 'user-3' }),
    });

    const res = await UpdateTask(req);
    expect(res.status).toBe(200);

    const calls = webhookCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);

    expect(calls.find((c) => c.event === 'task.assigned')).toBeDefined();
    expect(calls.find((c) => c.event === 'task.updated')).toBeDefined();
  });

  it('does not dispatch any webhook on validation failure', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'turbo' }),
    });

    const res = await UpdateTask(req);
    expect(res.status).toBe(400);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/tasks/[id] ──────────────────────────────────

describe('DELETE /api/tasks/[id]', () => {
  it('dispatches task.deleted webhook on successful deletion', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1', {
      method: 'DELETE',
    });

    const res = await DeleteTask(req);
    expect(res.status).toBe(200);

    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);

    const calls = webhookCalls();
    expect(calls[0]!.event).toBe('task.deleted');
    expect(calls[0]!.orgId).toBe('org-1');
    expect(calls[0]!.data).toMatchObject({
      taskId: 'task-1',
      title: 'Test Task',
      taskIdDisplay: 'TASK-1',
      status: 'open',
      deletedBy: 'user-1',
    });
  });
});

// ── POST /api/tasks/[id]/comments ───────────────────────────

describe('POST /api/tasks/[id]/comments', () => {
  it('dispatches task.comment_added webhook on successful comment', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'This is a test comment' }),
    });

    const res = await CreateComment(req);
    expect(res.status).toBe(201);

    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);

    const calls = webhookCalls();
    const commentCall = calls.find((c) => c.event === 'task.comment_added');
    expect(commentCall).toBeDefined();
    expect(commentCall!.orgId).toBe('org-1');
    expect(commentCall!.data).toMatchObject({
      taskId: 'task-1',
      taskTitle: 'Test Task',
      taskIdDisplay: 'TASK-1',
      createdBy: 'user-1',
    });
    expect(typeof commentCall!.data.commentId).toBe('string');
    expect(commentCall!.data.commentId).toBeTruthy();
    expect(commentCall!.data.commentPreview).toBe('This is a test comment');
  });

  it('does not dispatch any webhook on validation failure', async () => {
    const req = mockRequest('http://n:3000/api/tasks/task-1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });

    const res = await CreateComment(req);
    expect(res.status).toBe(400);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});
