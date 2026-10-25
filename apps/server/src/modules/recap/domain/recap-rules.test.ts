/**
 * 年度回忆纯规则（10-25 会员 v6）：窗口/截止、夜间跨日、连续天数、确定性文案。
 * 全部用固定日期，不读真实时钟、不连数据库。
 */
import { describe, expect, it } from 'vitest';
import {
  formatRecapDate,
  longestStreak,
  nightOffsetMinutes,
  pickLatestNight,
  recapCaveat,
  recapCutoffNote,
  recapLines,
  recapLocalYear,
  recapWindow,
  toNightMessage,
  type RecapLineStats,
} from './recap-rules.js';

const EMPTY_STATS: RecapLineStats = {
  totalMessages: 0,
  userMessages: 0,
  characterMessages: 0,
  characterCount: 0,
  activeDays: 0,
  monthlyUserMessages: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, count: 0 })),
  topCharacters: [],
  busiestDays: [],
};

describe('年度回忆的时间窗口（北京时间）', () => {
  it('窗口是 1 月 1 日 00:00 到 12 月 31 日 22:00，含头不含尾', () => {
    const window = recapWindow(2026);
    expect(window.start.toISOString()).toBe('2025-12-31T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-12-31T14:00:00.000Z');
    expect(recapWindow(2027).end.toISOString()).toBe('2027-12-31T14:00:00.000Z');
  });

  it('口径说明写明截止 22:00，不宣称包含最后一秒', () => {
    const note = recapCutoffNote(2026);
    expect(note).toContain('2026-01-01 00:00');
    expect(note).toContain('2026-12-31 22:00');
    expect(note).toContain('不含 22:00 之后');
    expect(note).toContain('私密模式');
  });

  it('按北京时间判断跨年：22:00 还是当年，次日 00:00 已经是下一年', () => {
    expect(recapLocalYear(new Date('2026-12-31T22:00:00+08:00'))).toBe(2026);
    expect(recapLocalYear(new Date('2026-12-31T23:59:59+08:00'))).toBe(2026);
    expect(recapLocalYear(new Date('2027-01-01T00:00:00+08:00'))).toBe(2027);
  });
});

describe('夜间口径（22:00–次日 06:00）', () => {
  it('夜间时间轴：23:59 不晚于凌晨 03:15', () => {
    expect(nightOffsetMinutes(22, 0)).toBe(0);
    expect(nightOffsetMinutes(23, 59)).toBe(119);
    expect(nightOffsetMinutes(0, 0)).toBe(120);
    expect(nightOffsetMinutes(3, 15)).toBe(315);
    expect(nightOffsetMinutes(5, 59)).toBe(479);
    expect(nightOffsetMinutes(6, 0)).toBeNull();
    expect(nightOffsetMinutes(21, 59)).toBeNull();
  });

  it('「最晚的一晚」取夜间时间轴最深的一条，展示真实日期与时刻', () => {
    const latest = pickLatestNight([
      {
        date: '2026-03-07',
        time: '23:59',
        nightOffsetMinutes: 119,
        conversationId: 'c-1',
        characterId: 'p-1',
        atIso: '2026-03-07T15:59:00.000Z',
      },
      {
        // 次日凌晨：比较时算前一晚更深，但展示的日期是真实的 3 月 8 日。
        date: '2026-03-08',
        time: '03:15',
        nightOffsetMinutes: 315,
        conversationId: 'c-2',
        characterId: null,
        atIso: '2026-03-07T19:15:00.000Z',
      },
    ]);
    expect(latest?.time).toBe('03:15');
    expect(toNightMessage(latest)).toEqual({
      date: '2026-03-08',
      time: '03:15',
      conversationId: 'c-2',
      characterId: null,
    });
  });

  it('没有夜间消息就是 null，不编「熬夜」', () => {
    expect(pickLatestNight([])).toBeNull();
    expect(toNightMessage(null)).toBeNull();
  });
});

describe('连续天数与文案', () => {
  it('最长连续天数按北京日期算，乱序与重复日期不影响', () => {
    expect(longestStreak([])).toBeNull();
    expect(longestStreak(['2026-03-02', '2026-03-01', '2026-03-01', '2026-03-04'])).toEqual({
      days: 2,
      from: '2026-03-01',
      to: '2026-03-02',
    });
    expect(longestStreak(['2026-12-30', '2026-12-31', '2026-12-29', '2026-12-01'])).toEqual({
      days: 3,
      from: '2026-12-29',
      to: '2026-12-31',
    });
  });

  it('日期显示成「3 月 8 日」，非法输入原样返回', () => {
    expect(formatRecapDate('2026-03-08')).toBe('3 月 8 日');
    expect(formatRecapDate('not-a-date')).toBe('not-a-date');
  });

  it('没有数据就不写任何句子（不编造陪伴时长）', () => {
    expect(
      recapLines({
        stats: EMPTY_STATS,
        topNames: {},
        latestNight: null,
        nightCount: 0,
        streak: null,
      }),
    ).toEqual([]);
  });

  it('有数据时只用真实数字，并且夜间为 0 时不出现「熬夜」句子', () => {
    const stats: RecapLineStats = {
      ...EMPTY_STATS,
      totalMessages: 120,
      userMessages: 50,
      characterMessages: 70,
      characterCount: 3,
      activeDays: 9,
      monthlyUserMessages: EMPTY_STATS.monthlyUserMessages.map((item) =>
        item.month === 10 ? { ...item, count: 30 } : item,
      ),
      topCharacters: [{ characterId: 'p-1', userMessages: 40 }],
      busiestDays: [{ date: '2026-10-03', userMessages: 21 }],
    };
    const lines = recapLines({
      stats,
      topNames: { 'p-1': '小青' },
      latestNight: null,
      nightCount: 0,
      streak: { days: 4, from: '2026-10-01', to: '2026-10-04' },
    });
    expect(lines).toContain('最常聊的是「小青」，你给 TA 发了 40 条消息。');
    expect(lines).toContain('聊得最多的是 10 月 3 日，那天你发了 21 条。');
    expect(lines).toContain('10 月最热闹，你发了 30 条。');
    expect(lines.join('\n')).not.toContain('晚上');
    expect(lines.join('\n')).not.toContain('熬夜');

    const withNight = recapLines({
      stats,
      topNames: { 'p-1': '小青' },
      latestNight: {
        date: '2026-03-08',
        time: '03:15',
        conversationId: 'c-2',
        characterId: null,
      },
      nightCount: 5,
      streak: null,
    });
    expect(withNight).toContain('有 5 个晚上你在 22 点后还聊过天。');
    expect(withNight).toContain('最晚的一次是 3 月 8 日 03:15（按真实发送时间）。');
  });

  it('有旧版迁移记录时如实说明日期精度，没有就不吓唬人', () => {
    expect(recapCaveat({ migratedMessages: 0 })).toBeNull();
    const caveat = recapCaveat({ migratedMessages: 12 });
    expect(caveat).toContain('12 条来自旧版迁移');
    expect(caveat).toContain('UTC');
    expect(caveat).toContain('仅供参考');
  });
});
