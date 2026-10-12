/**
 * 预设角色种子（说明见 docs/backend/preset-seed.md）。可重复执行，已存在的同名预设角色跳过。
 *
 *   开发：pnpm seed:presets [-- --admin <管理员用户名>]
 *   生产镜像：node dist/seed-presets.js [--admin <管理员用户名>]
 *
 * 导入 docs/ai/samples 的 6 张样本卡（生成文件 preset-seed/samples.generated.ts）和 3 个日常向原创角色，
 * 以已有管理员身份走 characters 服务层创建、检查、上架。不创建账号、不调用模型。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { seedPresetCharacters } from '../modules/characters/index.js';
import { IdentityCommands } from '../modules/identity/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, loadConfig } from '../platform/index.js';
import { DAILY_PRESETS } from './preset-seed/daily.js';
import { SAMPLE_PRESETS } from './preset-seed/samples.generated.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const adminIndex = args.indexOf('--admin');
  const adminName = adminIndex >= 0 ? args[adminIndex + 1] : undefined;
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const adminId = await app.get(IdentityCommands, { strict: false }).findAdminId(adminName);
    const results = await seedPresetCharacters(app, adminId, [...SAMPLE_PRESETS, ...DAILY_PRESETS]);
    for (const r of results)
      process.stdout.write(
        `${r.outcome.padEnd(9)} ${r.name}${r.characterId ? ` ${r.characterId}` : ''}${r.error ? ` —— ${r.error}` : ''}\n`,
      );
    const failed = results.filter((r) => r.outcome === 'failed').length;
    process.stdout.write(
      `完成：共 ${results.length} 个，失败 ${failed} 个。上架检查为开发放行（审计 preset.seed_check_bypassed）。\n`,
    );
    if (failed > 0) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `预设角色种子失败：${error instanceof Error ? error.message : '未知错误'}\n`,
  );
  process.exitCode = 1;
});
