import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './service-pricing',
  workers: 1,
  timeout: 40_000,
  use: {
    baseURL: 'http://127.0.0.1:5182',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'pnpm --filter @weiban/admin exec vite --host 127.0.0.1 --port 5182 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5182/test/browser-fixtures/service-model.html',
    reuseExistingServer: false,
  },
});
