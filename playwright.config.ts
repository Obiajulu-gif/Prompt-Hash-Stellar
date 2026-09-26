import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests', // Removed the './' prefix which throws off Windows scanning
  testMatch: '**.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Actionable output: html + list + github in CI so failures are immediately visible
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github'], ['list']] : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    // Screenshots + trace on first retry ensure failures produce actionable artifacts
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // Keep tests deterministic and isolated: no shared state, each test gets a fresh context
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev', // Matches this workflow's `npm install` step; `yarn dev` re-triggers Yarn's own install/immutability check under Corepack and fails to start
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  // Deterministic: require explicit environment; do not leak real RPC secrets into mocked runs
  expect: {
    timeout: 8_000,
  },
});