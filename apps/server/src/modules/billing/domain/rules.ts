/**
 * billing 的纯规则（不碰数据库、不读时钟）：常量、用途分类、估价与结算金额计算、分时价选择。
 * 规则来源：docs/architecture/billing.md 第 4、5.2、6.1、6.6、7 节；契约 ports/billing.ts、ports/model-gateway.ts。
 */
import {
  BACKGROUND_PURPOSES,
  BUDGET_EXEMPT_PURPOSES,
  SAFETY_OVERDRAFT_PURPOSES,
  type ModelPurpose,
  type PriceUnit,
  type SpendCategory as SpendCategorySchema,
  type UsageQuantities,
} from '@weiban/contracts';
import type { z } from 'zod';

type SpendCategory = z.infer<typeof SpendCategorySchema>;
import { P32_LOW_BALANCE_ALERT_MICROS } from '../../../platform/index.js';
import { localParts, PLATFORM_TIME_ZONE } from './local-time.js';

// ---------- 常量 ----------

/**
 * 安全优先透支上限的默认值：2 元。数字的唯一定义处是 billing.md 6.6 第 2 条，这里是它在代码中的映射；
 * 可用环境变量 BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS 覆盖（platform 配置）。
 */
export const SAFETY_OVERDRAFT_LIMIT_MICROS_DEFAULT = 2_000_000;

/** 对账第 ① 层：用户钱包余额低于 −(透支上限 + 1 元) 标红（billing.md 6.6 第 7 条、8.2 节）。 */
export const OVERDRAFT_ALERT_MARGIN_MICROS = 1_000_000;

/** 最低冻结额 0.001 元（billing.md 6.1）。 */
export const MIN_HOLD_MICROS = 1_000;

/** 冻结有效期：创建后 10 分钟（billing.md 5.3）。 */
export const HOLD_TTL_MS = 10 * 60_000;

/** 对账第 ① 层：超过 1 小时仍为 active 的冻结算异常（billing.md 8.2）。 */
export const STALE_HOLD_MS = 60 * 60_000;

/** 后台每日上限默认值：3 元。唯一定义处 docs/ai/cost-estimate.md 6.1。 */
export const DEFAULT_BACKGROUND_DAILY_LIMIT_MICROS = 3_000_000;

/** 余额提醒线默认值：PRD P-32（product-params.ts）。 */
export const DEFAULT_LOW_BALANCE_THRESHOLD_MICROS = P32_LOW_BALANCE_ALERT_MICROS;

/** 平台每日成本预算达到这个比例时通知管理员（billing.md 第 7 节第 2 条）。 */
export const PLATFORM_BUDGET_ALERT_RATIO = 0.8;

// ---------- 用途分类 ----------

/**
 * 用途 → 用户可见分组（billing.md 5.2 节对照表）。用 Record 保证契约新增用途时这里必须登记（否则类型检查失败）。
 */
export const PURPOSE_CATEGORY: Record<ModelPurpose, SpendCategory> = {
  chat_reply: 'chat',
  memory: 'background',
  simulation: 'background',
  proactive: 'background',
  moments: 'background',
  vision: 'media',
  voice: 'media',
  image_generation: 'media',
  web_search: 'media',
  import_analysis: 'import',
  safety_check: 'safety',
  safety_followup: 'safety',
  behavior_planning: 'planning',
  admin_distill: 'admin',
  admin_persona_check: 'admin',
  admin_public_update_search: 'admin',
  admin_eval: 'admin',
  admin_upstream_test: 'admin',
};

export function categoryOf(purpose: string | null): SpendCategory | null {
  if (!purpose) return null;
  return (PURPOSE_CATEGORY as Record<string, SpendCategory | undefined>)[purpose] ?? null;
}

/**
 * 这次冻结是否计入用户后台每日上限（billing.md 第 7 节第 1 条）：
 * 豁免用途永不计入；后台用途总是计入；其他用途看调用方是否传了 countAsBackground。
 */
export function countsAsBackground(purpose: ModelPurpose, countAsBackground?: boolean): boolean {
  if (BUDGET_EXEMPT_PURPOSES.includes(purpose)) return false;
  if (BACKGROUND_PURPOSES.includes(purpose)) return true;
  return countAsBackground === true;
}

/** 安全优先透支的资格（billing.md 6.6 第 1 条，billing 这一侧的校验）。 */
export function safetyOverdraftEligible(
  purpose: ModelPurpose,
  accountKind: 'user' | 'platform',
  requested: boolean | undefined,
): boolean {
  return (
    requested === true && accountKind === 'user' && SAFETY_OVERDRAFT_PURPOSES.includes(purpose)
  );
}

// ---------- 价格 ----------

export interface PriceBand {
  name: string;
  weekdays: number[];
  start: string;
  end: string;
}

export interface PriceRow {
  modelKey: string;
  unit: PriceUnit;
  band: PriceBand | null;
  priceMicros: number;
  costMicros: number;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** 时段是否覆盖该时刻（北京时间；end 不含；end ≤ start 表示跨午夜）。 */
export function bandCovers(band: PriceBand, at: Date): boolean {
  const p = localParts(at, PLATFORM_TIME_ZONE);
  const minute = p.hour * 60 + p.minute;
  const start = toMinutes(band.start);
  const end = toMinutes(band.end);
  if (start < end) return band.weekdays.includes(p.weekday) && minute >= start && minute < end;
  // 跨午夜：前半段按当天星期判断，后半段按前一天
  if (minute >= start) return band.weekdays.includes(p.weekday);
  if (minute < end) return band.weekdays.includes(p.weekday === 1 ? 7 : p.weekday - 1);
  return false;
}

/** 选出某单位在该时刻生效的价格：先找覆盖该时刻的时段价，否则取全天价（band = null）。 */
export function selectPrice(rows: readonly PriceRow[], unit: PriceUnit, at: Date): PriceRow | null {
  const candidates = rows.filter((r) => r.unit === unit);
  return (
    candidates.find((r) => r.band !== null && bandCovers(r.band, at)) ??
    candidates.find((r) => r.band === null) ??
    null
  );
}

/** 用量字段 → 计价单位与「每单位对应的数量换算」（分母，全部化成 1/3,000,000 的整数倍计算）。 */
const COMMON_DENOMINATOR = 3_000_000n;
const QUANTITY_UNITS: Array<{
  field: keyof UsageQuantities;
  unit: PriceUnit;
  /** 数量 × 单价 × factor / COMMON_DENOMINATOR = 微元。 */
  factor: bigint;
}> = [
  { field: 'inputTokens', unit: 'input_tokens_per_million', factor: 3n }, // ÷ 1,000,000
  { field: 'cachedInputTokens', unit: 'cached_input_tokens_per_million', factor: 3n },
  { field: 'outputTokens', unit: 'output_tokens_per_million', factor: 3n },
  { field: 'images', unit: 'image', factor: 3_000_000n }, // × 1
  { field: 'ttsChars', unit: 'tts_10k_chars', factor: 300n }, // ÷ 10,000
  { field: 'asrSeconds', unit: 'asr_minute', factor: 50_000n }, // ÷ 60
  { field: 'realtimeSeconds', unit: 'realtime_minute', factor: 50_000n },
  { field: 'searchCalls', unit: 'search_call', factor: 3_000_000n },
];

export type PriceResult =
  { ok: true; sellMicros: number; costMicros: number } | { ok: false; missingUnit: PriceUnit };

/**
 * 按价目表计算一次调用的售价金额与成本金额（billing.md 4.2：结果向上取整到整数微元）。
 * 有数量但没有对应价格的单位：strict = true 时返回缺价（冻结时拒绝，避免免费调用）；
 * strict = false 时按 0 计（结算时调用已经发生，不能拒绝；由调用方记错误日志）。
 * 命中缓存的输入 token 没有单独的缓存价时按普通输入价计。
 */
export function priceUsage(
  rows: readonly PriceRow[],
  usage: UsageQuantities,
  at: Date,
  strict: boolean,
): PriceResult & { unpricedUnits: PriceUnit[] } {
  let sell = 0n;
  let cost = 0n;
  const unpriced: PriceUnit[] = [];
  for (const { field, unit, factor } of QUANTITY_UNITS) {
    const quantity = usage[field] ?? 0;
    if (quantity <= 0) continue;
    let row = selectPrice(rows, unit, at);
    if (!row && unit === 'cached_input_tokens_per_million') {
      row = selectPrice(rows, 'input_tokens_per_million', at);
    }
    if (!row) {
      if (strict) return { ok: false, missingUnit: unit, unpricedUnits: [unit] };
      unpriced.push(unit);
      continue;
    }
    const q = BigInt(Math.ceil(quantity));
    sell += q * BigInt(row.priceMicros) * factor;
    cost += q * BigInt(row.costMicros) * factor;
  }
  const ceilDiv = (n: bigint) => Number((n + COMMON_DENOMINATOR - 1n) / COMMON_DENOMINATOR);
  return {
    ok: true,
    sellMicros: ceilDiv(sell),
    costMicros: ceilDiv(cost),
    unpricedUnits: unpriced,
  };
}

/** 用量是否全部为非负有限数。 */
export function validUsage(usage: UsageQuantities): boolean {
  return Object.values(usage).every(
    (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
  );
}

/** 价目表草稿的校验：同一模型同一单位同一时段不能重复；有时段价的单位必须有全天价兜底。返回问题列表。 */
export function validatePriceItems(items: readonly PriceRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const hasBase = new Set<string>();
  const needsBase = new Set<string>();
  for (const item of items) {
    const key = `${item.modelKey}|${item.unit}`;
    const full = `${key}|${item.band?.name ?? ''}`;
    if (seen.has(full))
      problems.push(`重复的价格：${item.modelKey} ${item.unit} ${item.band?.name ?? '全天'}`);
    seen.add(full);
    if (item.band) {
      needsBase.add(key);
      if (item.band.start === item.band.end)
        problems.push(`时段 ${item.band.name} 的开始与结束相同`);
    } else hasBase.add(key);
  }
  for (const key of needsBase) {
    if (!hasBase.has(key)) problems.push(`${key.replace('|', ' ')} 有时段价但缺少全天价`);
  }
  return problems;
}
