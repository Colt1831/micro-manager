import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * WM-002 — real-Postgres integration tests.
 *
 * Separate from the mocked unit suite: node environment, no DB mock, and run
 * serially in a single fork so the shared database is never raced across files.
 * Invoked via `pnpm test:integration`, which CI runs after applying migrations.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__integration__/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Workspace package isn't symlinked under node_modules — mirror tsconfig paths.
      '@workmanagement/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
