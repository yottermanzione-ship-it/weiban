import { defineConfig } from '@playwright/test';
/** 无数据库的真实组件浏览器开发自测；只跑本任务的情景模式用例。 */
export default defineConfig({
  testDir: './feedback',
  testMatch: 'scenario-ui.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5182',
    viewport: { width: 390, height: 844 },
    headless: true,
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5182 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5182/test/browser-fixtures/scenario-ui.html',
    reuseExistingServer: false,
  },
});
