/**
 * v3.3（ADR-0032）：模型倍率端口 BillingModelRatePort 的实现。
 *
 * 「倍率」= 每百万 token 的人民币价格。它不是新的数据：就是当前生效价目表里该模型三项 token 单位
 * （input_tokens_per_million / cached_input_tokens_per_million / output_tokens_per_million）的全天价。
 * 后台「模型」页保存倍率时，本服务复制当前生效价目表、替换这一个模型的三项价格（连同它们的分时价）、
 * 生成新版本并立即发布——冻结仍引用价目表版本，扣费、对账规则都不变（billing.md 第 4 节）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ActiveModelTokenRates,
  BillingModelRatePort,
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
import { validatePriceItems, type PriceBand, type PriceRow } from '../domain/rules.js';
import { priceItems, priceVersions } from '../infra/db/schema.js';

const TOKEN_UNITS: readonly PriceUnit[] = [
  'input_tokens_per_million',
  'cached_input_tokens_per_million',
  'output_tokens_per_million',
];

type Row = typeof priceItems.$inferSelect;

function ratesOf(rows: Row[], field: 'priceMicros' | 'costMicros'): ModelTokenPrices | null {
  const base = (unit: PriceUnit) => rows.find((r) => r.unit === unit && r.band === null);
  const input = base('input_tokens_per_million');
  const output = base('output_tokens_per_million');
  if (!input || !output) return null;
  const cached = base('cached_input_tokens_per_million');
  return {
    inputPerMillionMicros: input[field],
    cachedInputPerMillionMicros: cached ? cached[field] : null,
    outputPerMillionMicros: output[field],
  };
}

const same = (a: ModelTokenPrices | null, b: ModelTokenPrices) =>
  !!a &&
  a.inputPerMillionMicros === b.inputPerMillionMicros &&
  a.outputPerMillionMicros === b.outputPerMillionMicros &&
  a.cachedInputPerMillionMicros === b.cachedInputPerMillionMicros;

function checkPrices(p: ModelTokenPrices): void {
  for (const v of [
    p.inputPerMillionMicros,
    p.outputPerMillionMicros,
    p.cachedInputPerMillionMicros,
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
}
