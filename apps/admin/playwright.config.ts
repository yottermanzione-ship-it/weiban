import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @weiban/server exec tsx test/support/admin-browser-app.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @weiban/admin preview --host 127.0.0.1',
      cwd: '../..',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
