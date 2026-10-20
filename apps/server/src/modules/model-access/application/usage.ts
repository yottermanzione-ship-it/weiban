/**
 * 用量记录（billing.md 10.1）。
 *
 * - UsageRecorder：给 D-L0-09 的网关写用量记录（调用前建 pending 行、结束时写结果、结算 / 解冻后写金额快照）。
 *   一条记录对应一次 generateText（同一幂等键只有一条；网关内部重试记在 retry_count）。
 * - AdminUsageService：管理后台用量与费用查询（ADM-08）：汇总、明细、导出（导出写审计）。
 *   口径（10.1 第 3 条）：「用户扣费」= billingOwner = user 的成功调用的 charged 合计；「平台成本」= cost 合计
 *   （含平台账户调用）；「平台吸收」= absorbed 合计。只统计已结束（succeeded / failed）的调用。
 *   token：inputTokens 是**未命中缓存**的输入，与 billing 计价一致；totalTokens = 未命中 + 命中 + 输出。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_USAGE_EXPORT_MAX_ROWS,
  microsToPoints,
  type AdminUsageDimension,
  type AdminUsageOverview,
  type AdminUsageFilter,
  type AdminUsageRecord,
  type AdminUsageSummary,
  type AdminUsageTotals,
  type BillingOwner,
  type GenerateTextInput,
  type ModelPurpose,
} from '@weiban/contracts';
import { and, desc, eq, gte, inArray, isNull, lt, like, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { USAGE_DAY_TIME_ZONE, decodeCursor, encodeCursor } from '../domain/rules.js';
import { upstreams, usageRecords, generationAttempts } from '../infra/db/schema.js';

type UsageRow = typeof usageRecords.$inferSelect;
/** v3.6：稳定开头字符数 → 估算 token（中文为主，约 0.7～0.8 token / 字，取 0.75）。 */
const PREFIX_TOKENS_PER_CHAR = 0.75;

// ---------- 网关写入（D-L0-09 使用） ----------

export interface StartUsageInput {
  input: Pick<
    GenerateTextInput,
    | 'userId'
    | 'purpose'
    | 'billingOwner'
    | 'modelRole'
    | 'characterId'
    | 'conversationId'
    | 'idempotencyKey'
    | 'safetyPriority'
    | 'countAsBackground'
    | 'meta'
  >;
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  /** 是否按后台功能计入（网关按 BACKGROUND_PURPOSES / countAsBackground 规则算好再传）。 */
  countsAsBackground: boolean;
}

export interface FinishUsageInput {
  status: 'succeeded' | 'failed';
  errorCode?: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  /** 3.24：缓存写入 token（Anthropic 原生协议报告）；不传按 0。 */
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  outputTokens: number;
  estimated: boolean;
  latencyMs: number;
  ttftMs?: number | null;
  retryCount: number;
  /** T-071：多媒体用量（写入 usage_records.media_units）。 */
  mediaUnits?: Record<string, number> | null;
}

@Injectable()
export class UsageRecorder {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async startAttempt(input: {
    generationId: string;
    userId: string;
    ordinal: number;
    modelKey: string;
    upstreamId: string;
    upstreamModelId: string;
    usageRecordId: string;
    holdId: string;
    boundSnapshot: unknown;
  }) {
    const id = newId();
    await this.database.db
      .insert(generationAttempts)
      .values({ ...input, id, phase: 'reserved', createdAt: this.clock.now() });
    return id;
  }
  async markAttemptSent(id: string) {
    await this.database.db
      .update(generationAttempts)
      .set({ phase: 'sent' })
      .where(eq(generationAttempts.id, id));
  }
  /** 3.26：usageState 可显式传 estimated（上游没报用量、按本地估算计费）；不传按 known 得出。 */
  async finishAttempt(
    id: string,
    usage: unknown,
    known: boolean,
    errorCode: string | null,
    usageState?: 'reported' | 'estimated' | 'unknown',
  ) {
    await this.database.db
      .update(generationAttempts)
      .set({
        phase: 'finished',
        reportedUsage: usage,
        usageState: usageState ?? (known ? 'reported' : 'unknown'),
        errorCode,
        finishedAt: this.clock.now(),
      })
      .where(eq(generationAttempts.id, id));
  }
  async recoverAttempts(usageRecordId: string, known: boolean) {
    await this.database.db
      .update(generationAttempts)
      .set({
        phase: 'finished',
        usageState: known ? 'reported' : 'unknown',
        errorCode: 'interrupted',
        finishedAt: this.clock.now(),
      })
      .where(
        and(
          eq(generationAttempts.usageRecordId, usageRecordId),
          ne(generationAttempts.phase, 'finished'),
        ),
      );
  }

  /**
   * 调用前建一条 pending 记录。同一幂等键已有记录时不新建，返回已有的（created = false），
   * 网关据此走「返回第一次的结果」分支。
   */
  async start(s: StartUsageInput): Promise<{ record: UsageRow; created: boolean }> {
    const now = this.clock.now();
    const [inserted] = await this.database.db
      .insert(usageRecords)
      .values({
        id: newId(),
        createdAt: now,
        userId: s.input.userId,
        characterId: s.input.characterId ?? null,
        conversationId: s.input.conversationId ?? null,
        conversationKind: s.input.meta?.conversationKind ?? null,
        purpose: s.input.purpose,
        billingOwner: s.input.billingOwner,
        modelRole: s.input.modelRole,
        modelKey: s.modelKey,
        upstreamId: s.upstreamId,
        upstreamModelId: s.upstreamModelId,
        idempotencyKey: s.input.idempotencyKey,
        status: 'pending',
        retryCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimated: false,
        latencyMs: 0,
        safetyPriority: s.input.safetyPriority === true,
        countsAsBackground: s.countsAsBackground,
        chargedMicros: 0,
        costMicros: 0,
        absorbedCostMicros: 0,
        safetyOverdraft: false,
        personaVersion: s.input.meta?.personaVersion ?? null,
        promptTemplateVersion: s.input.meta?.promptTemplateVersion ?? null,
        scenarioMode: s.input.meta?.scenarioMode ?? null,
        stablePrefixTokens:
          typeof s.input.meta?.stablePrefixChars === 'number' && s.input.meta.stablePrefixChars > 0
            ? Math.round(s.input.meta.stablePrefixChars * PREFIX_TOKENS_PER_CHAR)
            : null,
      })
      .onConflictDoNothing({ target: usageRecords.idempotencyKey })
      .returning();
    if (inserted) return { record: inserted, created: true };
    const existing = await this.byIdempotencyKey(s.input.idempotencyKey);
    if (!existing) throw new Error('用量记录幂等冲突后找不到已有记录');
    return { record: existing, created: false };
  }

  async byIdempotencyKey(key: string): Promise<UsageRow | null> {
    const [row] = await this.database.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.idempotencyKey, key));
    return row ?? null;
  }
  async byId(id: string): Promise<UsageRow | null> {
    const [row] = await this.database.db.select().from(usageRecords).where(eq(usageRecords.id, id));
    return row ?? null;
  }
  async pendingForGeneration(id: string): Promise<UsageRow[]> {
    return this.database.db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.status, 'pending'),
          or(
            eq(usageRecords.idempotencyKey, `gateway:${id}`),
            like(usageRecords.idempotencyKey, `gateway:${id}:attempt:%`),
          ),
        ),
      );
  }
  async interruptedMedia(): Promise<UsageRow[]> {
    return this.database.db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.status, 'pending'),
          like(usageRecords.idempotencyKey, 'media:%'),
          lt(usageRecords.createdAt, new Date(this.clock.nowMs() - 120000)),
        ),
      )
      .limit(100);
  }

  /** v3.4：失败切换后改记实际调用的账号与上游模型名。 */
  async setUpstream(id: string, upstreamId: string, upstreamModelId: string): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({ upstreamId, upstreamModelId })
      .where(eq(usageRecords.id, id));
  }

  /** 冻结成功后记下冻结 ID、价目表版本、是否动用安全透支。 */
  async attachHold(
    id: string,
    hold: { holdId: string; priceVersionId: string; usedSafetyOverdraft: boolean },
  ): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        holdId: hold.holdId,
        priceVersionId: hold.priceVersionId,
        safetyOverdraft: hold.usedSafetyOverdraft,
      })
      .where(eq(usageRecords.id, id));
  }

  async finish(id: string, f: FinishUsageInput): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        status: f.status,
        errorCode: f.errorCode ?? null,
        inputTokens: f.inputTokens,
        cachedInputTokens: f.cachedInputTokens,
        cacheWrite5mTokens: f.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: f.cacheWrite1hTokens ?? 0,
        outputTokens: f.outputTokens,
        estimated: f.estimated,
        latencyMs: f.latencyMs,
        ttftMs: f.ttftMs ?? null,
        retryCount: f.retryCount,
        ...(f.mediaUnits ? { mediaUnits: f.mediaUnits } : {}),
        completedAt: this.clock.now(),
      })
      .where(eq(usageRecords.id, id));
  }

  /** settle 返回后写金额快照（副本；权威在 billing 流水）。可重复调用（修复任务补写）。 */
  async writeSettleSnapshot(
    id: string,
    s: {
      ledgerEntryId: string;
      amountMicros: number;
      costMicros: number;
      absorbedCostMicros?: number;
      costKnown?: boolean;
      uncertainCostMicros?: number;
    },
  ): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        ledgerEntryId: s.ledgerEntryId,
        chargedMicros: s.amountMicros,
        costMicros: s.costMicros,
        absorbedCostMicros: s.absorbedCostMicros ?? 0,
        costKnown: s.costKnown === true,
        uncertainCostMicros: s.uncertainCostMicros ?? 0,
        snapshotAt: this.clock.now(),
      })
      .where(
        and(
          eq(usageRecords.id, id),
          s.costKnown === true ? undefined : eq(usageRecords.costKnown, false),
        ),
      );
  }

  /** release 返回后写平台吸收成本快照。 */
  async writeReleaseSnapshot(
    id: string,
    s: { absorbedCostMicros: number; costKnown?: boolean; uncertainCostMicros?: number },
  ): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        absorbedCostMicros: s.absorbedCostMicros,
        costMicros: s.absorbedCostMicros,
        costKnown: s.costKnown === true,
        uncertainCostMicros: s.uncertainCostMicros ?? 0,
        snapshotAt: this.clock.now(),
      })
      .where(
        and(
          eq(usageRecords.id, id),
          s.costKnown === true ? undefined : eq(usageRecords.costKnown, false),
        ),
      );
  }

  /** 已成功但还没写金额快照的记录（修复任务用，billing.md 8.2 第 ② 层）。 */
  async missingSnapshots(limit = 100): Promise<UsageRow[]> {
    return this.database.db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.status, 'succeeded'), isNull(usageRecords.snapshotAt)))
      .orderBy(usageRecords.createdAt)
      .limit(limit);
  }
}

// ---------- 管理后台查询（ADM-08） ----------

const DIMENSION_SQL: Record<AdminUsageDimension, SQL> = {
  user: sql`${usageRecords.userId}::text`,
  character: sql`coalesce(${usageRecords.characterId}::text, '')`,
  model: sql`${usageRecords.modelKey}`,
  purpose: sql`${usageRecords.purpose}`,
  upstream: sql`${usageRecords.upstreamId}::text`,
  day: sql`to_char(${usageRecords.createdAt} at time zone ${sql.raw(`'${USAGE_DAY_TIME_ZONE}'`)}, 'YYYY-MM-DD')`,
  hour: sql`to_char(${usageRecords.createdAt} at time zone ${sql.raw(`'${USAGE_DAY_TIME_ZONE}'`)}, 'YYYY-MM-DD HH24')`,
};

const TOTALS_SQL = sql`
  count(*) filter (where not ${usageRecords.costKnown})::bigint as unknown_cost_calls,
  coalesce(sum(${usageRecords.uncertainCostMicros}), 0)::bigint as uncertain_cost_micros,
  count(*)::bigint as calls,
  count(*) filter (where ${usageRecords.status} = 'failed')::bigint as failed_calls,
  coalesce(sum(${usageRecords.inputTokens}), 0)::bigint as input_tokens,
  coalesce(sum(${usageRecords.cachedInputTokens}), 0)::bigint as cached_input_tokens,
  coalesce(sum(${usageRecords.outputTokens}), 0)::bigint as output_tokens,
  coalesce(sum(${usageRecords.cacheWrite5mTokens} + ${usageRecords.cacheWrite1hTokens}), 0)::bigint as cache_write_tokens,
  coalesce(sum(${usageRecords.inputTokens} + ${usageRecords.cachedInputTokens} + ${usageRecords.cacheWrite5mTokens} + ${usageRecords.cacheWrite1hTokens} + ${usageRecords.outputTokens}), 0)::bigint as total_tokens,
  coalesce(sum(${usageRecords.inputTokens} + ${usageRecords.cachedInputTokens} + ${usageRecords.cacheWrite5mTokens} + ${usageRecords.cacheWrite1hTokens} + ${usageRecords.outputTokens})
    filter (where ${usageRecords.estimated}), 0)::bigint as estimated_tokens,
  coalesce(sum(${usageRecords.chargedMicros})
    filter (where ${usageRecords.billingOwner} = 'user' and ${usageRecords.status} = 'succeeded'), 0)::bigint as charged_micros,
  coalesce(sum(${usageRecords.costMicros}), 0)::bigint as cost_micros,
  coalesce(sum(${usageRecords.absorbedCostMicros}), 0)::bigint as absorbed_cost_micros,
  coalesce(sum(${usageRecords.latencyMs}), 0)::bigint as latency_ms,
  coalesce(sum(${usageRecords.stablePrefixTokens}), 0)::bigint as stable_prefix_tokens,
  coalesce(sum(${usageRecords.inputTokens} + ${usageRecords.cachedInputTokens} + ${usageRecords.cacheWrite5mTokens} + ${usageRecords.cacheWrite1hTokens})
    filter (where ${usageRecords.stablePrefixTokens} is not null), 0)::bigint as marked_input_tokens`;

type TotalsRow = Record<
  | 'unknown_cost_calls'
  | 'uncertain_cost_micros'
  | 'calls'
  | 'failed_calls'
  | 'input_tokens'
  | 'cached_input_tokens'
  | 'output_tokens'
  | 'cache_write_tokens'
  | 'total_tokens'
  | 'estimated_tokens'
  | 'charged_micros'
  | 'cost_micros'
  | 'absorbed_cost_micros'
  | 'latency_ms'
  | 'stable_prefix_tokens'
  | 'marked_input_tokens',
  string | number | null
>;

function toTotals(r: TotalsRow | undefined): AdminUsageTotals {
  const n = (v: string | number | null | undefined) => Number(v ?? 0);
  const calls = n(r?.calls);
  // usage_records.input_tokens 是未命中缓存的输入（与价目表单位一致），命中率 = 命中 ÷（未命中 + 命中 + 缓存写入）
  const inputAll = n(r?.input_tokens) + n(r?.cached_input_tokens) + n(r?.cache_write_tokens);
  return {
    // v3.4 用量监控
    unknownCostCalls: n(r?.unknown_cost_calls),
    uncertainCostMicros: n(r?.uncertain_cost_micros),
    chargedPoints: microsToPoints(n(r?.charged_micros)),
    avgLatencyMs: calls > 0 ? Math.round(n(r?.latency_ms) / calls) : 0,
    failureRate: calls > 0 ? n(r?.failed_calls) / calls : 0,
    cacheHitRate: inputAll > 0 ? n(r?.cached_input_tokens) / inputAll : 0,
    // v3.6：理论可缓存占比（估算的稳定开头 ÷ 带标记调用的实际输入），估算偏差可能略超 1，封顶
    stablePrefixRate:
      n(r?.marked_input_tokens) > 0
        ? Math.min(1, n(r?.stable_prefix_tokens) / n(r?.marked_input_tokens))
        : 0,
    calls: n(r?.calls),
    failedCalls: n(r?.failed_calls),
    inputTokens: n(r?.input_tokens),
    cachedInputTokens: n(r?.cached_input_tokens),
    outputTokens: n(r?.output_tokens),
    cacheWriteTokens: n(r?.cache_write_tokens),
    totalTokens: n(r?.total_tokens),
    estimatedTokens: n(r?.estimated_tokens),
    chargedMicros: n(r?.charged_micros),
    costMicros: n(r?.cost_micros),
    absorbedCostMicros: n(r?.absorbed_cost_micros),
  };
}

export function toAdminRecord(row: UsageRow): AdminUsageRecord {
  return {
    costKnown: row.costKnown,
    uncertainCostMicros: row.uncertainCostMicros,
    usageRecordId: row.id,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    characterId: row.characterId,
    conversationKind: (row.conversationKind as 'direct' | 'group' | null) ?? null,
    purpose: row.purpose as ModelPurpose,
    billingOwner: row.billingOwner as BillingOwner,
    modelKey: row.modelKey,
    upstreamId: row.upstreamId,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWrite5mTokens: row.cacheWrite5mTokens,
    cacheWrite1hTokens: row.cacheWrite1hTokens,
    outputTokens: row.outputTokens,
    estimated: row.estimated,
    latencyMs: row.latencyMs,
    ttftMs: row.ttftMs,
    status: row.status as 'succeeded' | 'failed',
    errorCode: row.errorCode,
    retryCount: row.retryCount,
    chargedMicros: row.chargedMicros,
    costMicros: row.costMicros,
    absorbedCostMicros: row.absorbedCostMicros,
    priceVersionId: row.priceVersionId,
    safetyOverdraft: row.safetyOverdraft,
    chargedPoints: microsToPoints(row.chargedMicros),
    upstreamModelId: row.upstreamModelId.slice(0, 128),
    stablePrefixTokens: row.stablePrefixTokens ?? null,
  };
}

@Injectable()
export class AdminUsageService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async summary(req: {
    filter: AdminUsageFilter;
    groupBy: AdminUsageDimension[];
    sort: 'key_asc' | 'charged_desc';
    limit: number;
  }): Promise<AdminUsageSummary> {
    const where = this.where(req.filter);
    const dims = req.groupBy.map((d) => DIMENSION_SQL[d]);
    const keyCols = sql.join(
      dims.map((d, i) => sql`${d} as ${sql.raw(`k${i}`)}`),
      sql`, `,
    );
    const groupCols = sql.join(
      dims.map((_, i) => sql.raw(`k${i}`)),
      sql`, `,
    );
    const order = req.sort === 'charged_desc' ? sql`charged_micros desc, ${groupCols}` : groupCols;
    const grouped = await this.database.db.execute<TotalsRow & Record<string, string>>(sql`
      select ${keyCols}, ${TOTALS_SQL}
        from ${usageRecords}
       where ${where}
       group by ${groupCols}
       order by ${order}
       limit ${req.limit + 1}`);
    const totals = await this.database.db.execute<TotalsRow>(
      sql`select ${TOTALS_SQL} from ${usageRecords} where ${where}`,
    );
    const rows = grouped.rows.slice(0, req.limit).map((r) => ({
      keys: req.groupBy.map((_, i) => String(r[`k${i}`] ?? '')),
      ...toTotals(r),
    }));
    return {
      rows,
      totals: toTotals(totals.rows[0]),
      truncated: grouped.rows.length > req.limit,
    };
  }

  async records(req: {
    filter: AdminUsageFilter;
    cursor?: string;
    limit: number;
  }): Promise<{ items: AdminUsageRecord[]; nextCursor: string | null }> {
    const conds: SQL[] = [this.where(req.filter)];
    if (req.cursor) {
      const c = decodeCursor(req.cursor);
      if (!c) throw new AppError('bad_request', '游标不合法');
      const before = or(
        lt(usageRecords.createdAt, c.createdAt),
        and(eq(usageRecords.createdAt, c.createdAt), lt(usageRecords.id, c.id)),
      );
      if (before) conds.push(before);
    }
    const rows = await this.database.db
      .select()
      .from(usageRecords)
      .where(and(...conds))
      .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      .limit(req.limit + 1);
    const page = rows.slice(0, req.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toAdminRecord),
      nextCursor: rows.length > req.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /**
   * v3.4：用量看板概览（06-old-ui-spec 9.3）：所选时段与上一个等长时段的合计、账号可用情况、
   * 最近 24 小时错误（按账号 + 模型 + 错误类型合并）。
   */
  async overview(req: {
    from: string;
    to: string;
    upstreamIds?: string[];
    modelKeys?: string[];
  }): Promise<AdminUsageOverview> {
    const from = new Date(req.from);
    const to = new Date(req.to);
    const span = to.getTime() - from.getTime();
    const filter = (f: Date, t: Date): AdminUsageFilter => ({
      from: f.toISOString(),
      to: t.toISOString(),
      ...(req.upstreamIds ? { upstreamIds: req.upstreamIds } : {}),
      ...(req.modelKeys ? { modelKeys: req.modelKeys } : {}),
    });
    const totalsOf = async (f: AdminUsageFilter) =>
      toTotals(
        (
          await this.database.db.execute<TotalsRow>(
            sql`select ${TOTALS_SQL} from ${usageRecords} where ${this.where(f)}`,
          )
        ).rows[0],
      );
    const totals = await totalsOf(filter(from, to));
    const previousTotals =
      span > 0
        ? await totalsOf(filter(new Date(from.getTime() - span), from))
        : toTotals(undefined);
    const now = this.clock.now();
    const accounts = await this.database.db
      .select({
        enabled: upstreams.enabled,
        status: upstreams.status,
        cooldownUntil: upstreams.cooldownUntil,
      })
      .from(upstreams)
      .where(isNull(upstreams.deletedAt));
    let available = 0;
    let abnormal = 0;
    let disabled = 0;
    for (const a of accounts) {
      if (!a.enabled) disabled++;
      else if (a.status === 'active' && !(a.cooldownUntil && a.cooldownUntil > now)) available++;
      else abnormal++;
    }
    const since = new Date(now.getTime() - 86_400_000);
    const errors = await this.database.db
      .select({
        upstreamId: usageRecords.upstreamId,
        modelKey: usageRecords.modelKey,
        errorCode: sql<string>`coalesce(${usageRecords.errorCode}, 'unknown')`,
        count: sql<string>`count(*)`,
        lastAt: sql<Date>`max(${usageRecords.createdAt})`,
      })
      .from(usageRecords)
      .where(and(eq(usageRecords.status, 'failed'), gte(usageRecords.createdAt, since)))
      .groupBy(usageRecords.upstreamId, usageRecords.modelKey, sql`3`)
      .orderBy(sql`count(*) desc`)
      .limit(50);
    return {
      totals,
      previousTotals,
      accounts: { total: accounts.length, available, abnormal, disabled },
      recentErrors: errors.map((e) => ({
        upstreamId: e.upstreamId,
        modelKey: e.modelKey,
        errorCode: String(e.errorCode).slice(0, 64),
        count: Number(e.count),
        lastAt: new Date(e.lastAt).toISOString(),
      })),
    };
  }

  /** 导出：最多 ADMIN_USAGE_EXPORT_MAX_ROWS 行；每次写审计（谁、何时、筛选条件），ADM-08 第 6 条。 */
  async export(
    adminId: string,
    filter: AdminUsageFilter,
  ): Promise<{ items: AdminUsageRecord[]; truncated: boolean }> {
    const rows = await this.database.db
      .select()
      .from(usageRecords)
      .where(this.where(filter))
      .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      .limit(ADMIN_USAGE_EXPORT_MAX_ROWS + 1);
    const truncated = rows.length > ADMIN_USAGE_EXPORT_MAX_ROWS;
    const items = rows.slice(0, ADMIN_USAGE_EXPORT_MAX_ROWS).map(toAdminRecord);
    await this.audit.record({
      module: 'model_access',
      action: 'usage.exported',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'usage_records',
      details: { filter, rows: items.length, truncated },
    });
    return { items, truncated };
  }

  private where(f: AdminUsageFilter): SQL {
    const from = new Date(f.from);
    const to = new Date(f.to);
    if (!(from.getTime() < to.getTime())) {
      throw new AppError('bad_request', '开始时间必须早于结束时间');
    }
    const conds: SQL[] = [gte(usageRecords.createdAt, from), lt(usageRecords.createdAt, to)];
    conds.push(
      f.status
        ? eq(usageRecords.status, f.status)
        : inArray(usageRecords.status, ['succeeded', 'failed']),
    );
    if (f.userIds) conds.push(inArray(usageRecords.userId, f.userIds));
    if (f.characterIds) conds.push(inArray(usageRecords.characterId, f.characterIds));
    if (f.modelKeys) conds.push(inArray(usageRecords.modelKey, f.modelKeys));
    if (f.purposes) conds.push(inArray(usageRecords.purpose, f.purposes));
    if (f.upstreamIds) conds.push(inArray(usageRecords.upstreamId, f.upstreamIds));
    if (f.billingOwner) conds.push(eq(usageRecords.billingOwner, f.billingOwner));
    const all = and(...conds);
    if (!all) throw new Error('筛选条件为空');
    return all;
  }
}
