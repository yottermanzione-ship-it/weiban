/**
 * v3.3（ADR-0032）：后台「模型」页的合并接口——目录条目 + 倍率一次保存。
 *
 * 倍率（输入 / 输出 / 缓存，数值 = 每百万 token 的人民币价格）存在 billing 的价目表里（BillingModelRatePort）：
 * 保存时倍率有变化就先由 billing 复制当前价目表、替换该模型三项价格并立即发布新版本，再保存目录条目
 * （启用模型要求当前价目表有价格，所以先发价目表）。目录条目的规则全部沿用 CatalogService.upsert。
 * 若目录保存失败，已发布的新价格保留（只影响这一个模型的单价），管理员修正后重试即可。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AdminModelWrite,
  microsToPoints,
  type ActiveModelServiceRate,
  type ActiveModelTokenRates,
  type AdminCatalogEntry,
  type AdminModel,
  type BillingModelRatePort,
  type ModelDiscountSetting,
  type ModelRates,
  type ModelRoute,
  type ModelTokenPrices,
} from '@weiban/contracts';
import { AppError, CLOCK, type Clock } from '../../../platform/index.js';
import type { z } from 'zod';
import { standardReplyMicros } from '../domain/rules.js';
import { MODEL_RATE_PORT, type ModelPriceSource } from '../tokens.js';
import { CatalogService } from './catalog.js';
import { DisplayPricingService, type DisplayPricing } from './display-pricing.js';

type Write = z.output<typeof AdminModelWrite>;

const MICROS_PER_YUAN = 1_000_000;

export const serviceRatesToYuan = (rates: readonly ActiveModelServiceRate[]) =>
  rates.map((r) => ({
    unit: r.unit,
    price: r.priceMicros / MICROS_PER_YUAN,
    cost: r.costMicros / MICROS_PER_YUAN,
    hasTimeBands: r.hasTimeBands,
  }));

const toMicros = (yuan: number | null | undefined) =>
  yuan === null || yuan === undefined ? null : Math.round(yuan * MICROS_PER_YUAN);

/** 倍率（元 / 百万 token）→ 微元 / 百万 token。3.24：缓存写入没填为 null（按输入价计）。 */
export function ratesToPrices(rates: ModelRates): ModelTokenPrices {
  return {
    inputPerMillionMicros: Math.round(rates.input * MICROS_PER_YUAN),
    cachedInputPerMillionMicros: Math.round(rates.cache * MICROS_PER_YUAN),
    outputPerMillionMicros: Math.round(rates.output * MICROS_PER_YUAN),
    cacheWrite5mPerMillionMicros: toMicros(rates.cacheWrite5m),
    cacheWrite1hPerMillionMicros: toMicros(rates.cacheWrite1h),
  };
}

/** 微元 / 百万 token → 倍率（元 / 百万 token）；没有缓存价时缓存倍率 = 输入倍率；没有缓存写入价为 null。 */
export function pricesToRates(p: ModelTokenPrices): ModelRates {
  const yuan = (micros: number | null | undefined) =>
    micros === null || micros === undefined ? null : micros / MICROS_PER_YUAN;
  return {
    input: p.inputPerMillionMicros / MICROS_PER_YUAN,
    output: p.outputPerMillionMicros / MICROS_PER_YUAN,
    cache: (p.cachedInputPerMillionMicros ?? p.inputPerMillionMicros) / MICROS_PER_YUAN,
    cacheWrite5m: yuan(p.cacheWrite5mPerMillionMicros),
    cacheWrite1h: yuan(p.cacheWrite1hPerMillionMicros),
  };
}

/** 约每条回复的积分（cost-estimate.md 7.2「标准回复」），保留 2 位小数。 */
export function pointsPerReply(p: ModelTokenPrices | undefined): number | null {
  if (!p) return null;
  return Math.round(microsToPoints(standardReplyMicros(p)) * 100) / 100;
}

export function toAdminModel(
  entry: AdminCatalogEntry,
  rates: ActiveModelTokenRates | undefined,
  routes?: ModelRoute[],
  display?: DisplayPricing,
  discount?: ModelDiscountSetting,
  nowMs = 0,
  extra: Pick<AdminModel, 'arenaRank' | 'availability' | 'usageMissing' | 'serviceRates'> = {},
): AdminModel {
  return {
    ...entry,
    ...extra,
    discount: discount ?? null,
    discountActive:
      !!discount && Date.parse(discount.startsAt) <= nowMs && nowMs < Date.parse(discount.endsAt),
    displayMultiplierManual: display?.displayMultiplierManual ?? null,
    displayMultiplier: display?.displayMultiplier ?? null,
    rates: rates ? pricesToRates(rates.price) : null,
    costRates: rates ? pricesToRates(rates.cost) : null,
    hasTimeBands:
      (rates?.hasTimeBands ?? false) || !!extra.serviceRates?.some((r) => r.hasTimeBands),
    pointsPerReply: display?.pointsPerReply ?? pointsPerReply(rates?.price),
    routes: routes ?? [],
  };
}

/** 主路由 = 启用的路由里优先级最小、权重最大的那条（没有启用的就取第一条）。 */
export function primaryRoute(routes: ModelRoute[]): ModelRoute {
  const sorted = [...routes].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) || a.priority - b.priority || b.weight - a.weight,
  );
  return sorted[0]!;
}

@Injectable()
export class ModelAdminService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MODEL_RATE_PORT) private readonly rates: BillingModelRatePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(DisplayPricingService) private readonly display?: DisplayPricingService,
  ) {}

  async list(): Promise<AdminModel[]> {
    const entries = await this.catalog.adminList();
    // 3.23：已删除的模型不查价格 / 线路 / 折扣（同键可能已重新添加，按键查会串到新模型上）
    const keys = entries.filter((e) => !e.deletedAt).map((e) => e.modelKey);
    const rates = await this.rates.getActiveTokenRates(keys);
    const serviceRates = await this.rates.getActiveServiceRates?.(keys);
    const routes = await this.catalog.routes(keys);
    const display = await this.display?.forModels(keys);
    const discounts = await this.rates.getModelDiscounts(keys);
    const nowMs = this.clock.nowMs();
    // 3.24：可用性具体原因、榜单匹配名次
    const details = await this.catalog.availabilityDetails(keys);
    const arena = await this.catalog.arenaRanks();
    // 3.26：最近连续没返回用量的线路（后台提示，不停用）
    const missing = await this.catalog.usageMissing(keys);
    return entries.map((e) =>
      e.deletedAt
        ? toAdminModel(e, undefined, [], undefined, undefined, nowMs)
        : toAdminModel(
            e,
            rates.get(e.modelKey),
            routes.get(e.modelKey),
            display?.get(e.modelKey),
            discounts.get(e.modelKey),
            nowMs,
            {
              ...(serviceRates
                ? { serviceRates: serviceRatesToYuan(serviceRates.get(e.modelKey) ?? []) }
                : {}),
              arenaRank: arena.rankOf(e.arenaModelName),
              availability: {
                available: !details.get(e.modelKey),
                detail: details.get(e.modelKey) ?? null,
              },
              usageMissing: missing.get(e.modelKey) ?? [],
            },
          ),
    );
  }

  async upsert(adminId: string, pathKey: string, body: Write): Promise<AdminModel> {
    const { rates, costRates, serviceRates, routes, displayMultiplierManual, discount, ...rest } =
      body;
    if (serviceRates !== undefined) {
      if (!this.rates.publishModelServiceRates)
        throw new AppError('bad_request', '当前服务不支持服务单价写入，不能忽略该请求');
      if (pathKey !== body.modelKey)
        throw new AppError('bad_request', '修改模型键时不能同时修改服务单价');
      const capability = {
        search_call: 'web_search',
        tts_10k_chars: 'voice_output',
        asr_minute: 'voice_input',
        realtime_minute: 'voice_output',
        image: 'image_generation',
      } as const;
      for (const rate of serviceRates) {
        if (
          !body.capabilities.includes(capability[rate.unit]) ||
          (rate.unit === 'realtime_minute' && !body.capabilities.includes('voice_input'))
        )
          throw new AppError('bad_request', `服务计价单位 ${rate.unit} 与模型能力不匹配`);
      }
    }
    this.catalog.validateBillingBounds(body.billingBounds);
    for (const route of routes ?? []) this.catalog.validateBillingBounds(route.billingBounds);
    // v3.4：传了路由时，目录上的上游 = 主路由（旧接口与媒体网关仍读它）
    const primary = routes ? primaryRoute(routes) : null;
    const entry = primary
      ? {
          ...rest,
          upstreamId: primary.upstreamId,
          upstreamModelId: primary.upstreamModelId,
          ...(primary.billingBounds === undefined ? {} : { billingBounds: primary.billingBounds }),
        }
      : rest;
    if (rates && pathKey === body.modelKey) {
      await this.rates.publishModelTokenRates({
        operatorUserId: adminId,
        modelKey: body.modelKey,
        price: ratesToPrices(rates),
        cost: ratesToPrices(costRates ?? rates),
      });
    }
    if (serviceRates !== undefined)
      await this.rates.publishModelServiceRates!({
        operatorUserId: adminId,
        modelKey: body.modelKey,
        rates: serviceRates.map((r) => ({
          unit: r.unit,
          priceMicros: Math.round(r.price * MICROS_PER_YUAN),
          costMicros: Math.round((r.cost ?? r.price) * MICROS_PER_YUAN),
        })),
      });
    const saved = await this.catalog.upsert(adminId, pathKey, entry);
    if (routes) await this.catalog.replaceRoutes(adminId, saved.modelKey, routes);
    if (displayMultiplierManual !== undefined)
      await this.display?.setManual(saved.modelKey, displayMultiplierManual);
    // 3.22：限时折扣存 billing（报价 / 冻结 / 结算在 billing 同一处按它打折）。
    if (discount !== undefined)
      await this.rates.setModelDiscount({
        operatorUserId: adminId,
        modelKey: saved.modelKey,
        discount,
      });
    this.display?.invalidate();
    const current = await this.rates.getActiveTokenRates([saved.modelKey]);
    const currentServices = await this.rates.getActiveServiceRates?.([saved.modelKey]);
    const savedRoutes = await this.catalog.routes([saved.modelKey]);
    const display = await this.display?.forModels([saved.modelKey]);
    const discounts = await this.rates.getModelDiscounts([saved.modelKey]);
    const detail = (await this.catalog.availabilityDetails([saved.modelKey])).get(saved.modelKey);
    const arena = await this.catalog.arenaRanks();
    return toAdminModel(
      saved,
      current.get(saved.modelKey),
      savedRoutes.get(saved.modelKey),
      display?.get(saved.modelKey),
      discounts.get(saved.modelKey),
      this.clock.nowMs(),
      {
        ...(currentServices
          ? { serviceRates: serviceRatesToYuan(currentServices.get(saved.modelKey) ?? []) }
          : {}),
        arenaRank: arena.rankOf(saved.arenaModelName),
        availability: { available: !detail, detail: detail ?? null },
      },
    );
  }
}

/** 价格档位 / 约每条积分用的价格来源：当前生效价目表的 token 全天价（替代原 EmptyPriceSource）。 */
@Injectable()
export class RatePriceSource implements ModelPriceSource {
  constructor(@Inject(MODEL_RATE_PORT) private readonly rates: BillingModelRatePort) {}

  async textPrices(modelKeys: readonly string[]) {
    const map = await this.rates.getActiveTokenRates(modelKeys);
    return new Map([...map].map(([key, value]) => [key, value.price] as const));
  }
}
