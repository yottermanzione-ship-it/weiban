/** 后台读模型。任务归属只用持久业务键或原始生成编号，业务采用以显式回执为准。 */
import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  type AdminTaskState,
  type AdminTaskFilter,
  type AdminModelTask,
  type AdminTaskAttempt,
} from '@weiban/contracts';
import {
  DATABASE,
  AUDIT_LOG,
  AppError,
  type Database,
  type AuditLog,
} from '../../../platform/index.js';
import { AdminUsageService } from './usage.js';
import { MODEL_ACCESS_CHARGE_QUERY, type ChargeQuery } from '../tokens.js';

const exportLimit = 1000;
const preflight: Record<string, AdminTaskState> = {
  insufficient_balance: 'blocked_balance',
  concurrency_limited: 'blocked_concurrency',
  budget_exceeded: 'blocked_budget',
  request_too_large: 'blocked_request',
};
const dataObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function diagnostics(raw: unknown): AdminTaskAttempt['diagnostic'] {
  const v = dataObject(raw);
  const out: NonNullable<AdminTaskAttempt['diagnostic']> = {};
  for (const k of [
    'httpStatus',
    'retryAfterMs',
    'lastDataMs',
    'firstProgressMs',
    'lastProgressMs',
  ] as const) {
    const n = nonnegative(v[k]);
    if (n !== null) out[k] = n;
  }
  for (const k of [
    'stage',
    'providerCode',
    'requestId',
    'emptyKind',
    'requestField',
    'switchReason',
    'failureDomain',
    'rateLimitScope',
  ] as const) {
    const value = v[k];
    if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value)) out[k] = value;
  }
  return Object.keys(out).length ? out : null;
}
function cursorOf(value?: string) {
  if (!value) return null;
  try {
    const pair: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(pair[0]) &&
      Number.isFinite(Date.parse(pair[0])) &&
      Id.safeParse(pair[1]).success
    )
      return { createdAt: pair[0], id: pair[1] as string };
  } catch {
    /* 非法输入统一返回 400。 */
  }
  throw new AppError('bad_request', '分页游标无效');
}
function nextCursor(stamp: string, id: string) {
  return Buffer.from(JSON.stringify([stamp, id])).toString('base64url');
}

type ListRow = Omit<AdminModelTask, 'startedAt' | 'updatedAt' | 'refundedMicros' | 'retryAt'> & {
  startedAt: Date;
  updatedAt: Date;
  retryAt: Date | null;
  usageIds: string[];
  cursorStamp: string;
};
type AttemptRow = Omit<
  AdminTaskAttempt,
  | 'createdAt'
  | 'completedAt'
  | 'sent'
  | 'deadlineMs'
  | 'timeoutMs'
  | 'progressTimeoutMs'
  | 'overallRemainingMs'
  | 'crossModelReserveMs'
  | 'adapterElapsedMs'
  | 'routePriority'
  | 'diagnostic'
  | 'refundedMicros'
> & {
  createdAt: Date;
  completedAt: Date | null;
  holdId: string | null;
  phase: string | null;
  timing: unknown;
  providerDiagnostic: unknown;
  cursorStamp: string;
};

// 业务键尚未写入的历史记录，仅沿既有生成外键或已验证的网关幂等键归并。
const attemptJoin = `LEFT JOIN LATERAL (SELECT x.generation_id,x.ordinal,x.phase,x.bound_snapshot
 FROM model_access.generation_attempts x WHERE x.usage_record_id=u.id ORDER BY x.ordinal,x.created_at,x.id LIMIT 1) a ON true`;

const taskCte = `    WITH candidates AS MATERIALIZED (
      SELECT coalesce(task_key,id) task_key FROM model_access.usage_records WHERE (($10::uuid IS NULL AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) OR id=$10) AND ($9::uuid[] IS NULL OR user_id=ANY($9))
      UNION SELECT task_key FROM model_access.task_outcomes WHERE created_at >= $1 AND created_at < $2 AND ($9::uuid[] IS NULL OR user_id=ANY($9)) AND $10::uuid IS NULL
    ), scoped AS MATERIALIZED (
      SELECT candidates.task_key,u.id,u.user_id,u.conversation_kind,u.prompt_template_version,u.created_at,u.completed_at,u.hold_id,u.status,u.error_code,u.model_key,u.purpose,u.upstream_id,u.cost_known,u.estimated,u.cost_micros
      FROM candidates JOIN model_access.usage_records u ON u.task_key=candidates.task_key OR (u.task_key IS NULL AND u.id=candidates.task_key)
    ), grouped AS (
      SELECT task_key,min(created_at) started,max(coalesce(completed_at,created_at)) updated,
        (array_agg(purpose ORDER BY created_at,id))[1] purpose,
        (array_agg(user_id ORDER BY created_at,id))[1] owner,
        (array_agg(conversation_kind ORDER BY created_at,id))[1] conversation_kind,
        (array_agg(prompt_template_version ORDER BY created_at,id))[1] template,
        (array_agg(model_key ORDER BY created_at,id))[1] first_model,(array_agg(model_key ORDER BY created_at DESC,id DESC))[1] last_model,
        count(*)::int attempts,count(*) FILTER(WHERE status='failed')::int failed,count(distinct model_key)::int models,
        bool_or(status='pending') pending,bool_and(status='failed') all_failed,
        (array_agg(error_code ORDER BY created_at DESC,id DESC))[1] last_error,
        bool_and(hold_id IS NULL) no_holds,
        coalesce(sum(cost_micros) FILTER(WHERE cost_known AND NOT estimated),0)::float8 reported_cost,
        coalesce(sum(cost_micros) FILTER(WHERE cost_known AND estimated),0)::float8 estimated_cost,
        count(*) FILTER(WHERE NOT cost_known AND status<>'pending')::int pending_costs, array_agg(id ORDER BY created_at,id) ids,
        bool_and(error_code IS NOT DISTINCT FROM 'cancelled') cancelled,
        bool_or(($6::text IS NULL OR model_key=$6) AND ($7::uuid IS NULL OR upstream_id=$7) AND ($8::text IS NULL OR error_code=$8)) match
      FROM scoped GROUP BY task_key
    ), combined AS (
      SELECT c.task_key AS "taskKey",coalesce(t.user_id,g.owner) AS "userId",g.conversation_kind AS "conversationKind",g.template AS "promptTemplateVersion",least(t.created_at,g.started) AS "startedAt",
       greatest(t.updated_at,g.updated) AS "updatedAt",t.retry_at AS "retryAt",coalesce(t.purpose,g.purpose) purpose,
       CASE WHEN t.state='delivered' THEN CASE WHEN t.purpose='proactive' OR t.reason='proactive_sent' THEN 'proactive_sent' ELSE 'message_saved' END
         WHEN t.state='saved' THEN CASE WHEN t.reason IN ('group_memory_saved','memory_facts_saved') OR t.purpose<>'memory' THEN 'result_saved' ELSE 'summary_saved' END WHEN t.state='displayed' THEN 'thought_visible' WHEN t.state='filtered' THEN CASE WHEN t.purpose='behavior_planning' THEN 'thought_filtered' ELSE 'result_filtered' END
         WHEN coalesce(t.reason,g.last_error)='interrupted' THEN 'needs_review'
         WHEN t.state='cancelled' THEN 'cancelled' WHEN t.state='deferred' THEN 'retry_pending'
         WHEN coalesce(t.state='blocked',false) OR (t.state IS NULL AND g.all_failed AND g.no_holds) THEN CASE coalesce(t.reason,g.last_error)
             WHEN 'insufficient_balance' THEN 'blocked_balance' WHEN 'concurrency_limited' THEN 'blocked_concurrency'
             WHEN 'budget_exceeded' THEN 'blocked_budget' WHEN 'request_too_large' THEN 'blocked_request' ELSE 'unverified' END
         WHEN t.state='failed' THEN 'undelivered' WHEN g.pending THEN 'running' WHEN g.cancelled THEN 'cancelled' ELSE 'unverified' END state,
       coalesce(t.reason,g.last_error) reason,coalesce(g.attempts,0) AS "attemptCount",coalesce(g.failed,0) AS "failedAttempts",coalesce(g.models,0) AS "modelCount",
       g.first_model AS "firstModel",g.last_model AS "lastModel",
       COALESCE(t.state IN ('delivered','displayed','saved') AND EXISTS(
          SELECT 1 FROM model_access.usage_records won JOIN model_access.usage_records lost ON won.task_key=lost.task_key AND (lost.created_at,lost.id)<(won.created_at,won.id)
          WHERE won.id=t.usage_record_id AND won.status='succeeded' AND lost.status='failed' AND (won.upstream_id<>lost.upstream_id OR won.model_key<>lost.model_key)
        ),false) rescued,coalesce(g.reported_cost,0) AS "reportedCostMicros",coalesce(g.estimated_cost,0) AS "estimatedCostMicros",
       coalesce(g.pending_costs,0) AS "pendingCosts",coalesce(g.ids,'{}') AS "usageIds"
      FROM candidates c LEFT JOIN grouped g USING(task_key) LEFT JOIN model_access.task_outcomes t USING(task_key)
      WHERE g.match OR (g.task_key IS NULL AND $6 IS NULL AND $7 IS NULL AND $8 IS NULL)
    )
`;
function filterArgs(filter: AdminTaskFilter) {
  const span = Date.parse(filter.to) - Date.parse(filter.from);
  if (!(span > 0 && span <= 93 * 86400000))
    throw new AppError('bad_request', '开始时间须早于结束时间，范围最多 93 天');
  return [
    filter.from,
    filter.to,
    filter.state ?? null,
    filter.rescued ?? null,
    filter.purpose ?? null,
    filter.modelKey ?? null,
    filter.upstreamId ?? null,
    filter.errorCode ?? null,
    filter.userIds ?? null,
    filter.usageRecordId ?? null,
  ];
}
const taskWhere = `(($10::uuid IS NOT NULL) OR ("startedAt" >= $1 AND "startedAt" < $2))
 AND ($3::text IS NULL OR state=$3) AND ($4::bool IS NULL OR rescued=$4) AND ($5::text IS NULL OR purpose=$5)`;

@Injectable()
export class AdminTaskService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(AdminUsageService) private readonly usage: AdminUsageService,
    @Inject(MODEL_ACCESS_CHARGE_QUERY) private readonly billing: ChargeQuery,
  ) {}
  private async money(ids: string[]) {
    if (!this.billing.getUsageAccountAmounts)
      throw new AppError('service_unavailable', '用户账本查询未就绪');
    const totals = new Map<string, { chargedMicros: number; refundedMicros: number }>();
    for (let at = 0; at < ids.length; at += 1000)
      for (const row of await this.billing.getUsageAccountAmounts(ids.slice(at, at + 1000)))
        totals.set(row.usageRecordId, row);
    return totals;
  }
  private async read(filter: AdminTaskFilter, limit: number, token?: string) {
    const c = cursorOf(token);
    const result = await this.db.query<ListRow>(
      `
${taskCte}
    SELECT *,to_char("startedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorStamp" FROM combined WHERE ${taskWhere}
    AND ($11::timestamptz IS NULL OR ("startedAt","taskKey")<($11,$12::uuid))
    ORDER BY "startedAt" DESC,"taskKey" DESC LIMIT $13
  `,
      [...filterArgs(filter), c?.createdAt ?? null, c?.id ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const [amounts, labels] = await Promise.all([
      this.money(rows.flatMap((row) => row.usageIds)),
      this.usage.labelsOf(rows.map((row) => row.userId)),
    ]);
    const items: AdminModelTask[] = rows.map(({ usageIds, cursorStamp: _stamp, ...row }) => {
      let chargedMicros = 0,
        refundedMicros = 0;
      for (const id of usageIds) {
        const amt = amounts.get(id);
        if (!amt) throw new AppError('service_unavailable', '账本返回不完整');
        chargedMicros += amt.chargedMicros;
        refundedMicros += amt.refundedMicros;
      }
      return {
        ...row,
        userLabel: labels[row.userId] ?? null,
        retryAt: row.retryAt?.toISOString() ?? null,
        startedAt: row.startedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        chargedMicros,
        refundedMicros,
      };
    });
    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > limit && last ? nextCursor(last.cursorStamp, last.taskKey) : null,
    };
  }
  async overview(filter: AdminTaskFilter) {
    const result = await this.db.query<{ state: AdminTaskState; count: number; rescued: number }>(
      `${taskCte} SELECT state,count(*)::int count,count(*) filter(where rescued)::int rescued FROM combined WHERE ${taskWhere} GROUP BY state`,
      filterArgs(filter),
    );
    return {
      states: result.rows.map(({ state, count }) => ({ state, count })),
      total: result.rows.reduce((n, r) => n + r.count, 0),
      rescued: result.rows.reduce((n, r) => n + r.rescued, 0),
    };
  }
  list(args: { filter: AdminTaskFilter; limit: number; cursor?: string }) {
    return this.read(args.filter, args.limit, args.cursor);
  }
  async export(adminId: string, filter: AdminTaskFilter) {
    const result = await this.read(filter, exportLimit);
    await this.audit.record({
      module: 'model_access',
      action: 'tasks.exported',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'model_tasks',
      details: { filter, count: result.items.length, truncated: !!result.nextCursor },
    });
    return { items: result.items, truncated: !!result.nextCursor };
  }
  async attempts(args: { taskKey: string; limit: number; cursor?: string }) {
    const c = cursorOf(args.cursor);
    const result = await this.db.query<AttemptRow>(
      `
     SELECT u.id AS "usageRecordId",to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorStamp",u.created_at AS "createdAt",u.completed_at AS "completedAt",u.model_key AS "modelKey",
       u.upstream_id AS "upstreamId",account.name AS "upstreamName",u.upstream_model_id AS "upstreamModelId",
       u.input_tokens AS "inputTokens",u.cached_input_tokens AS "cachedInputTokens",u.output_tokens AS "outputTokens",u.cache_write_5m_tokens AS "cacheWrite5mTokens",u.cache_write_1h_tokens AS "cacheWrite1hTokens",u.reasoning_tokens AS "reasoningTokens",u.price_version_id AS "priceVersionId",
       a.ordinal,u.status,u.error_code AS "errorCode",u.cost_micros::float8 AS "costMicros",u.absorbed_cost_micros::float8 AS "absorbedCostMicros",
       u.cost_known AS "costKnown",u.estimated,u.latency_ms AS "latencyMs",u.hold_id AS "holdId",a.phase,
       a.bound_snapshot->'dispatchTiming' AS timing,a.bound_snapshot->'providerDiagnostic' AS "providerDiagnostic"
     FROM model_access.usage_records u ${attemptJoin} LEFT JOIN model_access.upstreams account ON account.id=u.upstream_id
     WHERE (u.task_key=$1::uuid OR (u.task_key IS NULL AND u.id=$1)) AND ($2::timestamptz IS NULL OR (u.created_at,u.id)>($2,$3::uuid))
     ORDER BY u.created_at,u.id LIMIT $4`,
      [args.taskKey, c?.createdAt ?? null, c?.id ?? null, args.limit + 1],
    );
    const rows = result.rows.slice(0, args.limit);
    const [amounts, holds, versions] = await Promise.all([
      this.money(rows.map((r) => r.usageRecordId)),
      this.billing.getBillingStatesByHoldIds?.(rows.flatMap((r) => (r.holdId ? [r.holdId] : []))) ??
        [],
      this.billing.getHistoricalPriceVersionLabels?.([
        ...new Set(rows.flatMap((row) => (row.priceVersionId ? [row.priceVersionId] : []))),
      ]) ?? [],
    ]);
    const versionLabels = new Map(versions.map((v) => [v.id, v.label]));
    const risk = new Map(holds.map((h) => [h.holdId, h.risk]));
    const items: AdminTaskAttempt[] = rows.map(
      ({ holdId, phase, timing, providerDiagnostic, cursorStamp: _stamp, ...r }) => {
        const t = dataObject(timing),
          sentAt = holdId ? risk.get(holdId)?.sentAt : undefined;
        const amt = amounts.get(r.usageRecordId);
        if (!amt) throw new AppError('service_unavailable', '账本返回不完整');
        const sent =
          t.deadlineMs !== undefined
            ? 'sent'
            : sentAt || phase === 'sent'
              ? 'authorized'
              : r.errorCode === 'route_risk_blocked' ||
                  (!holdId && preflight[r.errorCode ?? '']) ||
                  risk.get(holdId ?? '')?.phase === 'reserved' ||
                  (r.errorCode === 'cancelled' &&
                    risk.has(holdId ?? '') &&
                    risk.get(holdId ?? '')?.phase === 'resolved')
                ? 'not_sent'
                : 'unknown';
        return {
          ...r,
          ...amt,
          priceVersionLabel: r.priceVersionId
            ? (versionLabels.get(r.priceVersionId) ?? null)
            : null,
          sent,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
          overallRemainingMs: nonnegative(t.overallRemainingMs),
          crossModelReserveMs: nonnegative(t.crossModelReserveMs),
          routePriority: nonnegative(t.routePriority),
          deadlineMs: nonnegative(t.deadlineMs),
          timeoutMs: nonnegative(t.timeoutMs),
          progressTimeoutMs: nonnegative(t.progressTimeoutMs),
          adapterElapsedMs: nonnegative(t.adapterElapsedMs),
          diagnostic: diagnostics(providerDiagnostic),
        };
      },
    );
    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > args.limit && last
          ? nextCursor(last.cursorStamp, last.usageRecordId)
          : null,
    };
  }
}
