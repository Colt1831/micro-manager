import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { NextRequest } from 'next/server';

// ──────────────────────────────────────────────────────────────
// vi.hoisted — runs BEFORE the vi.mock factory factories.
// ──────────────────────────────────────────────────────────────

const { mockDbChainResolveValue, mockDb, mockDispatchWebhookEvent } = vi.hoisted(() => {
  const resolveState: { current: unknown } = { current: [] };

  /**
   * Build a mock Drizzle query-builder chain.
   *
   * The chain is a *thenable* object (has a `.then()` method) so that
   * `await chain` resolves to the configured data.  Without this,
   * `await` on a plain function returns the function itself.
   *
   * `.returning()` returns a resolved Promise directly, matching the
   * standard Drizzle behaviour for INSERT … RETURNING / UPDATE … RETURNING.
   */
  function createChain<T>(resolveValue: T) {
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

    (chain as unknown as Record<string, unknown>).returning = vi.fn(() =>
      Promise.resolve(resolveValue),
    );

    return chain as unknown as Record<string, (...args: unknown[]) => unknown> & {
      then: (resolve: (value: T) => void) => void;
    };
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

// Project routes don't use notifications/search/sanitize, but harmless to mock
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/search', () => ({
  indexTask: vi.fn().mockResolvedValue(undefined),
  removeTaskFromIndex: vi.fn().mockResolvedValue(undefined),
  indexProject: vi.fn().mockResolvedValue(undefined),
  removeProjectFromIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/sanitize', () => ({
  sanitizeRichText: vi.fn((content: string | null | undefined) => content ?? null),
}));

/**
 * Proxy-based schema mock ensures every property access
 * (e.g. schema.projects.organizationId) returns a safe sentinel
 * instead of undefined, preventing Drizzle's eq() from throwing.
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
    // Phase 2 dept-wall helpers — not under test here; allow / passthrough.
    canAccessDept: vi.fn(() => true),
    applyDeptScope: vi.fn((conditions: unknown[]) => conditions),
  };
});

// ──────────────────────────────────────────────────────────────
// Static imports (evaluated AFTER vi.mock is set up)
// ──────────────────────────────────────────────────────────────

import { POST as CreateProject } from '../route';
import { PATCH as UpdateProject, DELETE as DeleteProject } from '../[id]/route';

// ──────────────────────────────────────────────────────────────
// Fixtures & helpers
// ──────────────────────────────────────────────────────────────

const PROJECT_FIXTURE = {
  id: 'project-1',
  name: 'Test Project',
  code: 'TEST',
  description: 'A test project',
  organizationId: 'org-1',
  ownerId: 'owner-1',
  departmentId: null,
  teamId: null,
  status: 'active',
  priority: null,
  progress: null,
  completionPercentage: null,
  startDate: null,
  endDate: null,
  actualEndDate: null,
  budgetAmount: null,
  budgetCurrency: null,
  tags: [],
  isActive: true,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
  deletedAt: null,
  // Fields needed when the result is destructured as a user row
  email: 'owner@example.com',
  avatarUrl: null,
};

function setDbData(data: unknown): void {
  mockDbChainResolveValue.current = data;
}

/**
 * Build a minimal request-like object.  Uses standard Request API
 * (which happy-dom supports) with a nextUrl polyfill so that
 * getIdFromPath() and searchParams work in route handlers.
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
  setDbData([PROJECT_FIXTURE]);
});

// ── POST /api/projects ──────────────────────────────────────
// Expected webhook: project.created

describe('POST /api/projects', () => {
  it('dispatches project.created webhook on successful creation', async () => {
    const req = mockRequest('http://n:3000/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Project',
        code: 'NEW',
        description: 'Brand new project',
        ownerId: 'owner-1',
      }),
    });

    const res = await CreateProject(req);
    expect(res.status).toBe(201);

    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);

    const calls = webhookCalls();
    expect(calls[0]!.event).toBe('project.created');
    expect(calls[0]!.orgId).toBe('org-1');
    expect(calls[0]!.data).toMatchObject({
      projectId: 'project-1',
      name: 'Test Project',
      code: 'TEST',
      status: 'active',
      ownerId: 'owner-1',
      createdBy: 'user-1',
    });
  });

  it('does not dispatch any webhook on validation failure', async () => {
    // Missing required name field
    const req = mockRequest('http://n:3000/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAIL' }),
    });

    const res = await CreateProject(req);
    expect(res.status).toBe(400);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});

// ── PATCH /api/projects/[id] ────────────────────────────────
// Expected webhook: project.updated

describe('PATCH /api/projects/[id]', () => {
  it('dispatches project.updated when fields change', async () => {
    const req = mockRequest('http://n:3000/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Project', priority: 'high' }),
    });

    const res = await UpdateProject(req);
    expect(res.status).toBe(200);

    const calls = webhookCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe('project.updated');
    expect(calls[0]!.orgId).toBe('org-1');
    expect(calls[0]!.data).toMatchObject({
      projectId: 'project-1',
      name: 'Test Project', // pre-update name
      code: 'TEST',
      status: 'active',
      updatedBy: 'user-1',
    });
    // Should list changed fields, excluding system fields
    expect(calls[0]!.data.changes).toEqual(
      expect.arrayContaining(['name', 'priority']),
    );
    expect(calls[0]!.data.changes).not.toContain('updatedBy');
    expect(calls[0]!.data.changes).not.toContain('updatedAt');
  });

  it('does not dispatch any webhook when no fields change', async () => {
    // Empty body passes validation (all fields optional) but sets nothing
    const req = mockRequest('http://n:3000/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await UpdateProject(req);
    expect(res.status).toBe(200);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it('does not dispatch any webhook on validation failure', async () => {
    // Unknown field triggers .strict() rejection
    const req = mockRequest('http://n:3000/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nice', unknownField: 'boom' }),
    });

    const res = await UpdateProject(req);
    expect(res.status).toBe(400);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/projects/[id] ───────────────────────────────
// Expected webhook: project.deleted

describe('DELETE /api/projects/[id]', () => {
  it('dispatches project.deleted webhook on successful deletion', async () => {
    const req = mockRequest('http://n:3000/api/projects/project-1', {
      method: 'DELETE',
    });

    const res = await DeleteProject(req);
    expect(res.status).toBe(200);

    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);

    const calls = webhookCalls();
    expect(calls[0]!.event).toBe('project.deleted');
    expect(calls[0]!.orgId).toBe('org-1');
    expect(calls[0]!.data).toMatchObject({
      projectId: 'project-1',
      name: 'Test Project',
      code: 'TEST',
      status: 'active',
      deletedBy: 'user-1',
    });
  });
});
