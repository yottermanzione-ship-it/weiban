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
  type AdminUsageDimension,
  type AdminUsageFilter,
  type AdminUsageRecord,
  type AdminUsageSummary,
  type AdminUsageTotals,
  type BillingOwner,
  type GenerateTextInput,
  type ModelPurpose,
} from '@weiban/contracts';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
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
import { usageRecords } from '../infra/db/schema.js';

type UsageRow = typeof usageRecords.$inferSelect;

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
  outputTokens: number;
  estimated: boolean;
  latencyMs: number;
  ttftMs?: number | null;
  retryCount: number;
}

@Injectable()
export class UsageRecorder {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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
        outputTokens: f.outputTokens,
        estimated: f.estimated,
        latencyMs: f.latencyMs,
        ttftMs: f.ttftMs ?? null,
        retryCount: f.retryCount,
        completedAt: this.clock.now(),
      })
      .where(eq(usageRecords.id, id));
  }

  /** settle 返回后写金额快照（副本；权威在 billing 流水）。可重复调用（修复任务补写）。 */
  async writeSettleSnapshot(
    id: string,
    s: { ledgerEntryId: string; amountMicros: number; costMicros: number },
  ): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        ledgerEntryId: s.ledgerEntryId,
        chargedMicros: s.amountMicros,
        costMicros: s.costMicros,
        snapshotAt: this.clock.now(),
      })
      .where(eq(usageRecords.id, id));
  }

  /** release 返回后写平台吸收成本快照。 */
  async writeReleaseSnapshot(id: string, s: { absorbedCostMicros: number }): Promise<void> {
    await this.database.db
      .update(usageRecords)
      .set({
        absorbedCostMicros: s.absorbedCostMicros,
        costMicros: s.absorbedCostMicros,
        snapshotAt: this.clock.now(),
      })
      .where(eq(usageRecords.id, id));
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
};

const TOTALS_SQL = sql`
  count(*)::bigint as calls,
  count(*) filter (where ${usageRecords.status} = 'failed')::bigint as failed_calls,
  coalesce(sum(${usageRecords.inputTokens}), 0)::bigint as input_tokens,
  coalesce(sum(${usageRecords.cachedInputTokens}), 0)::bigint as cached_input_tokens,
  coalesce(sum(${usageRecords.outputTokens}), 0)::bigint as output_tokens,
  coalesce(sum(${usageRecords.inputTokens} + ${usageRecords.cachedInputTokens} + ${usageRecords.outputTokens}), 0)::bigint as total_tokens,
  coalesce(sum(${usageRecords.inputTokens} + ${usageRecords.cachedInputTokens} + ${usageRecords.outputTokens})
    filter (where ${usageRecords.estimated}), 0)::bigint as estimated_tokens,
  coalesce(sum(${usageRecords.chargedMicros})
    filter (where ${usageRecords.billingOwner} = 'user' and ${usageRecords.status} = 'succeeded'), 0)::bigint as charged_micros,
  coalesce(sum(${usageRecords.costMicros}), 0)::bigint as cost_micros,
  coalesce(sum(${usageRecords.absorbedCostMicros}), 0)::bigint as absorbed_cost_micros`;

type TotalsRow = Record<
  | 'calls'
  | 'failed_calls'
  | 'input_tokens'
  | 'cached_input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'estimated_tokens'
  | 'charged_micros'
  | 'cost_micros'
  | 'absorbed_cost_micros',
  string | number | null
>;

function toTotals(r: TotalsRow | undefined): AdminUsageTotals {
  const n = (v: string | number | null | undefined) => Number(v ?? 0);
  return {
    calls: n(r?.calls),
    failedCalls: n(r?.failed_calls),
    inputTokens: n(r?.input_tokens),
    cachedInputTokens: n(r?.cached_input_tokens),
    outputTokens: n(r?.output_tokens),
    totalTokens: n(r?.total_tokens),
    estimatedTokens: n(r?.estimated_tokens),
    chargedMicros: n(r?.charged_micros),
    costMicros: n(r?.cost_micros),
    absorbedCostMicros: n(r?.absorbed_cost_micros),
  };
}

export function toAdminRecord(row: UsageRow): AdminUsageRecord {
  return {
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
  };
}

@Injectable()
export class AdminUsageService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
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
    const order =
      req.sort === 'charged_desc' ? sql`charged_micros desc, ${groupCols}` : groupCols;
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
