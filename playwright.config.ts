import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests', // Removed the './' prefix which throws off Windows scanning
  testMatch: '**.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'yarn dev', // Switched to your native yarn command
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});