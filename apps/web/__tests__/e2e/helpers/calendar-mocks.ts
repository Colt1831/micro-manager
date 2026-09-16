import type { Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════
//  Mock Data Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Return `count` distinct dates within the current calendar month, ordered
 * today first, then alternating day offsets.
 *
 * The calendar only renders the current month view initially, and caps
 * badges per day cell at 3 (then folds extras into "+N more"), so mock due
 * dates must (a) never spill into the previous/next month and (b) land on
 * distinct day cells so every badge title renders.
 */
function pickDistinctDays(count: number): Date[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  // Walk outward from today; skip out-of-month days and already-used days.
  const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
  const used = new Set<number>();
  const result: Date[] = [];

  for (const offset of offsets) {
    if (result.length >= count) break;
    const day = today + offset;
    if (day < 1 || day > daysInMonth) continue;
    if (used.has(day)) continue;
    used.add(day);
    result.push(new Date(year, month, day));
  }
  return result;
}

/**
 * Generate mock tasks with safe due dates that stay within the current month
 * (the Calendar page only renders the current month view initially).
 *
 * - task-1: due today → shows on calendar
 * - task-2: due tomorrow → shows on calendar
 * - task-3: due 2 days from now → shows on calendar
 * - task-4: no due date → hidden from calendar
 * - task-5: due 2 days ago (overdue) → shows on calendar
 */
export function getMockCalendarTasks(): Record<string, unknown>[] {
  // Distinct day cells within the current month so every badge renders.
  // Tuple cast is safe: pickDistinctDays always returns `count` dates
  // (min 8 valid candidates from any day-of-month position).
  const [dueToday, dueTomorrow, dueLater, dueOverdue] = pickDistinctDays(4) as [
    Date, Date, Date, Date,
  ];

  return [
    {
      id: 'task-1',
      title: 'Review Q3 roadmap',
      status: 'in_progress',
      priority: 'high',
      dueDate: dueToday.toISOString(),
    },
    {
      id: 'task-2',
      title: 'Update onboarding docs',
      status: 'open',
      priority: 'medium',
      dueDate: dueTomorrow.toISOString(),
    },
    {
      id: 'task-3',
      title: 'Security audit findings',
      status: 'in_progress',
      priority: 'urgent',
      dueDate: dueLater.toISOString(),
    },
    {
      id: 'task-4',
      title: 'Hidden task (no due date)',
      status: 'open',
      priority: 'low',
      dueDate: null,
    },
    {
      id: 'task-5',
      title: 'Past due API migration',
      status: 'blocked',
      priority: 'critical',
      dueDate: dueOverdue.toISOString(),
    },
  ];
}

/**
 * Generate mock milestones with safe due dates (same reasoning as tasks).
 * - milestone-1: due today → shows on calendar
 * - milestone-2: due in 2 days → shows on calendar
 * - milestone-3: no due date → hidden from calendar
 */
export function getMockMilestones(): Record<string, unknown>[] {
  // Distinct day cells within the current month so every badge renders.
  // Tuple cast is safe: pickDistinctDays always returns `count` dates
  // (min 8 valid candidates from any day-of-month position).
  const [dueToday, dueLater] = pickDistinctDays(2) as [Date, Date];

  return [
    {
      id: 'ms-1',
      projectId: 'proj-1',
      projectName: 'Website Redesign',
      name: 'Beta launch milestone',
      description: 'Complete beta launch of the new website',
      status: 'in_progress',
      dueDate: dueToday.toISOString(),
      completedDate: null,
    },
    {
      id: 'ms-2',
      projectId: 'proj-2',
      projectName: 'Backend Migration',
      name: 'Database migration complete',
      description: 'All data migrated to new schema',
      status: 'pending',
      dueDate: dueLater.toISOString(),
      completedDate: null,
    },
    {
      id: 'ms-3',
      projectId: 'proj-3',
      projectName: 'Legacy Archive',
      name: 'Hidden milestone (no due date)',
      description: null,
      status: 'cancelled',
      dueDate: null,
      completedDate: null,
    },
  ];
}

/**
 * Generate mock approved leave within the current month.
 * - leave-1: single day, today → shows a leave badge
 * - leave-2: two-day span starting tomorrow → badge on both days
 */
export function getMockApprovedLeave(): Record<string, unknown>[] {
  const [d1, d2] = pickDistinctDays(2) as [Date, Date];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const d2end = new Date(d2);
  d2end.setDate(d2end.getDate() + 1);
  return [
    {
      id: 'leave-1',
      userId: 'user-1',
      startDate: iso(d1),
      endDate: iso(d1),
      isHalfDay: false,
      status: 'approved',
      user: { id: 'user-1', name: 'Riya Kapoor' },
      leaveType: { name: 'Casual Leave', color: '#0ea5e9' },
    },
    {
      id: 'leave-2',
      userId: 'user-2',
      startDate: iso(d2),
      endDate: iso(d2end),
      isHalfDay: true,
      status: 'approved',
      user: { id: 'user-2', name: 'Sam Lee' },
      leaveType: { name: 'Sick Leave', color: '#f59e0b' },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
//  Mock Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Mock the calendar API endpoints — tasks and milestones.
 * The calendar page fetches both in parallel on mount.
 *
 * IMPORTANT: Registers routes for bare /api/tasks and /api/milestones
 * (no query params). If other tests register more specific routes with
 * query params (e.g. /api/tasks?limit=500), those take precedence
 * over the bare routes registered here.
 *
 * @example
 *   await mockCalendarApis(page);
 *   await page.goto('/calendar');
 *   // Now badges render on the calendar grid with mock data
 */
export async function mockCalendarApis(
  page: Page,
  options: {
    tasks?: readonly Record<string, unknown>[];
    milestones?: readonly Record<string, unknown>[];
    leaves?: readonly Record<string, unknown>[];
    /** If true, abort ALL API calls to simulate network failure. */
    abort?: boolean;
    /** Delay in ms before fulfilling requests (to test loading state). */
    delay?: number;
  } = {},
) {
  const {
    tasks = getMockCalendarTasks(),
    milestones = getMockMilestones(),
    leaves = getMockApprovedLeave(),
    abort: shouldAbort,
    delay,
  } = options;

  // Tasks API — use function matcher so query params (e.g. ?dueDateStart=...)
  // don't cause the route to fall through. Glob patterns like '**/api/tasks'
  // match against the full URL including query string, so with query params
  // the endpoint would not be intercepted.
  await page.route(
    (url) => url.pathname.startsWith('/api/tasks'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (shouldAbort) {
        await route.abort('connectionrefused');
        return;
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks }),
      });
    },
  );

  // Milestones API — use function matcher (same reason)
  await page.route(
    (url) => url.pathname.startsWith('/api/milestones'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (shouldAbort) {
        await route.abort('connectionrefused');
        return;
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ milestones }),
      });
    },
  );

  // Leave-requests API — the calendar overlays approved leave, fetched on
  // mount and on month change. Match by pathname so date-range query params
  // don't bypass the route.
  await page.route(
    (url) => url.pathname.startsWith('/api/leave-requests'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (shouldAbort) {
        await route.abort('connectionrefused');
        return;
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: leaves }),
      });
    },
  );
}
