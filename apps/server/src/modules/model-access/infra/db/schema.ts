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
  check,
  customType,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const modelAccessSchema = pgSchema('model_access');

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** 上游：一个接口地址 + 一把平台密钥。 */
export const upstreams = modelAccessSchema.table(
  'upstreams',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** 契约 UpstreamKind：v1 只有 openai_compatible。 */
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
    sortOrder: integer('sort_order').notNull(),
    /** 平台默认用途：chat / background / vision，每种最多一个（部分唯一索引不好表达数组，由代码在行锁下保证）。 */
    defaultFor: text('default_for').array().notNull(),
    enabled: boolean('enabled').notNull(),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    index('model_catalog_upstream_idx').on(t.upstreamId),
    // 数据库兜底：无审查模型不能是平台默认模型（billing.md 3.2、第 9 节）
    check(
      'model_catalog_adult_not_default',
      sql`not ('adult_content' = any(${t.capabilities}) and cardinality(${t.defaultFor}) > 0)`,
    ),
  ],
);

/** 用户的全局模型选择（聊天 / 后台 / 成人模式）。为空表示未设置。 */
export const selections = modelAccessSchema.table('selections', {
  userId: uuid('user_id').primaryKey(),
  chatModelKey: text('chat_model_key'),
  backgroundModelKey: text('background_model_key'),
  adultModelKey: text('adult_model_key'),
  updatedAt: tz('updated_at').notNull(),
});

/** 角色单独设置的聊天模型。 */
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
    absorbedCostMicros: money('absorbed_cost_micros').notNull(),
    /** 冻结动用了安全优先透支（billing.md 6.6）。 */
    safetyOverdraft: boolean('safety_overdraft').notNull(),
    /** 金额快照写入时间；为空 = 还没写（进程在结算后崩溃时由修复任务补写，billing.md 8.2 第 ② 层）。 */
    snapshotAt: tz('snapshot_at'),
    // ---- 追查「变脸」用（GenerateTextInput.meta）----
    personaVersion: integer('persona_version'),
    promptTemplateVersion: text('prompt_template_version'),
    scenarioMode: text('scenario_mode'),
  },
  (t) => [
    uniqueIndex('usage_records_idempotency_key').on(t.idempotencyKey),
    index('usage_records_created_idx').on(t.createdAt, t.id),
    index('usage_records_user_created_idx').on(t.userId, t.createdAt),
    index('usage_records_character_created_idx').on(t.characterId, t.createdAt),
    index('usage_records_model_created_idx').on(t.modelKey, t.createdAt),
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
