/**
 * 3.17（会员 v5，docs/refactor/16-membership-v5.md §2）：用户端模型列表上的「×倍率」与「约每条 X 积分」。
 *
 * - 倍率只展示，扣费仍按实际 token × 价目表售价（billing）。
 *   后台手填（model_catalog.display_multiplier）优先；否则 = 加权价 / 基准模型加权价，
 *   加权价 = 0.8×输入售价 + 0.2×输出售价；基准模型存 model_access.settings 的 display_multiplier_base。
 * - 约每条积分：最近 7 天该模型「用户付费的聊天回复」成功调用的平均实扣；样本少于 MIN_SAMPLES 时按默认假设估算。
 *   结果在进程内缓存 10 分钟（列表接口高频、数据不需要实时）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DisplayMultiplierSettings,
  microsToPoints,
  type BillingModelRatePort,
  type BillingQuotePort,
  type ModelScenario,
  type UsageQuantities,
} from '@weiban/contracts';
import { BILLING_QUOTE_PORT } from '../../billing/index.js';
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
import { MODEL_PRICE_SOURCE, MODEL_RATE_PORT, type ModelPriceSource } from '../tokens.js';
import type { VoiceCallPipeline } from '../domain/voice-call-pipeline.js';
import { VOICE_CALL_MINUTE_BLEND, VOICE_CALL_MINUTE_USAGE } from './voice-call-composite.js';

export const DISPLAY_BASE_KEY = 'display_multiplier_base';
const BASE_KEY = DISPLAY_BASE_KEY;
const WINDOW_MS = 7 * 24 * 3_600_000;
const CACHE_MS = 10 * 60_000;
export const MIN_SAMPLES = 20;

export interface DisplayPricing {
  displayMultiplier: number | null;
  displayMultiplierManual: number | null;
  pointsPerReply: number | null;
  pointsPerReplyBasis: 'recent_7d' | 'default';
  /** 3.22：进行中的限时折扣（没有为 null）。 */
  discount: { rate: number; endsAt: string } | null;
  /** 3.22：按场景「约每次积分」（已含折扣）。 */
  pointsPerUse: Partial<Record<ModelScenario, number | null>>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 3.22：媒体场景「约每次」的估算用量（语音消息约 100 字、语音识别约 15 秒、发照片 1 张）。 */
const MEDIA_USE: Partial<Record<ModelScenario, UsageQuantities>> = {
  voice_message: { ttsChars: 100 },
  speech_recognition: { asrSeconds: 15 },
  image_generation: { images: 1 },
};
const TEXT_USE: readonly ModelScenario[] = ['chat', 'voice_call', 'private'];

@Injectable()
export class DisplayPricingService {
  private recent: { at: number; map: Map<string, { avg: number; n: number }> } | null = null;
  private mediaQuotes = new Map<string, { at: number; points: number | null }>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MODEL_PRICE_SOURCE) private readonly prices: ModelPriceSource,
    @Optional() @Inject(MODEL_RATE_PORT) private readonly rates?: BillingModelRatePort,
    @Optional() @Inject(BILLING_QUOTE_PORT) private readonly quotes?: BillingQuotePort,
  ) {}

  /** 后台改了价格 / 折扣后清掉缓存的媒体估算。 */
  invalidate(): void {
    this.mediaQuotes.clear();
  }

  /** 媒体场景按价目表 + 当前折扣报价（billing 同一算式），缓存 10 分钟。 */
  private async mediaPoints(modelKey: string, scenario: ModelScenario): Promise<number | null> {
    const usage = MEDIA_USE[scenario];
    if (!usage || !this.quotes) return null;
    const cacheKey = `${modelKey}|${scenario}`;
    const hit = this.mediaQuotes.get(cacheKey);
    const nowMs = this.clock.nowMs();
    if (hit && nowMs - hit.at < CACHE_MS) return hit.points;
    const quoted = await this.quotes.quote(modelKey, usage).catch(() => null);
    const points = quoted ? round2(microsToPoints(quoted.amountMicros)) : null;
    this.mediaQuotes.set(cacheKey, { at: nowMs, points });
    return points;
  }

  /** 媒体用现价报价；文本按缓存假设估算，不误用把缓存折成原价的冻结上限。 */
  async voiceCallPointsPerMinute(pipeline: VoiceCallPipeline): Promise<number | null> {
    const quotes = this.quotes;
    if (!quotes) return null;
    const results = await Promise.all([
      quotes.quote(pipeline.asrModelKey, VOICE_CALL_MINUTE_USAGE.asr),
      quotes.quote(pipeline.ttsModelKey, VOICE_CALL_MINUTE_USAGE.tts),
      this.prices.textPrices([pipeline.textModelKey]),
      this.rates?.getModelDiscounts([pipeline.textModelKey]) ?? Promise.resolve(new Map()),
    ]).catch(() => null);
    if (!results) return null;
    const [asr, tts, prices, discounts] = results;
    const text = prices.get(pipeline.textModelKey);
    if (!asr || !tts || !text) return null;
    const discount = discounts.get(pipeline.textModelKey);
    const now = this.clock.nowMs();
    const rate =
      discount && Date.parse(discount.startsAt) <= now && now < Date.parse(discount.endsAt)
        ? discount.rate
        : 1;
    const textMicros = Math.ceil(
      defaultReplyMicros(text) * VOICE_CALL_MINUTE_BLEND.textTurns * rate,
    );
    return round2(microsToPoints(asr.amountMicros + tts.amountMicros + textMicros));
  }

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
      .select({
        modelKey: modelCatalog.modelKey,
        value: modelCatalog.displayMultiplier,
        scenarios: modelCatalog.scenarios,
      })
      .from(modelCatalog)
      .where(inArray(modelCatalog.modelKey, [...keys]));
    const manual = new Map(manualRows.map((r) => [r.modelKey, r.value]));
    const scenariosOf = new Map(manualRows.map((r) => [r.modelKey, r.scenarios]));
    const discounts = (await this.rates?.getModelDiscounts(keys)) ?? new Map();
    const nowMs = this.clock.nowMs();
    const basePrice = baseModelKey ? priceMap.get(baseModelKey) : undefined;
    const baseWeighted = basePrice ? weightedPrice(basePrice) : 0;
    const recent = await this.recentAverages(keys);
    for (const key of keys) {
      const p = priceMap.get(key);
      const hand = manual.get(key) ?? null;
      const auto = p && baseWeighted > 0 ? round2(weightedPrice(p) / baseWeighted) : null;
      const d = discounts.get(key);
      const discount =
        d && Date.parse(d.startsAt) <= nowMs && nowMs < Date.parse(d.endsAt)
          ? { rate: d.rate, endsAt: d.endsAt }
          : null;
      const r = recent.get(key);
      // 折扣期间最近 7 天的实扣里混有折后数，不能再乘一次：改按默认假设 × 折后售价估算。
      const useRecent = !!r && r.n >= MIN_SAMPLES && !discount;
      const perReply = useRecent
        ? round2(microsToPoints(r.avg))
        : p
          ? round2(microsToPoints(defaultReplyMicros(p)) * (discount?.rate ?? 1))
          : null;
      const pointsPerUse: Partial<Record<ModelScenario, number | null>> = {};
      for (const scenario of (scenariosOf.get(key) ?? []) as ModelScenario[]) {
        pointsPerUse[scenario] = TEXT_USE.includes(scenario)
          ? perReply
          : await this.mediaPoints(key, scenario);
      }
      out.set(key, {
        displayMultiplierManual: hand,
        displayMultiplier: hand ?? auto,
        pointsPerReply: perReply,
        pointsPerReplyBasis: useRecent ? 'recent_7d' : 'default',
        discount,
        pointsPerUse,
      });
    }
    return out;
  }
}
