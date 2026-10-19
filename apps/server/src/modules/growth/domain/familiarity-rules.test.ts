import { describe, expect, it } from 'vitest';
import { P25_FAMILIARITY } from '../../../platform/index.js';
import { evaluateUserMessage, levelFromPoints, scaledPoints } from './familiarity-rules.js';

const t0 = new Date('2026-10-20T08:00:00.000Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

describe('16 号 §11 好感度参数', () => {
  it('免费 +4 / 上限 350；PRO+ 翻倍为 +8 / 上限 700', () => {
    expect(scaledPoints(P25_FAMILIARITY.points.userMessage, false)).toEqual({
      points: 4,
      dailyCap: 350,
    });
    expect(scaledPoints(P25_FAMILIARITY.points.userMessage, true)).toEqual({
      points: 8,
      dailyCap: 700,
    });
  });

  it('原有加分项同样翻倍', () => {
    expect(scaledPoints(P25_FAMILIARITY.points.activeChatDay, true).points).toBe(20);
    expect(scaledPoints(P25_FAMILIARITY.points.firstTimeInteraction, true).points).toBe(10);
  });

  it('满级阈值不变：一直聊免费 2 天、PRO+ 1 天满级', () => {
    expect(levelFromPoints(699)).toBe(4);
    expect(levelFromPoints(700)).toBe(5);
    expect(levelFromPoints(350 * 2)).toBe(5);
  });
});

describe('evaluateUserMessage 有效消息判定', () => {
  const first = { lastMessageHash: null, lastMessageScoredAt: null };

  it('第一条两个字以上的消息有效', () => {
    expect(evaluateUserMessage({ text: '你好', sentAt: t0, ...first }).valid).toBe(true);
  });

  it('去掉空白后不足 2 个字无效', () => {
    expect(evaluateUserMessage({ text: ' 嗯 ', sentAt: t0, ...first }).valid).toBe(false);
    expect(evaluateUserMessage({ text: ' \n\t ', sentAt: t0, ...first }).valid).toBe(false);
    expect(evaluateUserMessage({ text: '嗯 嗯', sentAt: t0, ...first }).valid).toBe(true);
  });

  it('与上一条内容相同（忽略空白）无效', () => {
    const a = evaluateUserMessage({ text: '早上好', sentAt: t0, ...first });
    const again = evaluateUserMessage({
      text: '早上 好',
      sentAt: later(10_000),
      lastMessageHash: a.hash,
      lastMessageScoredAt: t0,
    });
    expect(again.valid).toBe(false);
    expect(again.hash).toBe(a.hash);
  });

  it('距上一条计分消息不足 3 秒无效，满 3 秒有效', () => {
    const prev = evaluateUserMessage({ text: '在吗', sentAt: t0, ...first });
    const base = { lastMessageHash: prev.hash, lastMessageScoredAt: t0 };
    expect(evaluateUserMessage({ text: '睡了吗', sentAt: later(2_999), ...base }).valid).toBe(
      false,
    );
    expect(evaluateUserMessage({ text: '睡了吗', sentAt: later(3_000), ...base }).valid).toBe(true);
  });

  it('乱序到达（发送时刻早于上一条计分消息）按差的绝对值判断', () => {
    const base = { lastMessageHash: 'x', lastMessageScoredAt: t0 };
    expect(evaluateUserMessage({ text: '你好呀', sentAt: later(-1_000), ...base }).valid).toBe(
      false,
    );
    expect(evaluateUserMessage({ text: '你好呀', sentAt: later(-5_000), ...base }).valid).toBe(
      true,
    );
  });

  it('emoji 按一个字计', () => {
    expect(evaluateUserMessage({ text: '😀', sentAt: t0, ...first }).valid).toBe(false);
    expect(evaluateUserMessage({ text: '😀😀', sentAt: t0, ...first }).valid).toBe(true);
  });
});
