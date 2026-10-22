import { defineConfig } from '@playwright/test';
/** 无数据库的真实组件浏览器开发自测；与完整 HTTP/WS E2E 分开标识。 */
export default defineConfig({
  testDir: './feedback',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    viewport: { width: 390, height: 844 },
    headless: true,
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm --filter @weiban/web exec vite --host 127.0.0.1 --port 5179 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5179/test/browser-fixtures/web-feedback.html',
    reuseExistingServer: false,
  },
});
