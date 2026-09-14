import { test, expect } from '@playwright/test';
import { mockSettingsApis } from './helpers/settings-mocks';
import { setSessionCookie } from './helpers/task-detail-mocks';

// ═══════════════════════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════════════════════

test.beforeEach(async ({ page }) => {
  await setSessionCookie(page);
});

// Warm up the app on the first test to avoid cold-start compilation timeouts
let warmedUp = false;
test.beforeEach(async ({ page }) => {
  if (!warmedUp) {
    warmedUp = true;
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Navigate to settings and switch to the Notifications tab.
 * Returns once the Notifications tab content is hydrated.
 */
async function goToNotificationsTab(page: import('@playwright/test').Page) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /notifications/i }).click();
  await expect(page.getByRole('heading', { name: /notification channels/i })).toBeVisible({
    timeout: 10_000,
  });
}

// ═══════════════════════════════════════════════════════════════
//  Channel Toggle Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Channel Toggles', () => {
  test('renders all channel toggles (In-app, Email, Push, Slack)', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Check all channel labels are visible
    await expect(page.getByText('In-app', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Email', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Push', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Slack', { exact: true }).first()).toBeVisible();
  });

  test('shows channel descriptions', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    await expect(page.getByText('Notification bell in the top bar')).toBeVisible();
    await expect(page.getByText('Send email notifications')).toBeVisible();
    await expect(page.getByText('Push notifications (coming soon)')).toBeVisible();
    await expect(page.getByText('Send notifications to Slack channel')).toBeVisible();
  });

  test('In-app toggle starts enabled', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Find the In-app row and its toggle
    const inAppRow = page.getByText('Notification bell in the top bar').locator('..').locator('..').locator('..');
    const toggle = inAppRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('Email toggle starts enabled', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const emailRow = page.getByText('Send email notifications').locator('..').locator('..').locator('..');
    const toggle = emailRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('Push toggle is disabled', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const pushRow = page.getByText('Push notifications (coming soon)').locator('..').locator('..').locator('..');
    const toggle = pushRow.locator('[role="switch"]');
    await expect(toggle).toBeDisabled();
  });

  test('toggles Email off and back on', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const emailRow = page.getByText('Send email notifications').locator('..').locator('..').locator('..');
    const toggle = emailRow.locator('[role="switch"]');

    // Starts enabled
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Toggle off
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Toggle back on
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('toggles In-app off and saves', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const inAppRow = page.getByText('Notification bell in the top bar').locator('..').locator('..').locator('..');
    const toggle = inAppRow.locator('[role="switch"]');

    // Toggle off
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Save
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });

    // Toggle should remain off
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Slack Connection Status Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Slack Status', () => {
  test('shows Connected badge when Slack is configured', async ({ page }) => {
    await mockSettingsApis(page);

    // Mock Slack API to return connected status
    await page.route('**/api/settings/slack', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          integration: { id: 'slack-1', isActive: true, channelName: '#general' },
        }),
      });
    });

    await goToNotificationsTab(page);

    // Should show Connected badge near Slack
    await expect(page.getByText('Connected')).toBeVisible();
  });

  test('shows Not connected badge when Slack is not configured', async ({ page }) => {
    await mockSettingsApis(page);

    // Mock Slack API to return no integration
    await page.route('**/api/settings/slack', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ integration: null }),
      });
    });

    await goToNotificationsTab(page);

    // Should show Not connected badge
    await expect(page.getByText('Not connected')).toBeVisible();
  });

  test('shows Configure Slack link when not connected', async ({ page }) => {
    await mockSettingsApis(page);

    await page.route('**/api/settings/slack', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ integration: null }),
      });
    });

    await goToNotificationsTab(page);

    await expect(page.getByText('Configure Slack')).toBeVisible();
  });

  test('navigates to Slack tab when Configure Slack is clicked', async ({ page }) => {
    await mockSettingsApis(page);

    await page.route('**/api/settings/slack', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ integration: null }),
      });
    });

    await goToNotificationsTab(page);

    await page.getByText('Configure Slack').click();

    // Should navigate to Slack tab
    await expect(page.getByText('Slack Integration')).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  Per-Event Channel Toggle Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Per-Event Toggles', () => {
  test('renders all notification event types', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Check all event type labels are visible (exact match — the descriptions
    // contain these words too, e.g. "When a task becomes overdue")
    await expect(page.getByText('Task assigned', { exact: true })).toBeVisible();
    await expect(page.getByText('New comment', { exact: true })).toBeVisible();
    await expect(page.getByText('Status changed', { exact: true })).toBeVisible();
    await expect(page.getByText('Mentions', { exact: true })).toBeVisible();
    await expect(page.getByText('Due soon', { exact: true })).toBeVisible();
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
    await expect(page.getByText('Escalated', { exact: true })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
    await expect(page.getByText('Reopened', { exact: true })).toBeVisible();
  });

  test('shows channel columns for each event type', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Check that channel column headers exist
    const inAppHeaders = page.getByText('In-app');
    await expect(inAppHeaders.first()).toBeVisible();

    // There should be multiple "In-app" labels (one per event type + one in channels section)
    const count = await inAppHeaders.count();
    expect(count).toBeGreaterThanOrEqual(10); // At least 10 event types
  });

  test('shows event type descriptions', async ({ page, isMobile }) => {
    // Event descriptions are intentionally hidden on mobile (hidden sm:block)
    test.skip(isMobile, 'Event descriptions are hidden on mobile viewports');

    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    await expect(page.getByText('When a task is assigned to you')).toBeVisible();
    await expect(page.getByText('When someone comments on your task')).toBeVisible();
    await expect(page.getByText('When your task status changes')).toBeVisible();
  });

  test('toggles email for task assigned event', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Find the Task assigned row
    const taskAssignedRow = page.getByText('Task assigned', { exact: true }).locator('..').locator('..').locator('..');
    const toggles = taskAssignedRow.locator('[role="switch"]');

    // Email is the second toggle (index 1)
    const emailToggle = toggles.nth(1);
    await expect(emailToggle).toHaveAttribute('aria-checked', 'true');

    // Toggle off
    await emailToggle.click();
    await expect(emailToggle).toHaveAttribute('aria-checked', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Save Flow Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Save Flow', () => {
  test('Save Preferences button is visible and clickable', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const saveButton = page.getByRole('button', { name: /save preferences/i });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  test('saves modified preferences and shows success', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Toggle email off
    const emailRow = page.getByText('Send email notifications').locator('..').locator('..').locator('..');
    const emailToggle = emailRow.locator('[role="switch"]');
    await emailToggle.click();
    await expect(emailToggle).toHaveAttribute('aria-checked', 'false');

    // Click save
    await page.getByRole('button', { name: /save preferences/i }).click();

    // Should show success message
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows loading state while saving', async ({ page }) => {
    await mockSettingsApis(page);

    // Add delay to PATCH to see loading state
    await page.route('**/api/users/me/preferences', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: body }),
      });
    });

    await goToNotificationsTab(page);

    // Click save
    const saveButton = page.getByRole('button', { name: /save preferences/i });
    await saveButton.click();

    // Button should be disabled while saving
    await expect(saveButton).toBeDisabled();
  });

  test('shows error on save failure', async ({ page }) => {
    await mockSettingsApis(page);

    // Mock PATCH to fail
    await page.route('**/api/users/me/preferences', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }),
      });
    });

    await goToNotificationsTab(page);

    // Click save
    await page.getByRole('button', { name: /save preferences/i }).click();

    // Should show error message
    await expect(page.getByText(/failed to save preferences/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  Digest Toggle Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Digest', () => {
  test('renders digest toggle', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    await expect(page.getByText('Send digest email')).toBeVisible();
    await expect(page.getByText('Receive a summary of unread notifications')).toBeVisible();
  });

  test('digest toggle starts off by default', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const digestRow = page.getByText('Send digest email').locator('..').locator('..').locator('..');
    const toggle = digestRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('toggles digest on and shows frequency selector', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const digestRow = page.getByText('Send digest email').locator('..').locator('..').locator('..');
    const toggle = digestRow.locator('[role="switch"]');

    // Toggle on
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Should show frequency selector
    await expect(page.getByText('Frequency')).toBeVisible();
  });

  test('hides frequency selector when digest is toggled off', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const digestRow = page.getByText('Send digest email').locator('..').locator('..').locator('..');
    const toggle = digestRow.locator('[role="switch"]');

    // Toggle on
    await toggle.click();
    await expect(page.getByText('Frequency')).toBeVisible();

    // Toggle off
    await toggle.click();
    await expect(page.getByText('Frequency')).not.toBeVisible();
  });

  test('changes digest frequency', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const digestRow = page.getByText('Send digest email').locator('..').locator('..').locator('..');
    const toggle = digestRow.locator('[role="switch"]');

    // Toggle on
    await toggle.click();
    await expect(page.getByText('Frequency')).toBeVisible();

    // Change frequency to weekly
    const select = page.locator('select').filter({ hasText: 'Daily' });
    await select.selectOption('weekly');
    await expect(select).toHaveValue('weekly');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Keyboard Shortcut Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Notification Preferences — Keyboard Shortcuts', () => {
  test('navigates to notifications tab with key 7', async ({ page }) => {
    await mockSettingsApis(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Press key 7
    await page.keyboard.press('7');

    // Should navigate to notifications tab
    await expect(page.getByRole('heading', { name: /notification channels/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('navigates back to general tab with key 1', async ({ page }) => {
    await mockSettingsApis(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Go to notifications
    await page.keyboard.press('7');
    await expect(page.getByRole('heading', { name: /notification channels/i })).toBeVisible({
      timeout: 5_000,
    });

    // Go back to general
    await page.keyboard.press('1');
    await expect(page.getByRole('heading', { name: /general settings/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});
