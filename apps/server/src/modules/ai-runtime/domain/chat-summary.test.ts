import { describe, expect, it } from 'vitest';
import { importantMemoryIntent, renderChatSummary, validateSummaryAnswer } from './chat-summary.js';

describe('滚动总结的来源与权益', () => {
  it('日期由最早真实来源决定，不能把旧事重新写成今日解锁免费七天', () => {
    const sources = new Map([
      ['old', { at: '2026-09-01' }],
      ['new', { at: '2026-10-30' }],
    ]);
    const values = validateSummaryAnswer(
      { items: [{ text: '旧资料与新的约定', sourceIds: ['old', 'new'] }] },
      sources,
    );
    expect(values[0]?.at).toBe('2026-09-01');
    const stored = values.map((x) => ({ ...x, id: 'checkpoint' }));
    expect(renderChatSummary(stored, '2026-10-24')).toBe('');
    expect(renderChatSummary(stored, null)).toContain('旧资料');
    expect(stored).toHaveLength(1); // 只是读时排除，不删除会员到期前的内容。
  });
  it('拒绝虚构来源与过长输出', () => {
    expect(() =>
      validateSummaryAnswer({ items: [{ text: '伪造事实', sourceIds: ['unknown'] }] }, new Map()),
    ).toThrow('summary_unknown_source');
    expect(() =>
      validateSummaryAnswer(
        {
          items: [
            { text: '字'.repeat(1200), sourceIds: ['a'] },
            { text: '多余', sourceIds: ['a'] },
          ],
        },
        new Map([['a', { at: '2026-10-30' }]]),
      ),
    ).toThrow('summary_too_long');
  });
  it.each([
    '请记住我喜欢绿茶',
    '以后叫我小林',
    '我的生日是六月三日',
    '我们约好周六见',
    '你记错了，我现在住杭州',
    '我一直喜欢小猫',
  ])('明确候选进入事实线：%s', (text) => {
    expect(importantMemoryIntent(text)).toBe(true);
  });
  it.each([
    '早上好',
    '我今天有点难过',
    '我喜欢今天这杯饮料',
    '假如我是国王',
    '不要记住这个',
    '如果我是你的同桌',
  ])('闲聊或明确不记不触发：%s', (text) => {
    expect(importantMemoryIntent(text)).toBe(false);
  });
});
