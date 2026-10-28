/**
 * 批 V：语音目录补齐（ASR：TeleSpeech、MiMo；TTS：千问 3.1 Flash；实时通话：千问 Audio Realtime Plus、Omni）。
 * 只走服务层（ModelAdminService.upsert：目录 + 价格 + 计费上限一次写入，写审计），不开 HTTP，不打印密钥。
 *
 *   node dist/voice-catalog.js --show
 *   node dist/voice-catalog.js [--only telespeech,qwen-tts-flash] --realtime-upstream <UUID>   # 预演（默认，不写库）
 *   node dist/voice-catalog.js --apply --operator-id <管理员 UUID> --realtime-upstream <UUID> \
 *     [--enable-realtime] [--enable-unverified] [--tts-flash-cost 1.4] [--realtime-voice Cherry] \
 *     [--omni-model <百炼型号> --omni-cost 文字入,音频入,文字出,音频出 [--omni-voice <音色>]]
 *   node dist/voice-catalog.js --fix-omni [--apply --operator-id <管理员 UUID>]   # V2：只改 Omni 显示名 / 补默认音色
 *   node dist/voice-catalog.js --omni-clone-price [--apply --operator-id <管理员 UUID>]   # V3：Omni 补登记复刻价 0.013
 *   node dist/voice-catalog.js --attach-workspace <北京 workspace 上游 UUID> \
 *     [--workspace-models qwen/qwen-audio-3.0-realtime-plus[,qwen/qwen-audio-3.1-realtime-plus]] [--drop-stale-clones] \
 *     [--apply --operator-id <管理员 UUID>]   # V3：Realtime Plus 路由改挂迁入的北京 workspace
 *
 * 上游账号：TeleSpeech / MiMo ASR / 3.1 TTS Flash / 实时 / Omni 不给就沿用 sensevoice / MiMo TTS / 百炼 TTS Plus
 * 所在账号；V2 起实时通话全部走公共百炼账号（--realtime-upstream 可显式指定，kind 必须是 dashscope）。
 * V3：已有条目重跑时沿用它当前的上游账号（不把已改挂北京 workspace 的条目挂回去），除非显式给 --realtime-upstream 等。
 * 价格与默认启用规则见 voice-catalog-options.ts 顶部。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AdminModelWrite, type AdminModel, type Upstream } from '@weiban/contracts';
import { AppModule } from '../app.module.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  CatalogService,
  ModelAdminService,
  realtimeVoiceCloneCostYuan,
  RealtimeVoiceStore,
  UpstreamService,
} from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, DATABASE, loadConfig, type Database } from '../platform/index.js';
import {
  completeWrite,
  parseVoiceCatalogCommand,
  planOmniClonePrice,
  planOmniFix,
  planVoiceCatalog,
  planWorkspaceAttach,
  REALTIME_ITEMS,
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
  // V3：已有条目沿用当前上游（例 已改挂北京 workspace 的 3.0 Plus），只有显式给了账号才换。
  const current = models.find((m) => m.modelKey === planned.modelKey && !m.deletedAt)?.upstreamId;
  const id =
    explicit ??
    current ??
    (planned.upstream.reference
      ? models.find((m) => m.modelKey === planned.upstream.reference && !m.deletedAt)?.upstreamId
      : undefined);
  if (!id)
    return {
      problem: planned.upstream.reference
        ? `没有 --${planned.upstream.flag}-upstream，也找不到参考条目 ${planned.upstream.reference}`
        : `需要 --${planned.upstream.flag}-upstream（百炼账号 UUID）`,
    };
  const upstream = upstreams.find((u) => u.upstreamId === id);
  if (!upstream) return { problem: `上游账号 ${id} 不存在或已删除` };
  if (REALTIME_ITEMS.includes(planned.item) && upstream.kind !== 'dashscope')
    return { problem: `实时通话账号必须是百炼（dashscope），当前是 ${upstream.kind}` };
  if (planned.item === 'qwen-tts-flash' && upstream.kind !== 'dashscope')
    return { problem: `千问 TTS 账号必须是百炼（dashscope），当前是 ${upstream.kind}` };
  return { upstreamId: id };
}

/**
 * V2 --fix-omni：现有 Omni 实时条目改成带版本的显示名、补已核实的默认音色。只改显示名（rates = null 不改价格，
 * 不传 serviceRates 不改服务单价，其余字段原样写回），经 ModelAdminService.upsert 写审计 catalog.updated；
 * 默认音色经 RealtimeVoiceStore.setDefault 写审计 realtime_voice.default_set。默认只预演。
 */
async function fixOmni(
  command: VoiceCatalogCommand,
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  models: readonly AdminModel[],
  defaults: Readonly<Record<string, string>>,
) {
  const fixes = planOmniFix(models, defaults);
  if (command.kind !== 'apply') {
    out({ ok: true, dryRun: true, fixes });
    return;
  }
  const database = app.get<Database>(DATABASE, { strict: false });
  if (!(await isActiveMaintenanceAdmin(database, command.operatorId!)))
    throw new VoiceCatalogCliError(
      'ACTIVE_ADMIN_REQUIRED',
      '--operator-id 必须是启用状态的管理员用户 ID（写审计用）',
    );
  const admin = app.get(ModelAdminService, { strict: false });
  const voices = app.get(RealtimeVoiceStore, { strict: false });
  const done: unknown[] = [];
  for (const fix of fixes) {
    const current = models.find((m) => m.modelKey === fix.modelKey && !m.deletedAt);
    if (!current) continue;
    if (fix.rename) {
      // 只改显示名：rates = null（不改 token 价），服务单价 / 路由 / 展示倍率 / 折扣都不传（= 不改）；
      // AdminModelWrite 丢弃读出的 updatedAt、可用性等只读字段。
      const body = AdminModelWrite.parse({
        ...current,
        displayName: fix.rename.to,
        rates: null,
        costRates: undefined,
        serviceRates: undefined,
        routes: undefined,
        displayMultiplierManual: undefined,
        discount: undefined,
      });
      await admin.upsert(command.operatorId!, fix.modelKey, body);
    }
    if (fix.defaultVoice)
      await voices.setDefault(command.operatorId!, fix.modelKey, fix.defaultVoice);
    done.push(fix);
  }
  out({ ok: true, fixed: done });
}

type App = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

async function requireAdmin(app: App, operatorId: string) {
  const database = app.get<Database>(DATABASE, { strict: false });
  if (!(await isActiveMaintenanceAdmin(database, operatorId)))
    throw new VoiceCatalogCliError(
      'ACTIVE_ADMIN_REQUIRED',
      '--operator-id 必须是启用状态的管理员用户 ID（写审计用）',
    );
}

/** 只改服务单价 / 路由时的最小写入体：rates = null 不改 token 价，其余可改项不传（= 不改）。 */
function minimalWrite(current: AdminModel, patch: Record<string, unknown>) {
  return AdminModelWrite.parse({
    ...current,
    rates: null,
    costRates: undefined,
    serviceRates: undefined,
    routes: undefined,
    displayMultiplierManual: undefined,
    discount: undefined,
    ...patch,
  });
}

/**
 * V3 --omni-clone-price：现有 Omni 条目补登记复刻价（voice_clone 0.013 / 成本 0.01）。只传这一项服务单价，
 * 经 ModelAdminService.upsert 发布新价目表并写审计（catalog.updated、价目发布）。默认只预演。
 */
async function omniClonePrice(
  command: VoiceCatalogCommand,
  app: App,
  models: readonly AdminModel[],
) {
  const changes = planOmniClonePrice(models);
  if (command.kind !== 'apply') {
    out({ ok: true, dryRun: true, changes });
    return;
  }
  await requireAdmin(app, command.operatorId!);
  const admin = app.get(ModelAdminService, { strict: false });
  for (const change of changes) {
    const current = models.find((m) => m.modelKey === change.modelKey && !m.deletedAt);
    if (!current) continue;
    await admin.upsert(
      command.operatorId!,
      change.modelKey,
      minimalWrite(current, { serviceRates: [change.to] }),
    );
  }
  out({ ok: true, changed: changes });
}

/**
 * V3 --attach-workspace：Realtime Plus 条目改挂迁入的北京 workspace（校验见 planWorkspaceAttach）。正式执行顺序：
 * 1. 上游协议 / 基址修正（UpstreamService.update，审计 upstream.updated；改地址会清空暂停，需要在后台重新测试）；
 * 2. 每个条目的路由整体换成这一个上游（沿用上游型号、核准的 realtime 计费上限、启用状态），审计 catalog.updated /
 *    catalog.routes_replaced；按需复刻因此也走这个上游（媒体网关复刻用目录主线路的账号）；
 * 3. 删掉旧账号上按需复刻的绑定（--drop-stale-clones，审计 realtime_voice.clones_dropped）；
 * 4. 默认音色不合法时改成官方值（审计 realtime_voice.default_set）。
 * 上游的「启用」与连通测试仍由管理员在后台「上游账号」页完成（迁入的账号默认停用）。默认只预演。
 */
async function attachWorkspace(
  command: VoiceCatalogCommand,
  app: App,
  models: readonly AdminModel[],
  upstreams: readonly Upstream[],
  defaults: Readonly<Record<string, string>>,
) {
  const attach = command.attachWorkspace!;
  const voices = app.get(RealtimeVoiceStore, { strict: false });
  const bindings: Record<string, Record<string, number>> = {};
  for (const key of attach.models) bindings[key] = await voices.countBySource(key);
  const upstream = upstreams.find((u) => u.upstreamId === attach.upstreamId) ?? null;
  const plan = planWorkspaceAttach({
    upstream: upstream
      ? {
          upstreamId: upstream.upstreamId,
          name: upstream.name,
          kind: upstream.kind,
          baseUrl: upstream.baseUrl,
          enabled: upstream.enabled,
          status: upstream.status,
        }
      : null,
    modelKeys: attach.models,
    models,
    bindings,
    defaults,
    dropStaleClones: attach.dropStaleClones,
  });
  const nextSteps = [
    '后台「上游账号」页：找到这个账号 → 测试 → 启用（迁入的账号默认停用）',
    '再跑 import-legacy-realtime-voices 迁入北京 workspace 的旧绑定',
  ];
  if (command.kind !== 'apply' || plan.problems.length) {
    out({
      ok: plan.problems.length === 0,
      dryRun: true,
      plan: { ...plan, bindings },
      nextSteps,
    });
    if (plan.problems.length && command.kind === 'apply')
      throw new VoiceCatalogCliError('ATTACH_REJECTED', '有问题未解决，未写入任何内容', {
        problems: plan.problems,
      });
    return;
  }
  if (!('upstream' in plan)) return;
  await requireAdmin(app, command.operatorId!);
  const service = app.get(UpstreamService, { strict: false });
  const admin = app.get(ModelAdminService, { strict: false });
  if (plan.upstream.kind || plan.upstream.baseUrl)
    await service.update(command.operatorId!, attach.upstreamId, {
      ...(plan.upstream.kind ? { kind: plan.upstream.kind.to } : {}),
      ...(plan.upstream.baseUrl ? { baseUrl: plan.upstream.baseUrl.to } : {}),
    });
  const written: unknown[] = [];
  for (const item of plan.models) {
    const current = models.find((m) => m.modelKey === item.modelKey && !m.deletedAt)!;
    const primary = current.routes?.length
      ? [...current.routes].sort((a, b) => a.priority - b.priority)[0]!
      : null;
    const saved = await admin.upsert(
      command.operatorId!,
      item.modelKey,
      minimalWrite(current, {
        upstreamId: attach.upstreamId,
        billingBounds: item.billingBounds,
        routes: [
          {
            upstreamId: attach.upstreamId,
            upstreamModelId: item.upstreamModelId,
            priority: 0,
            weight: 1,
            enabled: primary?.enabled ?? true,
            billingBounds: item.billingBounds,
          },
        ],
      }),
    );
    const dropped =
      item.staleClones > 0 ? await voices.deleteClones(command.operatorId!, item.modelKey) : 0;
    if (item.defaultVoice)
      await voices.setDefault(command.operatorId!, item.modelKey, item.defaultVoice.to);
    written.push({
      ...summary(saved, upstreams),
      droppedClones: dropped,
      defaultVoice: item.defaultVoice,
    });
  }
  out({ ok: true, upstream: plan.upstream, written, nextSteps });
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
          ...(REALTIME_ITEMS.includes(e.item)
            ? {
                defaultVoice: defaults[e.modelKey] ?? null,
                characterVoices: await voices.count(e.modelKey),
              }
            : {}),
        })),
      ),
      skipped,
      // 目录里全部实时 / Omni 条目的音色情况、所在上游、复刻售价（V3 起由用户付；clone 条数 × 成本 ≈ 复刻的供应商成本）。
      realtime: await Promise.all(
        models
          .filter((m) => !m.deletedAt && m.tags.includes('pipeline:rt'))
          .map(async (m) => {
            const bySource = await voices.countBySource(m.modelKey);
            const upstream = upstreams.find((u) => u.upstreamId === m.upstreamId);
            return {
              modelKey: m.modelKey,
              displayName: m.displayName,
              enabled: m.enabled,
              upstream: upstream ? { name: upstream.name, status: upstream.status } : null,
              defaultVoice: defaults[m.modelKey] ?? null,
              characterVoices: bySource,
              clonePriceYuan: m.serviceRates?.find((r) => r.unit === 'voice_clone')?.price ?? null,
              cloneSupplierCostYuan:
                Math.round(
                  (bySource.clone ?? 0) * realtimeVoiceCloneCostYuan(m.upstreamModelId) * 100,
                ) / 100,
            };
          }),
      ),
    });
    return;
  }

  if (command.fixOmni) {
    await fixOmni(command, app, models, defaults);
    return;
  }
  if (command.omniClonePrice) {
    await omniClonePrice(command, app, models);
    return;
  }
  if (command.attachWorkspace) {
    await attachWorkspace(command, app, models, upstreams, defaults);
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
