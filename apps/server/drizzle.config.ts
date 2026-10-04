// drizzle-kit 配置：只用于「根据表定义生成迁移 SQL」（pnpm --filter @weiban/server db:generate）。
// 执行和回滚迁移用我们自己的执行器（src/platform/db/migrator.ts），因为 drizzle-kit 不支持回滚。
// 生成后必须手写同名的 .down.sql 回滚脚本，见 docs/backend/kernel.md「数据库迁移」。
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // 平台内核 + 所有模块的表定义（每个模块 infra/db/schema.ts）
  schema: ['./src/platform/db/schema.ts', './src/modules/*/infra/db/schema.ts'],
  out: './drizzle',
  casing: 'snake_case',
});
