/**
 * 时区与日期的纯函数（billing 用）：用户当地日期（后台每日上限、用量汇总）、北京时间自然日（平台每日上限、
 * 分时价、对账，billing.md 第 4.1、7 节）。只做计算，不读时钟（「现在」由调用方从平台时钟传入）。
 */

/** 平台每日上限、分时价、对账按北京时间（与供应商账单日一致）。 */
export const PLATFORM_TIME_ZONE = 'Asia/Shanghai';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = 周一 … 7 = 周日（与契约 PriceTimeBand.weekdays 一致）。 */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** 时区名是否可用（不认识的时区回退到北京时间，见 safeTimeZone）。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : PLATFORM_TIME_ZONE;
}

function parts(instant: Date, timeZone: string): LocalParts & { second: number } {
  const map: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS[map.weekday ?? ''] ?? 1,
  };
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const p = parts(instant, timeZone);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    weekday: p.weekday,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 某时刻在该时区的当地日期 YYYY-MM-DD。 */
export function localDate(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** 日期加减天数（YYYY-MM-DD，纯日历计算）。 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 两个日期相差的天数（b − a）。 */
export function daysBetween(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

/** 该时区下某个当地日期 0 点对应的 UTC 时刻。 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  // 当地时间 = UTC + 偏移；迭代两次处理夏令时
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = localAsUtc - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** 下一次当地 0 点（后台每日上限的重置时间）。 */
export function nextLocalMidnight(instant: Date, timeZone: string): Date {
  return startOfLocalDay(addDays(localDate(instant, timeZone), 1), timeZone);
}
