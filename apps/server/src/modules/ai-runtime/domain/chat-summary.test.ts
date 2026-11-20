import { describe, expect, it } from 'vitest';
import { summaryFloorSeq, uncoveredHistoryEnd } from './memory-window.js';
import {
  fitSummaryPiece,
  importantMemoryIntent,
  renderChatSummary,
  parseSummaryJson,
  summarySubmission,
  validateSummaryAnswer,
} from './chat-summary.js';

describe('滚动总结的来源与权益', () => {
  it('只拆完整外层 JSON 围栏，纯叙述和围栏外文字不可成为摘要', () => {
    const valid = { items: [{ text: '共同约定', sourceIds: ['m1'] }] };
    expect(parseSummaryJson('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
    expect(() => parseSummaryJson('补充说明\n```json\n{}\n```')).toThrow('summary_json');
    expect(() => validateSummaryAnswer({ text: '没有可验证来源的说明' }, new Map())).toThrow(
      'summary_fields',
    );
    expect(() =>
      validateSummaryAnswer({ items: [{ text: '约定', sourceIds: [] }] }, new Map()),
    ).toThrow('summary_reference_fields');
  });
  it('短编号只绑定此批，旧裸 ID 仅指向一次完整送入的消息', () => {
    const input = {
      previous: [{ id: 'old', at: '2026-01-01', text: '之前的约定' }],
      messages: [
        { id: 'whole:0:2', messageId: 'whole', at: '2026-01-02', sender: 'user', text: '全句' },
        { id: 'tail:3:5', messageId: 'tail', at: '2026-01-03', sender: 'user', text: '结尾' },
        { id: 'head:0:2', messageId: 'head', at: '2026-01-03', sender: 'user', text: '开头' },
      ],
      partialMessageId: 'head',
    };
    const old = summarySubmission(input);
    expect([...old.sources.keys()]).toEqual(['old', 'whole:0:2', 'tail:3:5', 'head:0:2', 'whole']);
    const compact = summarySubmission({ ...input, shortRefs: true });
    expect([...compact.sources.keys()]).toEqual(['p1', 'm1', 'm2', 'm3']);
    expect(JSON.stringify(compact.payload)).not.toContain('messageId');
    expect(() =>
      validateSummaryAnswer({ items: [{ text: '来源错', sourceIds: ['m4'] }] }, compact.sources),
    ).toThrow('summary_unknown_source');
  });
  it('超长旧消息按实际 JSON 字节连续分片，符号及中文不丢失', () => {
    const text = '汉字"😀\\\n'.repeat(90);
    const source = { messageId: 'source', at: '2026-11-18', sender: 'user' };
    let offset = 0,
      rebuilt = '';
    while (offset < text.length) {
      const piece = fitSummaryPiece(source, text, offset, 113, 153);
      expect(piece).not.toBeNull();
      expect(piece!.bytes).toBeLessThanOrEqual(153);
      expect(piece!.end).toBeGreaterThan(offset);
      expect(piece!.item.text).not.toMatch(/[\uD800-\uDBFF]$/);
      rebuilt += piece!.item.text;
      offset = piece!.end;
    }
    expect(rebuilt).toBe(text);
    expect(fitSummaryPiece(source, text, 0, 32, 1)).toBeNull();
  });
  it('免费档摘要起点不早于 summaryDays 窗口', () => {
    const history = [
      { seq: 1, createdAt: '2026-10-21T04:11:39.150Z' },
      { seq: 240, createdAt: '2026-10-23T07:46:17.651Z' },
      { seq: 900, createdAt: '2026-11-04T00:00:00.000Z' },
    ];
    expect(summaryFloorSeq(history, 7, new Date('2026-11-10T02:00:00Z'))).toBe(900);
    expect(summaryFloorSeq(history, null, new Date('2026-11-10T02:00:00Z'))).toBe(0);
    expect(summaryFloorSeq(history.slice(0, 2), 7, new Date('2026-11-10T02:00:00Z'))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
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
            { text: '多'.repeat(401), sourceIds: ['a'] },
          ],
        },
        new Map([['a', { at: '2026-10-30' }]]),
      ),
    ).toThrow('summary_too_long');
  });
  it('保留稍超生成目标的完整有效回顾，而不是截字或丢项', () => {
    const items = Array.from({ length: 26 }, (_, i) => ({
      text: `第${i}项：${'保留已有事实。'.repeat(7)}`,
      sourceIds: ['known'],
    }));
    const result = validateSummaryAnswer({ items }, new Map([['known', { at: '2026-11-10' }]]));
    expect(result.map((x) => x.text)).toEqual(items.map((x) => x.text));
    expect(result).toHaveLength(26);
    expect(() =>
      validateSummaryAnswer(
        { items: Array.from({ length: 31 }, () => ({ text: '事实', sourceIds: ['known'] })) },
        new Map([['known', { at: '2026-11-10' }]]),
      ),
    ).toThrow();
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

it('600条读取保护必须留下显式缺口，而不是假装模型容量或摘要已覆盖', () => {
  const history = Array.from({ length: 600 }, (_, i) => ({ seq: 1000 + i }));
  expect(uncoveredHistoryEnd(history, 0)).toBe(999);
  expect(uncoveredHistoryEnd(history, 999)).toBeNull();
  expect(uncoveredHistoryEnd(history.slice(1), 0)).toBeNull();
});
