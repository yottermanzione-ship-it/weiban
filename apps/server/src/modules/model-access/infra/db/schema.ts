/**
 * model-access 模块的表（PostgreSQL schema `model_access`，billing.md 第 2、3、9、10.1 节）。
 * 表说明见 docs/backend/model-access.md 第 3 节。只有 model-access 模块能读写。
 *
 * 安全：upstreams.secret_ciphertext 是平台数据密钥信封加密后的密文（AAD = upstream:{id}），
 * 掩码单独存 display_prefix / display_suffix（security-and-privacy.md 3.2 第 1 条）。任何接口都不返回密文。
 * 用量记录不存任何内容（消息、提示词、模型输出），只存技术数据与金额快照（billing.md 10.1 第 7 条）。
 *
 * 改表结构：改这里 → `pnpm --filter @weiban/server db:generate` 生成迁移 → 手写对应的 .down.sql。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  date,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const modelAccessSchema = pgSchema('model_access');

/** 3.30：公开搜索缓存仅保留哈希与资料摘要，正文不长期缓存。 */
export const webSearchCache = modelAccessSchema.table(
  'web_search_cache',
  {
    queryKey: text('query_key').primaryKey(),
    purpose: text('purpose').notNull(),
    results: jsonb('results'),
    leaseToken: uuid('lease_token').notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('web_search_expiry_idx').on(t.expiresAt)],
);
export const webToolLimits = modelAccessSchema.table(
  'web_tool_limits',
  {
    key: text('key').primaryKey(),
    window: text('window').notNull(),
    count: integer('count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('web_tool_limits_count_check', sql`${t.count} >= 0`)],
);

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** 上游：一个接口地址 + 一把平台密钥。 */
export const upstreams = modelAccessSchema.table(
  'upstreams',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** 契约 UpstreamKind：openai_compatible / anthropic（3.24，Claude 原生 Messages）/ dashscope / bocha_search / jev。 */
    kind: text('kind').notNull(),
    baseUrl: text('base_url').notNull(),
    /** 信封加密后的密钥（平台 DEK，AAD = upstream:{id}）。 */
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    displayPrefix: text('display_prefix').notNull(),
    displaySuffix: text('display_suffix').notNull(),
    /** 契约 UpstreamStatus：active / invalid / quota_exhausted / unavailable。 */
    status: text('status').notNull(),
    statusChangedAt: tz('status_changed_at').notNull(),
    lastTestedAt: tz('last_tested_at'),
    keyRotatedAt: tz('key_rotated_at'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
    // ---- v3.4（0089）上游账号池：调度与健康 ----
    /** 服务商标识（分组展示用）。 */
    provider: text('provider').notNull().default('openai_compatible'),
    priority: integer('priority').notNull().default(1),
    weight: integer('weight').notNull().default(100),
    maxConcurrency: integer('max_concurrency'),
    rpmLimit: integer('rpm_limit'),
    enabled: boolean('enabled').notNull().default(true),
    note: text('note'),
    /** 连续失败达到阈值后暂停到这个时间。 */
    cooldownUntil: tz('cooldown_until'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
    lastUsedAt: tz('last_used_at'),
    /** 10-20（0112）：软删时间。删除后密文清空、不参与调度，行保留给历史调用记录显示账号名。 */
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    check(
      'upstreams_status_check',
      sql`${t.status} in ('active', 'invalid', 'quota_exhausted', 'unavailable')`,
    ),
  ],
);

/** 上游状态变化历史（billing.md 3.1 第 5 条）。上游删除时随之删除。 */
export const upstreamStatus = modelAccessSchema.table(
  'upstream_status',
  {
    id: uuid('id').primaryKey(),
    upstreamId: uuid('upstream_id')
      .notNull()
      .references(() => upstreams.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    /** 变化来源：created / admin_test / key_rotated / gateway / probe。 */
    source: text('source').notNull(),
    /** 失败类别（契约 UpstreamTestFailure 或网关内部错误码），不含上游原文。 */
    failure: text('failure'),
    changedAt: tz('changed_at').notNull(),
  },
  (t) => [index('upstream_status_upstream_idx').on(t.upstreamId, t.changedAt)],
);

/**
 * 模型目录。upstream_id 不加外键：契约允许删除「只剩停用模型指向」的上游（启用的模型指向时 409），
 * 停用条目保留原 upstream_id；重新启用或改指上游时校验上游存在。
 */
export const modelCatalog = modelAccessSchema.table(
  'model_catalog',
  {
    modelKey: text('model_key').primaryKey(),
    displayName: text('display_name').notNull(),
    vendorName: text('vendor_name').notNull(),
    upstreamId: uuid('upstream_id').notNull(),
    upstreamModelId: text('upstream_model_id').notNull(),
    capabilities: text('capabilities').array().notNull(),
    tags: text('tags').array().notNull(),
    leaderboardRank: integer('leaderboard_rank'),
    /** 3.24（0120）：榜单对应名称（自动获取榜单时按它匹配名次）。 */
    arenaModelName: text('arena_model_name'),
    sortOrder: integer('sort_order').notNull(),
    /** 平台默认用途：chat / background / vision，每种最多一个（部分唯一索引不好表达数组，由代码在行锁下保证）。 */
    defaultFor: text('default_for').array().notNull(),
    enabled: boolean('enabled').notNull(),
    /** v3.6（0091）：系统消息放法 multi / single_system / no_system（docs/refactor/09 第 5 节）。 */
    systemMessageMode: text('system_message_mode').notNull().default('multi'),
    billingBounds: jsonb('billing_bounds').$type<import('@weiban/contracts').RouteBillingBounds>(),
    /** 会员 v5（0103）：展示倍率；null = 按基准模型自动算。只展示，不参与扣费。 */
    displayMultiplier: doublePrecision('display_multiplier'),
    /** 3.22（0114）：可用于哪些场景（契约 ModelScenario，后台勾选）。 */
    scenarios: text('scenarios')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
    /**
     * 3.23（0117）：软删。删除时 model_key 改成「原键#deleted:<随机>」腾出原键（同键可重新添加），
     * 原键存 original_model_key；行保留给历史调用记录显示模型名。按原键查目录的地方因此天然查不到已删除的行。
     */
    deletedAt: tz('deleted_at'),
    originalModelKey: text('original_model_key'),
  },
  (t) => [
    index('model_catalog_upstream_idx').on(t.upstreamId),
    index('model_catalog_original_key_idx')
      .on(t.originalModelKey)
      .where(sql`${t.originalModelKey} IS NOT NULL`),
    check(
      'model_catalog_deleted_check',
      sql`(${t.deletedAt} IS NULL) = (${t.originalModelKey} IS NULL) AND (${t.deletedAt} IS NULL OR NOT ${t.enabled})`,
    ),
    // 无审查模型只能用于专用检查默认，不能作为聊天/后台等生成默认。
    check(
      'model_catalog_adult_not_default',
      sql`not ('adult_content' = any(${t.capabilities})) or ${t.defaultFor} <@ ARRAY['adult_check']::text[]`,
    ),
    check(
      'model_catalog_system_message_mode',
      sql`${t.systemMessageMode} IN ('multi','single_system','no_system')`,
    ),
  ],
);

/**
 * v3.4（0089）：模型路由——一个模型可以走多个上游账号（按优先级、权重调度，失败自动切换）。
 * model_catalog.upstream_id / upstream_model_id 是主路由的镜像（旧接口、媒体网关仍读它）。
 */
export const modelRoutes = modelAccessSchema.table(
  'model_routes',
  {
    modelKey: text('model_key').notNull(),
    upstreamId: uuid('upstream_id')
      .notNull()
      .references(() => upstreams.id, { onDelete: 'cascade' }),
    upstreamModelId: text('upstream_model_id').notNull(),
    billingBounds: jsonb('billing_bounds').$type<import('@weiban/contracts').RouteBillingBounds>(),
    priority: integer('priority').notNull().default(1),
    weight: integer('weight').notNull().default(100),
    enabled: boolean('enabled').notNull().default(true),
    /** 3.26（0124）：连续几次没返回用量（已按估算计费）；上游重新报用量清零。达到阈值后台提示一次，不停用。 */
    usageMissingStreak: integer('usage_missing_streak').notNull().default(0),
    usageMissingSince: tz('usage_missing_since'),
    usageMissingAlertedAt: tz('usage_missing_alerted_at'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.modelKey, t.upstreamId] }),
    index('model_routes_upstream_idx').on(t.upstreamId),
  ],
);

/** v3.4（0089）：model-access 的后台配置（键值）。gateway_limits = 每用户限流与健康参数。 */
export const modelAccessSettings = modelAccessSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tz('updated_at').notNull(),
  updatedBy: uuid('updated_by'),
});

/** 用户的全局模型选择（聊天 / 后台 / 成人模式）。为空表示未设置。 */
export const selections = modelAccessSchema.table('selections', {
  userId: uuid('user_id').primaryKey(),
  chatModelKey: text('chat_model_key'),
  backgroundModelKey: text('background_model_key'),
  adultModelKey: text('adult_model_key'),
  updatedAt: tz('updated_at').notNull(),
});

/** 3.22（0115）：用户按场景的模型配置（一行一个场景；没有行 = 该场景未配置）。 */
export const scenarioSelections = modelAccessSchema.table(
  'scenario_selections',
  {
    userId: uuid('user_id').notNull(),
    scenario: text('scenario').notNull(),
    modelKey: text('model_key').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.scenario] }),
    index('scenario_selections_model_idx').on(t.modelKey),
  ],
);

/** 3.22（0115）：角色逐场景单独设置（没有行 = 跟随场景设置）。 */
export const characterScenarioOverrides = modelAccessSchema.table(
  'character_scenario_overrides',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    scenario: text('scenario').notNull(),
    modelKey: text('model_key').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId, t.scenario] }),
    index('character_scenario_overrides_character_idx').on(t.characterId),
  ],
);

/** 角色单独设置的聊天模型（3.22 起不再读写，数据已迁入 character_scenario_overrides，保留只为回滚）。 */
export const characterOverrides = modelAccessSchema.table(
  'character_overrides',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    chatModelKey: text('chat_model_key').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index('character_overrides_character_idx').on(t.characterId),
  ],
);

/**
 * 用量记录：每次网关调用一行（billing.md 10.1）。D-L0-09 的网关在调用前插入（status = pending），
 * 结束时改为 succeeded / failed，并在 settle / release 返回后写金额快照（charged / cost / absorbed）。
 * 金额是 billing 流水的**副本**，权威在 billing（对账第 ② 层逐条核对，TD-023）。
 */
export const usageRecords = modelAccessSchema.table(
  'usage_records',
  {
    id: uuid('id').primaryKey(),
    createdAt: tz('created_at').notNull(),
    completedAt: tz('completed_at'),
    /** 发起调用的用户；平台账户调用为发起操作的管理员。 */
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id'),
    conversationId: uuid('conversation_id'),
    /** direct / group，来自 GenerateTextInput.meta.conversationKind。 */
    conversationKind: text('conversation_kind'),
    purpose: text('purpose').notNull(),
    /** user / platform */
    billingOwner: text('billing_owner').notNull(),
    /** chat / background / adult */
    modelRole: text('model_role').notNull(),
    modelKey: text('model_key').notNull(),
    upstreamId: uuid('upstream_id').notNull(),
    upstreamModelId: text('upstream_model_id').notNull(),
    /** 网关调用的幂等键（同时是冻结的幂等键）；同一个键只有一条用量记录。 */
    idempotencyKey: text('idempotency_key').notNull(),
    /** pending（调用中）/ succeeded / failed。管理后台只看后两种。 */
    status: text('status').notNull(),
    errorCode: text('error_code'),
    retryCount: integer('retry_count').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    cachedInputTokens: integer('cached_input_tokens').notNull(),
    /** 3.24（0118）：缓存写入 token（Anthropic 原生协议报告）。 */
    cacheWrite5mTokens: integer('cache_write_5m_tokens').notNull().default(0),
    cacheWrite1hTokens: integer('cache_write_1h_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull(),
    /** 上游没返回用量、按估算规则得出（runtime-overview.md 2.5）。 */
    estimated: boolean('estimated').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    ttftMs: integer('ttft_ms'),
    safetyPriority: boolean('safety_priority').notNull(),
    countsAsBackground: boolean('counts_as_background').notNull(),
    // ---- 计费引用与金额快照（billing.md 10.1 第 2 条）----
    holdId: uuid('hold_id'),
    priceVersionId: uuid('price_version_id'),
    ledgerEntryId: uuid('ledger_entry_id'),
    chargedMicros: money('charged_micros').notNull(),
    costMicros: money('cost_micros').notNull(),
    costKnown: boolean('cost_known').notNull().default(false),
    uncertainCostMicros: money('uncertain_cost_micros').notNull().default(0),
    absorbedCostMicros: money('absorbed_cost_micros').notNull(),
    /** 冻结动用了安全优先透支（billing.md 6.6）。 */
    safetyOverdraft: boolean('safety_overdraft').notNull(),
    /** 金额快照写入时间；为空 = 还没写（进程在结算后崩溃时由修复任务补写，billing.md 8.2 第 ② 层）。 */
    snapshotAt: tz('snapshot_at'),
    // ---- 追查「变脸」用（GenerateTextInput.meta）----
    personaVersion: integer('persona_version'),
    promptTemplateVersion: text('prompt_template_version'),
    scenarioMode: text('scenario_mode'),
    /** v3.6（0091）：请求「稳定开头」的估算 token 数（meta.stablePrefixChars 折算），没有标记为空。 */
    stablePrefixTokens: integer('stable_prefix_tokens'),
    /** T-071：多媒体用量（ttsChars / asrSeconds / images / searchCalls），文本调用为空。 */
    mediaUnits: jsonb('media_units').$type<Record<string, number>>(),
  },
  (t) => [
    uniqueIndex('usage_records_idempotency_key').on(t.idempotencyKey),
    index('usage_records_created_idx').on(t.createdAt, t.id),
    index('usage_records_user_created_idx').on(t.userId, t.createdAt),
    index('usage_records_character_created_idx').on(t.characterId, t.createdAt),
    index('usage_records_model_created_idx').on(t.modelKey, t.createdAt),
    index('usage_records_upstream_created_idx').on(t.upstreamId, t.createdAt),
    check('usage_records_status_check', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check('usage_records_owner_check', sql`${t.billingOwner} in ('user', 'platform')`),
    check(
      'usage_records_kind_check',
      sql`${t.conversationKind} is null or ${t.conversationKind} in ('direct', 'group')`,
    ),
    check(
      'usage_records_nonnegative',
      sql`${t.inputTokens} >= 0 and ${t.cachedInputTokens} >= 0 and ${t.outputTokens} >= 0
          and ${t.latencyMs} >= 0 and ${t.retryCount} >= 0 and ${t.chargedMicros} >= 0
          and ${t.costMicros} >= 0 and ${t.absorbedCostMicros} >= 0`,
    ),
  ],
);

/** 24h 幂等结果缓存；输出独立用户 DEK 加密，用量记录仍不保存任何正文。 */
export const generationResults = modelAccessSchema.table(
  'generation_results',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    requestHash: text('request_hash').notNull(),
    phase: text('phase').notNull(),
    ciphertext: bytea('ciphertext'),
    usageRecordId: uuid('usage_record_id'),
    holdId: uuid('hold_id'),
    upstreamId: uuid('upstream_id'),
    createdAt: tz('created_at').notNull(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [
    index('generation_results_expiry_idx').on(t.expiresAt),
    index('generation_results_user_idx').on(t.userId),
    check('generation_results_phase_check', sql`${t.phase} in ('pending', 'result', 'complete')`),
  ],
);

/** 3.16：每次实际上游尝试独立追踪，正文仍只在已有加密generation缓存。 */
export const generationAttempts = modelAccessSchema.table(
  'generation_attempts',
  {
    id: uuid('id').primaryKey(),
    generationId: uuid('generation_id').notNull(),
    userId: uuid('user_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    modelKey: text('model_key').notNull(),
    upstreamId: uuid('upstream_id').notNull(),
    upstreamModelId: text('upstream_model_id').notNull(),
    usageRecordId: uuid('usage_record_id'),
    holdId: uuid('hold_id'),
    phase: text('phase').notNull(),
    boundSnapshot: jsonb('bound_snapshot').notNull(),
    reportedUsage: jsonb('reported_usage'),
    usageState: text('usage_state').notNull().default('unknown'),
    errorCode: text('error_code'),
    createdAt: tz('created_at').notNull(),
    finishedAt: tz('finished_at'),
  },
  (t) => [
    uniqueIndex('generation_attempts_generation_ordinal_key').on(t.generationId, t.ordinal),
    index('generation_attempts_usage_idx').on(t.usageRecordId),
    index('generation_attempts_user_idx').on(t.userId),
  ],
);
/** 平台候选/小V限频，使用真实账号和北京时间自然日，跨进程不靠内存。 */
export const platformPurposeLimits = modelAccessSchema.table(
  'platform_purpose_limits',
  {
    userId: uuid('user_id').notNull(),
    purpose: text('purpose').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull(),
    minuteStarts: tz('minute_starts').notNull(),
    minuteCount: integer('minute_count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.purpose] })],
);

/** 3.26（0125）：models.dev 公开模型数据的本地缓存（只有一行，id = 1）。data = 压缩索引（domain/models-dev.ts）。 */
export const modelsDevSnapshot = modelAccessSchema.table('models_dev_snapshot', {
  id: integer('id').primaryKey().default(1),
  fetchedAt: tz('fetched_at'),
  lastAttemptAt: tz('last_attempt_at'),
  lastError: text('last_error'),
  modelCount: integer('model_count').notNull().default(0),
  providerCount: integer('provider_count').notNull().default(0),
  data: jsonb('data').$type<import('../../domain/models-dev.js').ModelsDevIndex>(),
  updatedAt: tz('updated_at').notNull(),
});
