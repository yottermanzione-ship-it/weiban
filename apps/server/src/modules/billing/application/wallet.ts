/**
 * 用户端：钱包、提醒线与后台上限设置、流水分页、用量汇总；以及只读端口 BillingReadPort.getSpendStatus。
 * 钱包按需创建（billing.md 8.3 第 3 条）：用户第一次打开余额页时还没有钱包就建一个余额 0 的。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  BillingReadPort,
  IdentityReadPort,
  LedgerEntry,
  SpendStatus,
  UsageSummaryQuery,
  Wallet,
} from '@weiban/contracts';
import { and, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  CLOCK,
  DATABASE,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import {
  addDays,
  daysBetween,
  localDate,
  nextLocalMidnight,
  safeTimeZone,
  startOfLocalDay,
} from '../domain/local-time.js';
import { categoryOf } from '../domain/rules.js';
import { accounts, ledgerEntries } from '../infra/db/schema.js';
import { available, Ledger, type AccountRow, type LedgerRow } from './ledger.js';
import { ReservationService } from './reservations.js';

type UsageQuery = z.output<typeof UsageSummaryQuery>;

/** 用量汇总一次最多查这么多天。 */
const MAX_SUMMARY_DAYS = 366;

export function encodeCursor(row: Pick<LedgerRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(time ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new AppError('bad_request', '分页游标不正确');
  }
  return { createdAt, id };
}

/** 按时间倒序分页的条件：严格早于游标那一条。 */
export function beforeCursor(cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const c = decodeCursor(cursor);
  return or(
    lt(ledgerEntries.createdAt, c.createdAt),
    and(eq(ledgerEntries.createdAt, c.createdAt), lt(ledgerEntries.id, c.id)),
  );
}

export function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    entryId: row.id,
    type: row.type as LedgerEntry['type'],
    amountMicros: row.amountMicros,
    balanceAfterMicros: row.balanceAfterMicros,
    category: categoryOf(row.purpose),
    modelKey: row.modelKey,
    characterId: row.characterId,
    note: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class WalletService implements BillingReadPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async timeZoneOf(userId: string): Promise<string> {
    return safeTimeZone((await this.identity.getProfile(userId))?.timeZone);
  }

  async getWallet(userId: string): Promise<Wallet> {
    const timeZone = await this.timeZoneOf(userId);
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId, timeZone);
      return this.toWallet(tx, account);
    });
  }

  async updateSettings(
    userId: string,
    patch: { lowBalanceThresholdMicros?: number; backgroundDailyLimitMicros?: number },
  ): Promise<Wallet> {
    const timeZone = await this.timeZoneOf(userId);
    return this.database.transaction(async (tx) => {
      let account = await this.ledger.lockUserAccount(tx, userId, timeZone);
      const set: Partial<AccountRow> = {};
      if (patch.lowBalanceThresholdMicros !== undefined) {
        set.lowBalanceThresholdMicros = patch.lowBalanceThresholdMicros;
      }
      if (patch.backgroundDailyLimitMicros !== undefined) {
        set.backgroundDailyLimitMicros = patch.backgroundDailyLimitMicros;
      }
      if (Object.keys(set).length > 0) {
        const [updated] = await tx.db
          .update(accounts)
          .set({ ...set, updatedAt: this.clock.now(), version: account.version + 1 })
          .where(eq(accounts.id, account.id))
          .returning();
        if (updated) account = updated;
      }
      return this.toWallet(tx, account);
    });
  }

  async listLedger(
    userId: string,
    query: { type: 'topup' | 'spend' | 'all'; cursor?: string; limit: number },
  ): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
    const [account] = await this.database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    if (!account) return { items: [], nextCursor: null };
    const typeFilter =
      query.type === 'topup'
        ? gt(ledgerEntries.amountMicros, 0)
        : query.type === 'spend'
          ? lt(ledgerEntries.amountMicros, 0)
          : undefined;
    const rows = await this.database.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.accountId, account.id), typeFilter, beforeCursor(query.cursor)))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toLedgerEntry),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /** 用量汇总：按用户当地日期 [from, to]（含两端），只算调用扣费（charge，不含平台吸收）。 */
  async usageSummary(
    userId: string,
    query: UsageQuery,
  ): Promise<{
    rows: Array<{ key: string; amountMicros: number; calls: number }>;
    totalMicros: number;
  }> {
    const span = daysBetween(query.from, query.to);
    if (span < 0 || span >= MAX_SUMMARY_DAYS) {
      throw new AppError('bad_request', `日期范围不正确（from ≤ to，最多 ${MAX_SUMMARY_DAYS} 天）`);
    }
    const timeZone = await this.timeZoneOf(userId);
    const [account] = await this.database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    if (!account) return { rows: [], totalMicros: 0 };
    const keyExpr: Record<UsageQuery['groupBy'], string> = {
      day: `to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD')`,
      character: `coalesce(character_id::text, 'none')`,
      category: `coalesce(purpose, 'none')`,
      model: `coalesce(model_key, 'none')`,
    };
    const { rows } = await this.database.query<{ key: string; amount: string; calls: string }>(
      `SELECT ${keyExpr[query.groupBy]} AS key, -sum(amount_micros) AS amount, count(*) AS calls
         FROM billing.ledger_entries
        WHERE account_id = $1 AND type = 'charge' AND NOT absorbed
          AND created_at >= $2 AND created_at < $3
        GROUP BY 1 ORDER BY 1`,
      [
        account.id,
        startOfLocalDay(query.from, timeZone),
        startOfLocalDay(addDays(query.to, 1), timeZone),
        ...(query.groupBy === 'day' ? [timeZone] : []),
      ],
    );
    // 用途 → 分组（billing.md 5.2）在代码里换算，同组合并
    const merged = new Map<string, { amountMicros: number; calls: number }>();
    for (const r of rows) {
      const key = query.groupBy === 'category' ? (categoryOf(r.key) ?? 'none') : r.key;
      const acc = merged.get(key) ?? { amountMicros: 0, calls: 0 };
      acc.amountMicros += Number(r.amount);
      acc.calls += Number(r.calls);
      merged.set(key, acc);
    }
    const result = [...merged.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { rows: result, totalMicros: result.reduce((s, r) => s + r.amountMicros, 0) };
  }

  // ---------- BillingReadPort ----------

  async getSpendStatus(userId: string): Promise<SpendStatus> {
    const [account] = await this.database.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));
    if (!account) {
      return {
        availableMicros: 0,
        depleted: true,
        insufficient: true,
        backgroundRemainingTodayMicros: 0,
      };
    }
    const avail = available(account);
    const today = localDate(this.clock.now(), account.timeZone);
    const spent = await this.database.transaction((tx) =>
      this.reservations.backgroundSpent(tx, account.id, today),
    );
    return {
      availableMicros: avail,
      depleted: avail <= 0,
      insufficient: avail <= 0 || account.insufficientSince !== null,
      backgroundRemainingTodayMicros: Math.max(0, account.backgroundDailyLimitMicros - spent),
    };
  }

  private async toWallet(tx: DbTx, account: AccountRow): Promise<Wallet> {
    const now = this.clock.now();
    const today = localDate(now, account.timeZone);
    const spent = await this.reservations.backgroundSpent(tx, account.id, today);
    return {
      balanceMicros: account.balanceMicros,
      heldMicros: account.heldMicros,
      availableMicros: available(account),
      lowBalanceThresholdMicros: account.lowBalanceThresholdMicros,
      backgroundBudget: {
        dailyLimitMicros: account.backgroundDailyLimitMicros,
        spentTodayMicros: spent,
        resetsAt: nextLocalMidnight(now, account.timeZone).toISOString(),
      },
      updatedAt: account.updatedAt.toISOString(),
    };
  }
}
