import { defineConfig } from '@playwright/test';
/** Synthetic headless browser only. Every API is in-memory; external requests are blocked. */
export default defineConfig({
  testDir: './feedback',
  testMatch: 'legacy-personas.spec.ts',
  workers: 1,
  timeout: 30_000,
  outputDir: '../test-results/legacy-personas',
  use: {
    baseURL: 'http://127.0.0.1:5197',
    viewport: { width: 390, height: 844 },
    headless: true,
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5197 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5197/test/browser-fixtures/legacy-personas.html',
    reuseExistingServer: false,
  },
});
