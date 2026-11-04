import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../../../apps/admin/test/legacy-card.playwright.config.js';
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'admin-legacy.spec.ts',
  outputDir: './test-results',
  use: { ...base.use, trace: 'off' },
  webServer: {
    ...(base.webServer as object),
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
  },
});
