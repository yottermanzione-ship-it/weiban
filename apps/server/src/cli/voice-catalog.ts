/**
 * 批 V：语音目录补齐（ASR：TeleSpeech、MiMo；TTS：千问 3.1 Flash；实时通话：千问 Audio Realtime Plus、Omni）。
 * 只走服务层（ModelAdminService.upsert：目录 + 价格 + 计费上限一次写入，写审计），不开 HTTP，不打印密钥。
 *
 *   node dist/voice-catalog.js --show
 *   node dist/voice-catalog.js [--only telespeech,qwen-tts-flash] --realtime-upstream <UUID>   # 预演（默认，不写库）
 *   node dist/voice-catalog.js --apply --operator-id <管理员 UUID> --realtime-upstream <UUID> \
 *     [--enable-realtime] [--enable-unverified] [--tts-flash-cost 1.4] [--realtime-voice Cherry] \
 *     [--omni-model <百炼型号> --omni-cost 文字入,音频入,文字出,音频出 [--omni-voice <音色>]]
 *
 * 上游账号：TeleSpeech / MiMo ASR / 3.1 TTS Flash 不给就沿用 sensevoice / MiMo TTS / 百炼 TTS Plus 所在账号；
 * 实时 / Omni 必须用 --realtime-upstream 指定迁入的私有 workspace 账号（kind 必须是 dashscope）。
 * 价格与默认启用规则见 voice-catalog-options.ts 顶部。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AdminModel, Upstream } from '@weiban/contracts';
import { AppModule } from '../app.module.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  CatalogService,
  ModelAdminService,
  RealtimeVoiceStore,
  UpstreamService,
} from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, DATABASE, loadConfig, type Database } from '../platform/index.js';
import {
  completeWrite,
  parseVoiceCatalogCommand,
  planVoiceCatalog,
  type PlannedEntry,
  type VoiceCatalogCommand,
} from './voice-catalog-options.js';

class VoiceCatalogCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

/** 非敏感摘要：键、名称、启用、场景、标签、价格（元）、上游账号名。 */
function summary(model: AdminModel | undefined, upstreams: readonly Upstream[]) {
  if (!model) return null;
  const upstream = upstreams.find((u) => u.upstreamId === model.upstreamId);
  return {
    modelKey: model.modelKey,
    displayName: model.displayName,
    enabled: model.enabled,
    scenarios: model.scenarios ?? [],
    tags: model.tags,
    upstream: upstream
      ? { name: upstream.name, kind: upstream.kind, status: upstream.status }
      : null,
    rates: model.rates,
    serviceRates: model.serviceRates ?? [],
    available: model.availability?.available ?? null,
  };
}

function resolveUpstream(
  planned: PlannedEntry,
  command: VoiceCatalogCommand,
  models: readonly AdminModel[],
  upstreams: readonly Upstream[],
): { upstreamId: string } | { problem: string } {
  const explicit = command.upstreams[planned.upstream.flag];
  const id =
    explicit ??
    (planned.upstream.reference
      ? models.find((m) => m.modelKey === planned.upstream.reference && !m.deletedAt)?.upstreamId
      : undefined);
  if (!id)
    return {
      problem: planned.upstream.reference
        ? `没有 --${planned.upstream.flag}-upstream，也找不到参考条目 ${planned.upstream.reference}`
        : `需要 --${planned.upstream.flag}-upstream（迁入的私有 workspace 账号）`,
    };
  const upstream = upstreams.find((u) => u.upstreamId === id);
  if (!upstream) return { problem: `上游账号 ${id} 不存在或已删除` };
  if (
    (planned.item === 'qwen-realtime' || planned.item === 'omni') &&
    upstream.kind !== 'dashscope'
  )
    return { problem: `实时通话账号必须是百炼（dashscope），当前是 ${upstream.kind}` };
  if (planned.item === 'qwen-tts-flash' && upstream.kind !== 'dashscope')
    return { problem: `千问 TTS 账号必须是百炼（dashscope），当前是 ${upstream.kind}` };
  return { upstreamId: id };
}

async function run(
  command: VoiceCatalogCommand,
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
) {
  const admin = app.get(ModelAdminService, { strict: false });
  const voices = app.get(RealtimeVoiceStore, { strict: false });
  const upstreams = await app.get(UpstreamService, { strict: false }).list();
  const models = await admin.list();
  const { entries, skipped } = planVoiceCatalog(command);
  const defaults = await voices.defaults();

  if (command.kind === 'show') {
    out({
      ok: true,
      entries: await Promise.all(
        entries.map(async (e) => ({
          item: e.item,
          modelKey: e.modelKey,
          current: summary(
            models.find((m) => m.modelKey === e.modelKey && !m.deletedAt),
            upstreams,
          ),
          ...(e.item === 'qwen-realtime' || e.item === 'omni'
            ? {
                defaultVoice: defaults[e.modelKey] ?? null,
                characterVoices: await voices.count(e.modelKey),
              }
            : {}),
        })),
      ),
      skipped,
    });
    return;
  }

  const prepared = entries.map((planned) => {
    const existing = models.find((m) => m.modelKey === planned.modelKey && !m.deletedAt) ?? null;
    const upstream = resolveUpstream(planned, command, models, upstreams);
    return { planned, existing, upstream };
  });
  const problems = prepared.flatMap((p) =>
    'problem' in p.upstream ? [`${p.planned.modelKey}：${p.upstream.problem}`] : [],
  );
  const preview = prepared.map(({ planned, existing, upstream }) => ({
    item: planned.item,
    modelKey: planned.modelKey,
    action: existing ? 'update' : 'create',
    willBeEnabled: (existing?.enabled ?? false) || planned.enable,
    upstream:
      'upstreamId' in upstream
        ? (upstreams.find((u) => u.upstreamId === upstream.upstreamId)?.name ?? null)
        : null,
    rates: planned.write.rates,
    serviceRates: planned.write.serviceRates,
    billingBounds: planned.write.billingBounds,
    defaultVoice: planned.defaultVoice,
    notes: planned.notes,
  }));
  if (command.kind === 'plan') {
    out({ ok: problems.length === 0, dryRun: true, entries: preview, skipped, problems });
    return;
  }
  if (problems.length)
    throw new VoiceCatalogCliError(
      'UPSTREAM_UNRESOLVED',
      '有条目找不到合适的上游账号，未写入任何内容',
      {
        problems,
      },
    );
  const database = app.get<Database>(DATABASE, { strict: false });
  if (!(await isActiveMaintenanceAdmin(database, command.operatorId!)))
    throw new VoiceCatalogCliError(
      'ACTIVE_ADMIN_REQUIRED',
      '--operator-id 必须是启用状态的管理员用户 ID（写审计用）',
    );
  const written: unknown[] = [];
  for (const { planned, existing, upstream } of prepared) {
    if (!('upstreamId' in upstream)) continue;
    const body = completeWrite(planned, {
      upstreamId: upstream.upstreamId,
      existing: existing
        ? {
            sortOrder: existing.sortOrder,
            leaderboardRank: existing.leaderboardRank,
            enabled: existing.enabled,
          }
        : null,
    });
    const saved = await admin.upsert(command.operatorId!, planned.modelKey, body);
    if (planned.defaultVoice)
      await voices.setDefault(command.operatorId!, planned.modelKey, planned.defaultVoice);
    written.push(summary(saved, upstreams));
  }
  out({
    ok: true,
    written,
    skipped,
    notes: preview.map((p) => ({ modelKey: p.modelKey, notes: p.notes })),
  });
}

async function main(): Promise<void> {
  const parsed = parseVoiceCatalogCommand(process.argv.slice(2));
  if (!parsed.ok) throw new VoiceCatalogCliError(parsed.code, parsed.message);
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    // 确保目录服务已装配（与 voice-call-pipeline 相同的入口约定）。
    app.get(CatalogService, { strict: false });
    await run(parsed.command, app);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const payload =
    error instanceof VoiceCatalogCliError
      ? { ok: false, code: error.code, message: error.message, ...error.details }
      : {
          ok: false,
          code: 'VOICE_CATALOG_FAILED',
          message: error instanceof Error ? error.message : '未知错误',
        };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
