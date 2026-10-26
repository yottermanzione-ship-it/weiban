/**
 * 管理端：账户列表、加 / 扣余额（必填原因、幂等、审计，billing.md 8.1）、某用户完整流水、上游账单录入、平台花费。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  microsToPoints,
  type BillingDebtSummary,
  pointsToMicros,
  type AdminAccountSummary,
  type AdminAdjustmentRequest,
  type AdminLedgerEntry,
  type AdminTopupEntry,
  type IdentityAccountStatusPort,
  type IdentityDirectoryPort,
  type UpstreamBill,
} from '@weiban/contracts';
import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
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
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
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
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 所有用户钱包概况。用户名通过 identity 目录端口按500个ID分批读取，不复制到计费表。
   */
  async listAccounts(): Promise<Summary[]> {
    const since = new Date(this.clock.nowMs() - 30 * DAY_MS);
    const { rows } = await this.database.query<{
      user_id: string;
      balance: string;
      held: string;
      bonus: string;
      spent: string | null;
      updated_at: Date;
    }>(
      `SELECT a.user_id, a.balance_micros AS balance, a.held_micros AS held,
              a.bonus_balance_micros AS bonus, a.updated_at,
              (SELECT -sum(l.amount_micros) FROM billing.ledger_entries l
                WHERE l.account_id = a.id AND l.type = 'charge' AND NOT l.absorbed
                  AND l.created_at >= $1) AS spent
         FROM billing.accounts a
        WHERE a.kind = 'user'
        ORDER BY a.created_at, a.id`,
      [since],
    );
    const usernames: Record<string, string> = {};
    for (let offset = 0; offset < rows.length; offset += 500) {
      Object.assign(
        usernames,
        await this.directory.getUsernames(rows.slice(offset, offset + 500).map((r) => r.user_id)),
      );
    }
    return rows.map((r) => {
      const spent = Math.max(0, Number(r.spent ?? 0));
      return {
        userId: r.user_id,
        username: usernames[r.user_id] ?? '',
        balanceMicros: Number(r.balance),
        heldMicros: Number(r.held),
        spentLast30DaysMicros: spent,
        balancePoints: microsToPoints(Number(r.balance)),
        spentLast30DaysPoints: microsToPoints(spent),
        bonusBalanceMicros: Math.max(0, Number(r.bonus ?? 0)),
        bonusBalancePoints: microsToPoints(Math.max(0, Number(r.bonus ?? 0))),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    });
  }

  /** 3.27（H1 先用后扣）：欠费用户（余额 < 0）与欠费金额，欠得多的在前（最多 500 个）。 */
  async listDebts(): Promise<BillingDebtSummary> {
    const { rows: totals } = await this.database.query<{ n: string; total: string | null }>(
      `SELECT count(*)::text AS n, (-sum(balance_micros))::text AS total
         FROM billing.accounts WHERE kind = 'user' AND balance_micros < 0`,
    );
    const { rows } = await this.database.query<{
      user_id: string;
      balance: string;
      last_charge_at: Date | null;
    }>(
      `SELECT a.user_id, a.balance_micros AS balance,
              (SELECT max(l.created_at) FROM billing.ledger_entries l
                WHERE l.account_id = a.id AND l.type = 'charge' AND NOT l.absorbed) AS last_charge_at
         FROM billing.accounts a
        WHERE a.kind = 'user' AND a.balance_micros < 0
        ORDER BY a.balance_micros, a.id
        LIMIT 500`,
    );
    const labels = rows.length
      ? await this.directory.getUserLabels(rows.map((r) => r.user_id))
      : {};
    const totalDebtMicros = Number(totals[0]?.total ?? 0);
    return {
      count: Number(totals[0]?.n ?? 0),
      totalDebtMicros,
      totalDebtPoints: microsToPoints(totalDebtMicros),
      items: rows.map((r) => {
        const balance = Number(r.balance);
        return {
          userId: r.user_id,
          username: labels[r.user_id]?.username ?? '',
          nickname: labels[r.user_id]?.nickname ?? null,
          balanceMicros: balance,
          balancePoints: microsToPoints(balance),
          debtMicros: -balance,
          debtPoints: microsToPoints(-balance),
          lastChargeAt: r.last_charge_at ? new Date(r.last_charge_at).toISOString() : null,
        };
      }),
    };
  }

  /**
   * 加 / 扣余额。幂等键按「用户 + 后台页面生成的键」唯一：重复提交返回第一次的流水；同一个键却换了方向或金额 → 409。
   * 扣减额不能超过可用余额（422 insufficient_balance），需要冲正历史错误用 adjustment（8.1）。
   */
  async adjust(operatorUserId: string, userId: string, req: AdjustRequest): Promise<AdminEntry> {
    if ((await this.status.getAccountStatus(userId)) !== 'active') {
      throw new AppError('not_found', '用户不存在或正在注销');
    }
    // v3.3：amountMicros 与 points 二选一（后台按积分输入，1 积分 = 10,000 微元）。
    if ((req.amountMicros === undefined) === (req.points === undefined)) {
      throw new AppError('bad_request', 'amountMicros 与 points 必须且只能传一个');
    }
    const amountMicros = req.amountMicros ?? pointsToMicros(req.points ?? 0);
    if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
      throw new AppError('bad_request', '金额必须大于 0');
    }
    const key = `admin:${userId}:${req.idempotencyKey}`;
    const type = req.direction === 'grant' ? 'admin_grant' : 'admin_deduct';
    const signed = req.direction === 'grant' ? amountMicros : -amountMicros;
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      const existing = await this.ledger.findByIdempotencyKey(tx, key);
      if (existing) {
        if (existing.type !== type || existing.amountMicros !== signed) {
          throw new AppError('conflict', '这个幂等键已用于另一笔不同的操作');
        }
        return toAdminLedgerEntry(existing);
      }
      if (type === 'admin_deduct' && amountMicros > available(account)) {
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

  /**
   * 3.21：充值记录 —— 管理员加 / 扣积分与注册赠送（开通会员赠送 purpose = membership_bonus 不算）。
   * 平台账户没有 admin_grant / admin_deduct，按类型筛选即可。
   */
  async listTopups(query: {
    userId?: string | undefined;
    kind?: AdminTopupEntry['kind'] | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<{ items: AdminTopupEntry[]; nextCursor: string | null }> {
    const notMembership = or(
      isNull(ledgerEntries.purpose),
      ne(ledgerEntries.purpose, 'membership_bonus'),
    );
    const kindFilter =
      query.kind === 'signup_bonus'
        ? and(eq(ledgerEntries.type, 'admin_grant'), eq(ledgerEntries.purpose, 'signup_bonus'))
        : query.kind === 'grant'
          ? and(
              eq(ledgerEntries.type, 'admin_grant'),
              or(isNull(ledgerEntries.purpose), ne(ledgerEntries.purpose, 'signup_bonus')),
              notMembership,
            )
          : query.kind === 'deduct'
            ? eq(ledgerEntries.type, 'admin_deduct')
            : and(inArray(ledgerEntries.type, ['admin_grant', 'admin_deduct']), notMembership);
    const rows = await this.database.db
      .select({ entry: ledgerEntries, userId: accounts.userId })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(
        and(
          eq(accounts.kind, 'user'),
          kindFilter,
          query.userId ? eq(accounts.userId, query.userId) : undefined,
          query.from ? gte(ledgerEntries.createdAt, new Date(query.from)) : undefined,
          query.to ? lt(ledgerEntries.createdAt, new Date(query.to)) : undefined,
          beforeCursor(query.cursor),
        ),
      )
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const ids = [...new Set(page.map((r) => r.userId).filter((id): id is string => !!id))];
    const usernames = ids.length ? await this.directory.getUsernames(ids) : {};
    const last = page[page.length - 1];
    return {
      items: page.map(({ entry, userId }) => ({
        ...toAdminLedgerEntry(entry),
        userId: userId!,
        username: usernames[userId!] ?? '',
        kind:
          entry.type === 'admin_deduct'
            ? 'deduct'
            : entry.purpose === 'signup_bonus'
              ? 'signup_bonus'
              : 'grant',
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.entry) : null,
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
        WHERE upstream_id IS NOT NULL AND (type = 'charge' OR (type = 'adjustment' AND starts_with(idempotency_key, 'cost_resolution:') AND amount_micros = 0)) AND created_at >= $1
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
