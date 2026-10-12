/**
 * 农历月日 → 公历日期（T-076，节日清单 lunar_annual）。
 * 用 Node 内置 ICU 的中国农历（Intl `ca-chinese`），不引入第三方库。闰月不参与匹配（只认非闰月）；
 * 某年农历当月没有这一天（如小月的三十）则该年返回 null。结果按公历年缓存。
 */
const formatter = new Intl.DateTimeFormat('en-u-ca-chinese', {
  timeZone: 'UTC',
  month: 'numeric',
  day: 'numeric',
});

const cache = new Map<number, Map<string, string>>();

/** 返回某公历年中所有「农历 MM-DD → 公历 YYYY-MM-DD」的对照（只含非闰月）。 */
function yearTable(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const table = new Map<string, string>();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (let t = start; t < end; t += 86_400_000) {
    const parts = formatter.formatToParts(new Date(t));
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    if (!/^\d+$/.test(month) || !/^\d+$/.test(day)) continue; // 闰月显示为「6bis」，跳过
    const key = `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (!table.has(key)) table.set(key, new Date(t).toISOString().slice(0, 10));
  }
  cache.set(year, table);
  return table;
}

/** 公历 year 年里农历 monthDay（MM-DD）对应的公历日期；没有则 null。 */
export function lunarToSolar(year: number, monthDay: string): string | null {
  return yearTable(year).get(monthDay) ?? null;
}

/** 校验农历 MM-DD：月 1–12、日 1–30。 */
export function isValidLunarMonthDay(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 30;
}
