/**
 * 定时跟进的纯规则（多样性草案 §4，表 follow_ups）。
 *
 * 触发规则：事项时间 + 2 小时；落在当地 22:00–次日 08:00 就推到次日 09:00。
 * 多日事项「取结束次日」这一条无法从记忆里单个 dueAt 算出来（记忆只有一个人时间点，
 * 没有结束时间），本文件不编造结束时间：调用方只传 dueAt 时按单点规则算；多日事项
 * 须由抽取方把结束次日算好再建行（见 trigger_rule 字段）。
 * 时间含糊（「过几天」）不建事项：只有带明确 dueAt 的约定才进 follow_ups。
 */
import { createHash } from 'node:crypto';

export type FollowUpStatus = 'pending' | 'asked' | 'cancelled' | 'expired';

/** 到点后保留多久：生态关着时不补发，超过这个时间改成已过期。 */
export const FOLLOW_UP_EXPIRY_MS = 24 * 3600_000;
/** 每天每角色最多问几条跟进。 */
export const FOLLOW_UP_DAILY_MAX = 2;

function localPartsOf(
  ms: number,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function zonedMs(date: string, hour: number, minute: number, timeZone: string): number {
  // 用 Intl 反推：目标墙上时间先当成 UTC（target），再按该时区的实际偏移修正（迭代两次足够收敛）。
  const target = Date.parse(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const get = (type: string) => shown.find((p) => p.type === type)?.value ?? '';
    const asUtc = Date.parse(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
    );
    guess += target - asUtc;
  }
  return guess;
}

/**
 * 事项时间 + 2 小时；落在当地 22:00–次日 08:00 就推到次日 09:00（当地）。
 * 返回 UTC 毫秒时间戳（trigger_at 统一存 UTC）。
 */
export function followUpTriggerAt(eventAtMs: number, timeZone: string): number {
  const candidate = eventAtMs + 2 * 3600_000;
  const local = localPartsOf(candidate, timeZone);
  const night = local.hour >= 22 || local.hour < 8;
  if (!night) return candidate;
  // 推到「候选时间所在当地日期的次日 09:00」：若在 0–8 点，次日是当天；若在 22–24 点，次日是明天。
  // 统一按：取候选当地日期，若小时 < 8 则当天 09:00，否则次日 09:00。
  const base = new Date(zonedMs(local.date, 9, 0, timeZone));
  if (local.hour < 8) return base.getTime();
  base.setUTCDate(base.getUTCDate() + 1);
  return base.getTime();
}

/** 该事项到点了吗（待问且 trigger_at 已到）。 */
export function isFollowUpDue(status: FollowUpStatus, triggerAtMs: number, nowMs: number): boolean {
  return status === 'pending' && triggerAtMs <= nowMs;
}

/** 到点后 24 小时仍没问（生态关着），就过期，不再补发。 */
export function isFollowUpExpired(
  status: FollowUpStatus,
  triggerAtMs: number,
  nowMs: number,
): boolean {
  return status === 'pending' && nowMs - triggerAtMs > FOLLOW_UP_EXPIRY_MS;
}

/** 同一用户同一角色同一件事同一时间只建一行：去重键。 */
export function followUpDedupHash(
  userId: string,
  characterId: string,
  eventText: string,
  eventAtMs: number,
): string {
  return createHash('sha256')
    .update([userId, characterId, eventText.trim(), String(eventAtMs)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

/** 触发规则说明（写进 trigger_rule 字段，供排查）。 */
export function followUpTriggerRule(eventAtMs: number, timeZone: string): string {
  const trigger = followUpTriggerAt(eventAtMs, timeZone);
  const pushed = trigger !== eventAtMs + 2 * 3600_000;
  return pushed ? 'event+2h, night window pushed to 09:00 local' : 'event+2h';
}
