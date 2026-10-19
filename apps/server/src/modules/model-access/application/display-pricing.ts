/**
 * 3.17（会员 v5，docs/refactor/16-membership-v5.md §2）：用户端模型列表上的「×倍率」与「约每条 X 积分」。
 *
 * - 倍率只展示，扣费仍按实际 token × 价目表售价（billing）。
 *   后台手填（model_catalog.display_multiplier）优先；否则 = 加权价 / 基准模型加权价，
 *   加权价 = 0.8×输入售价 + 0.2×输出售价；基准模型存 model_access.settings 的 display_multiplier_base。
 * - 约每条积分：最近 7 天该模型「用户付费的聊天回复」成功调用的平均实扣；样本少于 MIN_SAMPLES 时按默认假设估算。
 *   结果在进程内缓存 10 分钟（列表接口高频、数据不需要实时）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { DisplayMultiplierSettings, microsToPoints } from '@weiban/contracts';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { defaultReplyMicros, weightedPrice, type ModelTextPrices } from '../domain/rules.js';
import { modelAccessSettings, modelCatalog, usageRecords } from '../infra/db/schema.js';
import { MODEL_PRICE_SOURCE, type ModelPriceSource } from '../tokens.js';

const BASE_KEY = 'display_multiplier_base';
const WINDOW_MS = 7 * 24 * 3_600_000;
const CACHE_MS = 10 * 60_000;
export const MIN_SAMPLES = 20;

export interface DisplayPricing {
  displayMultiplier: number | null;
  displayMultiplierManual: number | null;
  pointsPerReply: number | null;
  pointsPerReplyBasis: 'recent_7d' | 'default';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DisplayPricingService {
  private recent: { at: number; map: Map<string, { avg: number; n: number }> } | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MODEL_PRICE_SOURCE) private readonly prices: ModelPriceSource,
  ) {}

  async getSettings(): Promise<DisplayMultiplierSettings> {
    const [row] = await this.database.db
      .select()
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, BASE_KEY));
    const parsed = DisplayMultiplierSettings.safeParse(row?.value);
    return parsed.success ? parsed.data : { baseModelKey: null };
  }

  async updateSettings(
    operatorUserId: string,
    input: DisplayMultiplierSettings,
  ): Promise<DisplayMultiplierSettings> {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(modelAccessSettings)
        .values({ key: BASE_KEY, value: input, updatedAt: now, updatedBy: operatorUserId })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: input, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'display_multiplier.base_updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'model_access_settings',
          targetId: null,
          details: { ...input },
        },
        tx,
      );
    });
    return input;
  }

  /** 保存后台手填倍率（null = 改回自动）。 */
  async setManual(modelKey: string, value: number | null): Promise<void> {
    await this.database.db
      .update(modelCatalog)
      .set({ displayMultiplier: value === null ? null : round2(value) })
      .where(eq(modelCatalog.modelKey, modelKey));
  }

  /** 最近 7 天各模型聊天回复的平均实扣（微元）与样本数。 */
  private async recentAverages(keys: readonly string[]) {
    const nowMs = this.clock.nowMs();
    if (!this.recent || nowMs - this.recent.at > CACHE_MS) {
      const rows = await this.database.db
        .select({
          modelKey: usageRecords.modelKey,
          avg: sql<string>`avg(${usageRecords.chargedMicros})`,
          n: sql<string>`count(*)`,
        })
        .from(usageRecords)
        .where(
          and(
            gte(usageRecords.createdAt, new Date(nowMs - WINDOW_MS)),
            eq(usageRecords.status, 'succeeded'),
            eq(usageRecords.billingOwner, 'user'),
            eq(usageRecords.purpose, 'chat_reply'),
          ),
        )
        .groupBy(usageRecords.modelKey);
      this.recent = {
        at: nowMs,
        map: new Map(rows.map((r) => [r.modelKey, { avg: Number(r.avg), n: Number(r.n) }])),
      };
    }
    const out = new Map<string, { avg: number; n: number }>();
    for (const k of keys) {
      const v = this.recent.map.get(k);
      if (v) out.set(k, v);
    }
    return out;
  }

  /** 一批模型的展示倍率与约每条积分。prices 不传时自己查当前售价。 */
  async forModels(
    keys: readonly string[],
    prices?: Map<string, ModelTextPrices>,
  ): Promise<Map<string, DisplayPricing>> {
    const out = new Map<string, DisplayPricing>();
    if (keys.length === 0) return out;
    const { baseModelKey } = await this.getSettings();
    const wanted = [...new Set([...keys, ...(baseModelKey ? [baseModelKey] : [])])];
    const priceMap =
      prices && (!baseModelKey || prices.has(baseModelKey))
        ? prices
        : await this.prices.textPrices(wanted);
    const manualRows = await this.database.db
      .select({ modelKey: modelCatalog.modelKey, value: modelCatalog.displayMultiplier })
      .from(modelCatalog)
      .where(inArray(modelCatalog.modelKey, [...keys]));
    const manual = new Map(manualRows.map((r) => [r.modelKey, r.value]));
    const basePrice = baseModelKey ? priceMap.get(baseModelKey) : undefined;
    const baseWeighted = basePrice ? weightedPrice(basePrice) : 0;
    const recent = await this.recentAverages(keys);
    for (const key of keys) {
      const p = priceMap.get(key);
      const hand = manual.get(key) ?? null;
      const auto = p && baseWeighted > 0 ? round2(weightedPrice(p) / baseWeighted) : null;
      const r = recent.get(key);
      const useRecent = !!r && r.n >= MIN_SAMPLES;
      out.set(key, {
        displayMultiplierManual: hand,
        displayMultiplier: hand ?? auto,
        pointsPerReply: useRecent
          ? round2(microsToPoints(r.avg))
          : p
            ? round2(microsToPoints(defaultReplyMicros(p)))
            : null,
        pointsPerReplyBasis: useRecent ? 'recent_7d' : 'default',
      });
    }
    return out;
  }
}
