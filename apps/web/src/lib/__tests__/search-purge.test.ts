import { describe, it, expect, beforeEach, vi } from 'vitest';

// Item E — search reindex purges stale docs per-org (multi-tenant safe).
// Proves only stale docs of the requested org are removed and no global
// deleteAllDocuments is ever called.

const { mockIndex, mockGetDocuments, mockDeleteDocuments } = vi.hoisted(() => {
  const mockGetDocuments = vi.fn();
  const mockDeleteDocuments = vi.fn().mockResolvedValue({ taskUid: 1 });
  const mockIndex = vi.fn(() => ({
    getDocuments: mockGetDocuments,
    deleteDocuments: mockDeleteDocuments,
    addDocuments: vi.fn(),
    updateSettings: vi.fn(),
  }));
  return { mockIndex, mockGetDocuments, mockDeleteDocuments };
});

vi.mock('meilisearch', () => ({
  MeiliSearch: vi.fn(() => ({
    index: mockIndex,
    createIndex: vi.fn().mockResolvedValue(undefined),
    deleteAllDocuments: vi.fn(() => {
      throw new Error('deleteAllDocuments must never be called (multi-tenant)');
    }),
  })),
}));

process.env.MEILISEARCH_HOST = 'http://localhost:7700';

import { purgeStaleTasks } from '@/lib/search';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purgeStaleTasks (per-org stale purge)', () => {
  it('deletes only indexed docs of the org that are not in the active set', async () => {
    // Indexed for org-1: t1 (active), t2 (stale/deleted), t3 (stale).
    mockGetDocuments.mockResolvedValueOnce({
      results: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    });

    const removed = await purgeStaleTasks('org-1', ['t1']);

    expect(removed).toBe(2);
    expect(mockDeleteDocuments).toHaveBeenCalledTimes(1);
    const deleted = mockDeleteDocuments.mock.calls[0]![0] as string[];
    expect(deleted.sort()).toEqual(['t2', 't3']);
    // The org filter must be applied to the read (no cross-org fetch).
    expect(mockGetDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'organizationId = org-1' }),
    );
  });

  it('removes nothing when every indexed doc is still active', async () => {
    mockGetDocuments.mockResolvedValueOnce({ results: [{ id: 'a' }, { id: 'b' }] });

    const removed = await purgeStaleTasks('org-1', ['a', 'b']);

    expect(removed).toBe(0);
    expect(mockDeleteDocuments).not.toHaveBeenCalled();
  });
});
