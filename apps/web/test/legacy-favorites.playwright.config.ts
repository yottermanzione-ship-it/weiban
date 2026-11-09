import { defineConfig } from '@playwright/test';
/** Fresh headless context, local synthetic fixture only; no production or device session. */
export default defineConfig({
  testDir: './feedback',
  testMatch: 'legacy-favorites.spec.ts',
  workers: 1,
  timeout: 30_000,
  outputDir: '../test-results/legacy-favorites',
  use: {
    baseURL: 'http://127.0.0.1:5193',
    viewport: { width: 390, height: 844 },
    headless: true,
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5193 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5193/test/browser-fixtures/legacy-favorites.html',
    reuseExistingServer: false,
  },
});
