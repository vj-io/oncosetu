import { defineConfig } from 'vitest/config'

// `npm test` runs the `unit` project only (src/**); `npm run test:integration` needs a live DB.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
    ],
  },
})
