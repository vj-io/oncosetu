// E2E gates from PRD §13 (V01..V06) against a running server: BASE_URL (default http://localhost:3000).
// Everything runs in the second organisation (Ganga Valley Hospital); Narmada holds the live demo data.
//   npx playwright test                      # all
//   npx playwright test --project=main       # parallel specs (2 workers)
//   npx playwright test --project=webkit     # the Safari subset (needs `npx playwright install webkit`)
//   npx playwright test --project=clock      # tests that move the org clock; they run alone, after `main`
// v05-offline.spec.ts needs a production build (an offline reload never hydrates on `next dev`).
import { defineConfig, devices } from '@playwright/test'
import { BASE } from './tests/e2e/helpers/env'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 240_000, // OCR takes ~20 s per image on the dev server
  expect: { timeout: 20_000 },
  workers: 2,
  fullyParallel: true, // every test registers its own patient, so tests are independent and workers take them one by one
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // channel 'chromium' = the full Chromium build (new headless mode); the separate headless-shell download is not needed.
  use: { channel: process.env.PW_CHANNEL ?? 'chromium', baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 20_000, navigationTimeout: 60_000 },
  projects: [
    { name: 'main', grepInvert: /@clock/, use: { ...devices['Desktop Chrome'] } },
    // PRD §6.8 browser support includes Safari on iOS: the V01 smoke, the patient portal (caregiver upload), the 375 px
    // a11y/responsive pages and the CSP/cookie checks also run in WebKit (`npx playwright install webkit`).
    { name: 'webkit', testMatch: ['v01-foundation.spec.ts', 'v05-caregiver.spec.ts', 'a11y-responsive.spec.ts', 'security-headers.spec.ts'], grepInvert: /@clock/, use: { ...devices['Desktop Safari'], channel: '' } }, // '' clears the Chromium channel set above
    // The org clock is shared by every test in the org, so tests that move it must not overlap with anything else.
    { name: 'clock', grep: /@clock/, workers: 1, dependencies: ['main', 'webkit'], use: { ...devices['Desktop Chrome'] } },
  ],
})
