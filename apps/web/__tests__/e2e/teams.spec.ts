import { test, expect, type Page } from '@playwright/test';
import { mockTeamsApi } from './helpers/teams-mocks';
import { setSessionCookie } from './helpers/task-detail-mocks';

// ─── Helpers ───────────────────────────────────────────────────

/**
 * The "Teams" heading exists as both <h1>Teams</h1> (page title) and
 * <h2>Teams</h2> (section heading) when teams data is present, so we
 * always take .first() to avoid strict-mode violations.
 */
function teamsHeading(page: Page) {
  return page.getByRole('heading', { name: 'Teams', exact: true }).first();
}

// ─── Setup ─────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await setSessionCookie(page);
});

// ─── Tests ─────────────────────────────────────────────────────

test.describe('Teams Page', () => {
  test('shows loading shimmer while teams are being fetched', async ({ page }) => {
    await mockTeamsApi(page, { delay: 500 });

    await page.goto('/teams');

    // Shimmer placeholders should be visible while loading
    await expect(page.locator('.shimmer').first()).toBeVisible({ timeout: 5_000 });

    // Title should appear after loading completes
    await expect(teamsHeading(page)).toBeVisible({ timeout: 10_000 });
  });

  test('shows error state with retry button when API fails', async ({ page }) => {
    await mockTeamsApi(page, { abort: true });

    await page.goto('/teams');

    // Error card should appear
    await expect(page.getByText(/failed to load teams/i)).toBeVisible({ timeout: 15_000 });

    // Retry button should be present
    const retryButton = page.getByRole('button', { name: /retry/i });
    await expect(retryButton).toBeVisible();

    // Page should not crash — URL stays on teams
    expect(page.url()).toContain('/teams');
  });

  test('shows empty state when no teams or departments exist', async ({ page }) => {
    await mockTeamsApi(page, { teams: [], departments: [] });

    await page.goto('/teams');

    // Wait for the page to hydrate
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Empty state should show
    await expect(page.getByText(/no teams or departments/i)).toBeVisible();
    await expect(
      page.getByText(/Teams and departments will appear here/i),
    ).toBeVisible();

    // Create button should exist in empty state
    await expect(page.getByRole('button', { name: /create team/i }).first()).toBeVisible();
  });

  test('renders departments section with department cards', async ({ page }) => {
    await mockTeamsApi(page, { teams: [] });

    await page.goto('/teams');

    // Wait for page to hydrate
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Department names should be visible
    await expect(page.getByText('Engineering').first()).toBeVisible();
    await expect(page.getByText('Quality').first()).toBeVisible();

    // Department codes should be visible
    await expect(page.getByText('ENG').first()).toBeVisible();

    // Department descriptions should be visible
    await expect(page.getByText(/All engineering disciplines/i).first()).toBeVisible();
    await expect(page.getByText(/Testing and quality assurance/i).first()).toBeVisible();

    // Status badges flag only the exception. Every seeded department is active,
    // so no badge should appear — a badge on every row carries no information.
    await expect(page.getByText('Active', { exact: true })).toHaveCount(0);
  });

  test('renders teams section with team cards', async ({ page }) => {
    await mockTeamsApi(page, { departments: [] });

    await page.goto('/teams');

    // Wait for page to hydrate
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Team count should show
    await expect(page.getByText(/4 teams?/i)).toBeVisible();

    // Each team name should be visible
    await expect(page.getByText('Frontend').first()).toBeVisible();
    await expect(page.getByText('Backend').first()).toBeVisible();
    await expect(page.getByText('Design').first()).toBeVisible();
    await expect(page.getByText('QA').first()).toBeVisible();

    // Team codes should be visible
    await expect(page.getByText('FE').first()).toBeVisible();
    await expect(page.getByText('BE').first()).toBeVisible();

    // Team descriptions should be visible
    await expect(page.getByText(/Frontend web development/i).first()).toBeVisible();
    await expect(page.getByText(/Backend API and services/i).first()).toBeVisible();
    await expect(page.getByText(/Quality assurance and testing/i).first()).toBeVisible();

    // Lead user info should be rendered (truncated UUIDs)
    await expect(page.getByText(/Lead:/i).first()).toBeVisible();

    // Active badge should show
    await expect(page.getByText('Active').first()).toBeVisible();
  });

  test('shows inactive badge for inactive teams', async ({ page }) => {
    await mockTeamsApi(page, { departments: [] });

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // QA team is inactive
    await expect(page.getByText('Inactive').first()).toBeVisible();
  });

  test('shows both departments and teams sections together', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Count should show both
    await expect(page.getByText(/4 teams?/i)).toBeVisible();
    await expect(page.getByText(/2 departments?/i)).toBeVisible();

    // Both sections should render cards
    await expect(page.getByText('Engineering').first()).toBeVisible();
    await expect(page.getByText('Frontend').first()).toBeVisible();
  });

  test('opens create team modal and shows validation error for empty name', async ({
    page,
  }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Click Create Team button — use first() since header + empty-state both have one
    await page.getByRole('button', { name: /create team/i }).first().click();

    // Modal should appear
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).toBeVisible();

    // Click create with empty name (first() for mobile safety)
    await page.getByRole('button', { name: /create$/i }).first().click();

    // Validation error should appear
    await expect(page.getByText(/team name is required/i)).toBeVisible();
  });

  test('creates a team successfully via modal', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Open create modal
    await page.getByRole('button', { name: /create team/i }).first().click();
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).toBeVisible();

    // Fill the form
    const nameInput = page.getByPlaceholder(/e\.g\. Engineering/i);
    await nameInput.fill('DevOps');

    const codeInput = page.getByPlaceholder('e.g. ENG', { exact: true });
    await codeInput.fill('DO');

    const descInput = page.getByPlaceholder(/optional description/i);
    await descInput.fill('Infrastructure and deployment');

    // Submit (first() for mobile safety)
    await page.getByRole('button', { name: /create$/i }).first().click();

    // Wait for modal to close and new team to appear in the list
    await expect(page.getByText('DevOps')).toBeVisible({ timeout: 5_000 });

    // Modal should be closed
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).not.toBeVisible();
  });

  test('shows error message when team creation fails', async ({ page }) => {
    await mockTeamsApi(page, {
      createErrorStatus: 400,
      createErrorBody: { error: { code: 'VALIDATION_ERROR', message: 'Name is required' } },
    });

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Open create modal
    await page.getByRole('button', { name: /create team/i }).first().click();
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).toBeVisible();

    // Fill the form and submit
    const nameInput = page.getByPlaceholder(/e\.g\. Engineering/i);
    await nameInput.fill('Some Team');
    // Submit (first() for mobile safety)
    await page.getByRole('button', { name: /create$/i }).first().click();

    // Error should appear in the modal
    await expect(page.getByText(/Name is required/i)).toBeVisible({ timeout: 5_000 });

    // Modal should still be open
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).toBeVisible();
  });

  test('closes create modal on cancel', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');

    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Open modal
    await page.getByRole('button', { name: /create team/i }).first().click();
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Modal should close
    await expect(
      page.getByRole('heading', { name: /create team/i }),
    ).not.toBeVisible();
  });

  // ─── Departments: create & delete ────────────────────────────

  test('creates a department successfully via modal', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    // Open the New Department modal from the header
    await page.getByRole('button', { name: /new department/i }).first().click();
    await expect(page.getByRole('heading', { name: /create department/i })).toBeVisible();

    // Fill the form
    await page.getByPlaceholder(/e\.g\. Marketing/i).fill('Marketing');
    await page.getByPlaceholder('e.g. MKT', { exact: true }).fill('MKT');
    await page.getByPlaceholder(/optional description/i).fill('Brand and growth');

    // Submit
    await page.getByRole('button', { name: /create$/i }).first().click();

    // New department appears and the modal closes
    await expect(page.getByText('Marketing')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /create department/i })).not.toBeVisible();
  });

  test('shows validation error for empty department name', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /new department/i }).first().click();
    await expect(page.getByRole('heading', { name: /create department/i })).toBeVisible();

    // Submit with an empty name
    await page.getByRole('button', { name: /create$/i }).first().click();

    await expect(page.getByText(/department name is required/i)).toBeVisible();
  });

  test('deletes a department after confirmation', async ({ page }) => {
    await mockTeamsApi(page, { teams: [] });

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Engineering').first()).toBeVisible();

    // Click the per-card delete button (opacity-0 until hover, but Playwright treats it as visible)
    await page.getByRole('button', { name: 'Delete Engineering' }).click();

    // Confirmation modal appears naming the department
    await expect(page.getByRole('heading', { name: /delete department/i })).toBeVisible();
    await expect(page.getByText(/any teams in this department will become unassigned/i)).toBeVisible();

    // Confirm — the modal's own "Delete" button (exact) is distinct from the card buttons
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // The department card is removed
    await expect(page.getByText('Engineering')).toHaveCount(0, { timeout: 5_000 });
  });

  test('cancels department deletion', async ({ page }) => {
    await mockTeamsApi(page, { teams: [] });

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Engineering').first()).toBeVisible();

    await page.getByRole('button', { name: 'Delete Engineering' }).click();
    await expect(page.getByRole('heading', { name: /delete department/i })).toBeVisible();

    // Cancel — the department is untouched
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('heading', { name: /delete department/i })).not.toBeVisible();
    await expect(page.getByText('Engineering').first()).toBeVisible();
  });

  test('shows error when department deletion fails', async ({ page }) => {
    await mockTeamsApi(page, {
      teams: [],
      deleteDeptErrorStatus: 403,
      deleteDeptErrorBody: { error: { code: 'FORBIDDEN', message: 'Not allowed' } },
    });

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Engineering').first()).toBeVisible();

    await page.getByRole('button', { name: 'Delete Engineering' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // Error surfaces in the modal, which stays open, and the card remains
    await expect(page.getByText(/not allowed/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /delete department/i })).toBeVisible();
    await expect(page.getByText('Engineering').first()).toBeVisible();
  });

  test('renames a team via the rename button', async ({ page }) => {
    await mockTeamsApi(page);

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Frontend').first()).toBeVisible();

    // Open the rename modal for a team (hover-revealed button)
    await page.getByRole('button', { name: 'Rename Frontend' }).click();
    await expect(page.getByRole('heading', { name: /rename team/i })).toBeVisible();

    // Name is prefilled; change it and save
    const nameInput = page.getByRole('textbox', { name: 'Name' });
    await expect(nameInput).toHaveValue('Frontend');
    await nameInput.fill('Frontend Platform');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByRole('heading', { name: /rename team/i })).not.toBeVisible();
    await expect(page.getByText('Frontend Platform').first()).toBeVisible({ timeout: 5_000 });
  });

  test('renames a department via the rename button', async ({ page }) => {
    await mockTeamsApi(page, { teams: [] });

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Engineering').first()).toBeVisible();

    await page.getByRole('button', { name: 'Rename Engineering' }).click();
    await expect(page.getByRole('heading', { name: /rename department/i })).toBeVisible();

    const nameInput = page.getByRole('textbox', { name: 'Name' });
    await expect(nameInput).toHaveValue('Engineering');
    await nameInput.fill('Platform Engineering');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByRole('heading', { name: /rename department/i })).not.toBeVisible();
    await expect(page.getByText('Platform Engineering').first()).toBeVisible({ timeout: 5_000 });
  });

  test('shows an error when a rename fails', async ({ page }) => {
    await mockTeamsApi(page, { teams: [], renameErrorStatus: 400 });

    await page.goto('/teams');
    await expect(teamsHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Engineering').first()).toBeVisible();

    await page.getByRole('button', { name: 'Rename Engineering' }).click();
    await expect(page.getByRole('heading', { name: /rename department/i })).toBeVisible();
    await page.getByRole('button', { name: /save/i }).click();

    // Error surfaces and the modal stays open
    await expect(page.getByText(/rename failed/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /rename department/i })).toBeVisible();
  });
});
