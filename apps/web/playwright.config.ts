import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @weiban/server exec tsx test/support/browser-app.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @weiban/web preview --host 127.0.0.1',
      cwd: '../..',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
