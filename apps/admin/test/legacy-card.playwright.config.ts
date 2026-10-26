import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './legacy-card',
  workers: 1,
  timeout: 40_000,
  use: {
    baseURL: 'http://127.0.0.1:5183',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 1000 },
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'pnpm --filter @weiban/admin exec vite --host 127.0.0.1 --port 5183 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5183/test/browser-fixtures/legacy-card.html',
    reuseExistingServer: false,
  },
});
