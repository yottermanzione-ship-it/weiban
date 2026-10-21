import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleMediaAdapter } from '../infra/media-adapter.js';
import { ModelGatewayMedia } from '../application/media-gateway.js';
import { WebToolsStore } from '../application/web-tools-store.js';
import { characterCandidates, privateSearchText, publicWebUrl } from './web-search.js';
import { TestClock } from '../../../platform/index.js';
import { GatewayLimitsService } from '../application/limits.js';
import { decisionQuestions, decisionUrl, parseDecisionReply } from '../infra/jev-adapter.js';

import {
  checkBaseUrl,
  classifyTestStatus,
  decodeCursor,
  encodeCursor,
  formatMask,
  hasAdultContent,
  maskParts,
  normalizeApiKey,
  priceTier,
  standardReplyMicros,
  statusAfterTest,
  unavailableReason,
} from './rules.js';

afterEach(() => vi.restoreAllMocks());

describe('J verified decision protocol', () => {
  const questions = [
    { questionId: 'q', kind: 'choice' as const, prompt: 'Choose', options: ['act', 'defer'] },
  ];
  const reply = {
    model: 'jev-1.13.0',
    answers: {
      q: {
        type: 'choice',
        choice: 'defer',
        confidence: 0.9,
        probabilities: { act: 0.01, defer: 0.99 },
      },
    },
    usage: { input_tokens: 44, output_tokens: 9 },
  };
  const target = {
    kind: 'openai_compatible',
    baseUrl: 'https://relay.example/v1',
    apiKey: 'synthetic-key',
    model: 'jev-latest',
  };
  it('routes relay and native APIs without duplicated v1; no guessed judge endpoint', () => {
    expect(decisionUrl(target)).toBe('https://relay.example/v1/decisions');
    expect(decisionUrl({ kind: 'jev', baseUrl: 'https://native.example/v1/' })).toBe(
      'https://native.example/v1/systemone',
    );
    expect(decisionUrl({ kind: 'jev', baseUrl: 'https://native.example' })).toBe(
      'https://native.example/v1/systemone',
    );
    expect(decisionUrl({ kind: 'anthropic', baseUrl: 'https://native.example' })).toBeNull();
    expect(decisionQuestions(questions)).toEqual({
      q: { type: 'choice', instructions: 'Choose', criteria: { act: null, defer: null } },
    });
  });
  it('rejects duplicate IDs/options and empty choices before sending', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(decisionQuestions([...questions, ...questions])).toBeNull();
    for (const options of [[], ['act', 'act'], ['']]) {
      const result = await new OpenAiCompatibleMediaAdapter().decide(target, {
        state: {},
        questions: [{ ...questions[0]!, options }],
      });
      expect(result).toMatchObject({ ok: false, zeroCost: true });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('matches answers by ID and requires a complete valid probability distribution and usage', () => {
    expect(parseDecisionReply(reply, questions)).toMatchObject({
      inputTokens: 44,
      outputTokens: 9,
      answers: [{ choice: 'defer', confidence: 0.9 }],
    });
    for (const raw of [
      { ...reply, usage: {} },
      { ...reply, usage: { input_tokens: -1 } },
      { ...reply, answers: {} },
      { ...reply, answers: { q: { ...reply.answers.q, choice: 'outside' } } },
      { ...reply, answers: { q: { ...reply.answers.q, probabilities: { act: 0.2, defer: 0.2 } } } },
      {
        ...reply,
        answers: { q: { ...reply.answers.q, probabilities: { act: 0, defer: 0.9, extra: 0.1 } } },
      },
    ])
      expect(parseDecisionReply(raw, questions)).toBeNull();
  });
  it('maps Noul probability to yes/no plus margin; Scale preserves modal index in legacy port', () => {
    const result = parseDecisionReply(
      {
        model: 'jev',
        usage: { input_tokens: 1 },
        answers: {
          yes: { type: 'noul', noul: 0.25 },
          score: {
            type: 'score',
            score: 1.1,
            confidence: 0.4,
            probabilities: { '0': 0.2, '1': 0.5, '2': 0.3 },
          },
        },
      },
      [
        { questionId: 'yes', kind: 'yes_no', prompt: 'Is it true?', options: ['yes', 'no'] },
        { questionId: 'score', kind: 'scale', prompt: 'Rate', options: ['low', 'medium', 'high'] },
      ],
    );
    expect(result?.answers).toEqual([
      { questionId: 'yes', choice: 'no', probabilities: { yes: 0.25, no: 0.75 }, confidence: 0.5 },
      {
        questionId: 'score',
        choice: '1',
        probabilities: { '0': 0.2, '1': 0.5, '2': 0.3 },
        confidence: 0.4,
      },
    ]);
  });
  it('uses exact Decisions body, reported usage, and bounded request deadline', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(reply));
    const result = await new OpenAiCompatibleMediaAdapter().decide(target, {
      state: { synthetic: true },
      questions,
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({ ok: true, value: { inputTokens: 44 } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://relay.example/v1/decisions');
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'jev-latest',
      state: { synthetic: true },
      questions: decisionQuestions(questions),
    });
    expect(init!.redirect).toBe('manual');
  });
  it('classifies B.AI 400 quota errors and empty 429 without exposing response messages or retrying', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'insufficient_user_quota', message: 'DO_NOT_ECHO' } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    const adapter = new OpenAiCompatibleMediaAdapter();
    expect(await adapter.decide(target, { state: {}, questions })).toEqual({
      ok: false,
      zeroCost: true,
      category: 'quota_exhausted',
    });
    expect(await adapter.decide(target, { state: {}, questions })).toEqual({
      ok: false,
      zeroCost: true,
      category: 'rate_limited',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not invent token counts or zero cost on malformed 200 / network loss', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ answers: {} }))
      .mockRejectedValueOnce(new Error('DO_NOT_ECHO'));
    const adapter = new OpenAiCompatibleMediaAdapter();
    expect(await adapter.decide(target, { state: {}, questions })).toEqual({
      ok: false,
      category: 'provider_error',
    });
    expect(await adapter.decide(target, { state: {}, questions })).toEqual({
      ok: false,
      category: 'network_error',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('S DeepSeek Search / Fetch 协议', () => {
  it('旧管理端保存调度设置时保留已调整过的搜索额度', async () => {
    const limits = Object.create(GatewayLimitsService.prototype) as GatewayLimitsService;
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: async () => {} });
    const tx = { db: { insert: () => ({ values }) } };
    const old = {
      perUserConcurrency: null,
      perUserRpm: null,
      failureThreshold: 3,
      cooldownSeconds: 300,
    };
    Object.assign(limits, {
      get: async () => ({
        ...old,
        searchCandidatesPerUserDay: 21,
        searchCandidatesGlobalDay: 5100,
      }),
      database: { transaction: (run: (t: object) => Promise<void>) => run(tx) },
      clock: new TestClock('2026-10-21T12:00:00Z'),
      audit: { record: vi.fn() },
    });
    expect(await limits.update('admin', { ...old, failureThreshold: 4 })).toMatchObject({
      failureThreshold: 4,
      searchCandidatesPerUserDay: 21,
      searchCandidatesGlobalDay: 5100,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.objectContaining({ searchCandidatesGlobalDay: 5100 }),
      }),
    );
  });
  it('本地QPS拒绝按零成本释放，不能把健康的上游标成故障', async () => {
    const media = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
    const fail = vi.fn();
    const charge = { usageRecordId: 'u', holdId: 'h' };
    Object.assign(media, {
      activeGenerations: new WeakMap(),
      cached: (_kind: string, _input: unknown, callback: () => Promise<unknown>) => callback(),
      resolve: async () => ({
        ok: true,
        value: { modelKey: 'search/model', billingBounds: { search: { maxResults: 10 } } },
      }),
      webTools: {
        key: () => 'k',
        claim: async () => ({ kind: 'claimed', token: 'lease' }),
        finish: vi.fn(),
      },
      reserve: async () => ({ ok: true, value: charge }),
      beginCharge: async () => true,
      fail,
      withTarget: (
        _model: unknown,
        callback: (target: object, adapter: object) => Promise<unknown>,
      ) =>
        callback(
          {},
          {
            search: async () => ({
              ok: false,
              category: 'rate_limited',
              zeroCost: true,
              localRateLimit: true,
            }),
          },
        ),
    });
    expect(
      await media.webSearch({
        userId: 'u',
        purpose: 'search_candidates',
        billingOwner: 'platform',
        idempotencyKey: 'k',
        query: '程澈',
        maxResults: 5,
      }),
    ).toEqual({ ok: false, error: 'provider_unavailable' });
    expect(fail).toHaveBeenCalledWith(charge, 'rate_limited', { searchCalls: 0 }, false);
  });
  it('候选多层额度先全部检查再写入，日切重置；注销后的账号不能重建限额记录', async () => {
    const store = Object.create(WebToolsStore.prototype) as WebToolsStore;
    const rows = vi.fn().mockResolvedValue([{ window: '2026-10-21', count: 5000 }]);
    const written: { count: number }[] = [];
    const active = vi.fn().mockResolvedValue('active');
    const tx = {
      query: vi.fn(),
      db: {
        select: () => ({ from: () => ({ where: rows }) }),
        insert: () => ({
          values: (value: { count: number }) => ({
            onConflictDoUpdate: async () => {
              written.push(value);
            },
          }),
        }),
      },
    };
    Object.assign(store, {
      db: { transaction: (run: (t: object) => Promise<unknown>) => run(tx) },
      clock: new TestClock('2026-10-21T12:00:00Z'),
      accounts: { getAccountStatus: active },
      limits: {
        get: async () => ({ searchCandidatesGlobalDay: 5000, searchCandidatesPerUserDay: 20 }),
      },
    });
    expect(await store.consumeCandidate('user')).toBe(false);
    expect(written).toEqual([]);
    // 全局尚有余额、用户当天已用20次，不能只扣掉全局计数。
    rows
      .mockResolvedValueOnce([{ window: '2026-10-21', count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ window: '2026-10-21', count: 20 }]);
    expect(await store.consumeCandidate('user')).toBe(false);
    expect(written).toEqual([]);
    rows.mockResolvedValue([{ window: '2026-10-20', count: 99999 }]);
    expect(await store.consumeCandidate('user')).toBe(true);
    expect(written.map((x) => x.count)).toEqual([1, 1, 1]);
    active.mockResolvedValue('deleting');
    expect(await store.consumeCandidate('user')).toBe(false);
    expect(written).toHaveLength(3);
  });
  const target = {
    kind: 'deepseek_search',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'fixture-key',
    model: 'deepseek-search',
  };
  it('同一搜索请求附 Bearer、不跟重定向；按 Unicode 截断并保留元数据、去跟踪参数', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: '公开角色',
              url: 'https://example.com/role?utm_source=ad&lang=zh#section',
              summary: '长摘要',
              snippet: '短摘要',
              site_name: '公开百科',
              date: null,
              authority: 3,
              rerank_score: 2.1,
              content: '公开正文',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const adapter = new OpenAiCompatibleMediaAdapter();
    const result = await adapter.search(target, {
      query: '猫'.repeat(150),
      maxResults: 5,
      needContent: true,
    });
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/tools/search');
    const init = fetcher.mock.calls[0]![1]!;
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: 'Bearer fixture-key' },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      query: '猫'.repeat(128),
      count: 5,
      need_content: true,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        billable: true,
        hits: [
          {
            title: '公开角色',
            url: 'https://example.com/role?lang=zh',
            snippet: '长摘要',
            source: '公开百科',
            publishedAt: null,
            authority: 3,
            relevance: 2.1,
            content: '公开正文',
          },
        ],
      },
    });
  });
  it('空结果不计费；非空结果即使本地丢弃不安全 URL 也保留真实供应商成本', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"results":[]}'))
      .mockResolvedValueOnce(
        new Response('{"results":[{"title":"bad","url":"http://127.0.0.1/"}]}'),
      );
    const adapter = new OpenAiCompatibleMediaAdapter();
    expect(await adapter.search(target, { query: '公开角色', maxResults: 5 })).toEqual({
      ok: true,
      value: { hits: [], billable: false },
    });
    expect(await adapter.search(target, { query: '公开角色', maxResults: 5 })).toEqual({
      ok: true,
      value: { hits: [], billable: true },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('抓取只发给供应商；403/404不作密钥故障，正文限制两万字符', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: '公开文章', content: '正'.repeat(21000) })),
      );
    const adapter = new OpenAiCompatibleMediaAdapter();
    for (let n = 0; n < 2; n++)
      expect(await adapter.fetchPage(target, { url: 'https://example.com/article' })).toEqual({
        ok: true,
        value: { title: '', content: '' },
      });
    const page = await adapter.fetchPage(target, { url: 'https://example.com/article' });
    expect(page.ok && page.value.content.length).toBe(20000);
    expect(
      fetcher.mock.calls.every(([url]) => url === 'https://api.deepseek.com/v1/tools/fetch'),
    ).toBe(true);
    expect(await adapter.fetchPage(target, { url: 'http://user:password@example.com/' })).toEqual({
      ok: false,
      category: 'bad_request',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('401/402映射正确且不回显错误正文；本地限速拒绝不发请求', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('SECRET_PROVIDER_CANARY', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 402 }));
    const adapter = new OpenAiCompatibleMediaAdapter();
    expect(await adapter.search(target, { query: '公开角色', maxResults: 1 })).toEqual({
      ok: false,
      category: 'invalid_key',
      zeroCost: true,
    });
    expect(await adapter.search(target, { query: '公开角色', maxResults: 1 })).toEqual({
      ok: false,
      category: 'quota_exhausted',
      zeroCost: true,
    });
    const gated = new OpenAiCompatibleMediaAdapter(async () => false);
    expect(await gated.search(target, { query: '公开角色', maxResults: 1 })).toEqual({
      ok: false,
      category: 'rate_limited',
      zeroCost: true,
      localRateLimit: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('429等一秒只重试一次；畸形200响应不假报已知零成本', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"results":[]}'))
      .mockResolvedValueOnce(new Response('not-json'));
    const adapter = new OpenAiCompatibleMediaAdapter();
    expect((await adapter.search(target, { query: '公开角色', maxResults: 1 })).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await adapter.search(target, { query: '公开角色', maxResults: 1 })).toEqual({
      ok: false,
      category: 'provider_error',
    });
  });
  it('缓存键不含原查询，规范化相同公开查询共享；用途与原问题隔离', () => {
    const store = Object.create(WebToolsStore.prototype) as WebToolsStore;
    const key = store.key('search/model', 'search_candidates', ' ＡＢＣ  角色 ', 5);
    expect(key).toBe(store.key('search/model', 'search_candidates', 'abc 角色', 5));
    expect(key).toMatch(/^[a-f0-9]{64}$/u);
    expect(key).not.toBe(store.key('search/model', 'admin_distill', 'abc 角色', 5));
    expect(key).not.toBe(
      store.key('search/model', 'search_candidates', 'abc 角色', 5, '另一部作品'),
    );
  });
  it('候选过滤私生活、电话号码、凭据与内网链接，不把网页当成角色事实', () => {
    expect(privateSearchText('我的同学 小李')).toBe(true);
    expect(privateSearchText('１３８００１３８０００')).toBe(true);
    expect(privateSearchText('某演员的新作品')).toBe(false);
    expect(privateSearchText('site:weibo.com after:2026-10-21 公开活动')).toBe(false);
    expect(privateSearchText('https://example.com/?id=%31%33%38%30%30%31%33%38%30%30%30')).toBe(
      true,
    );
    expect(publicWebUrl('http://2130706433/')).toBeNull();
    const good = {
      title: '程澈 - 公开百科',
      url: 'https://example.com/cc?utm_source=x',
      snippet: '虚构作品角色',
      source: null,
      publishedAt: null,
    };
    expect(
      characterCandidates('程澈', [
        good,
        good,
        { ...good, url: 'https://example.com/privacy', snippet: '私人手机号 13800138000' },
      ]),
    ).toEqual([
      {
        name: '程澈',
        title: good.title,
        description: good.snippet,
        sourceUrl: 'https://example.com/cc',
      },
    ]);
  });
  it('网关空搜索结果以0次结算，非空按1次；共享缓存命中不再次调用供应商', async () => {
    const media = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
    const claim = vi.fn().mockResolvedValue({ kind: 'claimed', token: 'lease' });
    const finish = vi.fn();
    const search = vi.fn().mockResolvedValue({ ok: true, value: { hits: [], billable: false } });
    const actuals: unknown[] = [];
    const metadata = {
      modelKey: 'search/model',
      chargedMicros: 0,
      latencyMs: 1,
      usageRecordId: 'usage-fixture',
    };
    const run = vi.fn(
      async (
        _base: unknown,
        _model: unknown,
        _estimate: unknown,
        callback: (
          target: object,
          adapter: object,
        ) => Promise<{ ok: boolean; value: object; actual: unknown }>,
      ) => {
        const outcome = await callback(target, { search });
        actuals.push(outcome.actual);
        return { ok: true, value: { ...metadata, ...outcome.value } };
      },
    );
    Object.assign(media, {
      cached: (_kind: string, _input: unknown, callback: () => Promise<unknown>) => callback(),
      resolve: async () => ({
        ok: true,
        value: { ...metadata, billingBounds: { search: { maxResults: 10 } } },
      }),
      webTools: { key: () => 'key', claim, finish },
      run,
    });
    const input = {
      userId: 'u',
      purpose: 'search_candidates' as const,
      billingOwner: 'platform' as const,
      idempotencyKey: 'key',
      query: '程澈',
      maxResults: 5,
    };
    expect((await media.webSearch(input)).ok).toBe(true);
    expect(actuals).toEqual([{ searchCalls: 0 }]);
    search.mockResolvedValue({ ok: true, value: { hits: [], billable: true } });
    await media.webSearch(input);
    expect(actuals.at(-1)).toEqual({ searchCalls: 1 });
    claim.mockResolvedValue({ kind: 'hit', value: { ...metadata, items: [] } });
    await media.webSearch(input);
    expect(run).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
  });
});

describe('密钥与掩码', () => {
  it('去除首尾空白，长度不合法返回 null', () => {
    expect(normalizeApiKey('  sk-abcdefgh  ')).toBe('sk-abcdefgh');
    expect(normalizeApiKey('   short  ')).toBeNull();
    expect(normalizeApiKey('x'.repeat(513))).toBeNull();
  });

  it('长密钥前 4 后 4，短密钥缩短，至少一半看不见', () => {
    const long = 'sk-a1234567890abcdef9xQz';
    const m = maskParts(long);
    expect(formatMask(m.prefix, m.suffix)).toBe('sk-a…9xQz');
    expect(formatMask(m.prefix, m.suffix).length).toBeLessThanOrEqual(16);
    for (const key of ['abcdefgh', 'abcdefghijkl', 'abcdefghijklmno']) {
      const p = maskParts(key);
      expect((p.prefix.length + p.suffix.length) * 2).toBeLessThanOrEqual(key.length);
    }
  });
});

describe('连通测试分类', () => {
  it('状态码 → 失败类别 → 上游状态', () => {
    expect(classifyTestStatus(200)).toBeNull();
    expect(classifyTestStatus(401)).toBe('invalid_key');
    expect(classifyTestStatus(403)).toBe('invalid_key');
    expect(classifyTestStatus(402)).toBe('insufficient_balance');
    expect(classifyTestStatus(500)).toBe('provider_error');
    expect(classifyTestStatus(302)).toBe('provider_error');
    expect(statusAfterTest(null)).toBe('active');
    expect(statusAfterTest('invalid_key')).toBe('invalid');
    expect(statusAfterTest('insufficient_balance')).toBe('quota_exhausted');
    expect(statusAfterTest('network_error')).toBe('unavailable');
    expect(statusAfterTest('provider_error')).toBe('unavailable');
  });

  it('接口地址：生产只允许 https，不许带账号密码或查询串', () => {
    expect(checkBaseUrl('https://api.deepseek.com/v1/', true)).toBe('https://api.deepseek.com/v1');
    expect(checkBaseUrl('http://127.0.0.1:9/v1', true)).toBeNull();
    expect(checkBaseUrl('http://127.0.0.1:9/v1', false)).toBe('http://127.0.0.1:9/v1');
    expect(checkBaseUrl('https://user:pw@x.com/v1', false)).toBeNull();
    expect(checkBaseUrl('https://x.com/v1?key=1', false)).toBeNull();
    expect(checkBaseUrl('ftp://x.com', false)).toBeNull();
    expect(checkBaseUrl('not a url', false)).toBeNull();
  });
});

describe('可用性与无审查标记', () => {
  it('下架优先于上游故障', () => {
    expect(unavailableReason(null, 'active')).toBe('model_removed');
    expect(unavailableReason({ enabled: false, capabilities: [] }, 'active')).toBe('model_removed');
    expect(unavailableReason({ enabled: true, capabilities: [] }, 'invalid')).toBe(
      'provider_unavailable',
    );
    expect(unavailableReason({ enabled: true, capabilities: [] }, null)).toBe(
      'provider_unavailable',
    );
    expect(unavailableReason({ enabled: true, capabilities: [] }, 'active')).toBeNull();
    expect(hasAdultContent(['vision', 'adult_content'])).toBe(true);
    expect(hasAdultContent(['vision'])).toBe(false);
  });
});

describe('价格档位（cost-estimate.md 7.3 首批模型）', () => {
  // 单价：元 / 百万 token → 微元 / 百万 token
  const yuan = (v: number) => Math.round(v * 1_000_000);
  it('与 AI 负责人的估算表一致', () => {
    // 输入 2、缓存 0.04、输出 3 元/百万 → 约 0.0106 元 → 便宜
    expect(
      priceTier({
        inputPerMillionMicros: yuan(2),
        cachedInputPerMillionMicros: yuan(0.04),
        outputPerMillionMicros: yuan(3),
      }),
    ).toBe('cheap');
    // qwen3.8-max 一档：约 0.10 元 → 较贵
    expect(
      priceTier({
        inputPerMillionMicros: yuan(12),
        cachedInputPerMillionMicros: null,
        outputPerMillionMicros: yuan(48),
      }),
    ).toBe('expensive');
    // 约 0.05 元 → 中等
    expect(
      priceTier({
        inputPerMillionMicros: yuan(8),
        cachedInputPerMillionMicros: yuan(2),
        outputPerMillionMicros: yuan(16),
      }),
    ).toBe('medium');
    expect(priceTier(undefined)).toBe('medium');
  });

  it('没有缓存价时命中部分按未命中价算，向上取整', () => {
    expect(
      standardReplyMicros({
        inputPerMillionMicros: 1_000_000,
        cachedInputPerMillionMicros: null,
        outputPerMillionMicros: 1_000_000,
      }),
    ).toBe(8150);
    expect(
      standardReplyMicros({
        inputPerMillionMicros: 1,
        cachedInputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
      }),
    ).toBe(1);
  });
});

describe('游标', () => {
  it('往返一致，非法游标返回 null', () => {
    const at = new Date('2026-10-05T12:00:00.000Z');
    const id = '0192f000-0000-7000-8000-000000000001';
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
    expect(decodeCursor('not-base64')).toBeNull();
    expect(decodeCursor(Buffer.from('["x","y"]').toString('base64url'))).toBeNull();
  });
});
