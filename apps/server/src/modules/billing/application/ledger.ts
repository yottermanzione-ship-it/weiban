/**
 * 账户与流水的核心写入（billing 内部共用）：取账户并加行锁、按需创建钱包、写一条流水并同事务改余额、
 * 按 billing.md 6.3 第 3 条发余额事件。所有改余额的路径（结算、管理员加扣、注册赠送、平台吸收）都经过 postEntry。
 *
 * 并发：调用方必须在事务里先用 lockUserAccount / lockPlatformAccount 拿到加锁的账户行（SELECT ... FOR UPDATE），
 * 同一账户的并发操作因此排队，余额不会算错（billing.md 5.2 第 1 条）。
 * 加锁顺序（防死锁）：用户账户 → 平台账户 → 冻结记录 → 平台每日预算行。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LedgerEntryType } from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import {
  CLOCK,
  newId,
  OUTBOX,
  type Clock,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import {
  DEFAULT_BACKGROUND_DAILY_LIMIT_MICROS,
  DEFAULT_LOW_BALANCE_THRESHOLD_MICROS,
} from '../domain/rules.js';
import { localDate, PLATFORM_TIME_ZONE, safeTimeZone } from '../domain/local-time.js';
import { accounts, ledgerEntries } from '../infra/db/schema.js';

export type AccountRow = typeof accounts.$inferSelect;
export type LedgerRow = typeof ledgerEntries.$inferSelect;

export interface NewEntry {
  type: LedgerEntryType;
  /** 有符号：加钱为正，扣钱为负。 */
  amountMicros: number;
  idempotencyKey: string;
  usageRecordId?: string | null;
  holdId?: string | null;
  purpose?: string | null;
  modelKey?: string | null;
  characterId?: string | null;
  priceVersionId?: string | null;
  upstreamId?: string | null;
  costMicros?: number | null;
  absorbed?: boolean;
  safetyOverdraft?: boolean;
  reason?: string | null;
  operatorUserId?: string | null;
  /** 同时释放的冻结额（结算时：held_micros 减去该冻结；默认 0）。 */
  releaseHeldMicros?: number;
}

export const available = (a: Pick<AccountRow, 'balanceMicros' | 'heldMicros'>) =>
  a.balanceMicros - a.heldMicros;

@Injectable()
export class Ledger {
  constructor(
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 用户钱包：不存在则创建（余额 0、默认提醒线与后台上限），已存在则不动；返回加锁后的行。 */
  async lockUserAccount(tx: DbTx, userId: string, timeZone?: string | null): Promise<AccountRow> {
    await this.createUserAccountIfMissing(tx, userId, timeZone);
    const [row] = await tx.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .for('update');
    if (!row) throw new Error('钱包创建后读取失败');
    return row;
  }

  /** 钱包按需创建（billing.md 8.3 第 3 条）：已存在则跳过。返回是否新建。 */
  async createUserAccountIfMissing(
    tx: DbTx,
    userId: string,
    timeZone?: string | null,
  ): Promise<boolean> {
    const now = this.clock.now();
    const inserted = await tx.db
      .insert(accounts)
      .values({
        id: newId(),
        kind: 'user',
        userId,
        balanceMicros: 0,
        heldMicros: 0,
        lowBalanceThresholdMicros: DEFAULT_LOW_BALANCE_THRESHOLD_MICROS,
        backgroundDailyLimitMicros: DEFAULT_BACKGROUND_DAILY_LIMIT_MICROS,
        timeZone: safeTimeZone(timeZone),
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .onConflictDoNothing()
      .returning({ id: accounts.id });
    return inserted.length > 0;
  }

  async lockPlatformAccount(tx: DbTx): Promise<AccountRow> {
    const now = this.clock.now();
    await tx.db
      .insert(accounts)
      .values({
        id: newId(),
        kind: 'platform',
        userId: null,
        balanceMicros: 0,
        heldMicros: 0,
        lowBalanceThresholdMicros: 0,
        backgroundDailyLimitMicros: 0,
        timeZone: PLATFORM_TIME_ZONE,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .onConflictDoNothing();
    const [row] = await tx.db
      .select()
      .from(accounts)
      .where(eq(accounts.kind, 'platform'))
      .for('update');
    if (!row) throw new Error('平台账户创建后读取失败');
    return row;
  }

  /** 按账户 ID 加锁读取（结算 / 解冻 / 过期用）。 */
  async lockAccountById(tx: DbTx, accountId: string): Promise<AccountRow> {
    const [row] = await tx.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for('update');
    if (!row) throw new Error('账户不存在');
    return row;
  }

  /** 按幂等键查已有流水（同一笔操作重复提交只记一次）。 */
  async findByIdempotencyKey(tx: DbTx, key: string): Promise<LedgerRow | null> {
    const [row] = await tx.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, key));
    return row ?? null;
  }

  async findChargeByUsage(tx: DbTx, usageRecordId: string): Promise<LedgerRow | null> {
    const [row] = await tx.db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.usageRecordId, usageRecordId),
          eq(ledgerEntries.type, 'charge'),
          eq(ledgerEntries.absorbed, false),
        ),
      );
    return row ?? null;
  }

  /**
   * 在已加锁的账户上写一条流水并改余额（同一事务）。返回新流水和改后的账户。
   * 用户钱包按 billing.md 6.3 第 3 条发事件：
   * - 每次余额变化：billing.balance_changed；
   * - 余额减少且可用余额从 > 0 变为 ≤ 0：billing.balance_depleted；
   * - 余额减少后可用余额低于提醒线（当地同一天最多一次）：billing.balance_low；
   * - 余额增加且（可用余额从 ≤ 0 回到 > 0，或 insufficient_since 不为空且增加后 > 0）：billing.balance_restored，
   *   并清空 insufficient_since。
   * 冻结 / 解冻 / 过期不经过这里（它们不改余额，不发 balance_restored，6.3 第 3 条）。
   */
  async postEntry(
    tx: DbTx,
    account: AccountRow,
    entry: NewEntry,
  ): Promise<{ entry: LedgerRow; account: AccountRow }> {
    const now = this.clock.now();
    const held = account.heldMicros - (entry.releaseHeldMicros ?? 0);
    // 「之前」不算这次结算释放的冻结：冻结额正好用光可用余额、结算后变负，也算一次「耗尽」
    const before = account.balanceMicros - held;
    const balance = account.balanceMicros + entry.amountMicros;
    const after = balance - held;
    const row: LedgerRow = {
      id: newId(),
      accountId: account.id,
      createdAt: now,
      type: entry.type,
      amountMicros: entry.amountMicros,
      balanceAfterMicros: balance,
      idempotencyKey: entry.idempotencyKey,
      usageRecordId: entry.usageRecordId ?? null,
      holdId: entry.holdId ?? null,
      purpose: entry.purpose ?? null,
      modelKey: entry.modelKey ?? null,
      characterId: entry.characterId ?? null,
      priceVersionId: entry.priceVersionId ?? null,
      upstreamId: entry.upstreamId ?? null,
      costMicros: entry.costMicros ?? null,
      absorbed: entry.absorbed ?? false,
      safetyOverdraft: entry.safetyOverdraft ?? false,
      reason: entry.reason ?? null,
      operatorUserId: entry.operatorUserId ?? null,
    };
    await tx.db.insert(ledgerEntries).values(row);

    let insufficientSince = account.insufficientSince;
    let lowNotifiedOn = account.lowNotifiedOn;
    const userId = account.kind === 'user' ? account.userId : null;
    if (userId) {
      await this.outbox.publish(tx, 'billing.balance_changed', 'billing', {
        userId,
        balanceMicros: balance,
        availableMicros: after,
        entryType: entry.type,
      });
      if (entry.amountMicros > 0) {
        const trigger =
          before <= 0 && after > 0
            ? ('crossed_zero' as const)
            : insufficientSince !== null && after > 0
              ? ('topped_up_after_rejection' as const)
              : null;
        if (trigger) {
          await this.outbox.publish(tx, 'billing.balance_restored', 'billing', {
            userId,
            availableMicros: after,
            trigger,
          });
          insufficientSince = null;
        }
      } else if (entry.amountMicros < 0) {
        if (before > 0 && after <= 0) {
          await this.outbox.publish(tx, 'billing.balance_depleted', 'billing', { userId });
        }
        const today = localDate(now, account.timeZone);
        const threshold = account.lowBalanceThresholdMicros;
        if (threshold > 0 && after < threshold && lowNotifiedOn !== today) {
          await this.outbox.publish(tx, 'billing.balance_low', 'billing', {
            userId,
            availableMicros: after,
            thresholdMicros: threshold,
          });
          lowNotifiedOn = today;
        }
      }
    }

    const [updated] = await tx.db
      .update(accounts)
      .set({
        balanceMicros: balance,
        heldMicros: held,
        insufficientSince,
        lowNotifiedOn,
        updatedAt: now,
        version: account.version + 1,
      })
      .where(eq(accounts.id, account.id))
      .returning();
    if (!updated) throw new Error('账户更新失败');
    return { entry: row, account: updated };
  }

  /** 只改冻结额（冻结 / 解冻 / 过期），不写流水、不发余额事件。 */
  async changeHeld(tx: DbTx, account: AccountRow, delta: number): Promise<AccountRow> {
    const [updated] = await tx.db
      .update(accounts)
      .set({
        heldMicros: account.heldMicros + delta,
        updatedAt: this.clock.now(),
        version: account.version + 1,
      })
      .where(eq(accounts.id, account.id))
      .returning();
    if (!updated) throw new Error('账户更新失败');
    return updated;
  }
}
