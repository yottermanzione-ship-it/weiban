import { defineConfig } from '@playwright/test';
/** 由受控本机Vite夹具服务运行；不启动或连接生产/旧站，不冒充完整业务E2E。 */
export default defineConfig({
  testDir: './feedback',
  testMatch: ['chat-history.spec.ts', 'moments-prices.spec.ts'],
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5189',
    viewport: { width: 390, height: 844 },
    headless: true,
    channel: 'chrome',
  },
});
