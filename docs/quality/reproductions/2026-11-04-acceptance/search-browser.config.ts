import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../../../apps/web/playwright.config.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'search-browser.spec.ts',
  outputDir: './test-results',
  use: { ...base.use, trace: 'off' },
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map((x) => ({
    ...x,
    cwd: root,
  })),
});
