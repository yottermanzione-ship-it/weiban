/**
 * 年度回忆的纯规则（10-25 会员 v6）：时间窗口、夜间口径、连续天数、确定性文案。
 * 这里不读时钟、不碰数据库、不调用模型——同样的输入永远得到同样的输出，方便用假 Clock 测跨年与夜间跨日。
 *
 * 口径（与契约 http/recap.ts 的说明一致）：
 * - 窗口：每年 1 月 1 日 00:00 至 12 月 31 日 22:00（北京时间），含头不含尾。不宣称包含最后一秒。
 * - 夜间：22:00–次日 06:00。比较「哪一晚聊得更晚」用夜间时间轴（22:00 = 0，次日 03:15 = 315），
 *   凌晨的消息在比较时算前一晚，但展示仍用真实发送日期与时刻（不会把 23:59 当成比 03:15 更晚）。
 * - 连续天数只按北京日期算，不把首尾时间差说成「聊了几个小时」。
 * - 没有任何数据支撑的句子不生成；不编造陪伴时长 / 熬夜。
 */
import {
  RECAP_CUTOFF_HOUR,
  RECAP_NIGHT_END_HOUR,
  RECAP_NIGHT_START_HOUR,
  type ChatRecapNightCandidate,
  type RecapNightMessage,
  type RecapStats,
} from '@weiban/contracts';
import {
  PLATFORM_TIME_ZONE,
  daysBetween,
  localDate,
  startOfLocalDay,
} from '../../../platform/index.js';

export const RECAP_TIME_ZONE = PLATFORM_TIME_ZONE;
const HOUR_MS = 3_600_000;
/** 22:00 之后到次日 06:00 之前，凌晨按「22:00 起算的第几小时」补到时间轴上。 */
const HOURS_AFTER_MIDNIGHT = 24 - RECAP_NIGHT_START_HOUR;

export interface RecapWindow {
  /** 含。 */
  start: Date;
  /** 不含；同时也是统计截止时刻（12-31 22:00）。 */
  end: Date;
}

/** 年度统计窗口：1 月 1 日 00:00 至 12 月 31 日 22:00（北京时间）。 */
export function recapWindow(year: number): RecapWindow {
  const start = startOfLocalDay(`${year}-01-01`, RECAP_TIME_ZONE);
  const december31 = startOfLocalDay(`${year}-12-31`, RECAP_TIME_ZONE);
  return { start, end: new Date(december31.getTime() + RECAP_CUTOFF_HOUR * HOUR_MS) };
}

/** 某个时刻在北京时间属于哪一年（生成任务按它决定年度）。 */
export function recapLocalYear(now: Date): number {
  return Number(localDate(now, RECAP_TIME_ZONE).slice(0, 4));
}

/** 在夜间时间轴上的分钟数；不在夜间（06:00–21:59）返回 null。 */
export function nightOffsetMinutes(hour: number, minute: number): number | null {
  if (hour >= RECAP_NIGHT_START_HOUR) return (hour - RECAP_NIGHT_START_HOUR) * 60 + minute;
  if (hour < RECAP_NIGHT_END_HOUR) return (hour + HOURS_AFTER_MIDNIGHT) * 60 + minute;
  return null;
}

/**
 * 「最晚的一晚」：按夜间时间轴取最深的一条；同分取真实时间较晚的。
 * 候选通常已由 SQL 按同一口径排序并截断，这里再做一次纯函数判定，口径只写一次、可单测。
 */
export function pickLatestNight(
  candidates: readonly ChatRecapNightCandidate[],
): ChatRecapNightCandidate | null {
  let best: ChatRecapNightCandidate | null = null;
  for (const candidate of candidates) {
    if (
      !best ||
      candidate.nightOffsetMinutes > best.nightOffsetMinutes ||
      (candidate.nightOffsetMinutes === best.nightOffsetMinutes && candidate.atIso > best.atIso)
    )
      best = candidate;
  }
  return best;
}

/** 夜间候选 → 契约里的展示对象（真实日期 + 时刻）。 */
export function toNightMessage(
  candidate: ChatRecapNightCandidate | null,
): RecapNightMessage | null {
  if (!candidate) return null;
  return {
    date: candidate.date,
    time: candidate.time,
    conversationId: candidate.conversationId,
    characterId: candidate.characterId,
  };
}

/** 最长连续活跃天数（按北京日期）；没有日期返回 null。 */
export function longestStreak(
  activeDates: readonly string[],
): { days: number; from: string; to: string } | null {
  const sorted = [...new Set(activeDates)].sort();
  let best: { days: number; from: string; to: string } | null = null;
  let runStart: string | null = null;
  let previous: string | null = null;
  let run = 0;
  for (const date of sorted) {
    if (previous && daysBetween(previous, date) === 1) run += 1;
    else {
      runStart = date;
      run = 1;
    }
    previous = date;
    if (runStart && (!best || run > best.days)) best = { days: run, from: runStart, to: date };
  }
  return best;
}

/** 「3 月 8 日」这种给人看的写法；输入不是 YYYY-MM-DD 就原样返回，不猜。 */
export function formatRecapDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/** 页面顶部的口径 / 截止说明。 */
export function recapCutoffNote(year: number): string {
  const cutoff = String(RECAP_CUTOFF_HOUR).padStart(2, '0');
  return (
    `统计范围：${year}-01-01 00:00 至 ${year}-12-31 ${cutoff}:00（北京时间），不含 ${cutoff}:00 之后的消息。` +
    '只统计普通聊天里你此刻还能看到的记录：不含私密模式、系统提示、已撤回 / 已删除 / 已清空的消息。'
  );
}

/** 有旧版迁移记录时的如实说明；没有迁移记录返回 null（不吓唬新用户）。 */
export function recapCaveat(stats: Pick<RecapStats, 'migratedMessages'>): string | null {
  if (stats.migratedMessages <= 0) return null;
  return (
    `这份统计里有 ${stats.migratedMessages} 条来自旧版迁移：日期按旧站记录（UTC）换算；` +
    '旧的个别记录没有真实发送时间，那部分日期可能不精确，所以旧数据的夜间时刻仅供参考。'
  );
}

/** 文案只需要这几个字段，单独收窄类型；契约的 RecapStats 结构上满足它。 */
export interface RecapLineStats {
  totalMessages: number;
  userMessages: number;
  characterMessages: number;
  characterCount: number;
  activeDays: number;
  monthlyUserMessages: Array<{ month: number; count: number }>;
  topCharacters: Array<{ characterId: string; userMessages: number }>;
  busiestDays: Array<{ date: string; userMessages: number }>;
}

export interface RecapLineInput {
  stats: RecapLineStats;
  /** characterId → 展示名（生成时快照，角色之后被删也不影响这份回顾）。 */
  topNames: Record<string, string>;
  latestNight: RecapNightMessage | null;
  nightCount: number;
  streak: { days: number; from: string; to: string } | null;
}

/**
 * 确定性文字回顾：只用真实数字，哪一项没有数据就不生成那一句。
 * 不写「陪伴了你多久」「又熬了几个通宵」这类没有依据的话。
 */
export function recapLines(input: RecapLineInput): string[] {
  const { stats, topNames, latestNight, nightCount, streak } = input;
  const lines: string[] = [];
  if (stats.totalMessages > 0)
    lines.push(
      `这一年你看到 ${stats.totalMessages} 条消息：你发出 ${stats.userMessages} 条，TA 们发来 ${stats.characterMessages} 条。`,
    );
  if (stats.characterCount > 0) lines.push(`你和 ${stats.characterCount} 位角色聊过天。`);
  const top = stats.topCharacters[0];
  if (top && top.userMessages > 0)
    lines.push(
      `最常聊的是「${topNames[top.characterId] ?? '一位角色'}」，你给 TA 发了 ${top.userMessages} 条消息。`,
    );
  const busiest = stats.busiestDays[0];
  if (busiest && busiest.userMessages > 0)
    lines.push(
      `聊得最多的是 ${formatRecapDate(busiest.date)}，那天你发了 ${busiest.userMessages} 条。`,
    );
  if (stats.activeDays > 0) lines.push(`这一年你有 ${stats.activeDays} 天发过消息。`);
  const peak = stats.monthlyUserMessages.reduce<{ month: number; count: number } | null>(
    (best, item) => (item.count > 0 && (!best || item.count > best.count) ? item : best),
    null,
  );
  if (peak) lines.push(`${peak.month} 月最热闹，你发了 ${peak.count} 条。`);
  if (streak && streak.days >= 2)
    lines.push(
      `最长连续 ${streak.days} 天都有你发言：${formatRecapDate(streak.from)} 至 ${formatRecapDate(streak.to)}。`,
    );
  if (nightCount > 0) lines.push(`有 ${nightCount} 个晚上你在 22 点后还聊过天。`);
  if (latestNight)
    lines.push(
      `最晚的一次是 ${formatRecapDate(latestNight.date)} ${latestNight.time}（按真实发送时间）。`,
    );
  return lines;
}
