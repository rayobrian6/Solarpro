import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
    ],
    // Per-file environment overrides: use the @vitest-environment docblock
    // comment at the top of each .test.tsx file that needs jsdom.
    // e.g.: /** @vitest-environment jsdom */
    // These are custom-runner golden test scripts (use their own test() fn,
    // not vitest's describe/it). Run manually: `npx tsx lib/<file>.test.ts`.
    exclude: [
      'node_modules',
      '.next',
      'lib/sld-topology.test.ts',
      'lib/bom-master-task.test.ts',
      'lib/ecoflow.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'lib/**/*.ts',
        'app/api/**/*.ts',
        'components/onboarding/**/*.ts',
        'components/onboarding/**/*.tsx',
      ],
      exclude: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 'server-only' is a Next.js Server Component guard that throws in non-Next.js
      // environments (including Vitest). Mock it as a no-op so tests can import
      // server-side modules (db-ready, db-neon) directly without errors.
      'server-only': path.resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
});
