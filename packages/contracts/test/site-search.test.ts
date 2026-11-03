import { describe, expect, it } from 'vitest';
import {
  SITE_SEARCH_DID_YOU_MEAN_LIMIT,
  SITE_SEARCH_PAGE_LIMIT,
  SITE_SEARCH_SUGGEST_LIMIT,
  SearchEndpoints,
  SiteSearchResult,
  SiteSearchSuggestion,
} from '../src/index.js';

const result = {
  candidateId: 'official:00000000-0000-4000-8000-000000000001',
  source: 'official',
  action: 'add',
  name: '李晨',
  match: 'exact',
  matchedTerm: null,
  identity: '演员',
  unverified: false,
  ambiguous: true,
  entityKey: null,
  sourceUrl: null,
  characterId: '00000000-0000-4000-8000-000000000001',
  workId: null,
  conversationId: null,
  added: false,
  character: null,
  work: null,
};

describe('5.5 站内角色搜索契约（T-20261104b）', () => {
  it('新接口是独立的 GET，旧的联网候选接口保持原样', () => {
    expect(SearchEndpoints.suggest).toMatchObject({
      method: 'GET',
      path: '/api/v1/search/suggest',
    });
    expect(SearchEndpoints.results).toMatchObject({
      method: 'GET',
      path: '/api/v1/search/characters',
    });
    expect(SearchEndpoints.characterCandidates).toMatchObject({
      method: 'POST',
      path: '/api/v1/search/character-candidates',
    });
    expect(SearchEndpoints.characterCandidates.body!.safeParse({ query: '李晨' }).success).toBe(
      true,
    );
    expect(SearchEndpoints.characterCandidates.body!.safeParse({ query: '李' }).success).toBe(
      false,
    );
  });

  it('接收端容错：以后新增的来源、动作、命中方式读成 unsupported，不报错', () => {
    const parsed = SiteSearchResult.parse({
      ...result,
      source: 'external',
      action: 'request_add',
      match: 'semantic',
      matchedTerm: { text: '晨哥', kind: 'nickname' },
    });
    expect(parsed).toMatchObject({
      source: 'unsupported',
      action: 'unsupported',
      match: 'unsupported',
      matchedTerm: { text: '晨哥', kind: 'unsupported' },
    });
    expect(
      SiteSearchSuggestion.parse({
        text: '李晨',
        match: 'exact',
        matchedTerm: null,
        sources: ['official', 'x'],
      }).sources,
    ).toEqual(['official', 'unsupported']);
  });

  it('查询参数：搜索词最长 200（超过 64 只取前 64 参与匹配），每页 1～20，prefer 只认官方 / 广场', () => {
    const q = SearchEndpoints.results.query!;
    expect(q.parse({ q: '李晨' })).toMatchObject({ q: '李晨', limit: SITE_SEARCH_PAGE_LIMIT });
    expect(q.parse({})).toMatchObject({ q: '' });
    expect(q.safeParse({ q: '长'.repeat(201) }).success).toBe(false);
    expect(q.safeParse({ q: '李晨', limit: '21' }).success).toBe(false);
    expect(q.safeParse({ q: '李晨', prefer: 'own' }).success).toBe(false);
    expect(SearchEndpoints.suggest.query!.parse({ q: '易烊千' })).toEqual({ q: '易烊千' });
  });

  it('条数上限：联想 8 条、你是否想找 5 条、结果每页 20 条', () => {
    expect([
      SITE_SEARCH_SUGGEST_LIMIT,
      SITE_SEARCH_DID_YOU_MEAN_LIMIT,
      SITE_SEARCH_PAGE_LIMIT,
    ]).toEqual([8, 5, 20]);
    const response = SearchEndpoints.suggest.response;
    const item = { text: '李晨', match: 'exact', matchedTerm: null, sources: ['official'] };
    expect(
      response.safeParse({ query: '李', items: Array(9).fill(item), didYouMean: [] }).success,
    ).toBe(false);
    expect(
      SearchEndpoints.results.response.safeParse({
        query: '李晨',
        items: [result],
        nextCursor: null,
        didYouMean: [{ text: '李晨' }],
      }).success,
    ).toBe(true);
  });
});
