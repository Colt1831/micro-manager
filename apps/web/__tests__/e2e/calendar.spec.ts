import { test, expect } from '@playwright/test';
import { mockCalendarApis } from './helpers/calendar-mocks';
import { setSessionCookie } from './helpers/task-detail-mocks';

// ─── Helpers ───────────────────────────────────────────────────

/** Get the display text for the current month/year shown in the header. */
function currentMonthYear(): string {
  const now = new Date();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[now.getMonth()]!} ${now.getFullYear()}`;
}

/** Get the date portion (day number) for today. */
function todayDate(): number {
  return new Date().getDate();
}

// ─── Setup ─────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await setSessionCookie(page);
});

// ─── Tests ─────────────────────────────────────────────────────

test.describe('Calendar', () => {
  test('shows loading shimmer while data is being fetched', async ({ page }) => {
    await mockCalendarApis(page, { delay: 500 });

    await page.goto('/calendar');

    // Shimmer placeholders should be visible while loading
    await expect(page.locator('.shimmer').first()).toBeVisible({ timeout: 5_000 });

    // Title should appear after loading completes
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('shows empty state when no tasks or milestones have due dates', async ({ page }) => {
    // Provide tasks and milestones with no due dates so calendar is empty
    await mockCalendarApis(page, {
      tasks: [
        { id: 't1', title: 'No date task', status: 'open', priority: 'low', dueDate: null },
      ] as unknown as Record<string, unknown>[],
      milestones: [
        { id: 'm1', projectId: 'p1', projectName: 'Test', name: 'No date milestone', description: null, status: 'pending', dueDate: null, completedDate: null },
      ] as unknown as Record<string, unknown>[],
      leaves: [],
    });

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Empty state should show
    await expect(
      page.getByText(/no tasks or milestones with dates/i),
    ).toBeVisible();
    await expect(
      page.getByText(/tasks and milestones appear on the calendar/i),
    ).toBeVisible();

    // "New Task" link should be visible in empty state
    await expect(page.getByRole('link', { name: /new task/i })).toBeVisible();
  });

  test('renders month view header with correct month and year', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // The month/year should be visible in the header button
    const expectedTitle = currentMonthYear();
    await expect(page.getByText(expectedTitle)).toBeVisible();
  });

  test('renders task badges on correct dates', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Tasks with due dates should appear as badges in the calendar grid
    // Today's task: "Review Q3 roadmap"
    await expect(page.getByText(/Review Q3 roadmap/i).first()).toBeVisible();

    // Tomorrow's task: "Update onboarding docs"
    await expect(page.getByText(/Update onboarding docs/i).first()).toBeVisible();

    // Next week's task: "Security audit findings"
    await expect(page.getByText(/Security audit findings/i).first()).toBeVisible();

    // Overdue task: "Past due API migration"
    await expect(page.getByText(/Past due API migration/i).first()).toBeVisible();

    // Task without due date should NOT be visible
    await expect(page.getByText(/Hidden task/i)).not.toBeVisible();
  });

  test('renders milestone badges with diamond icon', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Milestones with due dates should appear as badges
    // "Beta launch milestone" (due today)
    await expect(page.getByText(/Beta launch milestone/i).first()).toBeVisible();

    // "Database migration complete" (due in 7 days)
    await expect(page.getByText(/Database migration complete/i).first()).toBeVisible();

    // Milestone without due date should NOT be visible
    await expect(page.getByText(/Hidden milestone/i)).not.toBeVisible();
  });

  test('overlays approved leave badges', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Approved leave shows the leave-taker's name; half-day carries the ½ cue.
    await expect(page.getByText(/Riya Kapoor/i).first()).toBeVisible();
    await expect(page.getByText(/Sam Lee ½/i).first()).toBeVisible();

    // Legend gains an approved-leave entry.
    await expect(page.getByText('Approved leave', { exact: true })).toBeVisible();
  });

  test('switches to day view and renders a task on the selected day', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Click the Day view tab
    await page.getByRole('tab', { name: /^day$/i }).click();

    // Today's date badge should be visible in the day header
    const today = todayDate();
    await expect(page.getByText(String(today)).first()).toBeVisible();

    // Today's task should render in the day view
    await expect(page.getByText(/Review Q3 roadmap/i).first()).toBeVisible();

    // Navigating to the next day should hide today's task (it's not due then)
    await page.getByRole('button', { name: /next day/i }).click();
    await expect(page.getByText(/Review Q3 roadmap/i)).not.toBeVisible();
  });

  test('switches to week view and shows correct layout', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Click the Week view tab
    await page.getByRole('tab', { name: /week/i }).click();

    // Week view should show day column headers
    await expect(page.getByText(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/i).first()).toBeVisible();

    // Today's date badge should be visible in week view
    const today = todayDate();
    await expect(page.getByText(String(today)).first()).toBeVisible();

    // Tasks should still be visible in week view
    await expect(page.getByText(/Review Q3 roadmap/i).first()).toBeVisible();
  });

  test('navigates to previous and next month', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Get the current month/year text
    const originalTitle = currentMonthYear();
    await expect(page.getByText(originalTitle)).toBeVisible();

    // Click Previous month button
    await page.getByRole('button', { name: /previous month/i }).click();

    // The title should now show a different month
    const currentText = await page.getByText(/January|February|March|April|May|June|July|August|September|October|November|December/).first().textContent();
    expect(currentText).not.toBe(originalTitle);

    // Click Next month button once to return to original
    await page.getByRole('button', { name: /next month/i }).click();

    // Should be back to the original month/year
    await expect(page.getByText(originalTitle)).toBeVisible();
  });

  test('Today button navigates back to current month', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Navigate away to previous month
    await page.getByRole('button', { name: /previous month/i }).click();

    // Verify we navigated away
    const originalTitle = currentMonthYear();
    const awayText = await page.getByText(/January|February|March|April|May|June|July|August|September|October|November|December/).first().textContent();
    expect(awayText).not.toBe(originalTitle);

    // Click Today button
    await page.getByRole('button', { name: /today/i }).click();

    // Should be back to current month
    await expect(page.getByText(originalTitle)).toBeVisible();
  });

  test('renders status legend with milestone count', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Status legend should be visible
    await expect(page.getByText(/Status/i)).toBeVisible();

    // Common status labels should appear in legend
    await expect(page.getByText(/Draft/i)).toBeVisible();
    await expect(page.getByText(/Open/i)).toBeVisible();
    await expect(page.getByText(/In Progress/i)).toBeVisible();
    await expect(page.getByText(/Completed/i)).toBeVisible();

    // Milestone count should be shown in legend (2 milestones with due dates)
    await expect(page.getByText(/2 milestones/i)).toBeVisible();
  });

  test('shows task popover on click', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Find a task badge and click it to open the popover
    const taskBadge = page.getByText(/Review Q3 roadmap/i).first();
    await expect(taskBadge).toBeVisible();

    // Click the badge to open the popover
    await taskBadge.click();

    // Popover should appear with task details
    await expect(page.getByRole('link', { name: /view task/i })).toBeVisible({ timeout: 3_000 });

    // Popover should show the task status badge
    await expect(page.getByText(/In Progress/i).first()).toBeVisible();

    // Popover should show priority
    await expect(page.getByText(/High/i).first()).toBeVisible();
  });

  test('shows milestone popover on click', async ({ page }) => {
    await mockCalendarApis(page);

    await page.goto('/calendar');

    // Wait for page to hydrate
    await expect(
      page.getByRole('heading', { name: 'Calendar', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Find a milestone badge and click it to open the popover
    const milestoneBadge = page.getByText(/Beta launch milestone/i).first();
    await expect(milestoneBadge).toBeVisible();

    // Click the badge to open the popover
    await milestoneBadge.click();

    // Popover should appear with milestone details
    await expect(page.getByRole('link', { name: /view project/i })).toBeVisible({ timeout: 3_000 });

    // Popover should show "Milestone" label and project name
    await expect(page.getByText(/Website Redesign/i).first()).toBeVisible();

    // Popover should show the milestone description
    await expect(page.getByText(/Complete beta launch/i)).toBeVisible();
  });
});
