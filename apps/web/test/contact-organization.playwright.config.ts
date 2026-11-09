import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './feedback',
  testMatch: 'contact-organization.spec.ts',
  workers: 1,
  timeout: 35_000,
  outputDir: '../test-results/contact-organization',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    viewport: { width: 390, height: 844 },
    headless: true,
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5198 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5198/test/browser-fixtures/contact-organization.html',
    reuseExistingServer: false,
  },
});
