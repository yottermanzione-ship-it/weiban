/**
 * 批 V / V2 / V3：旧站实时通话复刻音色迁入（operator-only）。把旧库 character_voice_bindings 里指定可迁端点 + ready 的
 * 绑定写进 model_access.realtime_voice_bindings（只插入没有的，不覆盖已有的）：
 * - V2 公共百炼供应商 8eed4824 下的 Omni 3.5 Plus 端点 → qwen/qwen3.5-omni-plus-realtime；
 * - V3 北京 workspace（供应商 cb9de005、端点 eb3630dd-bfbd-49ea-a460-b542a98eb354）的 qwen-audio-3.0-realtime-plus
 *   → qwen/qwen-audio-3.0-realtime-plus。要求这个条目已用 voice-catalog --attach-workspace 改挂北京 workspace 上游
 *   （复刻音色只在创建它的 workspace 有效），否则拒绝；反过来公共端点的绑定也不能迁到挂北京 workspace 的条目。
 *
 *   node dist/import-legacy-realtime-voices.js --input /abs/realtime-bindings.json --endpoint-id <旧端点完整 ID>
 *   node dist/import-legacy-realtime-voices.js --input /abs/realtime-bindings.json --endpoint-id <旧端点完整 ID> \
 *     --apply --operator-id <管理员 UUID>
 *
 * 输入：scripts/ops/export-realtime-workspace.mjs bindings 的输出（{ bindings: [...] }，字段 character_id / endpoint_id /
 * provider_id / model / voice_id / status）。默认只预演；「156语音」（8d1b5e3b / 6b29cca6 / 156）一律拒绝，行里带
 * provider_id 时必须是该端点对应的供应商。目标模型必须已在目录里（先跑 voice-catalog）；角色必须已在新库里。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  ModelAdminService,
  RealtimeVoiceStore,
  UpstreamService,
} from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, DATABASE, loadConfig, type Database } from '../platform/index.js';
import {
  BEIJING_WORKSPACE_HOST,
  LEGACY_BEIJING_ENDPOINT_ID,
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
    // V3：北京 workspace 的音色只能迁到挂在北京 workspace 上游的条目；其余端点的不能迁到它上面。
    const upstreams = await app.get(UpstreamService, { strict: false }).list();
    const onWorkspace = (modelKey: string) => {
      const model = models.find((m) => m.modelKey === modelKey && !m.deletedAt);
      const upstream = upstreams.find((u) => u.upstreamId === model?.upstreamId);
      try {
        return upstream ? new URL(upstream.baseUrl).hostname === BEIJING_WORKSPACE_HOST : false;
      } catch {
        return false;
      }
    };
    const fromWorkspace = command.endpointId === LEGACY_BEIJING_ENDPOINT_ID;
    const wrongAccount = Object.keys(plan.byModel).filter(
      (key) => registered.has(key) && onWorkspace(key) !== fromWorkspace,
    );
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
      wrongAccount,
      byModel: plan.byModel,
      skipped: plan.skipped,
    };
    if (!command.apply) {
      out({ ok: wrongAccount.length === 0, dryRun: true, ...report });
      return;
    }
    if (wrongAccount.length)
      throw new CliError(
        'UPSTREAM_ACCOUNT_MISMATCH',
        fromWorkspace
          ? `${wrongAccount.join('、')} 还没挂北京 workspace 上游：先跑 voice-catalog --attach-workspace`
          : `${wrongAccount.join('、')} 挂在北京 workspace 上游，不能迁入其他账号的复刻音色`,
      );
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
