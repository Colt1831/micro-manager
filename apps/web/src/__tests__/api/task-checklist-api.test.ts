import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain, createRequest, chain as getChain } from '@/__tests__/api/test-helpers';

// ═══════════════════════════════════════════════════════════════════
// Hoisted mocks — these run before all imports
// ═══════════════════════════════════════════════════════════════════

const { mockNextResponseJson, mockDb, mockRequirePermission, mockCreateAuditEntry } = vi.hoisted(
  () => ({
    mockNextResponseJson: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      ok: (init?.status ?? 200) < 400,
      json: async () => body,
    })),

    mockDb: vi.fn(),

    mockRequirePermission: vi.fn(() => Promise.resolve()),

    mockCreateAuditEntry: vi.fn(() => Promise.resolve()),
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
      status: 'tasks.status',
    } as Record<string, string>,
    taskChecklistItems: {
      id: 'tci.id',
      taskId: 'tci.taskId',
      content: 'tci.content',
      isChecked: 'tci.isChecked',
      checkedBy: 'tci.checkedBy',
      checkedAt: 'tci.checkedAt',
      sortOrder: 'tci.sortOrder',
      createdAt: 'tci.createdAt',
    } as Record<string, string>,
  },
  // The wall is exercised in task-helpers.test.ts; here it is a pass-through
  // so these tests keep asserting the query/response contract.
  applyDeptScope: vi.fn((conditions: unknown[]) => conditions),
  handleApiError: vi.fn((_error: unknown, message: string) => ({
    error: { code: 'INTERNAL_ERROR', message },
    status: 500,
  })),
}));

vi.mock('@/lib/audit', () => ({
  createAuditEntry: mockCreateAuditEntry,
}));

// ═══════════════════════════════════════════════════════════════════
// Imports — these run after mocks are in place
// ═══════════════════════════════════════════════════════════════════

import { GET, POST, PATCH, DELETE } from '@/app/api/tasks/[id]/checklist/route';

const CHECKLIST_PATH = '/api/tasks/task-123/checklist';

beforeEach(() => {
  vi.resetAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// GET — List checklist items
// ═══════════════════════════════════════════════════════════════════

describe('Checklist API — GET (list items)', () => {
  it('returns items for a task', async () => {
    const items = [
      {
        id: 'item-1',
        taskId: 'task-123',
        content: 'Set up DB',
        isChecked: false,
        checkedBy: null,
        checkedAt: null,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'item-2',
        taskId: 'task-123',
        content: 'Create API',
        isChecked: true,
        checkedBy: 'user-1',
        checkedAt: new Date().toISOString(),
        sortOrder: 1,
        createdAt: new Date().toISOString(),
      },
    ];

    mockDb.mockReturnValue(createChain([items]));

    const response = await GET(createRequest('GET', CHECKLIST_PATH));

    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.objectContaining({ items }));
    expect(response.status).toBe(200);

    // Verify the innerJoin was used (org scope check)
    expect(getChain(mockDb).innerJoin).toHaveBeenCalled();
  });

  it('returns empty array when no items exist', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    const response = await GET(createRequest('GET', CHECKLIST_PATH));

    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.objectContaining({ items: [] }));
    expect(response.status).toBe(200);
  });

  it('calls requirePermission with task:view', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    await GET(createRequest('GET', CHECKLIST_PATH));

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'task:view');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST — Create checklist item
// ═══════════════════════════════════════════════════════════════════

describe('Checklist API — POST (create item)', () => {
  it('creates a checklist item successfully', async () => {
    const newItem = {
      id: 'item-new',
      taskId: 'task-123',
      content: 'Write tests',
      isChecked: false,
      checkedBy: null,
      checkedAt: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
    };

    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }], // Task exists
      [{ sortOrder: -1 }], // Last sort order (none yet)
      [newItem], // Insert result
    ]);
    mockDb.mockReturnValue(chain);

    const response = await POST(
      createRequest('POST', CHECKLIST_PATH, undefined, { content: 'Write tests' }),
    );

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ item: newItem }),
      expect.objectContaining({ status: 201 }),
    );
    expect(response.status).toBe(201);

    // Verify insert was called with the right data
    expect(chain.insert).toHaveBeenCalled();
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', content: 'Write tests' }),
    );

    // Audit entry created
    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.checklist_item_added', entityId: 'task-123' }),
    );
  });

  it('calls requirePermission with task:edit', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [],
        [{ id: 'item-1', content: 'Test' }],
      ]),
    );

    await POST(createRequest('POST', CHECKLIST_PATH));

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'task:edit');
  });

  it('returns 404 when task does not exist', async () => {
    mockDb.mockReturnValue(createChain([[]])); // Task not found

    const response = await POST(createRequest('POST', CHECKLIST_PATH));

    expect(response.status).toBe(404);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Task not found' }),
      }),
      expect.objectContaining({ status: 404 }),
    );
  });

  it('returns 403 when task belongs to different organization', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'other-org', status: 'open' }], // Cross-org
      ]),
    );

    const response = await POST(createRequest('POST', CHECKLIST_PATH));

    expect(response.status).toBe(403);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FORBIDDEN', message: 'Access denied' }),
      }),
      expect.objectContaining({ status: 403 }),
    );
  });

  it('returns 500 when insert returns empty', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [],
        [], // Insert returned empty!
      ]),
    );

    const response = await POST(createRequest('POST', CHECKLIST_PATH));

    expect(response.status).toBe(500);
    expect(mockCreateAuditEntry).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// PATCH — Update checklist item (toggle, edit, reorder)
// ═══════════════════════════════════════════════════════════════════

describe('Checklist API — PATCH (update item)', () => {
  it('returns 400 when itemId is missing', async () => {
    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH)); // No itemId

    expect(response.status).toBe(400);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'itemId is required' }),
      }),
      expect.objectContaining({ status: 400 }),
    );
  });

  it('calls requirePermission with task:edit', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [{ id: 'item-1', isChecked: false }],
        [{ id: 'item-1', content: 'Updated', isChecked: false }],
      ]),
    );

    await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1'));

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'task:edit');
  });

  it('updates item content', async () => {
    const updatedItem = { id: 'item-1', content: 'Updated content', isChecked: false };
    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
      [{ id: 'item-1', isChecked: false }],
      [updatedItem],
    ]);
    mockDb.mockReturnValue(chain);

    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(200);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ item: updatedItem }),
    );

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.checklist_item_updated' }),
    );
  });

  it('toggles isChecked to true and records who checked it', async () => {
    const checkedItem = { id: 'item-1', content: 'Task', isChecked: true, checkedBy: 'user-1' };
    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
      [{ id: 'item-1', isChecked: false }],
      [checkedItem],
    ]);
    mockDb.mockReturnValue(chain);

    await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1', { isChecked: true }));

    // The route sets checkedBy and checkedAt when isChecked is true
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ isChecked: true, checkedBy: 'user-1' }),
    );

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.checklist_item_checked' }),
    );
  });

  it('logs unchecked action when toggling isChecked from true to false', async () => {
    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
      [{ id: 'item-1', isChecked: true }],
      [{ id: 'item-1', isChecked: false, checkedBy: null }],
    ]);
    mockDb.mockReturnValue(chain);

    await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1', { isChecked: false }));

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.checklist_item_unchecked' }),
    );
  });

  it('returns 404 when task does not exist', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(404);
  });

  it('returns 404 when checklist item does not exist', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [], // Item not found
      ]),
    );

    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-missing'));

    expect(response.status).toBe(404);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Checklist item not found' }),
      }),
      expect.objectContaining({ status: 404 }),
    );
  });

  it('returns 403 when task belongs to different organization', async () => {
    mockDb.mockReturnValue(
      createChain([[{ id: 'task-123', organizationId: 'other-org', status: 'open' }]]),
    );

    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(403);
  });

  it('updates sortOrder for reorder', async () => {
    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
      [{ id: 'item-1', isChecked: false }],
      [{ id: 'item-1', sortOrder: 5 }],
    ]);
    mockDb.mockReturnValue(chain);

    await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1', { sortOrder: 5 }));

    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 5 }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE — Delete checklist item
// ═══════════════════════════════════════════════════════════════════

describe('Checklist API — DELETE (remove item)', () => {
  it('deletes a checklist item successfully', async () => {
    const chain = createChain([
      [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
      [{ id: 'item-1', content: 'Delete me' }],
      [],
    ]);
    mockDb.mockReturnValue(chain);

    const response = await DELETE(createRequest('DELETE', CHECKLIST_PATH, 'itemId=item-1'));

    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(response.status).toBe(200);

    // Verify delete was called
    expect(chain.delete).toHaveBeenCalled();

    // Audit entry
    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.checklist_item_removed', entityId: 'task-123' }),
    );
  });

  it('returns 400 when itemId is missing', async () => {
    const response = await DELETE(createRequest('DELETE', CHECKLIST_PATH)); // No itemId

    expect(response.status).toBe(400);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'itemId is required' }),
      }),
      expect.objectContaining({ status: 400 }),
    );
  });

  it('returns 404 when task does not exist', async () => {
    mockDb.mockReturnValue(createChain([[]]));

    const response = await DELETE(createRequest('DELETE', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(404);
  });

  it('returns 404 when checklist item does not exist', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [], // Item not found
      ]),
    );

    const response = await DELETE(createRequest('DELETE', CHECKLIST_PATH, 'itemId=item-missing'));

    expect(response.status).toBe(404);
    expect(getChain(mockDb).delete).not.toHaveBeenCalled();
  });

  it('returns 403 when task belongs to different organization', async () => {
    mockDb.mockReturnValue(
      createChain([[{ id: 'task-123', organizationId: 'other-org', status: 'open' }]]),
    );

    const response = await DELETE(createRequest('DELETE', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(403);
    expect(getChain(mockDb).delete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Response contract
// ═══════════════════════════════════════════════════════════════════

describe('Checklist API — response contract', () => {
  it('GET returns expected shape with items array', async () => {
    mockDb.mockReturnValue(
      createChain([
        [
          {
            id: 'item-1',
            taskId: 'task-123',
            content: 'Test',
            isChecked: false,
            checkedBy: null,
            checkedAt: null,
            sortOrder: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      ]),
    );

    await GET(createRequest('GET', CHECKLIST_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);

    const item = (body.items as Record<string, unknown>[])[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('taskId');
    expect(item).toHaveProperty('content');
    expect(item).toHaveProperty('isChecked');
    expect(item).toHaveProperty('checkedBy');
    expect(item).toHaveProperty('checkedAt');
    expect(item).toHaveProperty('sortOrder');
    expect(item).toHaveProperty('createdAt');
  });

  it('POST returns 201 and item on success', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [],
        [{ id: 'item-new', content: 'New item' }],
      ]),
    );

    await POST(createRequest('POST', CHECKLIST_PATH));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [body, init] = firstCall! as [Record<string, unknown>, { status?: number } | undefined];
    expect(init?.status).toBe(201);
    expect(body).toHaveProperty('item');
  });

  it('PATCH returns 200 and item on success', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [{ id: 'item-1', isChecked: false }],
        [{ id: 'item-1', content: 'Updated', isChecked: false }],
      ]),
    );

    const response = await PATCH(createRequest('PATCH', CHECKLIST_PATH, 'itemId=item-1'));

    expect(response.status).toBe(200);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ item: expect.anything() }),
    );
  });

  it('DELETE returns 200 and success:true on success', async () => {
    mockDb.mockReturnValue(
      createChain([
        [{ id: 'task-123', organizationId: 'org-1', status: 'open' }],
        [{ id: 'item-1', content: 'Delete me' }],
        [],
      ]),
    );

    await DELETE(createRequest('DELETE', CHECKLIST_PATH, 'itemId=item-1'));

    const firstCall = mockNextResponseJson.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0] as Record<string, unknown>;
    expect(body).toHaveProperty('success', true);
  });
});
