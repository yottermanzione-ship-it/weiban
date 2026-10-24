import { describe, expect, it } from 'vitest';
import { CharacterEligibilityFacts } from '@weiban/contracts';
import { applyEligibilityPatch, splitSelected } from './batch-helpers.js';

function facts(overrides: Record<string, unknown> = {}) {
  return CharacterEligibilityFacts.parse({
    basis: 'original',
    realPersonKind: null,
    ageSetting: 'adult',
    childAppearance: false,
    childFeaturesDetected: false,
    ...overrides,
  });
}

describe('applyEligibilityPatch', () => {
  it('只改年龄时保留其他字段', () => {
    const next = applyEligibilityPatch(facts({ childAppearance: true }), { ageSetting: 'minor' });
    expect(next.ageSetting).toBe('minor');
    expect(next.childAppearance).toBe(true);
    expect(next.basis).toBe('original');
    expect(next.realPersonKind).toBeNull();
  });

  it('切到真人时沿用原真人类型；没有原类型时按公众人物', () => {
    const fromReal = applyEligibilityPatch(
      facts({ basis: 'real_person', realPersonKind: 'historical' }),
      { basis: 'real_person' },
    );
    expect(fromReal.realPersonKind).toBe('historical');

    const fromOriginal = applyEligibilityPatch(facts(), { basis: 'real_person' });
    expect(fromOriginal.realPersonKind).toBe('celebrity');
  });

  it('切回虚构 / 原创时清空真人类型', () => {
    const next = applyEligibilityPatch(
      facts({ basis: 'real_person', realPersonKind: 'private_person' }),
      { basis: 'fictional' },
    );
    expect(next.basis).toBe('fictional');
    expect(next.realPersonKind).toBeNull();
  });

  it('非真人角色只改真人类型会被拒绝', () => {
    expect(() => applyEligibilityPatch(facts(), { realPersonKind: 'celebrity' })).toThrow(
      '只有真人角色才能设置真人类型',
    );
  });
});

describe('splitSelected', () => {
  it('按 key 拆分并保持原顺序', () => {
    const items = [
      { id: 'a', unit: 'x' },
      { id: 'b', unit: 'y' },
      { id: 'c', unit: 'z' },
    ];
    const { remaining, removed } = splitSelected(items, ['b'], (item) => item.id);
    expect(remaining.map((item) => item.id)).toEqual(['a', 'c']);
    expect(removed.map((item) => item.id)).toEqual(['b']);
  });
});
