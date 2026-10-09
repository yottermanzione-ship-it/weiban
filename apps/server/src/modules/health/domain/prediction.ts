/**
 * 经期预测与状态计算（PLAY-01 第 3、5、6 条，参数 P-37）。纯函数，无 I/O，不读当前时间：
 * 「今天」由调用方按用户时区算好传入（YYYY-MM-DD）。
 *
 * P-37：用最近 6 个周期的平均周期长度和经期天数预测；记录不足 2 个周期时用默认值
 * （周期 28 天、经期 5 天）；经期前提醒在预计开始日前 2 天；经期持续超过 10 天时角色可温和建议就医。
 */

export const P37 = {
  recentCycles: 6,
  minCycles: 2,
  defaultCycleDays: 28,
  defaultPeriodDays: 5,
  reminderDaysBefore: 2,
  longPeriodDays: 10,
  /** 未填结束日的经期超过这么多天，视为用户忘记补记（不再算「正在经期」），避免误报就医提醒。 */
  staleOpenDays: 15,
  /** 相邻周期长度最大差超过此值视为不规律。 */
  irregularSpreadDays: 7,
} as const;

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

/** 两个 YYYY-MM-DD 之间相差的天数（to - from）。 */
export function dateDiffDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 把某个时间点换算成用户时区下的日期 YYYY-MM-DD。 */
export function localDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }
}

export interface CycleSpan {
  id: string;
  startDate: string;
  endDate: string | null;
}

/** 经期的「有效结束日」：有结束日用结束日；没有时按进行中算到今天，但最多 staleOpenDays 天。 */
export function effectiveEnd(cycle: CycleSpan, today: string): string {
  if (cycle.endDate) return cycle.endDate;
  const cap = addDays(cycle.startDate, P37.staleOpenDays - 1);
  return today < cap ? today : cap;
}

export type Confidence = 'normal' | 'irregular' | 'insufficient_data';

export interface Prediction {
  predictedNextStart: string | null;
  predictedDays: number | null;
  confidence: Confidence;
}

export const PREDICTION_DISCLAIMER = '预测仅供参考，不能用于避孕或医疗判断';

function average(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 按 P-37 预测下次开始日与经期天数。cycles 顺序不限。 */
export function predict(cycles: CycleSpan[], today: string): Prediction {
  if (!cycles.length)
    return { predictedNextStart: null, predictedDays: null, confidence: 'insufficient_data' };
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const recent = sorted.slice(-(P37.recentCycles + 1));
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++)
    gaps.push(dateDiffDays(recent[i - 1]!.startDate, recent[i]!.startDate));
  const enough = gaps.length >= P37.minCycles;
  const cycleDays = enough ? Math.round(average(gaps)) : P37.defaultCycleDays;
  const lengths = sorted
    .filter((c) => c.endDate)
    .slice(-P37.recentCycles)
    .map((c) => dateDiffDays(c.startDate, c.endDate!) + 1)
    .filter((n) => n > 0);
  const periodDays =
    lengths.length >= P37.minCycles ? Math.round(average(lengths)) : P37.defaultPeriodDays;
  let confidence: Confidence = 'normal';
  if (!enough) confidence = 'insufficient_data';
  else if (Math.max(...gaps) - Math.min(...gaps) > P37.irregularSpreadDays)
    confidence = 'irregular';
  const last = sorted[sorted.length - 1]!;
  let next = addDays(last.startDate, Math.max(cycleDays, 1));
  // 预测日已过去且还没记录新经期：顺延到不早于今天，避免显示过去的「预测」。
  while (next < today) next = addDays(next, Math.max(cycleDays, 1));
  return { predictedNextStart: next, predictedDays: Math.max(periodDays, 1), confidence };
}

/** 今天是否在经期、第几天、对应哪一次经期。 */
export function currentStatus(
  cycles: CycleSpan[],
  today: string,
): { inPeriod: boolean; dayOfPeriod: number | null; current: CycleSpan | null } {
  const sorted = [...cycles].sort((a, b) => b.startDate.localeCompare(a.startDate));
  for (const c of sorted) {
    if (c.startDate > today) continue;
    if (effectiveEnd(c, today) < today) continue;
    return { inPeriod: true, dayOfPeriod: dateDiffDays(c.startDate, today) + 1, current: c };
  }
  return { inPeriod: false, dayOfPeriod: null, current: null };
}

/** 两段日期是否重叠（含端点）。 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
