import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Real-Postgres integration tests run under vitest.integration.config.ts.
    exclude: [...configDefaults.exclude, 'src/__integration__/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mirror the tsconfig paths so tests that import route modules can
      // resolve the workspace packages (not symlinked under node_modules).
      '@workmanagement/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
