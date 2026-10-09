/**
 * 熟悉度领域规则（GRW-03, P-25）。
 * 纯函数，不依赖任何 NestJS / DB / 平台代码，方便单元测试。
 */
import { P25_FAMILIARITY } from '../../../platform/index.js';

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
): string | null {
  if (kind === 'custom') {
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
