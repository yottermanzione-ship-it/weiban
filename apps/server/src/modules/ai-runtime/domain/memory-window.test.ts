import { describe, expect, it } from 'vitest';
import { renderStableMemory, stableHistoryReadLimit } from './memory-window.js';

const input = {
  scope: 'normal' as const,
  resident: [],
  windowStart: 100,
  segments: [{ toSeq: 90, at: '2026-10-16', scope: 'normal' as const, text: '近期片段' }],
  legacySummary: '无日期旧摘要',
  daily: [
    { period: '2026-10-13', normal: '过期日摘要', adult: '' },
    { period: '2026-10-14', normal: '边界日摘要', adult: '' },
  ],
  monthly: [{ period: '2026-10', normal: '混合整月旧事', adult: '' }],
  annual: [{ period: '2026', normal: '混合整年旧事', adult: '' }],
};

describe('缓存友好的原文读取窗口', () => {
  const read = (last: number) =>
    Array.from({ length: last }, (_, i) => i + 1).slice(-stableHistoryReadLimit(last + 1));
  it('同一段只追加新消息，跨段也至少保留旧策略的全部600条', () => {
    for (let last = 640; last < 832; last++) {
      const current = read(last);
      expect(current.slice(-600)).toEqual(Array.from({ length: 600 }, (_, i) => last - 599 + i));
      expect(current.length).toBeLessThanOrEqual(663);
      if (last % 64 !== 63) expect(read(last + 1).slice(0, current.length)).toEqual(current);
    }
  });
  it('短聊天原文一条不少，未指定游标时仍使用既有上限', () => {
    expect(read(40)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(stableHistoryReadLimit()).toBe(600);
  });
});
describe('限制天数时的旧摘要回退', () => {
  it('月中截止不带入跨边界的整月/整年摘要，边界当天仍可用', () => {
    const result = renderStableMemory({ ...input, summarySince: '2026-10-14' });
    expect(result).toContain('边界日摘要');
    expect(result).toContain('近期片段');
    for (const text of ['过期日摘要', '混合整月旧事', '混合整年旧事', '无日期旧摘要'])
      expect(result).not.toContain(text);
  });
  it('月首截止允许从该日开始的整月，但仍拒绝跨边界年度摘要', () => {
    const result = renderStableMemory({ ...input, summarySince: '2026-10-01' });
    expect(result).toContain('混合整月旧事');
    expect(result).not.toContain('混合整年旧事');
  });
  it('不限制天数仍可用旧月年摘要；无片段时可用旧滚动摘要', () => {
    const result = renderStableMemory({ ...input, segments: [], summarySince: null });
    for (const text of ['混合整月旧事', '混合整年旧事', '无日期旧摘要'])
      expect(result).toContain(text);
  });
});
