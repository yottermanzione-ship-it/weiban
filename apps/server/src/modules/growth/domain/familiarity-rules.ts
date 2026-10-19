/**
 * 熟悉度领域规则（GRW-03, P-25）。
 * 纯函数，不依赖任何 NestJS / DB / 平台代码，方便单元测试。
 */
import { createHash } from 'node:crypto';
import { P25_FAMILIARITY } from '../../../platform/index.js';

// ---------- 按消息加分（16 号 §11） ----------

/**
 * 判定一条用户消息是否算「有效消息」，并给出它的内容指纹（去空白后的 SHA-256，不保存正文）。
 * - 去掉空白后至少 minChars 个字（按字符计，emoji 算一个）；
 * - 指纹与上一条消息（不论是否计分）不同；
 * - 距上一条计分消息至少 minIntervalMs（乱序到达时取差的绝对值）。
 */
export function evaluateUserMessage(input: {
  text: string;
  sentAt: Date;
  lastMessageHash: string | null;
  lastMessageScoredAt: Date | null;
}): { hash: string; valid: boolean } {
  const rule = P25_FAMILIARITY.userMessage;
  const normalized = input.text.replace(/\s+/gu, '');
  const hash = createHash('sha256').update(normalized).digest('hex');
  const valid =
    Array.from(normalized).length >= rule.minChars &&
    input.lastMessageHash !== hash &&
    (!input.lastMessageScoredAt ||
      Math.abs(input.sentAt.getTime() - input.lastMessageScoredAt.getTime()) >= rule.minIntervalMs);
  return { hash, valid };
}

/** 加分倍率与当日上限（PRO+ 每次加分与每日上限都 ×proPlusBonusRate，向上取整）。 */
export function scaledPoints(
  basePoints: number,
  proPlus: boolean,
): { points: number; dailyCap: number } {
  const rate = proPlus ? P25_FAMILIARITY.proPlusBonusRate : 1;
  return {
    points: Math.ceil(basePoints * rate),
    dailyCap: Math.ceil(P25_FAMILIARITY.maxPointsPerCharacterPerDay * rate),
  };
}

// ---------- 等级与点数 ----------

/**
 * 根据累计点数计算当前等级。
 * levelThresholds: { 1:0, 2:30, 3:100, 4:300, 5:700 }
 */
export function levelFromPoints(totalPoints: number): number {
  const thresholds = P25_FAMILIARITY.levelThresholds;
  if (totalPoints >= thresholds[5]) return 5;
  if (totalPoints >= thresholds[4]) return 4;
  if (totalPoints >= thresholds[3]) return 3;
  if (totalPoints >= thresholds[2]) return 2;
  return 1;
}

/**
 * 当前等级已积累点数（本级起点到当前累计点数的差值）。
 */
export function pointsInLevel(totalPoints: number, level: number): number {
  const thresholds = P25_FAMILIARITY.levelThresholds as Record<number, number>;
  return totalPoints - (thresholds[level] ?? 0);
}

/**
 * 升到下一级需要多少点；已到 L5 返回 null。
 */
export function pointsToNextLevel(level: number): number | null {
  if (level >= 5) return null;
  const thresholds = P25_FAMILIARITY.levelThresholds as Record<number, number>;
  return thresholds[level + 1]! - thresholds[level]!;
}

// ---------- 认识天数 ----------

/**
 * 从「认识日期」字符串（YYYY-MM-DD，用户本地日期）和当前时刻计算认识第 N 天。
 * 添加当天算第 1 天（GRW-04 第 1 条）。
 * 这里以 UTC 日期做简单天数差，精确时区计算需 identity 的 timeZone；
 * service 层如果获得 timeZone 可以替换此函数直接用 Intl 计算。
 */
export function daysKnownFromDate(knownSince: string, now: Date): number {
  const origin = new Date(knownSince + 'T00:00:00Z');
  const diffMs = now.getTime() - origin.getTime();
  return Math.max(1, Math.floor(diffMs / 86400000) + 1);
}

/**
 * 返回当前时刻在给定时区下的 YYYY-MM-DD 字符串。
 */
export function todayInTz(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ---------- 系统纪念日节点 ----------

/**
 * GRW-04 第 2 条：第 7、30、100、200、365 天，之后每 100 天和每个周年。
 * 这里只预生成前 3 年常见节点（后续由 computeNextOccurrence 处理周年循环）。
 */
export const SYSTEM_ANNIVERSARY_DAYS: number[] = [
  7,
  30,
  100,
  200,
  365,
  465,
  565,
  665,
  730, // 2 年内每 100 天
  830,
  930,
  1030,
  1095, // 3 年内
];

export function systemAnniversaryLabel(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;
    return `认识 ${years} 周年`;
  }
  return `认识第 ${days} 天`;
}

// ---------- 下次触达日期 ----------

/**
 * 计算纪念日的 nextOccurrence（YYYY-MM-DD）。
 * - 系统纪念日：已过则计算下一个周年日期。
 * - 自定义纪念日：date 本身（一次性），从不循环。
 */
export function computeNextOccurrence(
  dateStr: string,
  todayStr: string,
  kind: 'system' | 'custom',
  repeatYearly = false,
): string | null {
  if (kind === 'custom' && !repeatYearly) {
    // 自定义纪念日只返回当天日期本身；不循环。
    return dateStr >= todayStr ? dateStr : null;
  }
  // 系统纪念日：若今天已过，找最近的下一个周年。
  if (dateStr >= todayStr) return dateStr;
  // Compute next yearly anniversary from the original date.
  const orig = new Date(dateStr + 'T00:00:00Z');
  const today = new Date(todayStr + 'T00:00:00Z');
  let candidate = new Date(orig);
  // Advance year-by-year until we reach a future date.
  while (candidate <= today) {
    candidate = new Date(
      Date.UTC(candidate.getUTCFullYear() + 1, orig.getUTCMonth(), orig.getUTCDate()),
    );
  }
  return candidate.toISOString().slice(0, 10);
}

// ---------- T-076：纪念卡、熟悉度卡用到的规则 ----------

/** 等级名称（GRW-03 第 1 条）。 */
export const LEVEL_NAMES: Record<number, string> = {
  1: '初识',
  2: '眼熟',
  3: '熟络',
  4: '老友',
  5: '知己',
};

/**
 * GRW-04 第 2 条：第 7、30、100、200、365 天，之后每 100 天和每个周年。
 * 「之后每 100 天」按设计 `cards-familiarity.md` 3.2 的示例（第 400 天）取 100 的整数倍。
 */
export function isSystemAnniversaryDay(days: number): boolean {
  if ([7, 30, 100, 200, 365].includes(days)) return true;
  return days > 365 && (days % 100 === 0 || days % 365 === 0);
}

/** 1..maxDays 中的全部系统纪念日节点（升序）。 */
export function systemAnniversaryDaysUpTo(maxDays: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= maxDays; d += 1) if (isSystemAnniversaryDay(d)) out.push(d);
  return out;
}

/** 由种子生成稳定的 UUID（系统纪念日 ID 等需要 Id 格式又不存库的场合）。 */
export function stableUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function addDays(localDate: string, days: number): string {
  return new Date(Date.parse(localDate + 'T00:00:00Z') + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 认识第 N 天：knownSince 当天为第 1 天（按两个当地日期相减）。 */
export function daysKnownOn(knownSince: string, localDate: string): number {
  return (
    Math.round(
      (Date.parse(localDate + 'T00:00:00Z') - Date.parse(knownSince + 'T00:00:00Z')) / 86_400_000,
    ) + 1
  );
}

/** 当地日期所在周的周一（名场面每周最多 1 张）。 */
export function weekStartOf(localDate: string): string {
  const day = new Date(localDate + 'T00:00:00Z').getUTCDay(); // 0 = 周日
  return addDays(localDate, -((day + 6) % 7));
}

/** 自定义纪念日今天是否到达（每年提醒的按月日比较；2 月 29 日在非闰年记在 2 月 28 日）。 */
export function customAnniversaryHits(date: string, repeatYearly: boolean, today: string): boolean {
  if (!repeatYearly) return date === today;
  if (date > today) return false;
  const md = date.slice(5);
  const todayMd = today.slice(5);
  if (md === todayMd) return true;
  const year = Number(today.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return md === '02-29' && !leap && todayMd === '02-28';
}
