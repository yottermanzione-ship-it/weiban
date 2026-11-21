/**
 * 管理员 API key 命令行（在 apps/server 目录运行，pnpm --filter 会自动切换过去）。用法：
 *
 *   pnpm --filter @weiban/server admin-api-key create --name muse-closing --created-by <管理员用户名> [--scope role-requests:complete]
 *   pnpm --filter @weiban/server admin-api-key list
 *   pnpm --filter @weiban/server admin-api-key revoke --id <key id>
 *
 * 生产（构建后）：node dist/admin-api-key.js <命令> …
 *
 * create 只在标准输出打印一次明文 key：操作者当场取走存入连接器，绝不写文件、绝不进聊天记录。
 * list / revoke 不输出任何明文。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import {
  AdminApiKeyError,
  AdminApiKeyService,
  CommandError,
  IdentityCommands,
} from '../modules/identity/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import {
  ConfigError,
  createLogger,
  loadConfig,
  SCOPE_ROLE_REQUESTS_COMPLETE,
} from '../platform/index.js';

const USAGE = `用法：
  admin-api-key create --name <用途名> --created-by <管理员用户名> [--scope role-requests:complete]
  admin-api-key list
  admin-api-key revoke --id <key id>`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const keys = app.get(AdminApiKeyService);
    const commands = app.get(IdentityCommands);
    const out = (line: string) => process.stdout.write(`${line}\n`);
    switch (command) {
      case 'create': {
        const name = option(args, '--name');
        const createdByName = option(args, '--created-by');
        const scope = option(args, '--scope') ?? SCOPE_ROLE_REQUESTS_COMPLETE;
        if (!name) throw new CommandError('缺少 --name');
        if (!createdByName) throw new CommandError('缺少 --created-by <管理员用户名>');
        const createdBy = await commands.findAdminId(createdByName);
        const created = await keys.create(name, scope, createdBy);
        // 明文只打印一次：操作者当场取走存入连接器。
        out(`API key（只显示一次，请立即存入连接器，之后无法再查）：${created.key}`);
        out(
          `id ${created.id}，用途 ${created.name}，scope ${created.scope}，前缀 ${created.keyPrefix}`,
        );
        break;
      }
      case 'list': {
        const rows = await keys.list();
        if (!rows.length) {
          out('暂无管理员 API key');
          break;
        }
        for (const row of rows) {
          out(
            `${row.id} | ${row.name} | ${row.scope} | 前缀 ${row.keyPrefix} | 创建 ${row.createdAt.toISOString()} | 最近使用 ${row.lastUsedAt?.toISOString() ?? '从未'} | ${row.revokedAt ? `已作废 ${row.revokedAt.toISOString()}` : '有效'}`,
          );
        }
        break;
      }
      case 'revoke': {
        const id = option(args, '--id');
        if (!id) throw new CommandError('缺少 --id');
        const ok = await keys.revoke(id);
        out(ok ? `已作废 ${id}` : `找不到未作废的 key ${id}`);
        if (!ok) process.exitCode = 2;
        break;
      }
      default:
        throw new CommandError(`未知命令 ${command}\n${USAGE}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof CommandError ||
    error instanceof AdminApiKeyError ||
    error instanceof ConfigError
  ) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
