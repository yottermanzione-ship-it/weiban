import { describe, expect, it } from 'vitest';
import {
  CharacterSearchCandidate,
  SITE_SEARCH_DID_YOU_MEAN_LIMIT,
  SITE_SEARCH_PAGE_LIMIT,
  SITE_SEARCH_SUGGEST_LIMIT,
  SearchAdminEndpoints,
  SearchEndpoints,
  SiteSearchResult,
  SiteSearchSuggestion,
  WebCandidateResolution,
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

describe('5.6 联网候选身份与出处、点击只认候选 ID、后台修正（T-20261104e）', () => {
  const CANDIDATE_ID = 'web_AAAAAAAAAAAAAAAAAAAAAA';
  const legacy = {
    name: '李晨',
    title: '李晨（中国内地男演员）_百度百科',
    description: '李晨，中国内地男演员。',
    sourceUrl: 'https://baike.baidu.com/item/x/1001',
  };

  it('向后兼容：旧服务器只给四个字段仍能解析；新字段都可选', () => {
    expect(CharacterSearchCandidate.parse(legacy)).toEqual(legacy);
    const full = CharacterSearchCandidate.parse({
      ...legacy,
      candidateId: CANDIDATE_ID,
      identity: '中国内地男演员',
      identitySourceUrl: legacy.sourceUrl,
      sources: [{ url: legacy.sourceUrl, title: legacy.title, site: '百度百科' }],
      entityKey: 'baike:1001',
      unverified: true,
      ambiguous: true,
      action: 'create',
      characterId: null,
      conversationId: null,
      added: false,
      character: null,
    });
    expect(full.action).toBe('create');
  });

  it('接收端容错：以后新增的候选动作读成 unsupported', () => {
    expect(CharacterSearchCandidate.parse({ ...legacy, action: 'subscribe' }).action).toBe(
      'unsupported',
    );
    expect(
      WebCandidateResolution.parse({
        candidateId: CANDIDATE_ID,
        action: 'later',
        characterId: null,
        conversationId: null,
        prefill: null,
      }).action,
    ).toBe('unsupported');
  });

  it('出处最多 5 条且必须是网址；候选 ID 格式固定', () => {
    const source = { url: legacy.sourceUrl, title: 't', site: null };
    expect(
      CharacterSearchCandidate.safeParse({ ...legacy, sources: Array(6).fill(source) }).success,
    ).toBe(false);
    expect(
      CharacterSearchCandidate.safeParse({ ...legacy, sources: [{ ...source, url: 'not url' }] })
        .success,
    ).toBe(false);
    expect(CharacterSearchCandidate.safeParse({ ...legacy, candidateId: 'web_x' }).success).toBe(
      false,
    );
  });

  it('点击接口只收候选 ID（不收客户端的网址、名字、角色 ID）', () => {
    expect(SearchEndpoints.resolveCandidate).toMatchObject({
      method: 'POST',
      path: '/api/v1/search/character-candidates/resolve',
      auth: 'user',
    });
    const body = SearchEndpoints.resolveCandidate.body!;
    expect(body.safeParse({ candidateId: CANDIDATE_ID }).success).toBe(true);
    expect(body.safeParse({ candidateId: CANDIDATE_ID, url: legacy.sourceUrl }).success).toBe(
      false,
    );
    expect(body.safeParse({ candidateId: CANDIDATE_ID, name: '李晨' }).success).toBe(false);
    expect(body.safeParse({ candidateId: legacy.sourceUrl }).success).toBe(false);
  });

  it('后台修正接口都要管理员身份，修改都要写 2～200 字的原因', () => {
    for (const endpoint of Object.values(SearchAdminEndpoints)) expect(endpoint.auth).toBe('admin');
    const ok = { entityKey: 'baike:1001', fromEntityKey: 'wiki:zh:李晨', reason: '核对为同一人' };
    expect(SearchAdminEndpoints.mergeEntity.body!.safeParse(ok).success).toBe(true);
    expect(SearchAdminEndpoints.mergeEntity.body!.safeParse({ ...ok, reason: ' ' }).success).toBe(
      false,
    );
    expect(
      SearchAdminEndpoints.changeAlias.body!.safeParse({
        op: 'propose',
        alias: '晨哥',
        reason: '粉丝称呼',
      }).success,
    ).toBe(true);
    expect(
      SearchAdminEndpoints.changeAlias.body!.safeParse({
        op: 'delete_everything',
        alias: '晨哥',
        reason: '粉丝称呼',
      }).success,
    ).toBe(false);
  });
});
