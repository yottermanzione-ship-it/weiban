// 仓库根 Vitest 配置：`pnpm test` 一次跑完所有子项目的测试。
// 每个子项目在自己目录放 vitest.config.ts（用 defineProject），这里自动收集。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
    // 空项目（还没有任何测试）时也返回成功
    passWithNoTests: true,
  },
});
