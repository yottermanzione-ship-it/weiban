/**
 * v3.3（ADR-0032）：后台「模型」页的合并接口——目录条目 + 倍率一次保存。
 *
 * 倍率（输入 / 输出 / 缓存，数值 = 每百万 token 的人民币价格）存在 billing 的价目表里（BillingModelRatePort）：
 * 保存时倍率有变化就先由 billing 复制当前价目表、替换该模型三项价格并立即发布新版本，再保存目录条目
 * （启用模型要求当前价目表有价格，所以先发价目表）。目录条目的规则全部沿用 CatalogService.upsert。
 * 若目录保存失败，已发布的新价格保留（只影响这一个模型的单价），管理员修正后重试即可。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  AdminModelWrite,
  microsToPoints,
  type ActiveModelTokenRates,
  type AdminCatalogEntry,
  type AdminModel,
  type BillingModelRatePort,
  type ModelRates,
  type ModelRoute,
  type ModelTokenPrices,
} from '@weiban/contracts';
import type { z } from 'zod';
import { standardReplyMicros } from '../domain/rules.js';
import { MODEL_RATE_PORT, type ModelPriceSource } from '../tokens.js';
import { CatalogService } from './catalog.js';

type Write = z.output<typeof AdminModelWrite>;

const MICROS_PER_YUAN = 1_000_000;

/** 倍率（元 / 百万 token）→ 微元 / 百万 token。 */
export function ratesToPrices(rates: ModelRates): ModelTokenPrices {
  return {
    inputPerMillionMicros: Math.round(rates.input * MICROS_PER_YUAN),
    cachedInputPerMillionMicros: Math.round(rates.cache * MICROS_PER_YUAN),
    outputPerMillionMicros: Math.round(rates.output * MICROS_PER_YUAN),
  };
}

/** 微元 / 百万 token → 倍率（元 / 百万 token）；没有缓存价时缓存倍率 = 输入倍率。 */
export function pricesToRates(p: ModelTokenPrices): ModelRates {
  return {
    input: p.inputPerMillionMicros / MICROS_PER_YUAN,
    output: p.outputPerMillionMicros / MICROS_PER_YUAN,
    cache: (p.cachedInputPerMillionMicros ?? p.inputPerMillionMicros) / MICROS_PER_YUAN,
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
): AdminModel {
  return {
    ...entry,
    rates: rates ? pricesToRates(rates.price) : null,
    costRates: rates ? pricesToRates(rates.cost) : null,
    hasTimeBands: rates?.hasTimeBands ?? false,
    pointsPerReply: pointsPerReply(rates?.price),
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
  ) {}

  async list(): Promise<AdminModel[]> {
    const entries = await this.catalog.adminList();
    const keys = entries.map((e) => e.modelKey);
    const rates = await this.rates.getActiveTokenRates(keys);
    const routes = await this.catalog.routes(keys);
    return entries.map((e) => toAdminModel(e, rates.get(e.modelKey), routes.get(e.modelKey)));
  }

  async upsert(adminId: string, pathKey: string, body: Write): Promise<AdminModel> {
    const { rates, costRates, routes, ...rest } = body;
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
    const saved = await this.catalog.upsert(adminId, pathKey, entry);
    if (routes) await this.catalog.replaceRoutes(adminId, saved.modelKey, routes);
    const current = await this.rates.getActiveTokenRates([saved.modelKey]);
    const savedRoutes = await this.catalog.routes([saved.modelKey]);
    return toAdminModel(saved, current.get(saved.modelKey), savedRoutes.get(saved.modelKey));
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
