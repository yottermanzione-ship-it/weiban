import { describe, expect, it } from 'vitest';
import {
  followUpDedupHash,
  followUpTriggerAt,
  isFollowUpDue,
  isFollowUpExpired,
} from './follow-ups.js';

const TZ = 'Asia/Shanghai';

describe('跟进触发时间：事项 + 2 小时，深夜推到次日 09:00（当地）', () => {
  it('白天事项：+2 小时不变', () => {
    // 2026-10-31 10:00 北京时间 = 02:00 UTC；+2h = 12:00 北京时间。
    const event = Date.parse('2026-10-31T02:00:00Z');
    expect(followUpTriggerAt(event, TZ)).toBe(Date.parse('2026-10-31T04:00:00Z'));
  });
  it('晚上事项落入 22:00–08:00：推到次日 09:00', () => {
    // 事项 21:00 北京时间，+2h = 23:00，推到次日 09:00 北京时间 = 次日 01:00 UTC。
    const event = Date.parse('2026-10-31T13:00:00Z');
    expect(followUpTriggerAt(event, TZ)).toBe(Date.parse('2026-11-01T01:00:00Z'));
  });
  it('凌晨事项落入 0–8 点：推到当天 09:00', () => {
    // 事项 05:00 北京时间，+2h = 07:00，推到当天 09:00 北京时间 = 01:00 UTC。
    const event = Date.parse('2026-10-30T21:00:00Z');
    expect(followUpTriggerAt(event, TZ)).toBe(Date.parse('2026-10-31T01:00:00Z'));
  });
  it('边界：20:00 +2h = 22:00 整，推到次日 09:00；19:59 +2h = 21:59 不推', () => {
    expect(followUpTriggerAt(Date.parse('2026-10-31T12:00:00Z'), TZ)).toBe(
      Date.parse('2026-11-01T01:00:00Z'),
    );
    expect(followUpTriggerAt(Date.parse('2026-10-31T11:59:00Z'), TZ)).toBe(
      Date.parse('2026-10-31T13:59:00Z'),
    );
  });
  it('08:00 整不推（窗口是 22:00–08:00，08:00 已出窗口）', () => {
    // 事项 06:00 北京时间 +2h = 08:00，不推。
    expect(followUpTriggerAt(Date.parse('2026-10-30T22:00:00Z'), TZ)).toBe(
      Date.parse('2026-10-31T00:00:00Z'),
    );
  });
});

describe('跟进状态：到点、过期、去重', () => {
  const trigger = Date.parse('2026-10-31T04:00:00Z');
  it('待问且到点才算到点', () => {
    expect(isFollowUpDue('pending', trigger, trigger)).toBe(true);
    expect(isFollowUpDue('pending', trigger, trigger - 1)).toBe(false);
    expect(isFollowUpDue('asked', trigger, trigger + 1000)).toBe(false);
    expect(isFollowUpDue('cancelled', trigger, trigger + 1000)).toBe(false);
  });
  it('到点 24 小时后过期', () => {
    expect(isFollowUpExpired('pending', trigger, trigger + 24 * 3600_000)).toBe(false);
    expect(isFollowUpExpired('pending', trigger, trigger + 24 * 3600_000 + 1)).toBe(true);
    expect(isFollowUpExpired('asked', trigger, trigger + 48 * 3600_000)).toBe(false);
  });
  it('去重键：同一件事同一时间相同，换时间/换人不同', () => {
    const a = followUpDedupHash('u1', 'c1', '明天面试', trigger);
    expect(followUpDedupHash('u1', 'c1', '明天面试', trigger)).toBe(a);
    expect(followUpDedupHash('u1', 'c1', '明天面试', trigger + 1000)).not.toBe(a);
    expect(followUpDedupHash('u1', 'c2', '明天面试', trigger)).not.toBe(a);
    expect(followUpDedupHash('u1', 'c1', ' 周六演唱会 ', trigger)).toBe(
      followUpDedupHash('u1', 'c1', '周六演唱会', trigger),
    );
  });
});
