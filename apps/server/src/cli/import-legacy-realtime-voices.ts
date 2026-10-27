/**
 * 批 V / V2：旧站实时通话复刻音色迁入（operator-only）。把旧库 character_voice_bindings 里「公共百炼供应商 8eed4824
 * 下的 Omni 3.5 Plus 实时端点 + ready」的绑定写进 model_access.realtime_voice_bindings（只插入没有的，不覆盖已有的）。
 *
 *   node dist/import-legacy-realtime-voices.js --input /abs/realtime-bindings.json --endpoint-id <旧端点完整 ID>
 *   node dist/import-legacy-realtime-voices.js --input /abs/realtime-bindings.json --endpoint-id <旧端点完整 ID> \
 *     --apply --operator-id <管理员 UUID>
 *
 * 输入：scripts/ops/export-realtime-workspace.mjs bindings 的输出（{ bindings: [...] }，字段 character_id / endpoint_id /
 * provider_id / model / voice_id / status）。默认 qwen3.5-omni-plus-realtime → qwen/qwen3.5-omni-plus-realtime。
 * 默认只预演；复刻音色只在创建它的账号有效：私有 workspace（cb9de005 / 8d1b5e3b 及其端点、156）一律拒绝，
 * 行里带 provider_id 时还必须是公共供应商。目标模型必须已在目录里（先跑 voice-catalog）；角色必须已在新库里。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import { ModelAdminService, RealtimeVoiceStore } from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, DATABASE, loadConfig, type Database } from '../platform/index.js';
import {
  parseLegacyRealtimeVoiceCommand,
  planLegacyRealtimeBindings,
} from './voice-catalog-options.js';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function main(): Promise<void> {
  const parsed = parseLegacyRealtimeVoiceCommand(process.argv.slice(2));
  if (!parsed.ok) throw new CliError(parsed.code, parsed.message);
  const command = parsed.command;
  if (!path.isAbsolute(command.input)) throw new CliError('BAD_ARGUMENT', '--input 必须是绝对路径');
  const stat = fs.statSync(command.input, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_INPUT_BYTES)
    throw new CliError('INPUT_INVALID', '--input 不存在或超过 16 MiB');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(command.input, 'utf8'));
  } catch {
    throw new CliError('INPUT_INVALID', '--input 不是合法 JSON');
  }
  const plan = planLegacyRealtimeBindings(raw, command);

  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const database = app.get<Database>(DATABASE, { strict: false });
    const models = await app.get(ModelAdminService, { strict: false }).list();
    const registered = new Set(models.filter((m) => !m.deletedAt).map((m) => m.modelKey));
    const missingModels = Object.keys(plan.byModel).filter((key) => !registered.has(key));
    const ids = [...new Set(plan.rows.map((r) => r.characterId))];
    const { rows: found } = ids.length
      ? await database.query<{ id: string }>(
          'SELECT id::text AS id FROM characters.characters WHERE id = ANY($1::uuid[])',
          [ids],
        )
      : { rows: [] as Array<{ id: string }> };
    const present = new Set(found.map((r) => r.id));
    const rows = plan.rows.filter((r) => present.has(r.characterId) && registered.has(r.modelKey));
    const report = {
      endpointId: command.endpointId,
      offered: plan.rows.length,
      importable: rows.length,
      characterMissing: plan.rows.filter((r) => !present.has(r.characterId)).length,
      missingModels,
      byModel: plan.byModel,
      skipped: plan.skipped,
    };
    if (!command.apply) {
      out({ ok: true, dryRun: true, ...report });
      return;
    }
    if (!(await isActiveMaintenanceAdmin(database, command.operatorId!)))
      throw new CliError('ACTIVE_ADMIN_REQUIRED', '--operator-id 必须是启用状态的管理员用户 ID');
    const inserted = await app
      .get(RealtimeVoiceStore, { strict: false })
      .importLegacy(command.operatorId!, rows);
    out({ ok: true, ...report, inserted, alreadyPresent: rows.length - inserted });
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const payload =
    error instanceof CliError
      ? { ok: false, code: error.code, message: error.message }
      : {
          ok: false,
          code: 'IMPORT_REALTIME_VOICES_FAILED',
          message: error instanceof Error ? error.message : '未知错误',
        };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
