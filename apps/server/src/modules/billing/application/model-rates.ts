/**
 * v3.3（ADR-0032）：模型倍率端口 BillingModelRatePort 的实现。
 *
 * 「倍率」= 每百万 token 的人民币价格。它不是新的数据：就是当前生效价目表里该模型三项 token 单位
 * （input_tokens_per_million / cached_input_tokens_per_million / output_tokens_per_million）的全天价。
 * 后台「模型」页保存倍率时，本服务复制当前生效价目表、替换这一个模型的三项价格（连同它们的分时价）、
 * 生成新版本并立即发布——冻结仍引用价目表版本，扣费、对账规则都不变（billing.md 第 4 节）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { PRICE_PUBLISH_LOCK_SQL } from './price-publishing.js';
import type {
  ActiveModelServiceRate,
  ActiveModelTokenRates,
  ServicePriceUnit,
  BillingModelRatePort,
  ModelDiscountSetting,
  ModelTokenPrices,
  PriceUnit,
} from '@weiban/contracts';
import { asc, eq, inArray, and } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import {
  discountRateToBp,
  validatePriceItems,
  type PriceBand,
  type PriceRow,
} from '../domain/rules.js';
import { modelDiscounts, priceItems, priceVersions } from '../infra/db/schema.js';

const TOKEN_UNITS: readonly PriceUnit[] = [
  'input_tokens_per_million',
  'cached_input_tokens_per_million',
  'output_tokens_per_million',
  // 3.24：缓存写入（可选；没有这两行时按输入价计）
  'cache_write_5m_tokens_per_million',
  'cache_write_1h_tokens_per_million',
];

type Row = typeof priceItems.$inferSelect;

function ratesOf(rows: Row[], field: 'priceMicros' | 'costMicros'): ModelTokenPrices | null {
  const base = (unit: PriceUnit) => rows.find((r) => r.unit === unit && r.band === null);
  const input = base('input_tokens_per_million');
  const output = base('output_tokens_per_million');
  if (!input || !output) return null;
  const cached = base('cached_input_tokens_per_million');
  const write5m = base('cache_write_5m_tokens_per_million');
  const write1h = base('cache_write_1h_tokens_per_million');
  return {
    inputPerMillionMicros: input[field],
    cachedInputPerMillionMicros: cached ? cached[field] : null,
    outputPerMillionMicros: output[field],
    cacheWrite5mPerMillionMicros: write5m ? write5m[field] : null,
    cacheWrite1hPerMillionMicros: write1h ? write1h[field] : null,
  };
}

const same = (a: ModelTokenPrices | null, b: ModelTokenPrices) =>
  !!a &&
  a.inputPerMillionMicros === b.inputPerMillionMicros &&
  a.outputPerMillionMicros === b.outputPerMillionMicros &&
  a.cachedInputPerMillionMicros === b.cachedInputPerMillionMicros &&
  (a.cacheWrite5mPerMillionMicros ?? null) === (b.cacheWrite5mPerMillionMicros ?? null) &&
  (a.cacheWrite1hPerMillionMicros ?? null) === (b.cacheWrite1hPerMillionMicros ?? null);

function checkPrices(p: ModelTokenPrices): void {
  for (const v of [
    p.inputPerMillionMicros,
    p.outputPerMillionMicros,
    p.cachedInputPerMillionMicros,
    p.cacheWrite5mPerMillionMicros ?? null,
    p.cacheWrite1hPerMillionMicros ?? null,
  ])
    if (v !== null && (!Number.isSafeInteger(v) || v < 0))
      throw new AppError('bad_request', '倍率必须是非负数');
}

@Injectable()
export class ModelRateService implements BillingModelRatePort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getActiveTokenRates(
    modelKeys: readonly string[],
  ): Promise<Map<string, ActiveModelTokenRates>> {
    const out = new Map<string, ActiveModelTokenRates>();
    const keys = [...new Set(modelKeys)];
    if (keys.length === 0) return out;
    const [version] = await this.database.db
      .select({ id: priceVersions.id })
      .from(priceVersions)
      .where(eq(priceVersions.status, 'active'));
    if (!version) return out;
    const rows = await this.database.db
      .select()
      .from(priceItems)
      .where(
        and(
          eq(priceItems.priceVersionId, version.id),
          inArray(priceItems.modelKey, keys),
          inArray(priceItems.unit, [...TOKEN_UNITS]),
        ),
      );
    for (const key of keys) {
      const mine = rows.filter((r) => r.modelKey === key);
      const price = ratesOf(mine, 'priceMicros');
      const cost = ratesOf(mine, 'costMicros');
      if (!price || !cost) continue;
      out.set(key, { price, cost, hasTimeBands: mine.some((r) => r.band !== null) });
    }
    return out;
  }

  async publishModelTokenRates(input: {
    operatorUserId: string;
    modelKey: string;
    price: ModelTokenPrices;
    cost: ModelTokenPrices;
  }): Promise<{ priceVersionId: string; published: boolean }> {
    checkPrices(input.price);
    checkPrices(input.cost);
    return this.database.transaction(async (tx) => {
      // 所有发布（含 PriceService.activate）都先锁当前生效版本，串行切换
      await tx.query(PRICE_PUBLISH_LOCK_SQL);
      const { rows: locked } = await tx.query<{ id: string }>(
        `SELECT id FROM billing.price_versions WHERE status = 'active' FOR UPDATE`,
      );
      const activeId = locked[0]?.id ?? null;
      const current: Row[] = activeId
        ? await tx.db
            .select()
            .from(priceItems)
            .where(eq(priceItems.priceVersionId, activeId))
            .orderBy(asc(priceItems.sortOrder))
        : [];
      const mine = current.filter(
        (r) => r.modelKey === input.modelKey && TOKEN_UNITS.includes(r.unit as PriceUnit),
      );
      if (
        activeId &&
        !mine.some((r) => r.band !== null) &&
        same(ratesOf(mine, 'priceMicros'), input.price) &&
        same(ratesOf(mine, 'costMicros'), input.cost)
      ) {
        return { priceVersionId: activeId, published: false };
      }
      const kept: PriceRow[] = current
        .filter((r) => !mine.includes(r))
        .map((r) => ({
          modelKey: r.modelKey,
          unit: r.unit as PriceUnit,
          band: (r.band as PriceBand | null) ?? null,
          priceMicros: r.priceMicros,
          costMicros: r.costMicros,
        }));
      const fresh: PriceRow[] = [
        {
          modelKey: input.modelKey,
          unit: 'input_tokens_per_million',
          band: null,
          priceMicros: input.price.inputPerMillionMicros,
          costMicros: input.cost.inputPerMillionMicros,
        },
        {
          modelKey: input.modelKey,
          unit: 'cached_input_tokens_per_million',
          band: null,
          priceMicros: input.price.cachedInputPerMillionMicros ?? input.price.inputPerMillionMicros,
          costMicros: input.cost.cachedInputPerMillionMicros ?? input.cost.inputPerMillionMicros,
        },
        {
          modelKey: input.modelKey,
          unit: 'output_tokens_per_million',
          band: null,
          priceMicros: input.price.outputPerMillionMicros,
          costMicros: input.cost.outputPerMillionMicros,
        },
        // 3.24：缓存写入价只在填了时写（售价没填 = 按输入价，不写这一行）
        ...(
          [
            ['cache_write_5m_tokens_per_million', 'cacheWrite5mPerMillionMicros'],
            ['cache_write_1h_tokens_per_million', 'cacheWrite1hPerMillionMicros'],
          ] as const
        ).flatMap(([unit, field]) => {
          const price = input.price[field];
          if (price === null || price === undefined) return [];
          return [
            {
              modelKey: input.modelKey,
              unit,
              band: null,
              priceMicros: price,
              costMicros: input.cost[field] ?? price,
            },
          ];
        }),
      ];
      const items = [...kept, ...fresh];
      const problems = validatePriceItems(items);
      if (problems.length > 0) {
        throw new AppError('bad_request', '价目表内容不正确', {
          details: { issues: problems.map((message) => ({ path: 'rates', message })) },
        });
      }
      const now = this.clock.now();
      const id = newId();
      await tx.db.insert(priceVersions).values({
        id,
        versionLabel: `rates-${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`.slice(0, 32),
        status: 'draft',
        effectiveFrom: null,
        note: `模型倍率：${input.modelKey}`.slice(0, 200),
        createdAt: now,
        createdBy: input.operatorUserId,
      });
      await tx.db.insert(priceItems).values(
        items.map((item, index) => ({
          id: newId(),
          priceVersionId: id,
          modelKey: item.modelKey,
          unit: item.unit,
          band: item.band,
          priceMicros: item.priceMicros,
          costMicros: item.costMicros,
          sortOrder: index,
        })),
      );
      if (activeId) {
        await tx.db
          .update(priceVersions)
          .set({ status: 'retired', retiredAt: now })
          .where(eq(priceVersions.id, activeId));
      }
      await tx.db
        .update(priceVersions)
        .set({ status: 'active', effectiveFrom: now })
        .where(eq(priceVersions.id, id));
      await this.audit.record(
        {
          module: 'billing',
          action: 'price_version.rates_published',
          actorType: 'admin',
          actorId: input.operatorUserId,
          targetType: 'price_version',
          targetId: id,
          details: {
            modelKey: input.modelKey,
            replaced: activeId,
            price: input.price,
            cost: input.cost,
          },
        },
        tx,
      );
      return { priceVersionId: id, published: true };
    });
  }

  /** 3.36：非 token 全天基价；每个单位单独保留分时标志。 */
  async getActiveServiceRates(
    modelKeys: readonly string[],
  ): Promise<Map<string, ActiveModelServiceRate[]>> {
    const out = new Map<string, ActiveModelServiceRate[]>();
    const keys = [...new Set(modelKeys)];
    if (!keys.length) return out;
    const [version] = await this.database.db
      .select({ id: priceVersions.id })
      .from(priceVersions)
      .where(eq(priceVersions.status, 'active'));
    if (!version) return out;
    const rows = await this.database.db
      .select()
      .from(priceItems)
      .where(
        and(
          eq(priceItems.priceVersionId, version.id),
          inArray(priceItems.modelKey, keys),
          inArray(priceItems.unit, [
            'image',
            'tts_10k_chars',
            'asr_minute',
            'realtime_minute',
            'search_call',
            'audio_input_tokens_per_million',
            'audio_output_tokens_per_million',
            'voice_clone',
          ]),
        ),
      );
    for (const row of rows.filter((r) => r.band === null)) {
      const rates = out.get(row.modelKey) ?? [];
      rates.push({
        unit: row.unit as ServicePriceUnit,
        priceMicros: row.priceMicros,
        costMicros: row.costMicros,
        hasTimeBands: rows.some(
          (r) => r.modelKey === row.modelKey && r.unit === row.unit && r.band !== null,
        ),
      });
      out.set(row.modelKey, rates);
    }
    return out;
  }

  async publishModelServiceRates(input: {
    operatorUserId: string;
    modelKey: string;
    rates: { unit: ServicePriceUnit; priceMicros: number; costMicros: number }[];
  }): Promise<{ priceVersionId: string; published: boolean }> {
    const allowed = [
      'image',
      'tts_10k_chars',
      'asr_minute',
      'realtime_minute',
      'search_call',
      'audio_input_tokens_per_million',
      'audio_output_tokens_per_million',
      'voice_clone',
    ];
    if (
      input.rates.length < 1 ||
      input.rates.length > allowed.length ||
      new Set(input.rates.map((r) => r.unit)).size !== input.rates.length ||
      input.rates.some(
        (r) =>
          !allowed.includes(r.unit) ||
          [r.priceMicros, r.costMicros].some(
            (v) => !Number.isSafeInteger(v) || v < 0 || v > 100_000_000_000,
          ),
      )
    )
      throw new AppError('bad_request', '服务单价必须为不重复的非 token 单位和非负整数微元');
    return this.database.transaction(async (tx) => {
      // 不能仅锁 active 行：初次发布不存在该行，并发发布仍须串行。
      await tx.query(PRICE_PUBLISH_LOCK_SQL);
      const { rows: locked } = await tx.query<{ id: string }>(
        `SELECT id FROM billing.price_versions WHERE status = 'active' FOR UPDATE`,
      );
      const activeId = locked[0]?.id ?? null;
      const current: Row[] = activeId
        ? await tx.db
            .select()
            .from(priceItems)
            .where(eq(priceItems.priceVersionId, activeId))
            .orderBy(asc(priceItems.sortOrder))
        : [];
      const mine = current.filter(
        (r) => r.modelKey === input.modelKey && input.rates.some((rate) => rate.unit === r.unit),
      );
      if (
        activeId &&
        mine.length === input.rates.length &&
        input.rates.every((rate) =>
          mine.some(
            (r) =>
              r.unit === rate.unit &&
              r.band === null &&
              r.priceMicros === rate.priceMicros &&
              r.costMicros === rate.costMicros,
          ),
        )
      )
        return { priceVersionId: activeId, published: false };
      const items: PriceRow[] = [
        ...current
          .filter((r) => !mine.includes(r))
          .map((r) => ({
            modelKey: r.modelKey,
            unit: r.unit as PriceUnit,
            band: r.band as PriceBand | null,
            priceMicros: r.priceMicros,
            costMicros: r.costMicros,
          })),
        ...input.rates.map((r) => ({ ...r, modelKey: input.modelKey, band: null })),
      ];
      const problems = validatePriceItems(items);
      if (problems.length)
        throw new AppError('bad_request', '价目表内容不正确', {
          details: { issues: problems.map((message) => ({ path: 'serviceRates', message })) },
        });
      const now = this.clock.now();
      const id = newId();
      await tx.db.insert(priceVersions).values({
        id,
        versionLabel: `service-${now.toISOString().replace(/\D/g, '')}`.slice(0, 32),
        status: 'draft',
        effectiveFrom: null,
        note: `服务单价：${input.modelKey}`.slice(0, 200),
        createdAt: now,
        createdBy: input.operatorUserId,
      });
      await tx.db.insert(priceItems).values(
        items.map((item, index) => ({
          ...item,
          id: newId(),
          priceVersionId: id,
          sortOrder: index,
        })),
      );
      if (activeId)
        await tx.db
          .update(priceVersions)
          .set({ status: 'retired', retiredAt: now })
          .where(eq(priceVersions.id, activeId));
      await tx.db
        .update(priceVersions)
        .set({ status: 'active', effectiveFrom: now })
        .where(eq(priceVersions.id, id));
      await this.audit.record(
        {
          module: 'billing',
          action: 'price_version.service_rates_published',
          actorType: 'admin',
          actorId: input.operatorUserId,
          targetType: 'price_version',
          targetId: id,
          details: {
            modelKey: input.modelKey,
            replaced: activeId,
            rates: input.rates,
            replacedTimeBands: mine.some((r) => r.band !== null),
          },
        },
        tx,
      );
      return { priceVersionId: id, published: true };
    });
  }

  // ---------- 3.23 删除模型 ----------

  async modelPriceFootprint(
    modelKeys: readonly string[],
  ): Promise<{ pricedModelKeys: string[]; discountedModelKeys: string[] }> {
    const keys = [...new Set(modelKeys)];
    if (keys.length === 0) return { pricedModelKeys: [], discountedModelKeys: [] };
    const [version] = await this.database.db
      .select({ id: priceVersions.id })
      .from(priceVersions)
      .where(eq(priceVersions.status, 'active'));
    const priced = version
      ? await this.database.db
          .selectDistinct({ modelKey: priceItems.modelKey })
          .from(priceItems)
          .where(and(eq(priceItems.priceVersionId, version.id), inArray(priceItems.modelKey, keys)))
      : [];
    const discounted = await this.database.db
      .select({ modelKey: modelDiscounts.modelKey })
      .from(modelDiscounts)
      .where(inArray(modelDiscounts.modelKey, keys));
    return {
      pricedModelKeys: priced.map((r) => r.modelKey).sort(),
      discountedModelKeys: discounted.map((r) => r.modelKey).sort(),
    };
  }

  async removeModels(input: {
    operatorUserId: string;
    modelKeys: readonly string[];
  }): Promise<{ priceVersionId: string | null; pricedModels: number; discounts: number }> {
    const keys = [...new Set(input.modelKeys)];
    if (keys.length === 0) return { priceVersionId: null, pricedModels: 0, discounts: 0 };
    return this.database.transaction(async (tx) => {
      // 与其他发布一样先锁当前生效版本，串行切换
      await tx.query(PRICE_PUBLISH_LOCK_SQL);
      const { rows: locked } = await tx.query<{ id: string }>(
        `SELECT id FROM billing.price_versions WHERE status = 'active' FOR UPDATE`,
      );
      const activeId = locked[0]?.id ?? null;
      const current: Row[] = activeId
        ? await tx.db
            .select()
            .from(priceItems)
            .where(eq(priceItems.priceVersionId, activeId))
            .orderBy(asc(priceItems.sortOrder))
        : [];
      const removed = current.filter((r) => keys.includes(r.modelKey));
      const pricedModels = new Set(removed.map((r) => r.modelKey)).size;
      const droppedDiscounts = await tx.db
        .delete(modelDiscounts)
        .where(inArray(modelDiscounts.modelKey, keys))
        .returning({ modelKey: modelDiscounts.modelKey });
      let priceVersionId: string | null = null;
      if (activeId && removed.length > 0) {
        const kept = current.filter((r) => !keys.includes(r.modelKey));
        const now = this.clock.now();
        priceVersionId = newId();
        await tx.db.insert(priceVersions).values({
          id: priceVersionId,
          versionLabel: `del-${now
            .toISOString()
            .slice(0, 23)
            .replace(/[-:T.]/g, '')}`.slice(0, 32),
          status: 'draft',
          effectiveFrom: null,
          note: `删除模型：${keys.join('、')}`.slice(0, 200),
          createdAt: now,
          createdBy: input.operatorUserId,
        });
        if (kept.length > 0)
          await tx.db.insert(priceItems).values(
            kept.map((item, index) => ({
              id: newId(),
              priceVersionId: priceVersionId!,
              modelKey: item.modelKey,
              unit: item.unit,
              band: item.band,
              priceMicros: item.priceMicros,
              costMicros: item.costMicros,
              sortOrder: index,
            })),
          );
        await tx.db
          .update(priceVersions)
          .set({ status: 'retired', retiredAt: now })
          .where(eq(priceVersions.id, activeId));
        await tx.db
          .update(priceVersions)
          .set({ status: 'active', effectiveFrom: now })
          .where(eq(priceVersions.id, priceVersionId));
      }
      if (priceVersionId || droppedDiscounts.length > 0)
        await this.audit.record(
          {
            module: 'billing',
            action: 'price_version.models_removed',
            actorType: 'admin',
            actorId: input.operatorUserId,
            targetType: 'price_version',
            targetId: priceVersionId,
            details: {
              modelKeys: keys,
              replaced: priceVersionId ? activeId : null,
              discountsRemoved: droppedDiscounts.map((d) => d.modelKey),
            },
          },
          tx,
        );
      return { priceVersionId, pricedModels, discounts: droppedDiscounts.length };
    });
  }

  // ---------- 3.22 限时折扣 ----------

  async getModelDiscounts(
    modelKeys: readonly string[],
  ): Promise<Map<string, ModelDiscountSetting>> {
    const keys = [...new Set(modelKeys)];
    const out = new Map<string, ModelDiscountSetting>();
    if (!keys.length) return out;
    const rows = await this.database.db
      .select()
      .from(modelDiscounts)
      .where(inArray(modelDiscounts.modelKey, keys));
    for (const r of rows)
      out.set(r.modelKey, {
        rate: r.rateBp / 10_000,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
      });
    return out;
  }

  async setModelDiscount(input: {
    operatorUserId: string;
    modelKey: string;
    discount: ModelDiscountSetting | null;
  }): Promise<void> {
    const now = this.clock.now();
    let values: { rateBp: number; startsAt: Date; endsAt: Date } | null = null;
    if (input.discount) {
      let rateBp: number;
      try {
        rateBp = discountRateToBp(input.discount.rate);
      } catch {
        throw new AppError('bad_request', '折扣须在 0.01～0.99 之间（例 0.5 = 5 折）', {
          status: 422,
        });
      }
      const startsAt = new Date(input.discount.startsAt);
      const endsAt = new Date(input.discount.endsAt);
      if (
        Number.isNaN(startsAt.getTime()) ||
        Number.isNaN(endsAt.getTime()) ||
        endsAt.getTime() <= startsAt.getTime()
      )
        throw new AppError('bad_request', '折扣的结束时间必须晚于开始时间', { status: 422 });
      values = { rateBp, startsAt, endsAt };
    }
    await this.database.transaction(async (tx) => {
      if (values)
        await tx.db
          .insert(modelDiscounts)
          .values({
            modelKey: input.modelKey,
            ...values,
            updatedAt: now,
            updatedBy: input.operatorUserId,
          })
          .onConflictDoUpdate({
            target: modelDiscounts.modelKey,
            set: { ...values, updatedAt: now, updatedBy: input.operatorUserId },
          });
      else await tx.db.delete(modelDiscounts).where(eq(modelDiscounts.modelKey, input.modelKey));
      await this.audit.record(
        {
          module: 'billing',
          action: values ? 'model_discount.set' : 'model_discount.cleared',
          actorType: 'admin',
          actorId: input.operatorUserId,
          targetType: 'model',
          targetId: input.modelKey,
          details: input.discount ? { ...input.discount } : {},
        },
        tx,
      );
    });
  }
}
