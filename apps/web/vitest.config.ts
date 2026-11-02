import { defineProject } from 'vitest/config';

/** 网页的纯逻辑单元测试（test/*.test.ts）；浏览器测试在 test/e2e 与 test/feedback，由 Playwright 运行。 */
export default defineProject({
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
  },
});
