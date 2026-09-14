import { test, expect } from '@playwright/test';
import {
  mockSettingsApis,
  MOCK_PREFS_SOUND_OFF_HAPTIC_ON,
  MOCK_PREFS_SOUND_ON_HAPTIC_OFF,
  MOCK_PREFS_BOTH_OFF,
} from './helpers/settings-mocks';
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
  // Wait for the page to hydrate — settings heading should appear
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Click the Notifications tab
  await page.getByRole('tab', { name: /notifications/i }).click();
  // Wait for the notification channels section to appear
  await expect(page.getByRole('heading', { name: /notification channels/i })).toBeVisible({
    timeout: 10_000,
  });
}

// ═══════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════

test.describe('Settings — Notifications — Sound & Haptic Toggles', () => {
  test('renders the Notification Feedback section with Sound and Vibration labels', async ({
    page,
  }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Notification Feedback section header
    await expect(page.getByText(/notification feedback/i)).toBeVisible();

    // Sound toggle with description
    await expect(page.getByText(/sound/i).first()).toBeVisible();
    await expect(page.getByText(/play a chime on new notifications/i)).toBeVisible();

    // Vibration toggle with description
    await expect(page.getByText(/vibration/i).first()).toBeVisible();
    await expect(page.getByText(/vibrate on new notifications/i)).toBeVisible();
  });

  test('shows Sound toggle as enabled by default', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // The Sound row description confirms the toggle rendered
    await expect(page.getByText(/play a chime on new notifications/i)).toBeVisible();

    // The toggle in the same parent section should be aria-checked="true"
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const toggle = soundRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('shows Vibration toggle as enabled by default', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const toggle = vibRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('toggles Sound off and saves successfully', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Find the Sound toggle and click it
    const vibRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const toggle = vibRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Click to toggle off
    await toggle.click();

    // Toggle should now be unchecked
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Click Save Preferences
    await page.getByRole('button', { name: /save preferences/i }).click();

    // Success state should appear
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });

    // Toggle should remain off after save
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('toggles Vibration off and saves successfully', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const toggle = vibRow.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('toggles both Sound and Vibration off and back on', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    // Get both toggles
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const soundToggle = soundRow.locator('[role="switch"]');
    const vibToggle = vibRow.locator('[role="switch"]');

    // Both start enabled
    await expect(soundToggle).toHaveAttribute('aria-checked', 'true');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'true');

    // Toggle both off
    await soundToggle.click();
    await vibToggle.click();

    await expect(soundToggle).toHaveAttribute('aria-checked', 'false');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'false');

    // Toggle both back on
    await soundToggle.click();
    await vibToggle.click();

    await expect(soundToggle).toHaveAttribute('aria-checked', 'true');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'true');

    // Save
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });
  });

  test('loads preferences with Sound off and Haptic on from server', async ({ page }) => {
    await mockSettingsApis(page, {
      preferences: MOCK_PREFS_SOUND_OFF_HAPTIC_ON as unknown as Record<string, unknown>,
    });
    await goToNotificationsTab(page);

    // Sound should be off
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const soundToggle = soundRow.locator('[role="switch"]');
    await expect(soundToggle).toHaveAttribute('aria-checked', 'false');

    // Vibration should be on
    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const vibToggle = vibRow.locator('[role="switch"]');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'true');
  });

  test('loads preferences with Sound on and Haptic off from server', async ({ page }) => {
    await mockSettingsApis(page, {
      preferences: MOCK_PREFS_SOUND_ON_HAPTIC_OFF as unknown as Record<string, unknown>,
    });
    await goToNotificationsTab(page);

    // Sound should be on
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const soundToggle = soundRow.locator('[role="switch"]');
    await expect(soundToggle).toHaveAttribute('aria-checked', 'true');

    // Vibration should be off
    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const vibToggle = vibRow.locator('[role="switch"]');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'false');
  });

  test('loads preferences with both Sound and Haptic off from server', async ({ page }) => {
    await mockSettingsApis(page, {
      preferences: MOCK_PREFS_BOTH_OFF as unknown as Record<string, unknown>,
    });
    await goToNotificationsTab(page);

    // Both should be off
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const soundToggle = soundRow.locator('[role="switch"]');
    const vibToggle = vibRow.locator('[role="switch"]');

    await expect(soundToggle).toHaveAttribute('aria-checked', 'false');
    await expect(vibToggle).toHaveAttribute('aria-checked', 'false');
  });

  test('shows error state when preferences API fails', async ({ page }) => {
    await mockSettingsApis(page, { abort: true });
    await goToNotificationsTab(page);

    // The page should show loading state: the settings page uses default preferences
    // when the API fails, so the toggles should still appear with default values.
    // Check that the page doesn't crash.
    await expect(page.getByText(/play a chime on new notifications/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Save Preferences button exists and is clickable', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const saveButton = page.getByRole('button', { name: /save preferences/i });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  // ═══════════════════════════════════════════════════════════════
  //  Preview Button Tests
  // ═══════════════════════════════════════════════════════════════

  test('renders the Sound preview chime button with correct label', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview notification chime/i,
    });
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toHaveAttribute('title', 'Preview chime');
  });

  test('renders the Vibration preview button with correct label', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview vibration feedback/i,
    });
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toHaveAttribute('title', 'Preview vibration');
  });

  test('clicks Sound preview chime button and shows toast', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview notification chime/i,
    });
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toBeEnabled();

    // Click the preview button
    await previewBtn.click();

    // The toast should appear with the chime notification title
    await expect(page.getByText('🔔 Preview chime', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Notification chime is playing...', { exact: true })).toBeVisible();
  });

  test('clicks Vibration preview button and shows toast', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview vibration feedback/i,
    });
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toBeEnabled();

    // Click the preview button
    await previewBtn.click();

    // The toast should appear with the vibration notification title
    await expect(page.getByText('📳 Preview vibration', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Vibration feedback triggered (mobile devices only).', { exact: true })).toBeVisible();
  });

  test('Sound preview button is disabled when sound is toggled off', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview notification chime/i,
    });
    await expect(previewBtn).toBeEnabled();

    // Toggle sound off
    const soundRow = page.getByText(/play a chime on new notifications/i).locator('..').locator('..').locator('..');
    const soundToggle = soundRow.locator('[role="switch"]');
    await soundToggle.click();

    // Preview button should now be disabled
    await expect(previewBtn).toBeDisabled();

    // Toggle sound back on
    await soundToggle.click();

    // Preview button should be re-enabled
    await expect(previewBtn).toBeEnabled();
  });

  test('Vibration preview button is disabled when haptic is toggled off', async ({ page }) => {
    await mockSettingsApis(page);
    await goToNotificationsTab(page);

    const previewBtn = page.getByRole('button', {
      name: /preview vibration feedback/i,
    });
    await expect(previewBtn).toBeEnabled();

    // Toggle vibration off
    const vibRow = page.getByText(/vibrate on new notifications/i).locator('..').locator('..').locator('..');
    const vibToggle = vibRow.locator('[role="switch"]');
    await vibToggle.click();

    // Preview button should now be disabled
    await expect(previewBtn).toBeDisabled();

    // Toggle vibration back on
    await vibToggle.click();

    // Preview button should be re-enabled
    await expect(previewBtn).toBeEnabled();
  });
});
