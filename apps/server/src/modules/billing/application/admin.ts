/**
 * 管理端：账户列表、加 / 扣余额（必填原因、幂等、审计，billing.md 8.1）、某用户完整流水、上游账单录入、平台花费。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminAccountSummary,
  AdminAdjustmentRequest,
  AdminLedgerEntry,
  IdentityAccountStatusPort,
  UpstreamBill,
} from '@weiban/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  APP_CONFIG,
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  newId,
  type AppConfig,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { daysBetween, localDate, PLATFORM_TIME_ZONE } from '../domain/local-time.js';
import { accounts, ledgerEntries, upstreamBills } from '../infra/db/schema.js';
import { available, Ledger, type LedgerRow } from './ledger.js';
import { PlatformBudget } from './platform-budget.js';
import { beforeCursor, encodeCursor, toLedgerEntry } from './wallet.js';

type AdjustRequest = z.output<typeof AdminAdjustmentRequest>;
type Summary = z.output<typeof AdminAccountSummary>;
type AdminEntry = z.output<typeof AdminLedgerEntry>;
type Bill = z.output<typeof UpstreamBill>;

const DAY_MS = 86_400_000;

export function toAdminLedgerEntry(row: LedgerRow): AdminEntry {
  return {
    ...toLedgerEntry(row),
    costMicros: row.costMicros,
    usageRecordId: row.usageRecordId,
    priceVersionId: row.priceVersionId,
    operatorUserId: row.operatorUserId,
    absorbed: row.absorbed,
    safetyOverdraft: row.safetyOverdraft,
  };
}

@Injectable()
export class BillingAdminService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(PlatformBudget) private readonly budget: PlatformBudget,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly status: IdentityAccountStatusPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 所有用户钱包概况。username 暂为空字符串：identity 的端口还没有「按 ID 取用户名」的方法，
   * 已提契约变更申请（交接说明）；批准前管理后台用用户 ID 显示。
   */
  async listAccounts(): Promise<Summary[]> {
    const since = new Date(this.clock.nowMs() - 30 * DAY_MS);
    const { rows } = await this.database.query<{
      user_id: string;
      balance: string;
      held: string;
      spent: string | null;
      updated_at: Date;
    }>(
      `SELECT a.user_id, a.balance_micros AS balance, a.held_micros AS held, a.updated_at,
              (SELECT -sum(l.amount_micros) FROM billing.ledger_entries l
                WHERE l.account_id = a.id AND l.type = 'charge' AND NOT l.absorbed
                  AND l.created_at >= $1) AS spent
         FROM billing.accounts a
        WHERE a.kind = 'user'
        ORDER BY a.created_at, a.id`,
      [since],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: '',
      balanceMicros: Number(r.balance),
      heldMicros: Number(r.held),
      spentLast30DaysMicros: Math.max(0, Number(r.spent ?? 0)),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /**
   * 加 / 扣余额。幂等键按「用户 + 后台页面生成的键」唯一：重复提交返回第一次的流水；同一个键却换了方向或金额 → 409。
   * 扣减额不能超过可用余额（422 insufficient_balance），需要冲正历史错误用 adjustment（8.1）。
   */
  async adjust(operatorUserId: string, userId: string, req: AdjustRequest): Promise<AdminEntry> {
    if ((await this.status.getAccountStatus(userId)) !== 'active') {
      throw new AppError('not_found', '用户不存在或正在注销');
    }
    const key = `admin:${userId}:${req.idempotencyKey}`;
    const type = req.direction === 'grant' ? 'admin_grant' : 'admin_deduct';
    const signed = req.direction === 'grant' ? req.amountMicros : -req.amountMicros;
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      const existing = await this.ledger.findByIdempotencyKey(tx, key);
      if (existing) {
        if (existing.type !== type || existing.amountMicros !== signed) {
          throw new AppError('conflict', '这个幂等键已用于另一笔不同的操作');
        }
        return toAdminLedgerEntry(existing);
      }
      if (type === 'admin_deduct' && req.amountMicros > available(account)) {
        throw new AppError('insufficient_balance', '扣减额不能超过用户的可用余额');
      }
      const { entry } = await this.ledger.postEntry(tx, account, {
        type,
        amountMicros: signed,
        idempotencyKey: key,
        reason: req.reason,
        operatorUserId,
      });
      await this.audit.record(
        {
          module: 'billing',
          action: `wallet.${type}`,
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'user',
          targetId: userId,
          details: { entryId: entry.id, amountMicros: signed, reason: req.reason },
        },
        tx,
      );
      return toAdminLedgerEntry(entry);
    });
  }

  async listAccountLedger(
    userId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: AdminEntry[]; nextCursor: string | null }> {
    const [account] = await this.database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    if (!account) throw new AppError('not_found', '该用户还没有钱包');
    const rows = await this.database.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.accountId, account.id), beforeCursor(query.cursor)))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toAdminLedgerEntry),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async createUpstreamBill(
    operatorUserId: string,
    input: {
      upstreamId: string;
      periodStart: string;
      periodEnd: string;
      amountMicros: number;
      note: string | null;
    },
  ): Promise<Bill> {
    if (daysBetween(input.periodStart, input.periodEnd) < 0) {
      throw new AppError('bad_request', '账单开始日期不能晚于结束日期');
    }
    const row = {
      id: newId(),
      upstreamId: input.upstreamId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amountMicros: input.amountMicros,
      note: input.note,
      createdAt: this.clock.now(),
      createdBy: operatorUserId,
    };
    await this.database.transaction(async (tx) => {
      await tx.db.insert(upstreamBills).values(row);
      await this.audit.record(
        {
          module: 'billing',
          action: 'upstream_bill.created',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'upstream',
          targetId: input.upstreamId,
          details: { billId: row.id, amountMicros: input.amountMicros },
        },
        tx,
      );
    });
    return {
      billId: row.id,
      upstreamId: row.upstreamId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      amountMicros: row.amountMicros,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async platformSummary(): Promise<{
    todayCostMicros: number;
    dailyCapMicros: number;
    platformAccountBalanceMicros: number;
    last30DaysCostByUpstream: Array<{ upstreamId: string; costMicros: number }>;
  }> {
    const now = this.clock.now();
    const today = localDate(now, PLATFORM_TIME_ZONE);
    const budget = await this.database.transaction((tx) => this.budget.today(tx, today));
    const [platform] = await this.database.db
      .select({ balance: accounts.balanceMicros })
      .from(accounts)
      .where(eq(accounts.kind, 'platform'));
    const { rows } = await this.database.query<{ upstream_id: string; cost: string }>(
      `SELECT upstream_id, sum(cost_micros) AS cost FROM billing.ledger_entries
        WHERE upstream_id IS NOT NULL AND type = 'charge' AND created_at >= $1
        GROUP BY upstream_id ORDER BY upstream_id`,
      [new Date(now.getTime() - 30 * DAY_MS)],
    );
    return {
      todayCostMicros: budget.settled,
      dailyCapMicros: this.config.billing.platformDailyCapMicros,
      platformAccountBalanceMicros: platform?.balance ?? 0,
      last30DaysCostByUpstream: rows.map((r) => ({
        upstreamId: r.upstream_id,
        costMicros: Number(r.cost),
      })),
    };
  }
}
