/**
 * 2026-11-02 生态动作清理：调度器旧计划的门控动作映射（纯函数）。
 * 经期关怀与纪念日寄信改按 message 门控；心愿计划无门控动作（null），到期按 ecology_off 丢弃。
 */
import { describe, expect, it } from 'vitest';
import { planActionForSourceRef } from './proactive-scheduler.js';

describe('planActionForSourceRef', () => {
  it('经期关怀计划按 message 门控', () => {
    expect(planActionForSourceRef('care:cycle-1:1:2026-11-02')).toBe('message');
    expect(planActionForSourceRef('care:cycle-1:2:2026-11-02')).toBe('message');
  });

  it('纪念日寄信计划按 message 门控（Play 本体不动，只改门控）', () => {
    expect(planActionForSourceRef('play_letter_anniv:anniv-1:2026-11-02')).toBe('message');
  });

  it('心愿计划无门控动作，返回 null（调用方按 ecology_off 丢弃，不崩溃）', () => {
    expect(planActionForSourceRef('play_wish_propose:char-1:2026-10-26')).toBeNull();
    expect(planActionForSourceRef('play_wish_follow:item-1')).toBeNull();
  });

  it('其余计划按 message 门控', () => {
    expect(planActionForSourceRef('birthday:2026-11-02')).toBe('message');
    expect(planActionForSourceRef('work:link-1:2026-11-02')).toBe('message');
    expect(planActionForSourceRef('')).toBe('message');
  });

  it('前缀必须从头匹配，不认中间出现的已删前缀', () => {
    expect(planActionForSourceRef('xplay_wish_propose:char-1')).toBe('message');
    // 下划线变体不是登记过的前缀（前缀含冒号），按默认 message 门控。
    expect(planActionForSourceRef('play_wish_propose_extra:char-1')).toBe('message');
  });
});
