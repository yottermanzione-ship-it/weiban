import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/support/setup-env.ts'],
    // 集成测试共用同一个测试库（TEST_DATABASE_URL），迁移回滚测试会删表重建，
    // 所以测试文件依次运行，不并行。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
