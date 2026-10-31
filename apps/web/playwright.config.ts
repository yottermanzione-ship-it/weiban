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
    // 首次进入权限引导弹窗（permissions-onboarding）只认本机 localStorage 的
    // permissions-onboarded 标记：全新测试上下文里标记为空，登录后第一次点击即弹
    // 模态弹窗、盖住全屏，导致全套 e2e 点击超时。测试上下文统一按“已完成引导”
    // 预置该标记（与各用例 addInitScript 预置首访标记是同一机制，只是提到配置层，
    // 避免每个用例重复写、避免新用例重蹈）；生产代码一字未动，真机行为不变。
    // 往这里加键前先核对：不得干扰首访断言（如 home-screen-guide-seen 的断言）。
    storageState: 'test/e2e/storage-state.json',
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
    {
      command: 'pnpm --filter @weiban/admin preview --host 127.0.0.1',
      cwd: '../..',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
