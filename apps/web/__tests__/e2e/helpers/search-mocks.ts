import type { Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════
//  Mock Data
// ═══════════════════════════════════════════════════════════════

interface MockSearchHit {
  id: string;
  type: 'task' | 'project' | 'user' | 'comment';
  title: string;
  subtitle: string | null;
  description: string | null;
  status: string | null;
  url: string;
  metadata: Record<string, unknown>;
}

/** Search hits returned for any query — one per entity type so the palette
 *  shows all four result groups (Tasks, Projects, People, Comments). */
export const MOCK_SEARCH_HITS: {
  tasks: MockSearchHit[];
  projects: MockSearchHit[];
  users: MockSearchHit[];
  comments: MockSearchHit[];
} = {
  tasks: [
    {
      id: 'task-s1',
      type: 'task',
      title: 'Payroll integration',
      subtitle: 'TASK-042',
      description: null,
      status: 'in_progress',
      url: '/tasks/task-s1',
      metadata: {},
    },
  ],
  projects: [
    {
      id: 'proj-s1',
      type: 'project',
      title: 'Payments API',
      subtitle: 'PAY-01',
      description: null,
      status: 'active',
      url: '/projects/proj-s1',
      metadata: {},
    },
  ],
  users: [
    {
      id: 'user-s1',
      type: 'user',
      title: 'Payal Sharma',
      subtitle: 'payal@example.com',
      description: null,
      status: 'active',
      url: '/users/user-s1',
      metadata: {},
    },
  ],
  comments: [
    {
      id: 'comment-s1',
      type: 'comment',
      title: 'Payroll integration',
      subtitle: 'TASK-042',
      description: 'Payment reconciliation comment',
      status: null,
      url: '/tasks/task-s1#comment-comment-s1',
      metadata: { taskId: 'task-s1' },
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
//  Mock Helper
// ═══════════════════════════════════════════════════════════════

/**
 * Mock GET /api/search?type=all&q=...&limit=5 — the endpoint the command
 * palette calls when the user types. Returns one hit per entity group.
 *
 * @example
 *   await mockSearchApi(page);
 *   await page.goto('/');
 *   // Press ⌘K, type "pay" → Tasks/Projects/People groups render with hits
 */
export async function mockSearchApi(page: Page) {
  // Narrow to the palette's exact URL shape — avoids also intercepting
  // /api/search/saved and /api/search/reindex (Playwright `?` matches any
  // single char, so a bare `**/api/search?*` would match those too).
  await page.route('**/api/search?type=all*', async (route) => {
    const url = route.request().url();
    const query = new URL(url).searchParams.get('q') ?? '';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: {
          tasks: { hits: MOCK_SEARCH_HITS.tasks, total: MOCK_SEARCH_HITS.tasks.length },
          projects: { hits: MOCK_SEARCH_HITS.projects, total: MOCK_SEARCH_HITS.projects.length },
          users: { hits: MOCK_SEARCH_HITS.users, total: MOCK_SEARCH_HITS.users.length },
          comments: { hits: MOCK_SEARCH_HITS.comments, total: MOCK_SEARCH_HITS.comments.length },
        },
        total: 4,
        query,
      }),
    });
  });
}
