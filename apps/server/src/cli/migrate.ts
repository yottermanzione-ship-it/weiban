/**
 * 数据库迁移命令行（在 apps/server 目录运行，pnpm --filter 会自动切换过去）：
 *   pnpm --filter @weiban/server db:migrate          执行所有未执行的迁移
 *   pnpm --filter @weiban/server db:rollback         回滚最近 1 个迁移
 *   pnpm --filter @weiban/server db:rollback -- 3    回滚最近 3 个迁移
 *   pnpm --filter @weiban/server db:status           列出迁移及是否已执行
 * 连接串取 DATABASE_URL（本机从仓库根目录 .env 读取）；迁移目录默认 ./drizzle，可用 MIGRATIONS_DIR 覆盖。
 */
import { resolve } from 'node:path';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { loadConfig } from '../platform/config/config.js';
import { Migrator } from '../platform/db/migrator.js';

async function main(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();
  const dir = resolve(process.env.MIGRATIONS_DIR ?? 'drizzle');
  const migrator = new Migrator(config.database.url, dir, (message) =>
    process.stdout.write(`${message}\n`),
  );
  const [command = 'status', arg] = process.argv.slice(2).filter((a) => a !== '--');
  if (command === 'up') {
    const done = await migrator.up();
    process.stdout.write(
      done.length ? `完成，执行了 ${done.length} 个迁移\n` : '没有需要执行的迁移\n',
    );
  } else if (command === 'down') {
    const steps = arg ? Number.parseInt(arg, 10) : 1;
    if (!Number.isInteger(steps) || steps < 1) throw new Error('回滚步数必须是正整数');
    const done = await migrator.down(steps);
    process.stdout.write(
      done.length ? `完成，回滚了 ${done.length} 个迁移\n` : '没有可回滚的迁移\n',
    );
  } else if (command === 'status') {
    for (const item of await migrator.status()) {
      process.stdout.write(`${item.applied ? '[已执行]' : '[未执行]'} ${item.tag}\n`);
    }
  } else {
    throw new Error(`未知命令 ${command}，可用：up / down [步数] / status`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
