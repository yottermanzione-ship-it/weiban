/**
 * 每日对账（billing.md 8.2，每天凌晨 3:30 北京时间对前一天跑一次，结果在管理后台查看；同一天重跑覆盖）。
 *
 * ① 账本自洽：每个账户 流水合计 = balance_micros；held_micros = 有效冻结合计；超过 1 小时仍 active 的冻结；
 *    用户钱包余额低于 −(安全透支上限 + 1 元)。任一不满足 → ledgerConsistent = false，异常明细存 details。
 * ② 用量与扣费一一对应：需要 model-access 的用量记录（D-L0-08 尚未实现），billing 不能读别的 schema。
 *    本模块已提供按日 / 按用量记录 ID 的只读查询（ChargeLookup），比对由 model-access 侧完成（契约变更申请）；
 *    在那之前 usageWithoutCharge / chargeWithoutUsage 记 0，details.usageCheck = 'pending_model_access'。
 * ③ 与上游账单比对：近 35 天内结束的账单，按成本价汇总同期（北京时间）流水的 cost_micros，偏差超过阈值标红。
 *
 * 异常时「标红、通知管理员」：写审计日志 + 错误级日志（管理员通知渠道尚未实现，见交接说明）。不自动修复。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReconciliationRun } from '@weiban/contracts';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { z } from 'zod';
import {
  APP_CONFIG,
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  LOGGER,
  newId,
  type AppConfig,
  type AuditLog,
  type Clock,
  type Database,
  type Logger,
} from '../../../platform/index.js';
import {
  addDays,
  daysBetween,
  localDate,
  PLATFORM_TIME_ZONE,
  startOfLocalDay,
} from '../domain/local-time.js';
import { OVERDRAFT_ALERT_MARGIN_MICROS, STALE_HOLD_MS } from '../domain/rules.js';
import { reconciliationRuns, upstreamBills } from '../infra/db/schema.js';
import { ReservationService } from './reservations.js';

type Run = z.output<typeof ReconciliationRun>;
type RunRow = typeof reconciliationRuns.$inferSelect;

/** 第 ③ 层看多久以内结束的账单。 */
const BILL_LOOKBACK_DAYS = 35;

export interface ReconciliationDetails {
  balanceMismatches: Array<{ accountId: string; balanceMicros: number; ledgerSumMicros: number }>;
  heldMismatches: Array<{ accountId: string; heldMicros: number; activeHoldsMicros: number }>;
  overdrawnAccounts: Array<{ accountId: string; userId: string | null; balanceMicros: number }>;
  staleHoldIds: string[];
  usageCheck: 'pending_model_access';
}

@Injectable()
export class ReconciliationService {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'billing' });
  }

  /** 定时任务入口：对「昨天」（北京时间）对账。 */
  async runForYesterday(): Promise<Run> {
    return this.run(addDays(localDate(this.clock.now(), PLATFORM_TIME_ZONE), -1));
  }

  async run(date: string): Promise<Run> {
    const now = this.clock.now();
    const db = this.database;

    const balance = await db.query<{ id: string; balance: string; total: string | null }>(
      `SELECT a.id, a.balance_micros AS balance,
              (SELECT sum(l.amount_micros) FROM billing.ledger_entries l WHERE l.account_id = a.id) AS total
         FROM billing.accounts a`,
    );
    const balanceMismatches = balance.rows
      .filter((r) => Number(r.balance) !== Number(r.total ?? 0))
      .map((r) => ({
        accountId: r.id,
        balanceMicros: Number(r.balance),
        ledgerSumMicros: Number(r.total ?? 0),
      }));

    const held = await db.query<{ id: string; held: string; active: string | null }>(
      `SELECT a.id, a.held_micros AS held,
              (SELECT sum(h.amount_micros) FROM billing.holds h
                WHERE h.account_id = a.id AND h.status = 'active') AS active
         FROM billing.accounts a`,
    );
    const heldMismatches = held.rows
      .filter((r) => Number(r.held) !== Number(r.active ?? 0))
      .map((r) => ({
        accountId: r.id,
        heldMicros: Number(r.held),
        activeHoldsMicros: Number(r.active ?? 0),
      }));

    const stale = await db.query<{ id: string }>(
      `SELECT id FROM billing.holds WHERE status = 'active' AND created_at < $1 ORDER BY created_at`,
      [new Date(now.getTime() - STALE_HOLD_MS)],
    );

    const floor = -(this.reservations.safetyOverdraftLimitMicros + OVERDRAFT_ALERT_MARGIN_MICROS);
    const overdrawn = await db.query<{ id: string; user_id: string | null; balance: string }>(
      `SELECT id, user_id, balance_micros AS balance FROM billing.accounts
        WHERE kind = 'user' AND balance_micros < $1`,
      [floor],
    );
    const overdrawnAccounts = overdrawn.rows.map((r) => ({
      accountId: r.id,
      userId: r.user_id,
      balanceMicros: Number(r.balance),
    }));

    const dayStart = startOfLocalDay(date, PLATFORM_TIME_ZONE);
    const dayEnd = startOfLocalDay(addDays(date, 1), PLATFORM_TIME_ZONE);
    const absorbed = await db.query<{ total: string | null }>(
      `SELECT -sum(amount_micros) AS total FROM billing.ledger_entries
        WHERE absorbed AND created_at >= $1 AND created_at < $2`,
      [dayStart, dayEnd],
    );

    // ③ 上游账单
    const threshold = this.config.billing.upstreamDiffRatio;
    const bills = await db.db
      .select()
      .from(upstreamBills)
      .where(
        and(
          gte(upstreamBills.periodEnd, addDays(date, -BILL_LOOKBACK_DAYS)),
          lte(upstreamBills.periodEnd, date),
        ),
      )
      .orderBy(asc(upstreamBills.periodEnd), asc(upstreamBills.createdAt));
    const upstreamDiffs: Run['upstreamDiffs'] = [];
    for (const bill of bills) {
      const { rows } = await db.query<{ cost: string | null }>(
        `SELECT sum(cost_micros) AS cost FROM billing.ledger_entries
          WHERE upstream_id = $1 AND type = 'charge' AND created_at >= $2 AND created_at < $3`,
        [
          bill.upstreamId,
          startOfLocalDay(bill.periodStart, PLATFORM_TIME_ZONE),
          startOfLocalDay(addDays(bill.periodEnd, 1), PLATFORM_TIME_ZONE),
        ],
      );
      const computed = Number(rows[0]?.cost ?? 0);
      const base = Math.max(bill.amountMicros, computed, 1);
      const diffRatio = Math.abs(bill.amountMicros - computed) / base;
      upstreamDiffs.push({
        upstreamId: bill.upstreamId,
        periodStart: bill.periodStart,
        periodEnd: bill.periodEnd,
        billedMicros: bill.amountMicros,
        computedCostMicros: computed,
        diffRatio: Math.round(diffRatio * 10_000) / 10_000,
        flagged: diffRatio > threshold,
      });
    }

    const details: ReconciliationDetails = {
      balanceMismatches,
      heldMismatches,
      overdrawnAccounts,
      staleHoldIds: stale.rows.map((r) => r.id),
      usageCheck: 'pending_model_access',
    };
    const ledgerConsistent =
      balanceMismatches.length === 0 &&
      heldMismatches.length === 0 &&
      overdrawnAccounts.length === 0;
    const row: RunRow = {
      id: newId(),
      runDate: date,
      ledgerConsistent,
      staleHolds: stale.rows.length,
      usageWithoutCharge: 0,
      chargeWithoutUsage: 0,
      upstreamDiffs,
      absorbedMicros: Math.max(0, Number(absorbed.rows[0]?.total ?? 0)),
      details,
      diffRatioThreshold: threshold,
      createdAt: now,
    };
    const flagged = !ledgerConsistent || row.staleHolds > 0 || upstreamDiffs.some((d) => d.flagged);
    await db.transaction(async (tx) => {
      await tx.db.delete(reconciliationRuns).where(eq(reconciliationRuns.runDate, date));
      await tx.db.insert(reconciliationRuns).values(row);
      if (flagged) {
        await this.audit.record(
          {
            module: 'billing',
            action: 'reconciliation.flagged',
            actorType: 'system',
            targetType: 'reconciliation_run',
            targetId: row.id,
            details: {
              date,
              balanceMismatches: balanceMismatches.length,
              heldMismatches: heldMismatches.length,
              overdrawnAccounts: overdrawnAccounts.length,
              staleHolds: row.staleHolds,
              flaggedBills: upstreamDiffs.filter((d) => d.flagged).length,
            },
          },
          tx,
        );
      }
    });
    if (flagged) this.log.error({ date, runId: row.id }, '对账发现异常，请到管理后台查看');
    else this.log.info({ date, runId: row.id }, '对账完成，无异常');
    return this.toRun(row);
  }

  async list(from: string, to: string): Promise<Run[]> {
    if (daysBetween(from, to) < 0) throw new AppError('bad_request', 'from 不能晚于 to');
    const rows = await this.database.db
      .select()
      .from(reconciliationRuns)
      .where(and(gte(reconciliationRuns.runDate, from), lte(reconciliationRuns.runDate, to)))
      .orderBy(asc(reconciliationRuns.runDate));
    return rows.map((r) => this.toRun(r));
  }

  /**
   * 对账第 ② 层 / 金额快照修复要用的只读查询：按用量记录 ID 查扣费（用户扣费 + 平台吸收）。
   * 待契约变更申请批准后挂到 BillingReadPort（交接说明）；当前只在 billing 内部与测试使用。
   */
  async chargesByUsage(usageRecordIds: readonly string[]): Promise<
    Array<{
      usageRecordId: string;
      ledgerEntryId: string;
      amountMicros: number;
      costMicros: number;
      absorbed: boolean;
      safetyOverdraft: boolean;
    }>
  > {
    if (usageRecordIds.length === 0) return [];
    const { rows } = await this.database.query<{
      usage_record_id: string;
      id: string;
      amount: string;
      cost: string | null;
      absorbed: boolean;
      safety_overdraft: boolean;
    }>(
      `SELECT usage_record_id, id, amount_micros AS amount, cost_micros AS cost, absorbed, safety_overdraft
         FROM billing.ledger_entries
        WHERE type = 'charge' AND usage_record_id = ANY($1::uuid[])
        ORDER BY created_at, id`,
      [usageRecordIds],
    );
    return rows.map((r) => ({
      usageRecordId: r.usage_record_id,
      ledgerEntryId: r.id,
      amountMicros: -Number(r.amount),
      costMicros: Number(r.cost ?? 0),
      absorbed: r.absorbed,
      safetyOverdraft: r.safety_overdraft,
    }));
  }

  /** 某天的异常明细（管理后台的契约暂无此字段，命令行 / 排查用）。 */
  async details(date: string): Promise<ReconciliationDetails | null> {
    const [row] = await this.database.db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.runDate, date));
    return row ? (row.details as ReconciliationDetails) : null;
  }

  private toRun(row: RunRow): Run {
    return {
      runId: row.id,
      date: row.runDate,
      ledgerConsistent: row.ledgerConsistent,
      staleHolds: row.staleHolds,
      usageWithoutCharge: row.usageWithoutCharge,
      chargeWithoutUsage: row.chargeWithoutUsage,
      upstreamDiffs: row.upstreamDiffs as Run['upstreamDiffs'],
      absorbedMicros: row.absorbedMicros,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
