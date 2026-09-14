import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI runners have limited CPU; 4 parallel browser contexts + Next dev
  // compilation + Postgres overload the runner until the dev server dies
  // (NS_ERROR_CONNECTION_REFUSED / rotating navigation timeouts). 2 is the
  // stable ceiling that still fits the per-browser job timeout.
  // ponytail: 2 CI workers; raise if runners get more cores.
  workers: process.env.CI ? 2 : 4,
  globalSetup: require.resolve('./__tests__/e2e/global-setup'),
  globalTeardown: require.resolve('./__tests__/e2e/global-teardown'),
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 15000,
      threshold: 0.5,
    },
  },
  reporter: [['html'], ['json', { outputFile: 'playwright-report/results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: 'postgres://dev:devpassword@localhost:5432/workmanagement',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
  ],
});
