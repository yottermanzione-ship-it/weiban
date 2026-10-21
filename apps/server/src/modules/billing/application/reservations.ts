/**
 * 计费端口（冻结 / 结算 / 解冻）的实现 + 过期清理。只有 model-access 的模型网关可以注入它（R9）。
 * 流程与规则：billing.md 第 5.3、6、6.6、7 节。所有金额整数微元。
 *
 * 一次冻结（estimateAndReserve）在**一个事务**里完成：
 *   锁用户账户 → 幂等（同一个键返回同一个冻结）→ 取当前价目表估价 → 余额检查（禁止用户透支）
 *   → 用户后台每日上限 → 平台每日上限原子预留 → 写冻结记录、加 held_micros。
 * 任一检查不通过都不留下冻结（余额不足时只记下 insufficient_since）。
 *
 * 3.27（H1，总经理 10-21「先用后扣、可欠一次」，取代上面「禁止用户透支」）：用户付费调用（postpaid）
 *   不再冻结积分：只要求可用余额 > 0；异常巨额（按实际发送的上下文 + 最大输出预估）先拦截；
 *   同一用户同时进行的付费调用有上限（满了前台排队几秒、后台直接拒绝）；结算按实际用量全额扣，余额可以变负。
 *   余额为负后 available ≤ 0，后续一切付费调用在这里被拒，直到充值。平台账户不受影响。
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
import { and, eq, lte, sql } from 'drizzle-orm';
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
  applyDiscount,
  countsAsBackground,
  HOLD_TTL_MS,
  priceUsage,
  priceUsageCeiling,
  splitSettlementCost,
  validUsage,
} from '../domain/rules.js';
import { accounts, dailySpend, holds, priceVersions } from '../infra/db/schema.js';
import { available, Ledger } from './ledger.js';
import { PlatformBudget } from './platform-budget.js';
import { PriceService } from './prices.js';
import { PostpaidSettingsService, type PostpaidLimits } from './postpaid-settings.js';

type HoldRow = typeof holds.$inferSelect;

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

/** 3.27：并发上限只数最近这么久内开始、仍未结算的付费调用（进程崩溃留下的冻结不会把用户卡 10 分钟）。 */
export const CONCURRENCY_WINDOW_MS = 120_000;
/** 3.27：前台调用排队时多久重试一次。 */
const CONCURRENCY_POLL_MS = 300;
/** 内部信号：并发已满（由外层决定排队还是拒绝）。 */
const BUSY = Symbol('busy');

@Injectable()
export class ReservationService implements BillingReservationPort {
  private readonly log: Logger;
  /** 旧查询兼容属性，不再参与任何用户付款资格。 */
  readonly safetyOverdraftLimitMicros = 0;

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
    @Inject(PostpaidSettingsService) private readonly postpaid: PostpaidSettingsService,
  ) {
    this.log = logger.child({ module: 'billing' });
    void config; // 旧透支环境配置不再赋予权限。
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
    // 3.27：用户付费调用的保护参数；后台任务（生态、记忆整理等）并发满了不排队，前台调用最多等几秒。
    const limits = userId ? await this.postpaid.limits() : null;
    const background =
      countsAsBackground(input.purpose, input.countAsBackground) || input.ecologyTask === true;
    const waitUntil = performance.now() + (limits && !background ? limits.concurrencyWaitMs : 0);
    for (;;) {
      const result = await this.reserveOnce(input, kind, userId, timeZone, limits);
      if (result !== BUSY) return result;
      if (performance.now() + CONCURRENCY_POLL_MS > waitUntil)
        return fail('concurrency_limited', '同时进行的付费调用太多，请稍后再试');
      await new Promise((resolve) => setTimeout(resolve, CONCURRENCY_POLL_MS));
    }
  }

  private async reserveOnce(
    input: ReserveInput,
    kind: 'user' | 'platform',
    userId: string | null,
    timeZone: string,
    limits: PostpaidLimits | null,
  ): Promise<PortResult<ReserveOutput, ReserveError> | typeof BUSY> {
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
        if (existing.modelKey !== input.modelKey || existing.purpose !== input.purpose)
          throw new BillingUsageError('同一幂等键不能更换模型或用途');
        if (!existing.limitSnapshot || !input.ceiling)
          return fail('price_missing', '旧冻结缺少已验证上限，不能作为新调用授权');
        const fields = [
          'inputTokens',
          'cachedInputTokens',
          'cacheWrite5mTokens',
          'cacheWrite1hTokens',
          'outputTokens',
          'images',
          'ttsChars',
          'asrSeconds',
          'realtimeSeconds',
          'searchCalls',
        ] as const;
        if (
          existing.limitSnapshot.evidence !== input.ceiling.evidence ||
          JSON.stringify(existing.limitSnapshot.pricingModels ?? []) !==
            JSON.stringify(input.ceiling.pricingModels ?? []) ||
          (input.priceVersionId !== undefined &&
            existing.priceVersionId !== input.priceVersionId) ||
          fields.some(
            (k) => (existing.limitSnapshot!.usage[k] ?? 0) !== (input.ceiling!.usage[k] ?? 0),
          )
        )
          throw new BillingUsageError('同一幂等键不能更换已批准计费上限');
        if (existing.status !== 'active' || existing.expiresAt.getTime() <= this.clock.nowMs())
          return fail(
            'price_missing',
            '冻结已关闭或过期；已有结果应从缓存重放，新尝试必须用独立编号',
          );
        return { ok: true, value: this.toReserveOutput(existing) };
      }

      const now = this.clock.now();
      const version = input.priceVersionId
        ? (
            await tx.db
              .select()
              .from(priceVersions)
              .where(eq(priceVersions.id, input.priceVersionId))
          )[0]
        : await this.prices.activeVersion(tx);
      if (!version) return fail('price_missing', '没有生效的价目表');
      if (version.status !== 'active' && version.status !== 'retired')
        return fail('price_missing', '不能按未生效价目表调用');
      const rows = await this.prices.modelPrices(tx, version.id, input.modelKey);
      if (rows.length === 0) return fail('price_missing', '当前价目表没有该模型的价格');
      if (!input.ceiling || !input.ceiling.evidence.trim() || !validUsage(input.ceiling.usage))
        return fail('price_missing', '需配置并验证计费上限');
      const priced = priceUsageCeiling(rows, input.ceiling.usage);
      if (!priced.ok) return fail('price_missing', `当前价目表缺少 ${priced.missingUnit} 的价格`);
      // 3.22：限时折扣在冻结时锁定（holds.discount_bp），结算按同一折扣；只打售价，成本不变。
      const discountBp = await this.prices.discountBp(tx, input.modelKey, this.clock.now());
      let amount = applyDiscount(priced.sellMicros, discountBp);
      let reservedCost = priced.costMicros;
      // 3.27：按实际发送的上下文 + 最大输出估价（异常巨额拦截用）；估不出来时按上限算（宁严勿松）。
      const estimateOf = (r: typeof rows, bp: number, fallback: number) => {
        const e = priceUsageCeiling(r, input.estimate);
        return e.ok && Number.isSafeInteger(e.sellMicros) ? applyDiscount(e.sellMicros, bp) : fallback;
      };
      let estimate = estimateOf(rows, discountBp, amount);
      for (const alternative of new Set(input.ceiling.pricingModels ?? [])) {
        const alternativeRows = await this.prices.modelPrices(tx, version.id, alternative);
        const upper = priceUsageCeiling(alternativeRows, input.ceiling.usage);
        if (!alternativeRows.length || !upper.ok)
          return fail('price_missing', '备用模型缺少完整上限定价');
        const alternativeBp = await this.prices.discountBp(tx, alternative, this.clock.now());
        const alternativeSell = applyDiscount(upper.sellMicros, alternativeBp);
        amount = Math.max(amount, alternativeSell);
        reservedCost = Math.max(reservedCost, upper.costMicros);
        estimate = Math.max(estimate, estimateOf(alternativeRows, alternativeBp, alternativeSell));
      }
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(reservedCost))
        return fail('price_missing', '计费上限超出安全金额范围');
      estimate = Math.min(estimate, amount);
      // 3.27：用户付费调用一律先用后扣（不冻结）；平台账户不变。
      const postpaid = kind === 'user';

      // 余额（平台账户余额可以为负，只受平台每日上限约束，billing.md 第 7 节第 3 条）。
      // 3.27：用户只要求可用余额 > 0（先用后扣）；免费模型（售价 0）不受影响。
      if (kind === 'user' && amount > 0 && available(account) <= 0) {
        const counts = input.ecologyTask === true;
        await tx.db
          .update(accounts)
          .set({
            insufficientSince: account.insufficientSince ?? now,
            ...(counts && !account.ecologyInsufficientSince
              ? { ecologyInsufficientSince: now, ecologyNoticePending: true }
              : {}),
          })
          .where(eq(accounts.id, account.id));
        return fail('insufficient_balance', '积分不足，充值后继续');
      }
      if (postpaid && amount > 0 && limits) {
        // 3.27：异常巨额请求先拦截（不调用、不扣费），写审计便于后台排查。
        if (estimate > limits.largeRequestLimitMicros) {
          await this.audit.record(
            {
              module: 'billing',
              action: 'postpaid.request_too_large',
              actorType: 'system',
              targetType: 'account',
              targetId: account.id,
              details: {
                modelKey: input.modelKey,
                purpose: input.purpose,
                estimateMicros: estimate,
                limitMicros: limits.largeRequestLimitMicros,
                estimate: input.estimate,
              },
            },
            tx,
          );
          return fail('request_too_large', '这次请求预估花费异常大，已拦截');
        }
        // 3.27：同一用户同时进行的付费调用上限（账户行已加锁，并发冻结在这里排队，计数准确）。
        const inFlight = await this.inFlightPaidCalls(tx, account.id);
        if (inFlight >= limits.maxConcurrentPaidCalls) return BUSY;
      }

      // 用户后台每日上限（账户行已加锁，同一用户的并发请求已排队）
      const counts = kind === 'user' && countsAsBackground(input.purpose, input.countAsBackground);
      const backgroundDay = counts ? localDate(now, account.timeZone) : null;
      if (backgroundDay) {
        const spent = await this.backgroundSpent(tx, account.id, backgroundDay);
        if (spent + (postpaid ? estimate : amount) > account.backgroundDailyLimitMicros) {
          return fail('budget_exceeded', '今天的后台花费已达上限');
        }
      }

      // 平台每日上限：原子预留。v3.3（ADR-0032）：只约束平台账户（管理员侧任务）；
      // 用户真实付费调用不占平台预算；已知售价0但成本>0则由平台承担，先预留其成本。
      const budgetDay = localDate(now, PLATFORM_TIME_ZONE);
      const usesPlatformBudget =
        kind === 'platform' ||
        input.reservePlatformRisk === true ||
        (amount === 0 && reservedCost > 0);
      if (usesPlatformBudget && !(await this.budget.reserve(tx, budgetDay, reservedCost))) {
        return fail('budget_exceeded', '平台今日总花费已达上限');
      }

      const hold: HoldRow = {
        id: newId(),
        accountId: account.id,
        amountMicros: postpaid ? 0 : amount,
        purpose: input.purpose,
        modelKey: input.modelKey,
        characterId: input.characterId ?? null,
        idempotencyKey: input.idempotencyKey,
        priceVersionId: version.id,
        status: 'active',
        createdAt: now,
        expiresAt: new Date(now.getTime() + HOLD_TTL_MS),
        budgetDay,
        reservedCostMicros: usesPlatformBudget ? reservedCost : 0,
        countsAsBackground: counts,
        backgroundDay,
        safetyOverdraft: false,
        closedAt: null,
        ledgerEntryId: null,
        releaseReason: null,
        absorbedCostMicros: null,
        limitSnapshot: input.ceiling,
        settlementSnapshot: null,
        releaseSnapshot: null,
        riskSnapshot: { phase: 'reserved', costUpperMicros: reservedCost, uncertainMicros: 0 },
        discountBp,
        postpaid,
        estimateMicros: postpaid ? estimate : 0,
      };
      await tx.db.insert(holds).values(hold);
      if (!postpaid) await this.ledger.changeHeld(tx, account, amount);
      return { ok: true, value: this.toReserveOutput(hold) };
    });
  }

  /** 仅首次从未发送的有效冻结授权供应商调用；响应丢失也不重复授权。 */
  async beginCall(input: {
    holdId: string;
    usageRecordId: string;
    upstreamId: string;
    upstreamModelId: string;
  }): Promise<boolean> {
    const initial = await this.findHold(input.holdId);
    return this.database.transaction(async (tx) => {
      await this.ledger.lockAccountById(tx, initial.accountId);
      const hold = await this.lockHold(tx, input.holdId);
      if (
        hold.status !== 'active' ||
        hold.expiresAt.getTime() <= this.clock.nowMs() ||
        hold.riskSnapshot?.phase !== 'reserved'
      )
        return false;
      // 3.26（G3-2）：同一路由有「成本待核」的旧调用时不再拒绝新调用（总经理确认：缺用量不暂停线路）。
      // 待核风险照常记在平台预算与对账里，由后台核实；这里只保留锁，和写入待核风险串行。
      await this.lockCallRoute(tx, input.upstreamId, input.upstreamModelId);
      await tx.db
        .update(holds)
        .set({
          riskSnapshot: {
            ...hold.riskSnapshot,
            phase: 'sent',
            usageRecordId: input.usageRecordId,
            upstreamId: input.upstreamId,
            upstreamModelId: input.upstreamModelId,
            sentAt: this.clock.now().toISOString(),
          },
        })
        .where(eq(holds.id, hold.id));
      return true;
    });
  }

  // ---------- 结算 ----------

  async settle(input: SettleInput): Promise<SettleOutput> {
    if (!validUsage(input.actual)) throw new BillingUsageError('实际用量必须是安全范围内的非负数');
    const startedAt = new Date(input.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new BillingUsageError('startedAt 不是合法时间');
    const hold0 = await this.findHold(input.holdId);
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockAccountById(tx, hold0.accountId);
      const platformAccount =
        account.kind === 'user' ? await this.ledger.lockPlatformAccount(tx) : null;
      const hold = await this.lockHold(tx, input.holdId);
      const charged = await this.ledger.findChargeByUsage(tx, input.usageRecordId);
      if (
        hold.riskSnapshot?.usageRecordId &&
        hold.riskSnapshot.usageRecordId !== input.usageRecordId
      )
        throw new BillingUsageError('用量编号与已发送调用不一致');
      if (charged) {
        if (charged.holdId !== hold.id)
          throw new BillingUsageError('这条用量记录已按另一个冻结结算过');
        return (
          hold.settlementSnapshot ?? {
            ledgerEntryId: charged.id,
            amountMicros: -charged.amountMicros,
            costMicros: charged.costMicros ?? 0,
            balanceAfterMicros: charged.balanceAfterMicros,
          }
        );
      }
      if (hold.status === 'settled') throw new BillingUsageError('该冻结已用另一条用量记录结算过');
      const priorAbsorbed =
        hold.status === 'released'
          ? await this.ledger.findByIdempotencyKey(tx, `absorbed:${hold.id}`)
          : null;
      if (priorAbsorbed?.usageRecordId && priorAbsorbed.usageRecordId !== input.usageRecordId)
        throw new BillingUsageError('旧解冻已关联其它用量，不可用另一结果重结');
      const wasActive = hold.status === 'active';
      const stillReserved = wasActive && hold.expiresAt.getTime() > this.clock.nowMs();
      const rows = await this.prices.modelPrices(tx, hold.priceVersionId, hold.modelKey);
      const actualKnown = input.actualKnown !== false;
      // 3.26：上游没报用量时网关按本地分词估算（actualEstimated）。按估算计费，同样受冻结上限保护、不透支。
      const usageEstimated = actualKnown && input.actualEstimated === true;
      const rawPriced = priceUsage(rows, actualKnown ? input.actual : {}, startedAt, false);
      if (!rawPriced.ok) throw new BillingUsageError('实际用量无法定价');
      // 3.22：按冻结时锁定的限时折扣计售价（与报价、冻结同一算式 applyDiscount）；成本不变。
      const priced = {
        ...rawPriced,
        sellMicros: applyDiscount(rawPriced.sellMicros, hold.discountBp ?? 10_000),
      };
      if (![priced.sellMicros, priced.costMicros].every(Number.isSafeInteger))
        throw new BillingUsageError('供应商实际用量金额超出安全范围，需人工核对');
      // 已释放/过期的用户资金没有授权再抢占；历史不一致也不能侵占其它hold。
      // 3.27：先用后扣的冻结没有上限，按实际用量全额扣（余额可以变负）；迟到 / 过期的结算也照扣。
      const userLimit = hold.postpaid
        ? Number.MAX_SAFE_INTEGER
        : stillReserved
          ? Math.max(0, Math.min(hold.amountMicros, available(account) + hold.amountMicros))
          : 0;
      const previousAbsorbed = hold.status === 'released' ? (hold.absorbedCostMicros ?? 0) : 0;
      // 已人工核实的供应商成本不被极迟响应/价目表推算重新覆盖。
      const verifiedCost = hold.riskSnapshot?.resolution?.costMicros;
      const costKnown =
        verifiedCost !== undefined || (actualKnown && priced.unpricedUnits.length === 0);
      const knownCost =
        verifiedCost ??
        (costKnown ? priced.costMicros : Math.max(priced.costMicros, previousAbsorbed));
      const amount =
        account.kind === 'platform'
          ? costKnown
            ? priced.sellMicros
            : Math.max(priced.sellMicros, previousAbsorbed)
          : !costKnown
            ? 0
            : Math.min(priced.sellMicros, userLimit);
      const allocation =
        account.kind === 'platform'
          ? {
              chargedCostMicros: knownCost - previousAbsorbed,
              absorbedCostMicros: previousAbsorbed,
            }
          : splitSettlementCost(knownCost, amount, priced.sellMicros);
      const reason = !actualKnown
        ? 'usage_unknown'
        : hold.postpaid
          ? 'postpaid'
          : !stillReserved
          ? 'late_unreserved'
          : amount < priced.sellMicros
            ? 'reservation_capped'
            : 'within_reservation';
      const { entry, account: after } = await this.ledger.postEntry(tx, account, {
        type: 'charge',
        // 平台旧release已扣成本时，迟到settle只追加余额差额，原流水不改。
        amountMicros: -(amount - (account.kind === 'platform' ? previousAbsorbed : 0)),
        idempotencyKey: `charge:${input.usageRecordId}`,
        usageRecordId: input.usageRecordId,
        holdId: hold.id,
        purpose: hold.purpose,
        modelKey: hold.modelKey,
        characterId: hold.characterId,
        priceVersionId: hold.priceVersionId,
        upstreamId: input.upstreamId ?? null,
        costMicros: allocation.chargedCostMicros,
        safetyOverdraft: false,
        releaseHeldMicros: wasActive ? hold.amountMicros : 0,
        reason: amount < priced.sellMicros ? '冻结上限保护，差额不向用户补扣' : null,
        allowNegative: hold.postpaid,
      });
      const absorptionDelta = allocation.absorbedCostMicros - previousAbsorbed;
      if (account.kind === 'user' && absorptionDelta !== 0) {
        // 复用失败吸收账本；迟到提供更准成本时仅追加差额，不能重复算原成本。
        const platform = platformAccount ?? (await this.ledger.lockPlatformAccount(tx));
        await this.ledger.postEntry(tx, platform, {
          type: 'charge',
          amountMicros: -absorptionDelta,
          idempotencyKey: `absorbed_settle:${input.usageRecordId}`,
          usageRecordId: input.usageRecordId,
          holdId: hold.id,
          purpose: hold.purpose,
          modelKey: hold.modelKey,
          characterId: hold.characterId,
          priceVersionId: hold.priceVersionId,
          upstreamId: input.upstreamId ?? null,
          costMicros: absorptionDelta,
          absorbed: true,
          reason: `预冻结保护：${reason}（供应商成本差额）`,
        });
      }
      const output: SettleOutput = {
        ledgerEntryId: entry.id,
        amountMicros: amount,
        costMicros: knownCost,
        balanceAfterMicros: entry.balanceAfterMicros,
        ...allocation,
        theoreticalMicros: priced.sellMicros,
        waivedMicros: Math.max(0, priced.sellMicros - amount),
        costKnown,
        unpricedUnits: actualKnown ? priced.unpricedUnits : ['missing_or_invalid_usage'],
        ...(usageEstimated ? { usageEstimated: true } : {}),
      };
      const risk = await this.updateRisk(tx, hold, costKnown, knownCost, wasActive);
      output.uncertainCostMicros = risk.snapshot?.uncertainMicros ?? 0;
      await tx.db
        .update(holds)
        .set({
          status: 'settled',
          closedAt: this.clock.now(),
          ledgerEntryId: entry.id,
          absorbedCostMicros: allocation.absorbedCostMicros,
          settlementSnapshot: output,
          riskSnapshot: risk.snapshot,
        })
        .where(eq(holds.id, hold.id));
      await this.addDailySpend(
        tx,
        account.id,
        hold.backgroundDay ?? localDate(hold.createdAt, after.timeZone),
        hold.countsAsBackground ? amount : 0,
        amount,
      );
      if (account.kind === 'platform' || hold.reservedCostMicros > 0 || absorptionDelta !== 0)
        await this.budget.settle(
          tx,
          hold.budgetDay,
          risk.remainingReserved,
          account.kind === 'platform' ? knownCost - previousAbsorbed : absorptionDelta,
        );
      if (
        (reason !== 'within_reservation' && reason !== 'postpaid') ||
        priced.unpricedUnits.length
      )
        await this.audit.record(
          {
            module: 'billing',
            action: 'prehold.settlement_protected',
            actorType: 'system',
            targetType: 'hold',
            targetId: hold.id,
            details: {
              reason,
              actual: input.actual,
              chargedMicros: amount,
              theoreticalMicros: priced.sellMicros,
              ...allocation,
              unpricedUnits: priced.unpricedUnits,
              usageEstimated,
            },
          },
          tx,
        );
      return output;
    });
  }

  // ---------- 解冻 ----------

  async release(input: ReleaseInput): Promise<ReleaseOutput> {
    const hold0 = await this.findHold(input.holdId);
    const startedAt = input.startedAt ? new Date(input.startedAt) : this.clock.now();
    if (Number.isNaN(startedAt.getTime())) throw new BillingUsageError('startedAt 不是合法时间');
    if (input.upstreamUsage && !validUsage(input.upstreamUsage)) {
      throw new BillingUsageError('上游用量必须是非负数');
    }

    return this.database.transaction(async (tx) => {
      let account = await this.ledger.lockAccountById(tx, hold0.accountId);
      const platformAccount =
        account.kind === 'user' ? await this.ledger.lockPlatformAccount(tx) : null;
      const hold = await this.lockHold(tx, input.holdId);
      if (hold.status === 'released')
        return (
          hold.releaseSnapshot ?? {
            absorbedCostMicros: hold.absorbedCostMicros ?? 0,
            costKnown: false,
          }
        );
      if (hold.status === 'settled') throw new BillingUsageError('该冻结已结算，不能再解冻');
      if (
        input.usageRecordId &&
        hold.riskSnapshot?.usageRecordId &&
        hold.riskSnapshot.usageRecordId !== input.usageRecordId
      )
        throw new BillingUsageError('用量编号与已发送调用不一致');
      const wasActive = hold.status === 'active';
      if (wasActive) account = await this.ledger.changeHeld(tx, account, -hold.amountMicros);

      // 失败调用仍被上游收费：按成本价记平台账户「吸收」，用户不付钱（billing.md 6.5）
      let absorbed = 0;
      // 3.26：upstreamUsageEstimated = 网关按本地估算给出的用量（上游没报），平台按估算吸收成本。
      const usageEstimated =
        input.upstreamUsage !== undefined && input.upstreamUsageEstimated === true;
      let costKnown = input.upstreamUsage !== undefined || hold.riskSnapshot?.phase === 'reserved';
      let unpricedUnits: string[] = [];
      if (input.upstreamUsage && hasQuantity(input.upstreamUsage)) {
        const rows = await this.prices.modelPrices(tx, hold.priceVersionId, hold.modelKey);
        const priced = priceUsage(rows, input.upstreamUsage, startedAt, false);
        costKnown =
          priced.ok && priced.unpricedUnits.length === 0 && Number.isSafeInteger(priced.costMicros);
        unpricedUnits = priced.unpricedUnits;
        if (priced.ok && !Number.isSafeInteger(priced.costMicros))
          unpricedUnits.push('unsafe_cost');
        absorbed = priced.ok && Number.isSafeInteger(priced.costMicros) ? priced.costMicros : 0;
        if (absorbed > 0) {
          const platform = account.kind === 'platform' ? account : platformAccount!;
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
            reason: `失败调用仍被上游收费（${input.reason}${usageEstimated ? '，按估算用量' : ''}）`,
          });
        }
      }
      const risk = await this.updateRisk(tx, hold, costKnown, absorbed, wasActive);
      await this.budget.settle(tx, hold.budgetDay, risk.remainingReserved, absorbed);
      await tx.db
        .update(holds)
        .set({
          status: 'released',
          closedAt: this.clock.now(),
          releaseReason: input.reason,
          absorbedCostMicros: absorbed,
          releaseSnapshot: {
            absorbedCostMicros: absorbed,
            costKnown,
            unpricedUnits,
            uncertainCostMicros: risk.snapshot?.uncertainMicros ?? 0,
            ...(usageEstimated ? { usageEstimated: true } : {}),
          },
          riskSnapshot: risk.snapshot,
        })
        .where(eq(holds.id, hold.id));
      if (!costKnown)
        await this.audit.record(
          {
            module: 'billing',
            action: 'prehold.failure_cost_unknown',
            actorType: 'system',
            targetType: 'hold',
            targetId: hold.id,
            details: {
              usageRecordId: input.usageRecordId ?? null,
              reported: input.upstreamUsage ?? null,
              unpricedUnits,
            },
          },
          tx,
        );
      return {
        absorbedCostMicros: absorbed,
        costKnown,
        unpricedUnits,
        uncertainCostMicros: risk.snapshot?.uncertainMicros ?? 0,
        ...(usageEstimated ? { usageEstimated: true } : {}),
      };
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
        const risk = await this.updateRisk(
          tx,
          hold,
          hold.riskSnapshot?.phase === 'reserved',
          0,
          true,
        );
        await this.budget.settle(tx, hold.budgetDay, risk.remainingReserved, 0);
        await tx.db
          .update(holds)
          .set({ status: 'expired', closedAt: this.clock.now(), riskSnapshot: risk.snapshot })
          .where(eq(holds.id, id));
        return true;
      });
      if (expired) count += 1;
    }
    if (count > 0) this.log.warn({ count }, '清理了过期未结算的冻结（网关进程可能崩溃过）');
    return count;
  }

  // ---------- 内部 ----------

  /** hold锁内转移风险；未知上限不进入实际成本，过期也不能释放已发送风险。 */
  private async updateRisk(
    tx: DbTx,
    hold: HoldRow,
    known: boolean,
    knownCost: number,
    wasActive: boolean,
  ) {
    const snapshot = hold.riskSnapshot;
    const reserved = wasActive ? hold.reservedCostMicros : 0;
    if (!snapshot) {
      // 历史冻结没有可证明的调用前成本上限，不能事后编造风险金额。
      if (!known)
        await this.audit.record(
          {
            module: 'billing',
            action: 'prehold.legacy_unknown_without_bound',
            actorType: 'system',
            targetType: 'hold',
            targetId: hold.id,
          },
          tx,
        );
      return { snapshot, remainingReserved: reserved };
    }
    if (known) {
      if (snapshot.upstreamId && snapshot.upstreamModelId)
        await this.lockCallRoute(tx, snapshot.upstreamId, snapshot.upstreamModelId);
      if (snapshot.phase === 'unknown')
        await this.budget.resolveUnknown(tx, hold.budgetDay, snapshot.uncertainMicros);
      return {
        snapshot: { ...snapshot, phase: 'resolved' as const, uncertainMicros: 0 },
        remainingReserved: reserved,
      };
    }
    if (snapshot.phase === 'unknown') return { snapshot, remainingReserved: 0 };
    if (
      snapshot.phase !== 'sent' ||
      !snapshot.upstreamId ||
      !snapshot.upstreamModelId ||
      !snapshot.sentAt
    ) {
      // 尚未发送不能产生供应商未知成本。
      return { snapshot, remainingReserved: reserved };
    }
    const uncertainMicros = Math.max(0, snapshot.costUpperMicros - knownCost);
    await this.lockCallRoute(tx, snapshot.upstreamId, snapshot.upstreamModelId);
    await this.budget.moveToUnknown(tx, hold.budgetDay, reserved, uncertainMicros, {
      holdId: hold.id,
      modelKey: hold.modelKey,
      upstreamId: snapshot.upstreamId,
      upstreamModelId: snapshot.upstreamModelId,
      sentAt: snapshot.sentAt,
      costUpperMicros: snapshot.costUpperMicros,
    });
    return {
      snapshot: { ...snapshot, phase: 'unknown' as const, uncertainMicros },
      remainingReserved: 0,
    };
  }

  /** 顺序固定：账户→hold→路由→预算；与未知风险提交串行，outbox停机也不能绕过。 */
  private async lockCallRoute(tx: DbTx, upstreamId: string, upstreamModelId: string) {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('billing:call-route:' || $1 || ':' || $2, 0))",
      [upstreamId, upstreamModelId],
    );
  }

  /** 3.27：这个账户最近 CONCURRENCY_WINDOW_MS 内开始、仍未结算的先用后扣调用数。 */
  async inFlightPaidCalls(tx: DbTx, accountId: string): Promise<number> {
    const now = this.clock.nowMs();
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM billing.holds
        WHERE account_id = $1 AND status = 'active' AND postpaid
          AND expires_at > $2 AND created_at > $3`,
      [accountId, new Date(now), new Date(now - CONCURRENCY_WINDOW_MS)],
    );
    return Number(rows[0]?.n ?? 0);
  }

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
      usedSafetyOverdraft: false,
    };
  }
}

function hasQuantity(usage: UsageQuantities): boolean {
  return Object.values(usage).some((v) => typeof v === 'number' && v > 0);
}
