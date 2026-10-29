import { defineConfig } from '@playwright/test';
/** Local onboarding interaction preview only; never starts a backend or uses real accounts. */
export default defineConfig({
  testDir: './feedback',
  testMatch: 'onboarding-tour.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: { width: 390, height: 844 },
    headless: true,
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5180 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5180/test/browser-fixtures/onboarding-tour.html',
    reuseExistingServer: true,
  },
});
