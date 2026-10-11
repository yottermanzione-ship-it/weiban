import { describe, expect, it } from 'vitest';
import { allowedQuirks, quirkDelay, ruleQuirk, typoCorrection, type QuirkFacts } from './quirks.js';

const facts: QuirkFacts = {
  fit: 5,
  tags: ['tsundere', 'shy'],
  scenarioMode: 'daily',
  scope: 'normal',
  instantReply: false,
  care: false,
  suspected: false,
  healthUsed: false,
  userText: '今天又看到一只猫',
  typoStyle: 'pinyin',
};

describe('private-chat quirk safety rules', () => {
  it.each([
    { care: true },
    { suspected: true },
    { healthUsed: true },
    { userText: '我很难过，帮帮我' },
    { userText: '请问药量怎么调整' },
    { userText: '我今天心情不好，不开心' },
    { userText: '最近失眠焦虑，真的很伤心' },
  ])('suppresses all actions for %o', (override) => {
    expect(allowedQuirks({ ...facts, ...override })).toEqual(['none']);
  });
  it('never delays instant replies or indifferent persona settings', () => {
    expect(allowedQuirks({ ...facts, instantReply: true })).not.toContain('read_delay');
    expect(allowedQuirks({ ...facts, instantReply: true })).not.toContain('shy_typing');
    expect(allowedQuirks({ ...facts, fit: 1 })).toEqual(['none']);
    expect(allowedQuirks({ ...facts, fit: 2 })).toEqual(['none', 'recall', 'typo']);
  });
  it('requires a matching persona or mode and excludes adult recall/typos', () => {
    expect(allowedQuirks({ ...facts, tags: [] })).toEqual(['none', 'recall', 'typo']);
    expect(allowedQuirks({ ...facts, scope: 'adult' })).toEqual([
      'none',
      'read_delay',
      'shy_typing',
    ]);
    expect(allowedQuirks({ ...facts, tags: [], scenarioMode: 'tsundere' })).toContain('read_delay');
    expect(allowedQuirks({ ...facts, tags: ['sharpTongue'] })).toContain('read_delay');
    expect(allowedQuirks({ ...facts, typoStyle: 'none' })).not.toContain('typo');
  });
  it('only picks available choices and clamps the mandatory response delay', () => {
    expect(ruleQuirk(['none'], 5, 0)).toBe('none');
    expect(ruleQuirk(['none', 'typo'], 5, 0)).toBe('typo');
    expect(ruleQuirk(allowedQuirks(facts), 5, 0.9)).toBe('none');
    expect(quirkDelay(-1)).toBe(30_000);
    expect(quirkDelay(2)).toBe(180_000);
  });
  it('uses a known typo and a separate correction, preserving unrelated text', () => {
    expect(typoCorrection('我已经到家了')).toEqual({ text: '我以经到家了', correction: '*已经' });
    expect(typoCorrection('陈再明的生日是2月3日')).toBeNull();
  });
});
