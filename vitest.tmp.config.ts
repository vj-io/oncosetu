import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: 'node', hookTimeout: 120_000, testTimeout: 120_000, include: ['tests/integration/**/*.test.ts'], fileParallelism: false },
})
