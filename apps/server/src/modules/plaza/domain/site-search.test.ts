import { describe, expect, it } from 'vitest';
import {
  ambiguousIds,
  decodeSearchCursor,
  encodeSearchCursor,
  mergeSuggestions,
  pageAfter,
  pickDidYouMean,
  plazaIdentity,
  rankCandidates,
  sortKey,
  type RankedCandidate,
} from './site-search.js';

const c = (
  candidateId: string,
  source: RankedCandidate['source'],
  name: string,
  score: number,
  extra: Partial<RankedCandidate> = {},
): RankedCandidate => ({ candidateId, source, name, score, added: false, heat: 0, ...extra });

describe('站内搜索聚合规则', () => {
  it('先看相关性，再看明确选择的来源、已添加、来源次序，热度最后', () => {
    const items = [
      c('plaza:hot', 'plaza', '王一博', 100, { heat: 99999 }),
      c('official:b', 'official', '王一博', 100),
      c('own:a', 'own', '王一博', 100),
      c('official:prefix', 'official', '王一博的猫', 79, { heat: 99999 }),
      c('official:added', 'official', '王一博', 100, { added: true }),
    ];
    expect(rankCandidates(items, undefined).map((i) => i.candidateId)).toEqual([
      'official:added',
      'official:b',
      'own:a',
      'plaza:hot',
      'official:prefix',
    ]);
    expect(rankCandidates(items, 'plaza').map((i) => i.candidateId)[0]).toBe('plaza:hot');
    // 热度高的前缀命中永远排不到精确命中前面。
    expect(rankCandidates(items, 'official').at(-1)?.candidateId).toBe('official:prefix');
  });

  it('同名（标准化后相同）的多项都标 ambiguous，单独一项不标', () => {
    const set = ambiguousIds([
      c('official:1', 'official', '李晨', 100),
      c('official:2', 'official', '李 晨', 100),
      c('plaza:3', 'plaza', '晨哥', 90),
    ]);
    expect([...set].sort()).toEqual(['official:1', 'official:2']);
  });

  it('稳定游标：取严格排在上一页最后一项之后的；搜索词或 prefer 不同、解不开的游标都从头开始', () => {
    const ranked = rankCandidates(
      Array.from({ length: 25 }, (_, i) =>
        c(`plaza:${String(i).padStart(2, '0')}`, 'plaza', `角色${i}`, 80),
      ),
      undefined,
    );
    const first = pageAfter(ranked, undefined, null, 20);
    expect(first.page).toHaveLength(20);
    expect(first.more).toBe(true);
    const cursor = encodeSearchCursor('角色', undefined, first.last!);
    const after = decodeSearchCursor(cursor, '角色', undefined);
    expect(after).toEqual(sortKey(first.page.at(-1)!, undefined));
    const second = pageAfter(ranked, undefined, after, 20);
    expect(second.page.map((i) => i.candidateId)).toEqual(
      ranked.slice(20).map((i) => i.candidateId),
    );
    expect(second.more).toBe(false);
    expect(decodeSearchCursor(cursor, '别的', undefined)).toBeNull();
    expect(decodeSearchCursor(cursor, '角色', 'plaza')).toBeNull();
    expect(decodeSearchCursor('not-a-cursor', '角色', undefined)).toBeNull();
    expect(decodeSearchCursor(undefined, '角色', undefined)).toBeNull();
  });

  it('「你是否想找」：同音优先、同一名字只给一次、已显示的不再建议、最多 5 条', () => {
    const out = pickDidYouMean(
      [
        { text: '王一傅', kind: 'edit', source: 'plaza' },
        { text: '易烊千玺的猫', kind: 'homophone', source: 'plaza' },
        { text: '易烊千玺', kind: 'homophone', source: 'official' },
        { text: '易烊千玺', kind: 'homophone', source: 'plaza' },
        { text: '已显示', kind: 'homophone', source: 'official' },
      ],
      new Set(['已显示']),
      5,
    );
    expect(out.map((d) => d.text)).toEqual(['易烊千玺', '易烊千玺的猫', '王一傅']);
    const many = Array.from({ length: 9 }, (_, i) => ({
      text: `名字${i}`,
      kind: 'edit' as const,
      source: 'official' as const,
    }));
    expect(pickDidYouMean(many, new Set(), 5)).toHaveLength(5);
  });

  it('联想按名字合并成一行，记下来源；分数高的在前，同分短名在前', () => {
    const items = mergeSuggestions(
      [
        { text: '李晨', score: 100, match: 'exact', matchedTerm: null, source: 'official' },
        { text: '李晨', score: 100, match: 'exact', matchedTerm: null, source: 'own' },
        { text: '李晨阳', score: 79, match: 'prefix', matchedTerm: null, source: 'plaza' },
        {
          text: '晨哥',
          score: 90,
          match: 'exact',
          matchedTerm: { text: '李晨', kind: 'based_on' },
          source: 'plaza',
        },
      ],
      8,
    );
    expect(items).toEqual([
      { text: '李晨', match: 'exact', matchedTerm: null, sources: ['official', 'own'] },
      {
        text: '晨哥',
        match: 'exact',
        matchedTerm: { text: '李晨', kind: 'based_on' },
        sources: ['plaza'],
      },
      { text: '李晨阳', match: 'prefix', matchedTerm: null, sources: ['plaza'] },
    ]);
  });

  it('广场作品的身份说明只用本站数据', () => {
    expect(
      plazaIdentity({
        kind: 'preset_variant',
        basedOnPresetName: '李晨',
        authorNickname: '作者甲',
        authorDeleted: false,
      }),
    ).toBe('基于官方角色「李晨」改编 · 作者 作者甲');
    expect(
      plazaIdentity({
        kind: 'custom_character',
        basedOnPresetName: null,
        authorNickname: '作者乙',
        authorDeleted: false,
      }),
    ).toBe('广场原创 · 作者 作者乙');
    expect(
      plazaIdentity({
        kind: 'unsupported',
        basedOnPresetName: null,
        authorNickname: null,
        authorDeleted: true,
      }),
    ).toBe('广场原创 · 作者 已注销用户');
  });
});
