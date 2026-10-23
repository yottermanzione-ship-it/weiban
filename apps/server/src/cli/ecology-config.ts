/**
 * 生态决策模型的受控配置入口（只走服务层，不开 HTTP，不打印密钥）。
 *
 *   node dist/ecology-config.js --admin <用户名>                     # 只看现状
 *   node dist/ecology-config.js --admin <用户名> --decision-model jev/jev-1.13.0
 *   node dist/ecology-config.js --admin <用户名> --decision-model ... --apply
 *
 * 不带 --apply 时只做校验与预览，不写库。写入前由服务层核对模型是否在目录、是否上架、是否有价格。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { EcologySettingsService } from '../modules/ai-runtime/index.js';
import { IdentityCommands } from '../modules/identity/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, loadConfig } from '../platform/index.js';

function fail(message: string): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code: message })}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const adminName = read('--admin');
  const decisionModel = read('--decision-model');
  const apply = args.includes('--apply');
  const known = new Set(['--admin', '--decision-model', '--apply']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') continue;
    if (!known.has(args[i]!)) fail('ARGUMENT_INVALID');
    if (!args[i + 1] || args[i + 1]!.startsWith('--')) fail('ARGUMENT_REQUIRED');
    i++;
  }

  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const identity = app.get(IdentityCommands, { strict: false });
    const settings = app.get(EcologySettingsService, { strict: false });
    const adminId = await identity.findAdminId(adminName);
    const before = await settings.adminOverview(adminId);
    const out: Record<string, unknown> = {
      decisionModelBefore: before.config.decisionModelKey || null,
      decisionModelReadyBefore: before.decisionModelReady,
      warningsBefore: before.warnings,
      runsLast24h: before.last24h.runs,
    };
    if (decisionModel) {
      // updateConfig 会核对目录/上架/价格；不带 --apply 时只在内存里验证一遍，不写库。
      if (!apply) {
        out.plannedDecisionModel = decisionModel;
        out.applied = false;
        out.note = '未带 --apply，未写库';
      } else {
        const after = await settings.updateConfig(adminId, {
          ...before.config,
          decisionModelKey: decisionModel,
        });
        out.decisionModelAfter = after.config.decisionModelKey;
        out.decisionModelReadyAfter = after.decisionModelReady;
        out.warningsAfter = after.warnings;
        out.applied = true;
      }
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'ECOLOGY_CONFIG_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
