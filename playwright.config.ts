import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the real app, in a real browser, on the in-memory sample
 * account from e2e/harness. Run with `npm run e2e`.
 *
 * The phone project is the one that matters: the app is used mostly on a
 * phone. Desktop runs only the specs that are about a keyboard and a mouse.
 *
 * Every spec fixes the clock (see e2e/fixtures.ts), so "due at 3 p.m. today"
 * means the same thing at any hour the suite runs.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      testIgnore: /\.desktop\.spec\.ts$/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /\.desktop\.spec\.ts$/,
    },
  ],
  webServer: {
    command: 'npx vite --config e2e/harness/vite.config.ts',
    port: 5199,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
