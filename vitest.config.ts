import { defineConfig } from 'vitest/config'

// `npm test` runs the `unit` project only (src/**); `npm run test:integration` needs a live DB.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      // One live database: files run one at a time so erasure / ABDM sweeps and the quota test cannot interfere.
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 60_000 } },
    ],
  },
})
