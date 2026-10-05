/**
 * 计费端口（冻结 / 结算 / 解冻）的实现 + 过期清理。只有 model-access 的模型网关可以注入它（R9）。
 * 流程与规则：billing.md 第 5.3、6、6.6、7 节。所有金额整数微元。
 *
 * 一次冻结（estimateAndReserve）在**一个事务**里完成：
 *   锁用户账户 → 幂等（同一个键返回同一个冻结）→ 取当前价目表估价 → 余额检查（含安全透支）
 *   → 用户后台每日上限 → 平台每日上限原子预留 → 写冻结记录、加 held_micros。
 * 任一检查不通过都不留下冻结（余额不足时只记下 insufficient_since）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ModelPurpose,
  type BillingReservationPort,
  type IdentityReadPort,
  type PortResult,
  type ReleaseInput,
  type ReleaseOutput,
  type ReserveError,
  type ReserveInput,
  type ReserveOutput,
  type SettleInput,
  type SettleOutput,
  type UsageQuantities,
} from '@weiban/contracts';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import {
  APP_CONFIG,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  LOGGER,
  newId,
  type AppConfig,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Logger,
} from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { localDate, PLATFORM_TIME_ZONE, safeTimeZone } from '../domain/local-time.js';
import {
  countsAsBackground,
  HOLD_TTL_MS,
  MIN_HOLD_MICROS,
  priceUsage,
  SAFETY_OVERDRAFT_LIMIT_MICROS_DEFAULT,
  safetyOverdraftEligible,
  validUsage,
} from '../domain/rules.js';
import { accounts, dailySpend, holds } from '../infra/db/schema.js';
import { available, Ledger } from './ledger.js';
import { PlatformBudget } from './platform-budget.js';
import { PriceService } from './prices.js';

type HoldRow = typeof holds.$inferSelect;

/**
 * SettleInput / ReleaseInput 的扩展：上游 ID（对账第 ③ 层、平台花费按上游汇总需要）。
 * 契约暂无此字段，已提变更申请（交接说明）；批准前网关不传，流水上为空。
 */
export interface UpstreamTag {
  upstreamId?: string;
}

/** 把计费内部的程序错误（调用方用错了端口）和业务结果区分开：前者抛出，后者走 PortResult。 */
export class BillingUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingUsageError';
  }
}

const fail = (error: ReserveError, message: string): PortResult<ReserveOutput, ReserveError> => ({
  ok: false,
  error,
  message,
});

@Injectable()
export class ReservationService implements BillingReservationPort {
  private readonly log: Logger;
  readonly safetyOverdraftLimitMicros: number;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(PriceService) private readonly prices: PriceService,
    @Inject(PlatformBudget) private readonly budget: PlatformBudget,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'billing' });
    this.safetyOverdraftLimitMicros =
      config.billing.safetyOverdraftLimitMicros ?? SAFETY_OVERDRAFT_LIMIT_MICROS_DEFAULT;
  }

  // ---------- 冻结 ----------

  async estimateAndReserve(input: ReserveInput): Promise<PortResult<ReserveOutput, ReserveError>> {
    if (!ModelPurpose.safeParse(input.purpose).success) {
      throw new BillingUsageError(`未知用途 ${String(input.purpose)}`);
    }
    if (!input.idempotencyKey || !input.modelKey) {
      throw new BillingUsageError('冻结缺少幂等键或模型键');
    }
    if (!validUsage(input.estimate)) throw new BillingUsageError('估算用量必须是非负数');
    const kind = input.account.kind;
    const userId = input.account.kind === 'user' ? input.account.userId : null;
    // 读用户时区放在事务外（不在持有行锁时等别的查询）
    const timeZone = userId
      ? safeTimeZone((await this.identity.getProfile(userId))?.timeZone)
      : PLATFORM_TIME_ZONE;
    const wantsOverdraft = input.safetyOverdraft === true;
    const overdraftAllowed = safetyOverdraftEligible(input.purpose, kind, input.safetyOverdraft);
    if (wantsOverdraft && !overdraftAllowed) {
      // 网关应已拦下（bad_request）；billing 再校验一次，不满足按普通冻结处理（契约 ReserveInput.safetyOverdraft）
      this.log.warn({ purpose: input.purpose, kind }, '不符合安全优先透支条件，按普通冻结处理');
    }

    return this.database.transaction(async (tx) => {
      let account = userId
        ? await this.ledger.lockUserAccount(tx, userId, timeZone)
        : await this.ledger.lockPlatformAccount(tx);
      if (userId && account.timeZone !== timeZone) {
        await tx.db.update(accounts).set({ timeZone }).where(eq(accounts.id, account.id));
        account = { ...account, timeZone };
      }

      // 幂等：同一个键返回同一个冻结（加锁之后再查，并发的同键请求排队后能看到前一个）
      const [existing] = await tx.db
        .select()
        .from(holds)
        .where(eq(holds.idempotencyKey, input.idempotencyKey));
      if (existing) {
        if (existing.accountId !== account.id) {
          throw new BillingUsageError('同一个幂等键被用于不同的账户');
        }
        return { ok: true, value: this.toReserveOutput(existing) };
      }

      const now = this.clock.now();
      const version = await this.prices.activeVersion(tx);
      if (!version) return fail('price_missing', '没有生效的价目表');
      const rows = await this.prices.modelPrices(tx, version.id, input.modelKey);
      if (rows.length === 0) return fail('price_missing', '当前价目表没有该模型的价格');
      const priced = priceUsage(rows, input.estimate, now, true);
      if (!priced.ok) return fail('price_missing', `当前价目表缺少 ${priced.missingUnit} 的价格`);
      const amount = Math.max(MIN_HOLD_MICROS, priced.sellMicros);
      const reservedCost = priced.costMicros;

      // 余额（平台账户余额可以为负，只受平台每日上限约束，billing.md 第 7 节第 3 条）
      let usedSafetyOverdraft = false;
      if (kind === 'user') {
        const avail = available(account);
        if (avail < amount) {
          if (overdraftAllowed && avail - amount >= -this.safetyOverdraftLimitMicros) {
            usedSafetyOverdraft = true;
          } else {
            await tx.db
              .update(accounts)
              .set({ insufficientSince: now })
              .where(and(eq(accounts.id, account.id), isNull(accounts.insufficientSince)));
            return fail('insufficient_balance', '可用余额不足');
          }
        }
      }

      // 用户后台每日上限（账户行已加锁，同一用户的并发请求已排队）
      const counts = kind === 'user' && countsAsBackground(input.purpose, input.countAsBackground);
      const backgroundDay = counts ? localDate(now, account.timeZone) : null;
      if (backgroundDay) {
        const spent = await this.backgroundSpent(tx, account.id, backgroundDay);
        if (spent + amount > account.backgroundDailyLimitMicros) {
          return fail('budget_exceeded', '今天的后台花费已达上限');
        }
      }

      // 平台每日上限：原子预留（安全透支也不例外，6.6 第 3 条）
      const budgetDay = localDate(now, PLATFORM_TIME_ZONE);
      if (!(await this.budget.reserve(tx, budgetDay, reservedCost))) {
        return fail('budget_exceeded', '平台今日总花费已达上限');
      }

      const hold: HoldRow = {
        id: newId(),
        accountId: account.id,
        amountMicros: amount,
        purpose: input.purpose,
        modelKey: input.modelKey,
        characterId: input.characterId ?? null,
        idempotencyKey: input.idempotencyKey,
        priceVersionId: version.id,
        status: 'active',
        createdAt: now,
        expiresAt: new Date(now.getTime() + HOLD_TTL_MS),
        budgetDay,
        reservedCostMicros: reservedCost,
        countsAsBackground: counts,
        backgroundDay,
        safetyOverdraft: usedSafetyOverdraft,
        closedAt: null,
        ledgerEntryId: null,
        releaseReason: null,
        absorbedCostMicros: null,
      };
      await tx.db.insert(holds).values(hold);
      await this.ledger.changeHeld(tx, account, amount);
      if (usedSafetyOverdraft) {
        // 每次动用透支写一条审计（用户 ID、冻结 ID、金额，不含任何内容；6.6 第 4 条）
        await this.audit.record(
          {
            module: 'billing',
            action: 'safety_overdraft.used',
            actorType: 'system',
            targetType: 'user',
            targetId: userId,
            details: {
              holdId: hold.id,
              amountMicros: amount,
              availableBeforeMicros: available(account),
            },
          },
          tx,
        );
      }
      return { ok: true, value: this.toReserveOutput(hold) };
    });
  }

  // ---------- 结算 ----------

  async settle(input: SettleInput & UpstreamTag): Promise<SettleOutput> {
    if (!validUsage(input.actual)) throw new BillingUsageError('实际用量必须是非负数');
    const startedAt = new Date(input.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new BillingUsageError('startedAt 不是合法时间');
    const hold0 = await this.findHold(input.holdId);

    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockAccountById(tx, hold0.accountId);
      // 幂等：同一条用量记录只扣一次
      const charged = await this.ledger.findChargeByUsage(tx, input.usageRecordId);
      if (charged) {
        if (charged.holdId !== input.holdId) {
          throw new BillingUsageError('这条用量记录已按另一个冻结结算过');
        }
        return {
          ledgerEntryId: charged.id,
          amountMicros: -charged.amountMicros,
          costMicros: charged.costMicros ?? 0,
          balanceAfterMicros: charged.balanceAfterMicros,
        };
      }
      const hold = await this.lockHold(tx, input.holdId);
      if (hold.status === 'settled') {
        throw new BillingUsageError('该冻结已用另一条用量记录结算过');
      }
      if (hold.status === 'released') throw new BillingUsageError('该冻结已解冻，不能再结算');
      // active 或 expired（过期后才回来的结算：照常扣费，billing.md 5.3）
      const wasActive = hold.status === 'active';
      const rows = await this.prices.modelPrices(tx, hold.priceVersionId, hold.modelKey);
      const priced = priceUsage(rows, input.actual, startedAt, false);
      if (!priced.ok) throw new Error('unreachable');
      if (priced.unpricedUnits.length > 0) {
        this.log.error(
          { holdId: hold.id, modelKey: hold.modelKey, units: priced.unpricedUnits },
          '结算用量里有价目表没有定价的单位，按 0 计',
        );
      }
      const amount = priced.sellMicros;
      const { entry, account: after } = await this.ledger.postEntry(tx, account, {
        type: 'charge',
        amountMicros: -amount,
        idempotencyKey: `charge:${input.usageRecordId}`,
        usageRecordId: input.usageRecordId,
        holdId: hold.id,
        purpose: hold.purpose,
        modelKey: hold.modelKey,
        characterId: hold.characterId,
        priceVersionId: hold.priceVersionId,
        upstreamId: input.upstreamId ?? null,
        costMicros: priced.costMicros,
        safetyOverdraft: hold.safetyOverdraft,
        releaseHeldMicros: wasActive ? hold.amountMicros : 0,
      });
      await tx.db
        .update(holds)
        .set({ status: 'settled', closedAt: this.clock.now(), ledgerEntryId: entry.id })
        .where(eq(holds.id, hold.id));
      await this.addDailySpend(
        tx,
        account.id,
        hold.backgroundDay ?? localDate(hold.createdAt, after.timeZone),
        hold.countsAsBackground ? amount : 0,
        amount,
      );
      await this.budget.settle(
        tx,
        hold.budgetDay,
        wasActive ? hold.reservedCostMicros : 0,
        priced.costMicros,
      );
      return {
        ledgerEntryId: entry.id,
        amountMicros: amount,
        costMicros: priced.costMicros,
        balanceAfterMicros: entry.balanceAfterMicros,
      };
    });
  }

  // ---------- 解冻 ----------

  async release(input: ReleaseInput & UpstreamTag): Promise<ReleaseOutput> {
    const hold0 = await this.findHold(input.holdId);
    const startedAt = input.startedAt ? new Date(input.startedAt) : this.clock.now();
    if (Number.isNaN(startedAt.getTime())) throw new BillingUsageError('startedAt 不是合法时间');
    if (input.upstreamUsage && !validUsage(input.upstreamUsage)) {
      throw new BillingUsageError('上游用量必须是非负数');
    }

    return this.database.transaction(async (tx) => {
      let account = await this.ledger.lockAccountById(tx, hold0.accountId);
      const hold = await this.lockHold(tx, input.holdId);
      if (hold.status === 'released') return { absorbedCostMicros: hold.absorbedCostMicros ?? 0 };
      if (hold.status === 'settled') throw new BillingUsageError('该冻结已结算，不能再解冻');
      const wasActive = hold.status === 'active';
      if (wasActive) account = await this.ledger.changeHeld(tx, account, -hold.amountMicros);

      // 失败调用仍被上游收费：按成本价记平台账户「吸收」，用户不付钱（billing.md 6.5）
      let absorbed = 0;
      if (input.upstreamUsage && hasQuantity(input.upstreamUsage)) {
        const rows = await this.prices.modelPrices(tx, hold.priceVersionId, hold.modelKey);
        const priced = priceUsage(rows, input.upstreamUsage, startedAt, false);
        absorbed = priced.ok ? priced.costMicros : 0;
        if (absorbed > 0) {
          const platform =
            account.kind === 'platform' ? account : await this.ledger.lockPlatformAccount(tx);
          await this.ledger.postEntry(tx, platform, {
            type: 'charge',
            amountMicros: -absorbed,
            idempotencyKey: `absorbed:${hold.id}`,
            usageRecordId: input.usageRecordId ?? null,
            holdId: hold.id,
            purpose: hold.purpose,
            modelKey: hold.modelKey,
            characterId: hold.characterId,
            priceVersionId: hold.priceVersionId,
            upstreamId: input.upstreamId ?? null,
            costMicros: absorbed,
            absorbed: true,
            reason: `失败调用仍被上游收费（${input.reason}）`,
          });
        }
      }
      await this.budget.settle(
        tx,
        hold.budgetDay,
        wasActive ? hold.reservedCostMicros : 0,
        absorbed,
      );
      await tx.db
        .update(holds)
        .set({
          status: 'released',
          closedAt: this.clock.now(),
          releaseReason: input.reason,
          absorbedCostMicros: absorbed,
        })
        .where(eq(holds.id, hold.id));
      return { absorbedCostMicros: absorbed };
    });
  }

  // ---------- 过期清理（定时任务每分钟一次，billing.md 5.3） ----------

  /** 把已过期仍为 active 的冻结改为 expired、释放额度、归还平台预算。返回处理条数。 */
  async expireHolds(limit = 500): Promise<number> {
    const now = this.clock.now();
    const due = await this.database.db
      .select({ id: holds.id, accountId: holds.accountId })
      .from(holds)
      .where(and(eq(holds.status, 'active'), lte(holds.expiresAt, now)))
      .limit(limit);
    let count = 0;
    for (const { id, accountId } of due) {
      const expired = await this.database.transaction(async (tx) => {
        const account = await this.ledger.lockAccountById(tx, accountId);
        const hold = await this.lockHold(tx, id);
        if (hold.status !== 'active') return false;
        await this.ledger.changeHeld(tx, account, -hold.amountMicros);
        await this.budget.settle(tx, hold.budgetDay, hold.reservedCostMicros, 0);
        await tx.db
          .update(holds)
          .set({ status: 'expired', closedAt: this.clock.now() })
          .where(eq(holds.id, id));
        return true;
      });
      if (expired) count += 1;
    }
    if (count > 0) this.log.warn({ count }, '清理了过期未结算的冻结（网关进程可能崩溃过）');
    return count;
  }

  // ---------- 内部 ----------

  /** 今天（用户当地日期）后台已结算 + 当前后台冻结。 */
  async backgroundSpent(tx: DbTx, accountId: string, day: string): Promise<number> {
    const { rows } = await tx.query<{ settled: string | null; held: string | null }>(
      `SELECT
         (SELECT background_settled_micros FROM billing.daily_spend
           WHERE account_id = $1 AND day = $2) AS settled,
         (SELECT sum(amount_micros) FROM billing.holds
           WHERE account_id = $1 AND status = 'active' AND counts_as_background
             AND background_day = $2) AS held`,
      [accountId, day],
    );
    return Number(rows[0]?.settled ?? 0) + Number(rows[0]?.held ?? 0);
  }

  private async addDailySpend(
    tx: DbTx,
    accountId: string,
    day: string,
    background: number,
    total: number,
  ): Promise<void> {
    await tx.db
      .insert(dailySpend)
      .values({
        accountId,
        day,
        backgroundSettledMicros: background,
        totalChargedMicros: total,
      })
      .onConflictDoUpdate({
        target: [dailySpend.accountId, dailySpend.day],
        set: {
          backgroundSettledMicros: sql`${dailySpend.backgroundSettledMicros} + ${background}`,
          totalChargedMicros: sql`${dailySpend.totalChargedMicros} + ${total}`,
        },
      });
  }

  private async findHold(holdId: string): Promise<HoldRow> {
    const [hold] = await this.database.db.select().from(holds).where(eq(holds.id, holdId));
    if (!hold) throw new BillingUsageError('冻结记录不存在');
    return hold;
  }

  private async lockHold(tx: DbTx, holdId: string): Promise<HoldRow> {
    const [hold] = await tx.db.select().from(holds).where(eq(holds.id, holdId)).for('update');
    if (!hold) throw new BillingUsageError('冻结记录不存在');
    return hold;
  }

  private toReserveOutput(hold: HoldRow): ReserveOutput {
    return {
      holdId: hold.id,
      amountMicros: hold.amountMicros,
      priceVersionId: hold.priceVersionId,
      usedSafetyOverdraft: hold.safetyOverdraft,
    };
  }
}

function hasQuantity(usage: UsageQuantities): boolean {
  return Object.values(usage).some((v) => typeof v === 'number' && v > 0);
}
