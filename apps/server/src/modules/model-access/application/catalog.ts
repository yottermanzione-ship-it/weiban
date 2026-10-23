/**
 * 模型目录（billing.md 3.2）：管理员维护（模型键 → 上游 + 上游模型名、能力、标签、默认标记、启用 / 停用），
 * 用户端模型列表（只列启用的），以及给选择 / 状态 / 网关用的查询。
 *
 * 规则：
 * - 无审查模型不能设为生成默认，也不能做平台内部模型（3.25 起不再有「成人内容检查」模型）。
 * - 默认识图模型必须具备 vision 能力；停用的模型不能是默认；
 * - 每种默认最多一个：设新默认时自动从原默认模型上摘掉（同一事务、审计里记下），
 *   所有目录写入经一把事务级咨询锁串行，避免并发设两个默认；
 * - 改指上游、启用 / 停用都写审计；可用性翻转时发 model_access.model_status_changed。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ActiveModelServiceRate,
  AdminCatalogEntry,
  AdminModel,
  BillingModelRatePort,
  ModelCapability,
  ModelInfo,
  ModelRoute,
  ModelScenario,
  ModelUnavailableDetail,
  PlatformInternalUse,
  SystemMessageMode,
  UpstreamStatus,
} from '@weiban/contracts';
import {
  AdminCatalogEntryWrite,
  ModelLeaderboardSource,
  ModelScenarioSettings,
  RouteBillingBounds,
} from '@weiban/contracts';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import {
  hasAdultContent,
  priceTier,
  standardReplyMicros,
  unavailableReason,
} from '../domain/rules.js';
import {
  normalizeArenaName,
  bestArenaRanks,
  relativeRanks,
  type LeaderboardEntry,
} from '../domain/leaderboard.js';
import {
  modelCatalog,
  modelRoutes,
  upstreams,
  scenarioSelections,
  modelAccessSettings,
} from '../infra/db/schema.js';
import {
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_PRICE_SOURCE,
  MODEL_RATE_PORT,
  type ChargeQuery,
  type ModelPriceSource,
} from '../tokens.js';
import { DisplayPricingService } from './display-pricing.js';
import { ChargeQueryUnavailableError } from './defaults.js';
import { parseVoiceCallPipeline, type VoiceCallPipeline } from '../domain/voice-call-pipeline.js';
import {
  checkVoiceCallComponents,
  DEFAULT_DISPLAY_BASE_MODEL_KEY,
  isVoiceCallComposite,
  readVoiceCallPipelineValue,
  serviceRatePrice,
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_SETTING_KEY,
  voiceCallDisplayMultiplier,
  voiceCallFailureDetail,
  type VoiceCallAvailability,
} from './voice-call-composite.js';

type CatalogRow = typeof modelCatalog.$inferSelect;
type CatalogWrite = z.infer<typeof AdminCatalogEntryWrite>;
/** 3.22：场景推荐模型 + 平台内部模型，存在 model_access.settings 的 model_uses（0114 从 default_for 迁移）。 */
export const MODEL_USES_KEY = 'model_uses';
/** 3.24：自动获取 / 粘贴导入的榜单快照（model_access.settings）。 */
export const LEADERBOARD_SNAPSHOT_KEY = 'leaderboard_snapshot';
/**
 * 用户可配置的场景。3.24 起去掉「图片识别」（vision）：图片随文本聊天（私密模式下随私密模式）模型发送，
 * 契约里的 vision 取值只为旧客户端保留。2026-10-22 起 image_generation 也不再是用户场景，角色分享图片不生图。
 */
export const ALL_SCENARIOS: readonly ModelScenario[] = [
  'chat',
  'voice_message',
  'speech_recognition',
  'voice_call',
  'private',
];
/** 文本类场景：用文本模型（按 token 计价，约每条回复）。 */
export const TEXT_SCENARIOS: readonly ModelScenario[] = ['chat', 'voice_call', 'private'];
/** 3.24：要求具备识图能力的场景（用户发的图片随这两个场景的模型发送；后台缺识图能力时提示）。 */
export const VISION_REQUIRED_SCENARIOS: readonly ModelScenario[] = ['chat', 'private'];

/** 3.24：榜单快照（存 settings；失败时只更新 lastAttemptAt / lastError，条目保留上次的）。 */
export interface LeaderboardSnapshot {
  fetchedAt: string | null;
  method: 'fetch' | 'paste' | null;
  sourceUrl: string | null;
  entries: LeaderboardEntry[];
  publishedAt?: string | null;
  totalRows?: number | null;
  previousEntries?: LeaderboardEntry[];
  lastAttemptAt: string | null;
  lastError: string | null;
}

/** 一个模型的当前事实：目录条目（可能不存在）+ 所属上游状态（上游可能已删除）。 */
export interface ModelFacts {
  modelKey: string;
  entry: CatalogRow | null;
  upstreamStatus: UpstreamStatus | null;
  upstreamBaseUrl?: string | null;
  /** 3.24：不可用的具体原因（只在要求时计算：facts(keys, { detail: true })）。 */
  detail?: ModelUnavailableDetail | null;
}

/** 3.24：多条线路都不可用时，报告「离可用最近」的那个原因。 */
const DETAIL_PRIORITY: readonly ModelUnavailableDetail[] = [
  'billing_bounds_paused',
  'billing_bounds_missing',
  'upstream_cooldown',
  'upstream_unavailable',
  'upstream_quota_exhausted',
  'upstream_invalid_key',
  'upstream_disabled',
  'no_route',
];

/** 目录写入串行化的咨询锁键（任意固定数字）。 */
export const CATALOG_LOCK_KEY = 72_270_008;

export function toAdminEntry(row: CatalogRow): AdminCatalogEntry {
  return {
    // 3.23：已删除的行 model_key 已改名，对外仍给原键（历史记录按原键找名字）
    modelKey: row.originalModelKey ?? row.modelKey,
    displayName: row.displayName,
    vendorName: row.vendorName,
    upstreamId: row.upstreamId,
    upstreamModelId: row.upstreamModelId,
    capabilities: row.capabilities as ModelCapability[],
    tags: row.tags,
    leaderboardRank: row.leaderboardRank,
    arenaModelName: row.arenaModelName ?? null,
    sortOrder: row.sortOrder,
    // 3.22：平台默认改为场景推荐 / 平台内部模型（ModelScenarioSettings），这里固定返回空数组。
    defaultFor: [],
    enabled: row.enabled,
    // 3.24：「图片识别」场景已去掉（0119 已清除，防御性过滤）
    scenarios: (row.scenarios as ModelScenario[]).filter((s) => s !== 'vision'),
    systemMessageMode: row.systemMessageMode as SystemMessageMode,
    billingBounds: row.billingBounds,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * 启用目录条目时是否必须先在价目表里有它的 token 价（契约 1.3）。
 * 组合通话模型（`voice/cascade-call` + `pipeline:voice_call`）自身不调用上游、没有 token 单价，
 * 费用由三个组件按真实调用分别计费，所以豁免；其余条目（含没有组合标签的同名条目）照旧要求价格。
 */
export function requiresCatalogPrice(entry: {
  modelKey: string;
  tags: readonly string[];
}): boolean {
  return !isVoiceCallComposite(entry);
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MODEL_PRICE_SOURCE) private readonly prices: ModelPriceSource,
    @Inject(MODEL_ACCESS_CHARGE_QUERY) private readonly charges: ChargeQuery,
    @Optional() @Inject(DisplayPricingService) private readonly display?: DisplayPricingService,
    // ADR-20261024：组合通话模型的展示倍率需要语音 / 识别的服务单价（billing 价目表）。
    @Optional() @Inject(MODEL_RATE_PORT) private readonly rates?: BillingModelRatePort,
  ) {}

  // ---------- 3.22 场景推荐模型 / 平台内部模型 ----------

  async modelUses(): Promise<ModelScenarioSettings> {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, MODEL_USES_KEY));
    const parsed = ModelScenarioSettings.safeParse(row?.value);
    if (!parsed.success) return { recommended: {}, internal: {} };
    // 3.24：图片识别场景已去掉；3.25：成人内容检查模型不再使用
    const {
      vision: _vision,
      image_generation: _imageGeneration,
      ...recommended
    } = parsed.data.recommended;
    const { adult_check: _adultCheck, ...internal } = parsed.data.internal;
    return { recommended, internal };
  }

  /**
   * 修改推荐 / 内部模型（只改传了的键）。推荐模型须启用且标注可用于该场景；内部模型须启用、不能是无审查模型。
   * 3.25：adult_check（成人内容检查）不再使用，忽略写入。返回修改后的完整设置。
   */
  async setModelUses(
    operatorUserId: string,
    input: ModelScenarioSettings,
  ): Promise<ModelScenarioSettings> {
    const current = await this.modelUses();
    const next: ModelScenarioSettings = {
      recommended: { ...current.recommended },
      internal: { ...current.internal },
    };
    for (const [scenario, key] of Object.entries(input.recommended) as [
      ModelScenario,
      string | null | undefined,
    ][]) {
      // 3.24：图片识别场景已去掉，忽略写入
      if (key === undefined || !ALL_SCENARIOS.includes(scenario)) continue;
      if (key !== null) {
        const f = await this.fact(key);
        if (!f.entry?.enabled || !f.entry.scenarios.includes(scenario))
          throw new AppError('bad_request', `推荐模型 ${key} 未启用或没有勾选可用于这个场景`, {
            status: 422,
            details: { field: `recommended.${scenario}` },
          });
        if (scenario !== 'private' && hasAdultContent(f.entry.capabilities))
          throw new AppError('model_not_allowed', '无审查模型只能推荐给私密模式', { status: 422 });
      }
      next.recommended[scenario] = key;
    }
    for (const [use, key] of Object.entries(input.internal) as [
      PlatformInternalUse,
      string | null | undefined,
    ][]) {
      if (key === undefined || use === 'adult_check') continue;
      if (key !== null) {
        const f = await this.fact(key);
        if (!f.entry?.enabled)
          throw new AppError('bad_request', `平台内部模型 ${key} 不存在或未启用`, {
            status: 422,
            details: { field: `internal.${use}` },
          });
        if (hasAdultContent(f.entry.capabilities))
          throw new AppError('model_not_allowed', '无审查模型不能做平台内部模型', {
            status: 422,
          });
      }
      next.internal[use] = key;
    }
    await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db
        .insert(modelAccessSettings)
        .values({ key: MODEL_USES_KEY, value: next, updatedAt: now, updatedBy: operatorUserId })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: next, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'model_uses.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model_settings',
          targetId: null,
          details: { before: current, after: next },
        },
        tx,
      );
    });
    return next;
  }

  // ---------- 组合通话模型（ADR-20261024） ----------

  /** 读 `model_access.settings.voice_call_pipeline`；严格校验，非法（含未知字段 / 重复组件）= 未配置。 */
  async voiceCallPipeline(): Promise<VoiceCallPipeline | null> {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, VOICE_CALL_PIPELINE_SETTING_KEY));
    return readVoiceCallPipelineValue(row?.value);
  }

  /**
   * 保存组合关系。只校验结构（三个不同且合法的模型键），不要求组件此刻已上架：
   * 允许先配关系、再逐个上模型；运行时逐项判断并给出不可用原因。
   */
  async setVoiceCallPipeline(operatorUserId: string, raw: unknown): Promise<VoiceCallPipeline> {
    const parsed = parseVoiceCallPipeline(raw);
    if (!parsed.ok)
      throw new AppError(
        'bad_request',
        parsed.error === 'pipeline_duplicate_components'
          ? '识别、文本、合成不能选同一个模型'
          : '语音通话组合模型设置格式不正确：需要 asrModelKey / textModelKey / ttsModelKey 三个合法模型键',
        { status: 422, details: { field: VOICE_CALL_PIPELINE_SETTING_KEY, error: parsed.error } },
      );
    if (
      [parsed.value.asrModelKey, parsed.value.textModelKey, parsed.value.ttsModelKey].includes(
        VOICE_CALL_CASCADE_MODEL_KEY,
      )
    )
      throw new AppError('bad_request', '组合模型不能把自己作为组件', { status: 422 });
    const before = await this.voiceCallPipeline();
    await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db
        .insert(modelAccessSettings)
        .values({
          key: VOICE_CALL_PIPELINE_SETTING_KEY,
          value: parsed.value,
          updatedAt: now,
          updatedBy: operatorUserId,
        })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: parsed.value, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'voice_call_pipeline.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model_access_settings',
          targetId: null,
          details: { before, after: parsed.value },
        },
        tx,
      );
    });
    return parsed.value;
  }

  /** 目录里的组合模型条目（固定模型键 + `pipeline:voice_call` 标签）；没有为 null。 */
  async voiceCallCompositeFact(): Promise<ModelFacts | null> {
    const facts = await this.fact(VOICE_CALL_CASCADE_MODEL_KEY);
    return isVoiceCallComposite(facts.entry) ? facts : null;
  }

  /** 组合模型的平台级可用性：三个组件都启用且上游正常才算可用（与某个用户是否选它无关）。 */
  async voiceCallAvailability(): Promise<VoiceCallAvailability> {
    const pipeline = await this.voiceCallPipeline();
    if (!pipeline) return { available: false, failure: { reason: 'pipeline_unconfigured' } };
    const facts = await this.facts([
      pipeline.asrModelKey,
      pipeline.textModelKey,
      pipeline.ttsModelKey,
    ]);
    const checked = checkVoiceCallComponents(pipeline, {
      asr: facts.get(pipeline.asrModelKey),
      text: facts.get(pipeline.textModelKey),
      tts: facts.get(pipeline.ttsModelKey),
    });
    return checked.ok
      ? { available: true, pipeline }
      : { available: false, failure: checked.failure };
  }

  /**
   * 组合模型的展示倍率：每分钟约 3 积分的混合口径（识别 1 分钟 + 合成约 68 字 + 文本约 6 轮），
   * 相对基准模型（默认 openai/gpt-6.1-sol，后台可另设）的同一分钟口径。任何一项价格缺失 = null。
   */
  async voiceCallCompositeDisplayMultiplier(): Promise<number | null> {
    const pipeline = await this.voiceCallPipeline();
    if (!pipeline) return null;
    const settings = (await this.display?.getSettings()) ?? { baseModelKey: null };
    const baseModelKey = settings.baseModelKey ?? DEFAULT_DISPLAY_BASE_MODEL_KEY;
    const serviceRates: ReadonlyMap<string, readonly ActiveModelServiceRate[]> =
      (await this.rates?.getActiveServiceRates?.([pipeline.asrModelKey, pipeline.ttsModelKey])) ??
      new Map();
    const prices = await this.prices.textPrices([pipeline.textModelKey, baseModelKey]);
    return voiceCallDisplayMultiplier({
      asrPerMinuteMicros: serviceRatePrice(serviceRates, pipeline.asrModelKey, 'asr_minute'),
      ttsPer10kCharsMicros: serviceRatePrice(serviceRates, pipeline.ttsModelKey, 'tts_10k_chars'),
      text: prices.get(pipeline.textModelKey),
      base: prices.get(baseModelKey),
    });
  }

  /** 场景推荐模型（只用于「一键选推荐」与管理员自己的 admin_* 调用；只算启用的）。 */
  async recommendedModel(scenario: ModelScenario): Promise<ModelFacts | null> {
    const key = (await this.modelUses()).recommended[scenario];
    return key ? this.enabledFact(key) : null;
  }

  /** 平台内部模型（安全检查、小V、平台内容、行为规划、联网搜索；只算启用的）。 */
  async internalModel(use: PlatformInternalUse): Promise<ModelFacts | null> {
    const key = (await this.modelUses()).internal[use];
    return key ? this.enabledFact(key) : null;
  }

  private async enabledFact(key: string): Promise<ModelFacts | null> {
    const f = await this.fact(key);
    return f.entry?.enabled ? f : null;
  }

  // ---------- 管理后台 ----------
  async leaderboardSource() {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, 'leaderboard_source'));
    const source = ModelLeaderboardSource.safeParse(row?.value);
    return source.success
      ? source.data
      : { label: 'Arena', url: 'https://arena.ai/leaderboard/chat/text', asOf: null };
  }
  async setLeaderboardSource(operatorUserId: string, input: unknown) {
    const source = ModelLeaderboardSource.parse(input);
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(modelAccessSettings)
        .values({
          key: 'leaderboard_source',
          value: source,
          updatedAt: this.clock.now(),
          updatedBy: operatorUserId,
        })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: source, updatedAt: this.clock.now(), updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model-access',
          action: 'leaderboard_source.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model_settings',
          targetId: null,
        },
        tx,
      );
    });
    return source;
  }
  /** 3.24：榜单快照（没有为 null）。 */
  async leaderboardSnapshot(): Promise<LeaderboardSnapshot | null> {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, LEADERBOARD_SNAPSHOT_KEY));
    const value = row?.value as Partial<LeaderboardSnapshot> | undefined;
    if (!value || typeof value !== 'object') return null;
    return {
      fetchedAt: typeof value.fetchedAt === 'string' ? value.fetchedAt : null,
      method: value.method === 'fetch' || value.method === 'paste' ? value.method : null,
      sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
      entries: Array.isArray(value.entries)
        ? value.entries.filter(
            (e): e is { name: string; rank: number } =>
              !!e && typeof e.name === 'string' && Number.isInteger(e.rank) && e.rank > 0,
          )
        : [],
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
      totalRows: typeof value.totalRows === 'number' ? value.totalRows : null,
      previousEntries: Array.isArray(value.previousEntries)
        ? value.previousEntries.filter(
            (e) => e && typeof e.name === 'string' && Number.isInteger(e.rank) && e.rank > 0,
          )
        : [],
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : null,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
    };
  }

  /**
   * 3.24：查原榜名次。默认用模型自己的名字（显示名 → 上游模型名）匹配，不再要求管理员逐条填
   * 「榜单对应名称」；只有后台手动指定的例外（arenaModelName）才优先。
   */
  async arenaRanks(): Promise<{
    rankOf(name: string | null | undefined): number | null;
    rankOfEntry(entry: {
      arenaModelName?: string | null;
      displayName: string;
      upstreamModelId: string;
    }): number | null;
    previousRankOf(name: string | null | undefined): number | null;
    previousRankOfEntry(entry: {
      arenaModelName?: string | null;
      displayName: string;
      upstreamModelId: string;
    }): number | null;
  }> {
    const snapshot = await this.leaderboardSnapshot();
    const byName = bestArenaRanks(snapshot?.entries ?? []);
    const previous = bestArenaRanks(snapshot?.previousEntries ?? []);
    const rankOf = (name: string | null | undefined) =>
      name ? (byName.get(normalizeArenaName(name)) ?? null) : null;
    const previousRankOf = (name: string | null | undefined) =>
      name ? (previous.get(normalizeArenaName(name)) ?? null) : null;
    const rankOfEntry = (entry: {
      arenaModelName?: string | null;
      displayName: string;
      upstreamModelId: string;
    }) =>
      rankOf(entry.arenaModelName) ?? rankOf(entry.displayName) ?? rankOf(entry.upstreamModelId);
    const previousRankOfEntry = (entry: {
      arenaModelName?: string | null;
      displayName: string;
      upstreamModelId: string;
    }) =>
      previousRankOf(entry.arenaModelName) ??
      previousRankOf(entry.displayName) ??
      previousRankOf(entry.upstreamModelId);
    return { rankOf, rankOfEntry, previousRankOf, previousRankOfEntry };
  }

  async leaderboardInfo() {
    const configured = await this.leaderboardSource();
    // 官方发布日期与抓取时间分开，不以抓取日期冒充榜单日期。
    const snapshot = configured ? await this.leaderboardSnapshot() : null;
    const source =
      configured && snapshot?.fetchedAt && snapshot.entries.length
        ? { ...configured, asOf: snapshot.publishedAt ?? null }
        : configured;
    const popular = await this.database.db
      .select({
        modelKey: scenarioSelections.modelKey,
        users: sql<number>`cast(count(*) as integer)`,
      })
      .from(scenarioSelections)
      .where(eq(scenarioSelections.scenario, 'chat'))
      .groupBy(scenarioSelections.modelKey);
    return {
      source,
      popular,
      fetchedAt: snapshot?.fetchedAt ?? null,
      method: snapshot?.method ?? null,
      lastError: snapshot?.lastError ?? null,
    };
  }

  /** 后台目录（含停用的；3.23 起也含已删除的，deletedAt 非空，排在最后）。 */
  async adminList(): Promise<AdminCatalogEntry[]> {
    const rows = await this.database.db
      .select()
      .from(modelCatalog)
      .orderBy(
        sql`${modelCatalog.deletedAt} is not null`,
        asc(modelCatalog.sortOrder),
        asc(modelCatalog.modelKey),
      );
    return rows.map(toAdminEntry);
  }

  async upsert(adminId: string, pathKey: string, raw: CatalogWrite): Promise<AdminCatalogEntry> {
    this.validateBillingBounds(raw.billingBounds);
    // 3.24：没带核对时间的计费上限记为保存时刻
    const body = { ...raw, billingBounds: this.stampBounds(raw.billingBounds) };
    if (pathKey !== body.modelKey) {
      throw new AppError('bad_request', '路径里的模型键与请求体不一致');
    }
    const capabilities = [...new Set(body.capabilities)];
    // 3.22：default_for 不再使用（改为场景推荐 / 平台内部模型），写入时一律清空，忽略请求里的值。
    const defaultFor: string[] = [];
    const tags = [...new Set(body.tags)];
    // 3.24：「图片识别」场景已去掉（旧后台传了也忽略）；文本聊天 / 私密模式模型缺识图能力只在后台提示，不拒绝保存。
    const scenarios = body.scenarios?.filter((s) => s !== 'vision');

    // 组合通话模型自身不调用上游、没有 token 单价（三组件各自计费），启用时不要求自己的价格。
    if (body.enabled && requiresCatalogPrice({ modelKey: body.modelKey, tags }))
      await this.requirePrice(body.modelKey);

    return this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      const [before] = await tx.db
        .select()
        .from(modelCatalog)
        .where(eq(modelCatalog.modelKey, body.modelKey))
        .for('update');
      const upstreamChanged = !before || before.upstreamId !== body.upstreamId;
      const [upstream] = await tx.db
        .select({ status: upstreams.status })
        .from(upstreams)
        .where(and(eq(upstreams.id, body.upstreamId), isNull(upstreams.deletedAt)))
        .for('share');
      if (!upstream && (body.enabled || upstreamChanged)) {
        throw new AppError('bad_request', '指定的上游不存在', { status: 422 });
      }
      const beforeStatus = before ? await this.upstreamStatusOf(tx, before.upstreamId) : null;

      const now = this.clock.now();
      const values = {
        modelKey: body.modelKey,
        displayName: body.displayName,
        vendorName: body.vendorName,
        upstreamId: body.upstreamId,
        upstreamModelId: body.upstreamModelId,
        capabilities,
        tags,
        leaderboardRank: body.leaderboardRank,
        // 3.24：不传 = 保持原值
        arenaModelName:
          body.arenaModelName === undefined
            ? (before?.arenaModelName ?? null)
            : body.arenaModelName?.trim() || null,
        sortOrder: body.sortOrder,
        defaultFor,
        enabled: body.enabled,
        scenarios: [...new Set(scenarios ?? before?.scenarios.filter((s) => s !== 'vision') ?? [])],
        // v3.6：不传 = 保持原值（旧后台页面不认识这个字段）
        systemMessageMode: body.systemMessageMode ?? before?.systemMessageMode ?? 'multi',
        billingBounds:
          body.billingBounds !== undefined
            ? body.billingBounds
            : before?.upstreamId === body.upstreamId &&
                before.upstreamModelId === body.upstreamModelId
              ? before.billingBounds
              : null,
        updatedAt: now,
      };
      const [row] = before
        ? await tx.db
            .update(modelCatalog)
            .set(values)
            .where(eq(modelCatalog.modelKey, body.modelKey))
            .returning()
        : await tx.db
            .insert(modelCatalog)
            .values({ ...values, createdAt: now })
            .returning();
      if (!row) throw new Error('数据库没有返回写入的行');
      if (upstream)
        await this.syncPrimaryRoute(
          tx,
          row.modelKey,
          row.upstreamId,
          row.upstreamModelId,
          body.billingBounds,
        );

      await this.audit.record(
        {
          module: 'model_access',
          action: before ? 'catalog.updated' : 'catalog.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model',
          targetId: body.modelKey,
          details: {
            upstreamId: body.upstreamId,
            upstreamModelId: body.upstreamModelId,
            ...(before && before.upstreamId !== body.upstreamId
              ? { upstreamChangedFrom: before.upstreamId }
              : {}),
            ...(before && before.upstreamModelId !== body.upstreamModelId
              ? { upstreamModelChangedFrom: before.upstreamModelId }
              : {}),
            ...(before && before.enabled !== body.enabled ? { enabledChanged: body.enabled } : {}),
            capabilities,
            scenarios: scenarios ?? before?.scenarios ?? [],
            ...(body.arenaModelName !== undefined ? { arenaModelName: body.arenaModelName } : {}),
          },
        },
        tx,
      );

      if (before) {
        const wasReason = unavailableReason(before, beforeStatus);
        const isReason = unavailableReason(row, (upstream?.status as UpstreamStatus) ?? null);
        if ((wasReason === null) !== (isReason === null)) {
          await this.outbox.publish(tx, 'model_access.model_status_changed', 'model_access', {
            modelKey: row.modelKey,
            available: isReason === null,
            reason: isReason ?? 'recovered',
          });
        }
      }
      return toAdminEntry(row);
    });
  }

  // ---------- 用户端 ----------

  async listModels(capability?: string, scenario?: ModelScenario): Promise<ModelInfo[]> {
    // 3.24：图片识别场景已去掉；旧客户端按它筛选时给能识图的文本聊天模型
    if (scenario === 'vision') {
      scenario = 'chat';
      capability ??= 'vision';
    }
    const rows = await this.database.db
      .select({
        entry: modelCatalog,
        upstreamStatus: upstreams.status,
      })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(eq(modelCatalog.enabled, true))
      .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.modelKey));
    const visible0 = rows.filter(
      (r) =>
        (!capability || r.entry.capabilities.includes(capability)) &&
        (!scenario || r.entry.scenarios.includes(scenario)),
    );
    const routed = await this.routeStatus(visible0.map((r) => r.entry.modelKey));
    const visible = visible0.map((r) => ({
      ...r,
      upstreamStatus: routed.get(r.entry.modelKey) ?? r.upstreamStatus,
    }));
    const prices = await this.prices.textPrices(visible.map((r) => r.entry.modelKey));
    // 3.17：约每条积分按最近 7 天平均实扣（不足时按默认假设）+ 展示倍率；未装配时退回 v3.3 标准回复估算
    const display = await this.display?.forModels(
      visible.map((r) => r.entry.modelKey),
      prices,
    );
    const perReply = (key: string) => {
      const d = display?.get(key);
      if (d) return d.pointsPerReply;
      const p = prices.get(key);
      return p ? Math.round(standardReplyMicros(p) / 100) / 100 : null;
    };
    // 组合通话模型自身没有上游 / token 价：倍率由三组件价格折算，可用性由三组件共同决定。
    const compositeVisible = visible.some((r) => isVoiceCallComposite(r.entry));
    const voiceCall = compositeVisible
      ? {
          displayMultiplier: await this.voiceCallCompositeDisplayMultiplier(),
          availability: await this.voiceCallAvailability(),
        }
      : null;
    // 榜单名次只从有效快照匹配（手动指定优先，否则用模型显示名 / 上游模型名），未匹配为 null，
    // 不再用旧手填名次兜底；在本次返回的列表里按相对顺序重新编号 1..N（不显示原榜名次）。
    const details = await this.availabilityDetails(visible.map((r) => r.entry.modelKey));
    const arena = await this.arenaRanks();
    const relative = relativeRanks(
      visible.map(({ entry }) => ({
        key: entry.modelKey,
        rank: arena.rankOfEntry(entry),
      })),
    );
    const previous = relativeRanks(
      visible.map(({ entry }) => ({
        key: entry.modelKey,
        rank: arena.previousRankOfEntry(entry),
      })),
    );
    return visible.map(({ entry, upstreamStatus }) => {
      const composite = isVoiceCallComposite(entry);
      const d = display?.get(entry.modelKey);
      // 后台手填倍率优先；组合模型没有自己的 token 价，自动值来自三组件分钟口径。
      const manualMultiplier = d?.displayMultiplierManual ?? entry.displayMultiplier ?? null;
      const displayMultiplier =
        manualMultiplier ??
        (composite ? (voiceCall?.displayMultiplier ?? null) : (d?.displayMultiplier ?? null));
      const reason = unavailableReason(entry, (upstreamStatus as UpstreamStatus | null) ?? null);
      const detail =
        details.get(entry.modelKey) ?? (reason === 'model_removed' ? 'model_removed' : null);
      const availability = composite
        ? voiceCall
          ? voiceCall.availability.available
            ? { available: true, unavailableDetail: null }
            : {
                available: false,
                unavailableDetail: voiceCallFailureDetail(voiceCall.availability.failure),
              }
          : { available: false, unavailableDetail: 'no_route' as const }
        : { available: reason === null && !detail, unavailableDetail: detail };
      return {
        modelKey: entry.modelKey,
        displayName: entry.displayName,
        vendorName: entry.vendorName,
        priceTier: priceTier(prices.get(entry.modelKey)),
        pointsPerReply: perReply(entry.modelKey),
        ...(d
          ? {
              pointsPerReplyBasis: d.pointsPerReplyBasis,
              displayMultiplier,
              discount: d.discount,
              pointsPerUse: d.pointsPerUse,
            }
          : composite
            ? { displayMultiplier }
            : {}),
        scenarios: (entry.scenarios as ModelScenario[]).filter((s) => ALL_SCENARIOS.includes(s)),
        capabilities: entry.capabilities as ModelCapability[],
        tags: entry.tags,
        leaderboardRank: relative.get(entry.modelKey) ?? null,
        leaderboardChange:
          relative.has(entry.modelKey) && previous.has(entry.modelKey)
            ? previous.get(entry.modelKey)! - relative.get(entry.modelKey)!
            : null,
        ...availability,
      };
    });
  }

  /**
   * 3.24：模型「暂时无法使用」的具体原因（null = 可用）。逐条线路看：上游账号启用与状态（密钥无效 / 余额不足 /
   * 被健康检查暂停 / 连续失败短暂暂停）、计费上限（缺失 / 用量核对未通过已暂停）；有一条线路全部正常再看价目表有没有价格。
   * 都不行时报告「离可用最近」的原因（DETAIL_PRIORITY）。没有线路的旧模型按目录上的主上游与计费上限判断。
   */
  async availabilityDetails(
    modelKeys: readonly string[],
  ): Promise<Map<string, ModelUnavailableDetail | null>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelUnavailableDetail | null>();
    if (!keys.length) return out;
    const entries = await this.database.db
      .select()
      .from(modelCatalog)
      .where(inArray(modelCatalog.modelKey, keys));
    const routeRows = await this.database.db
      .select({ route: modelRoutes, upstream: upstreams })
      .from(modelRoutes)
      .leftJoin(upstreams, eq(upstreams.id, modelRoutes.upstreamId))
      .where(inArray(modelRoutes.modelKey, keys));
    const primaryIds = [...new Set(entries.map((e) => e.upstreamId))];
    const primaries = primaryIds.length
      ? await this.database.db.select().from(upstreams).where(inArray(upstreams.id, primaryIds))
      : [];
    let priced: Set<string> | null;
    try {
      priced = new Set(await this.charges.listActivePricedModelKeys());
    } catch {
      priced = null; // 价目表暂时查不到：不据此判定
    }
    const now = this.clock.nowMs();
    const judge = (
      routeEnabled: boolean,
      upstream: typeof upstreams.$inferSelect | null | undefined,
      bounds: unknown,
    ): ModelUnavailableDetail | null => {
      const parsed = RouteBillingBounds.safeParse(bounds);
      const paused = parsed.success && parsed.data.pauseReason === 'usage_unknown';
      if (!routeEnabled) return paused ? 'billing_bounds_paused' : 'no_route';
      if (!upstream || upstream.deletedAt || !upstream.enabled) return 'upstream_disabled';
      if (upstream.status === 'invalid') return 'upstream_invalid_key';
      if (upstream.status === 'quota_exhausted') return 'upstream_quota_exhausted';
      if (upstream.status !== 'active') return 'upstream_unavailable';
      if (upstream.cooldownUntil && upstream.cooldownUntil.getTime() > now)
        return 'upstream_cooldown';
      if (paused) return 'billing_bounds_paused';
      if (
        !parsed.success ||
        (parsed.data.checkedAt !== undefined && Date.parse(parsed.data.checkedAt) > now)
      )
        return 'billing_bounds_missing';
      return null;
    };
    for (const key of keys) {
      const entry = entries.find((e) => e.modelKey === key);
      if (!entry || !entry.enabled || entry.deletedAt) {
        out.set(key, 'model_removed');
        continue;
      }
      const mine = routeRows.filter((r) => r.route.modelKey === key);
      const results = mine.length
        ? mine.map((r) => judge(r.route.enabled, r.upstream, r.route.billingBounds))
        : [
            judge(
              true,
              primaries.find((u) => u.id === entry.upstreamId),
              entry.billingBounds,
            ),
          ];
      if (results.some((r) => r === null)) {
        out.set(key, priced && !priced.has(key) ? 'price_missing' : null);
        continue;
      }
      out.set(key, DETAIL_PRIORITY.find((d) => results.includes(d)) ?? results[0] ?? 'no_route');
    }
    return out;
  }

  // ---------- 查询（选择、状态、网关） ----------

  /** 一批模型键的当前事实（不存在的键 entry 为 null）。 */
  async facts(
    modelKeys: readonly string[],
    options: { detail?: boolean } = {},
  ): Promise<Map<string, ModelFacts>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelFacts>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select({
        entry: modelCatalog,
        upstreamStatus: upstreams.status,
        upstreamBaseUrl: upstreams.baseUrl,
      })
      .from(modelCatalog)
      .leftJoin(upstreams, eq(upstreams.id, modelCatalog.upstreamId))
      .where(inArray(modelCatalog.modelKey, keys));
    for (const key of keys) out.set(key, { modelKey: key, entry: null, upstreamStatus: null });
    const routed = await this.routeStatus(rows.map((r) => r.entry.modelKey));
    for (const r of rows) {
      out.set(r.entry.modelKey, {
        modelKey: r.entry.modelKey,
        entry: r.entry,
        upstreamStatus:
          routed.get(r.entry.modelKey) ?? (r.upstreamStatus as UpstreamStatus | null) ?? null,
        upstreamBaseUrl: r.upstreamBaseUrl,
      });
    }
    if (options.detail) {
      const details = await this.availabilityDetails(keys);
      for (const [key, f] of out) out.set(key, { ...f, detail: details.get(key) ?? null });
    }
    return out;
  }

  // ---------- v3.4 模型路由（一个模型 → 多个上游账号） ----------

  /**
   * 按路由算模型可用性：有任一启用路由指向「启用且状态正常」的账号 → active，否则 unavailable。
   * 没有路由的模型不在结果里（调用方沿用主上游状态）。暂停（cooldown）是短暂的，不算模型不可用。
   */
  async routeStatus(modelKeys: readonly string[]): Promise<Map<string, UpstreamStatus>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, UpstreamStatus>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select({
        modelKey: modelRoutes.modelKey,
        up: sql<boolean>`bool_or(${modelRoutes.enabled} and ${upstreams.enabled} and ${upstreams.status} = 'active')`,
      })
      .from(modelRoutes)
      .innerJoin(upstreams, eq(upstreams.id, modelRoutes.upstreamId))
      .where(inArray(modelRoutes.modelKey, keys))
      .groupBy(modelRoutes.modelKey);
    for (const r of rows) out.set(r.modelKey, r.up ? 'active' : 'unavailable');
    return out;
  }

  /** 一批模型的路由（按优先级升序、权重降序）。 */
  async routes(modelKeys: readonly string[]): Promise<Map<string, ModelRoute[]>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelRoute[]>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select()
      .from(modelRoutes)
      .where(inArray(modelRoutes.modelKey, keys))
      .orderBy(asc(modelRoutes.priority), sql`${modelRoutes.weight} desc`);
    for (const r of rows) {
      const list = out.get(r.modelKey) ?? [];
      list.push({
        upstreamId: r.upstreamId,
        upstreamModelId: r.upstreamModelId,
        billingBounds: r.billingBounds,
        priority: r.priority,
        weight: r.weight,
        enabled: r.enabled,
      });
      out.set(r.modelKey, list);
    }
    return out;
  }

  /** 3.26（G3-2）：各模型最近连续没返回用量的线路（后台提示；计数 > 0 才列出）。 */
  async usageMissing(
    modelKeys: readonly string[],
  ): Promise<Map<string, NonNullable<AdminModel['usageMissing']>>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, NonNullable<AdminModel['usageMissing']>>();
    if (keys.length === 0) return out;
    const rows = await this.database.db
      .select({
        modelKey: modelRoutes.modelKey,
        upstreamId: modelRoutes.upstreamId,
        upstreamModelId: modelRoutes.upstreamModelId,
        streak: modelRoutes.usageMissingStreak,
        since: modelRoutes.usageMissingSince,
      })
      .from(modelRoutes)
      .where(and(inArray(modelRoutes.modelKey, keys), gt(modelRoutes.usageMissingStreak, 0)));
    for (const r of rows) {
      const list = out.get(r.modelKey) ?? [];
      list.push({
        upstreamId: r.upstreamId,
        upstreamModelId: r.upstreamModelId,
        streak: r.streak,
        since: r.since?.toISOString() ?? null,
      });
      out.set(r.modelKey, list);
    }
    return out;
  }

  /** 整体替换某模型的路由（后台「模型」向导）。账号必须存在、不能重复。 */
  async replaceRoutes(adminId: string, modelKey: string, raw: ModelRoute[]): Promise<void> {
    for (const route of raw) this.validateBillingBounds(route.billingBounds);
    const routes = raw.map((r) => ({ ...r, billingBounds: this.stampBounds(r.billingBounds) }));
    const ids = routes.map((r) => r.upstreamId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('bad_request', '同一个上游账号在路由里出现了两次', { status: 422 });
    }
    await this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      const found = await tx.db
        .select({ id: upstreams.id })
        .from(upstreams)
        .where(and(inArray(upstreams.id, ids), isNull(upstreams.deletedAt)));
      if (found.length !== ids.length) {
        throw new AppError('bad_request', '路由里有不存在的上游账号', { status: 422 });
      }
      const beforeRoutes = await tx.db
        .select()
        .from(modelRoutes)
        .where(eq(modelRoutes.modelKey, modelKey));
      const now = this.clock.now();
      await tx.db.delete(modelRoutes).where(eq(modelRoutes.modelKey, modelKey));
      await tx.db.insert(modelRoutes).values(
        routes.map((r) => ({
          modelKey,
          upstreamId: r.upstreamId,
          upstreamModelId: r.upstreamModelId,
          billingBounds:
            r.billingBounds !== undefined
              ? r.billingBounds
              : (beforeRoutes.find(
                  (old) =>
                    old.upstreamId === r.upstreamId && old.upstreamModelId === r.upstreamModelId,
                )?.billingBounds ?? null),
          priority: r.priority,
          weight: r.weight,
          enabled: r.enabled,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await this.audit.record(
        {
          module: 'model_access',
          action: 'catalog.routes_replaced',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model',
          targetId: modelKey,
          details: { routes },
        },
        tx,
      );
    });
  }

  validateBillingBounds(bounds: RouteBillingBounds | null | undefined): void {
    if (bounds == null) return;
    const parsed = RouteBillingBounds.safeParse(bounds);
    if (
      !parsed.success ||
      (parsed.data.checkedAt !== undefined &&
        Date.parse(parsed.data.checkedAt) > this.clock.nowMs())
    )
      throw new AppError(
        'bad_request',
        '计费上限格式不正确或核准时间在服务器未来，请核实后再保存',
        { status: 422 },
      );
  }

  /**
   * 3.24：后台不再填核对日期；没带 checkedAt 的计费上限记为保存时刻。「用量未知暂停」按它判断先后
   * （调用开始之后重新保存过的线路不会被那次调用的结果暂停）。
   */
  stampBounds<T extends RouteBillingBounds | null | undefined>(bounds: T): T {
    if (!bounds || bounds.checkedAt) return bounds;
    return { ...bounds, checkedAt: this.clock.now().toISOString() } as T;
  }

  /**
   * 旧接口（upsertCatalogEntry）保存后保证主路由存在：模型只有 0～1 条路由时替换为这一条；
   * 已有多条时更新 / 补上这个账号（优先级取现有最小值）。
   */
  private async syncPrimaryRoute(
    tx: DbTx,
    modelKey: string,
    upstreamId: string,
    upstreamModelId: string,
    billingBounds?: import('@weiban/contracts').RouteBillingBounds | null,
  ): Promise<void> {
    const existing = await tx.db
      .select()
      .from(modelRoutes)
      .where(eq(modelRoutes.modelKey, modelKey));
    const now = this.clock.now();
    if (existing.length <= 1) {
      const only = existing[0];
      if (only && only.upstreamId === upstreamId && only.upstreamModelId === upstreamModelId) {
        if (billingBounds !== undefined)
          await tx.db
            .update(modelRoutes)
            .set({ billingBounds, updatedAt: now })
            .where(and(eq(modelRoutes.modelKey, modelKey), eq(modelRoutes.upstreamId, upstreamId)));
        return;
      }
      await tx.db.delete(modelRoutes).where(eq(modelRoutes.modelKey, modelKey));
      await tx.db.insert(modelRoutes).values({
        modelKey,
        upstreamId,
        upstreamModelId,
        billingBounds: billingBounds ?? null,
        priority: only?.priority ?? 1,
        weight: only?.weight ?? 100,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    const mine = existing.find((r) => r.upstreamId === upstreamId);
    if (mine) {
      if (mine.upstreamModelId !== upstreamModelId || billingBounds !== undefined)
        await tx.db
          .update(modelRoutes)
          .set({ upstreamModelId, updatedAt: now, billingBounds: billingBounds ?? null })
          .where(and(eq(modelRoutes.modelKey, modelKey), eq(modelRoutes.upstreamId, upstreamId)));
      return;
    }
    await tx.db.insert(modelRoutes).values({
      modelKey,
      upstreamId,
      upstreamModelId,
      priority: Math.min(...existing.map((r) => r.priority)),
      weight: 100,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async fact(modelKey: string): Promise<ModelFacts> {
    const map = await this.facts([modelKey]);
    return map.get(modelKey) ?? { modelKey, entry: null, upstreamStatus: null };
  }

  /**
   * 契约 1.3：保存为启用时，当前生效价目表必须有这个模型的价格，否则 422 model_unavailable
   * （billing.md 4.1、ADR-0017 第 1 条）。计费查询端口未接入时 503，不放行。
   * 组合通话模型例外，见 requiresCatalogPrice。
   */
  private async requirePrice(modelKey: string): Promise<void> {
    let priced: string[];
    try {
      priced = await this.charges.listActivePricedModelKeys();
    } catch (error) {
      if (error instanceof ChargeQueryUnavailableError) {
        throw new AppError('service_unavailable', '暂时无法查询价目表，模型未启用，请稍后再试');
      }
      throw error;
    }
    if (!priced.includes(modelKey)) {
      throw new AppError(
        'model_unavailable',
        '当前生效的价目表里没有这个模型的价格：请先发布含该模型价格的价目表，再启用模型',
        { status: 422 },
      );
    }
  }

  private async upstreamStatusOf(tx: DbTx, upstreamId: string): Promise<UpstreamStatus | null> {
    const [u] = await tx.db
      .select({ status: upstreams.status })
      .from(upstreams)
      .where(eq(upstreams.id, upstreamId));
    return (u?.status as UpstreamStatus | undefined) ?? null;
  }
}
