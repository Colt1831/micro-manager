import { test, expect } from '@playwright/test';
import {
  mockSettingsApis,
  mockSlackSettingsApis,
  MOCK_SLACK_INTEGRATION,
} from './helpers/settings-mocks';
import { setSessionCookie } from './helpers/task-detail-mocks';

// ═══════════════════════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════════════════════

// NB: hyphens keep this from matching Slack's secret-scan pattern — GitHub
// push protection blocks commits containing hooks.slack.com token segments.
const WEBHOOK_URL =
  'https://hooks.slack.com/services/not-a-real-token/not-a-real-token/not-a-real-token';

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
 * Navigate to settings and open the Slack tab.
 * Returns once the Slack settings content has hydrated.
 * The tagline renders in both the connected and unconnected states.
 */
async function goToSlackTab(page: import('@playwright/test').Page) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /slack/i }).click();
  await expect(
    page.getByText(/send notifications to slack when tasks are created/i),
  ).toBeVisible({ timeout: 10_000 });
}

/** Open the disconnect confirmation modal (requires a connected integration). */
async function openDisconnectModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Disconnect Slack' }).click();
  await expect(page.getByRole('heading', { name: 'Disconnect Slack', exact: true })).toBeVisible();
}

// ═══════════════════════════════════════════════════════════════
//  Connect Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Slack Settings — Connect Flow', () => {
  test('shows the Connect Slack setup form when no integration is configured', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: null });
    await goToSlackTab(page);

    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Webhook URL' })).toBeVisible();
    await expect(page.getByPlaceholder(/hooks\.slack\.com/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  });

  test('shows webhook setup instructions', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: null });
    await goToSlackTab(page);

    await expect(page.getByText('How to get a Slack webhook URL')).toBeVisible();
    await expect(page.getByText(/slack → apps → incoming webhooks/i)).toBeVisible();
  });

  test('Test and Connect buttons start disabled and enable once a URL is entered', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: null });
    await goToSlackTab(page);

    const testButton = page.getByRole('button', { name: 'Test', exact: true });
    const connectButton = page.getByRole('button', { name: 'Connect', exact: true });

    await expect(testButton).toBeDisabled();
    await expect(connectButton).toBeDisabled();

    await page.getByPlaceholder(/hooks\.slack\.com/).fill(WEBHOOK_URL);

    await expect(testButton).toBeEnabled();
    await expect(connectButton).toBeEnabled();
  });

  test('Test webhook success shows confirmation', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { testResult: { success: true } });
    await goToSlackTab(page);

    await page.getByPlaceholder(/hooks\.slack\.com/).fill(WEBHOOK_URL);
    await page.getByRole('button', { name: 'Test', exact: true }).click();

    await expect(page.getByText('Test message sent!')).toBeVisible({ timeout: 5_000 });
  });

  test('Test webhook failure shows the error message', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      testResult: { success: false, error: 'Invalid webhook URL' },
    });
    await goToSlackTab(page);

    await page.getByPlaceholder(/hooks\.slack\.com/).fill(WEBHOOK_URL);
    await page.getByRole('button', { name: 'Test', exact: true }).click();

    await expect(page.getByText('Test failed')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Invalid webhook URL')).toBeVisible();
  });

  test('Connect saves the webhook and shows the active integration card', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: null,
      saveResponse: { status: 200, body: { integration: { ...MOCK_SLACK_INTEGRATION } } },
    });
    await goToSlackTab(page);

    await page.getByPlaceholder(/hooks\.slack\.com/).fill(WEBHOOK_URL);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // Connected card replaces the setup form
    await expect(page.getByText('#general')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByRole('button', { name: /send preview/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeHidden();
  });

  test('Connect shows an error when the webhook URL is invalid', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      saveResponse: {
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid Slack webhook URL' } },
      },
    });
    await goToSlackTab(page);

    await page.getByPlaceholder(/hooks\.slack\.com/).fill(WEBHOOK_URL);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByText('Invalid Slack webhook URL')).toBeVisible({ timeout: 5_000 });
    // With no integration present, the component swaps to its error state
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeHidden();

    // Retry refetches and returns to the connect form
    await page.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  Connected State
// ═══════════════════════════════════════════════════════════════

test.describe('Slack Settings — Connected State', () => {
  test('shows the active integration card with channel name', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: { ...MOCK_SLACK_INTEGRATION } });
    await goToSlackTab(page);

    await expect(page.getByText('#general')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByText('All task events')).toBeVisible();
  });

  test('shows Disabled badge when the integration is inactive', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: { ...MOCK_SLACK_INTEGRATION, isActive: false },
    });
    await goToSlackTab(page);

    await expect(page.getByText('Disabled')).toBeVisible();
    await expect(page.getByText('Active')).not.toBeVisible();
  });

  test('shows last-used and last-error indicators', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: { ...MOCK_SLACK_INTEGRATION, lastError: 'Webhook rejected: 401' },
    });
    await goToSlackTab(page);

    // lastUsedAt is rendered with a locale-formatted title; only assert the prefix
    await expect(page.locator('[title^="Last used:"]')).toBeVisible();
    await expect(page.locator('[title="Last error: Webhook rejected: 401"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Preview Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Slack Settings — Preview Flow', () => {
  test('Send Preview success shows confirmation', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: { ...MOCK_SLACK_INTEGRATION },
      previewResult: { success: true },
    });
    await goToSlackTab(page);

    await page.getByRole('button', { name: /send preview/i }).click();

    await expect(page.getByText('Preview sent! Check your Slack channel.')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Send Preview failure shows the error', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: { ...MOCK_SLACK_INTEGRATION },
      previewResult: { success: false, error: 'Slack returned 500' },
    });
    await goToSlackTab(page);

    await page.getByRole('button', { name: /send preview/i }).click();

    await expect(page.getByText('Preview failed')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Slack returned 500')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Disconnect Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Slack Settings — Disconnect Flow', () => {
  test('opens the disconnect confirmation modal', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: { ...MOCK_SLACK_INTEGRATION } });
    await goToSlackTab(page);

    await openDisconnectModal(page);

    await expect(page.getByText(/notifications will stop being sent to slack/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  });

  test('cancel keeps the integration connected', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: { ...MOCK_SLACK_INTEGRATION } });
    await goToSlackTab(page);

    await openDisconnectModal(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByText(/notifications will stop being sent to slack/i)).toBeHidden();
    await expect(page.getByRole('button', { name: /send preview/i })).toBeVisible();
  });

  test('disconnect deletes the integration and returns to the connect form', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: { ...MOCK_SLACK_INTEGRATION } });
    await goToSlackTab(page);

    await openDisconnectModal(page);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();

    // Back to the setup form
    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByPlaceholder(/hooks\.slack\.com/)).toBeVisible();
    await expect(page.getByRole('button', { name: /send preview/i })).toBeHidden();
  });

  test('disconnect failure keeps the integration', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, {
      integration: { ...MOCK_SLACK_INTEGRATION },
      deleteResponse: {
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'Failed to delete' } },
      },
    });
    await goToSlackTab(page);

    await openDisconnectModal(page);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();

    // Modal closes but the integration card remains
    await expect(page.getByText(/notifications will stop being sent to slack/i)).toBeHidden();
    await expect(page.getByRole('button', { name: /send preview/i })).toBeVisible();
    await expect(page.getByText('#general')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════════

test.describe('Slack Settings — Navigation', () => {
  test('navigates to the Slack tab with keyboard shortcut 5', async ({ page }) => {
    await mockSettingsApis(page);
    await mockSlackSettingsApis(page, { integration: null });
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.keyboard.press('5');

    await expect(page.getByRole('heading', { name: 'Connect Slack', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });
});
