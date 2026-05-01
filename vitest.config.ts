import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts', 'components/**/*.test.ts'],
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
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['node_modules', '.next'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});