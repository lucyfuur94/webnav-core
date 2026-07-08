import { defineConfig } from 'vitest/config';

// Opt-in browser e2e suite (npm run test:e2e). Boots a REAL dashboard + drives a
// REAL headless browser against saucedemo — the layer the unit suite mocks away.
// Serial (browser sessions are one-at-a-time), generous timeout (real page loads).
export default defineConfig({
  test: {
    globals: true,
    include: ['tests-e2e/**/*.e2e.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
