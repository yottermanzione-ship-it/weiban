/**
 * T-20261104a（总经理 11-04 两条要求）真库用例：真实网关 + 假 HTTP 上游 + 真实目录与计费。测试数据全部自造。
 * 1. 用户再触发服务商拦截，绝不能影响后台的上游账号判断：401 / 403 普通正文先用同一把密钥自检；
 * 2. 用户之间的拦截互不影响：同一用户 1 小时内被拦 5 次后只限制他自己的私密回复；被拦消息按会话登记。
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { GenerateTextInput, ModelGatewayPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  PRIVATE_BLOCK_LIMIT,
  TestClock,
  newId,
  type Database,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { BillingAdminService, PriceService } from '../src/modules/billing/testing.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import {
  CatalogService,
  GATEWAY_RETRY_WAIT,
  KEY_SELF_CHECK_TTL_MS,
  MODEL_GENERATION_POLICY,
  ScenarioService,
  UpstreamScheduler,
  UpstreamService,
} from '../src/modules/model-access/testing.js';
import { blockedSeqs, recordBlocked, withoutBlocked } from '../src/modules/ai-runtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const TEXT_BOUNDS = {
  format: 'billing-bounds-v1' as const,
  text: {
    contextTokens: 128_000,
    maxOutputTokens: 32_000,
    totalOutputIncludesReasoning: true as const,
    outputParameter: 'max_tokens' as const,
    maxImages: 4,
  },
};

describeDb('T-20261104a 上游判定自检与用户之间拦截隔离（真实网关）', () => {
  let app: INestApplication;
  let fake: Server;
  let db: Database;
  let gateway: ModelGatewayPort;
  let admin: string;
  let upstreamId: string;
  /** 上游对生成请求的回法：正常 / 401 普通正文 / 403 普通正文 / 403 安全策略正文。 */
  let mode: 'ok' | 'auth401' | 'auth403' | 'policy403' = 'ok';
  /** 连通测试（GET /v1/models）的状态码：200 = 密钥没坏，401 = 密钥真的坏了。 */
  let modelsStatus = 200;
  let calls = 0;
  let probes = 0;
  const key = 'sk-isolation-CANARY-DO-NOT-LOG-5521907';
  const output = '隔离测试回答 ISOLATION_OUTPUT';
  const userText = '用户私密消息 ISOLATION_CANARY_TEXT';
  const modelKey = 'isolation/private-test';
  const characterId = newId();
  const conversationId = newId();
  const logs = captureLogger();
  const clock = new TestClock('2026-11-04T08:00:00.000Z');

  beforeAll(async () => {
    await resetTestDatabase();
    fake = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        probes++;
        res.writeHead(modelsStatus).end(modelsStatus === 200 ? '{"data":[]}' : '{}');
        return;
      }
      calls++;
      for await (const part of req) void part;
      if (mode === 'auth401' || mode === 'auth403') {
        res
          .writeHead(mode === 'auth401' ? 401 : 403, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: { message: 'Forbidden' } }));
        return;
      }
      if (mode === 'policy403') {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: {
              code: 'policy_violation',
              type: 'policy_error',
              message: 'The request was blocked by a safety policy.',
            },
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { content: output } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      );
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(GATEWAY_RETRY_WAIT)
      .useValue(async () => undefined)
      // 私密资格由 policy 模块判断，不是这次要测的；这里一律放行，只测网关与上游判定。
      .overrideProvider(MODEL_GENERATION_POLICY)
      .useValue({ checkAdultGeneration: async () => ({ allowed: true }) })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    gateway = app.get(MODEL_GATEWAY_PORT);
    const commands = app.get(IdentityCommands);
    admin = await commands.createAdmin('isolation_admin', 'correct horse battery');
    const upstream = await app.get(UpstreamService).create(admin, {
      name: 'fake shared private upstream',
      kind: 'openai_compatible',
      baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`,
      apiKey: key,
    });
    upstreamId = upstream.upstreamId;
    const draft = await app.get(PriceService).createDraft(admin, {
      versionLabel: 'isolation',
      note: null,
      items: [
        ['input_tokens_per_million', 2000000],
        ['cached_input_tokens_per_million', 1000000],
        ['output_tokens_per_million', 8000000],
      ].map(([unit, price]) => ({
        modelKey,
        unit: unit as 'input_tokens_per_million',
        priceMicros: Number(price),
        costMicros: Number(price) / 2,
        band: null,
      })),
    });
    await app.get(PriceService).activate(admin, draft.priceVersionId, null);
    await app.get(CatalogService).upsert(admin, modelKey, {
      modelKey,
      displayName: 'Isolation Private Test',
      vendorName: 'Fake',
      upstreamId,
      upstreamModelId: 'fake',
      capabilities: [],
      tags: [],
      leaderboardRank: null,
      sortOrder: 0,
      defaultFor: [],
      scenarios: ['chat', 'private'],
      billingBounds: TEXT_BOUNDS,
      enabled: true,
    });
    await app.get(CatalogService).setModelUses(admin, {
      recommended: { chat: modelKey },
      internal: {},
      fixed: { private: modelKey },
    });
  });

  beforeEach(async () => {
    // 每个用例往后拨 3 小时：上一个用例的拦截记录、自检结论都过期，互不影响。
    clock.advance(3 * HOUR);
    mode = 'ok';
    modelsStatus = 200;
    await db.query(
      'UPDATE model_access.upstreams SET consecutive_failures = 0, cooldown_until = NULL WHERE id = $1',
      [upstreamId],
    );
    await app.get(UpstreamService).reportStatus(upstreamId, 'active', 'probe');
    await app.get(UpstreamScheduler).recordSuccess(upstreamId, modelKey);
    app.get(UpstreamService).forgetKeyCheck(upstreamId);
    calls = 0;
    probes = 0;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });

  async function newUser(name: string): Promise<string> {
    const commands = app.get(IdentityCommands);
    const id = await commands.createAdmin(name, 'correct horse battery');
    await commands.setRole(name, 'user');
    await app.get(BillingAdminService).adjust(admin, id, {
      direction: 'grant',
      amountMicros: 1_000_000,
      reason: 'isolation tests',
      idempotencyKey: newId(),
    });
    await app.get(ScenarioService).updateConfig(id, { chat: { modelKey } });
    return id;
  }

  /** 私密回复（私密模型 = 共用的上游账号）。 */
  const privateReply = (userId: string): GenerateTextInput => ({
    userId,
    characterId,
    conversationId,
    purpose: 'chat_reply',
    billingOwner: 'user',
    modelRole: 'adult',
    messages: [{ role: 'user', content: userText }],
    idempotencyKey: newId(),
    meta: { scenarioMode: 'adult', conversationKind: 'direct' },
  });
  /** 日常聊天回复（同一个模型，但不是私密场景）。 */
  const dailyReply = (userId: string): GenerateTextInput => ({
    userId,
    characterId,
    conversationId,
    purpose: 'chat_reply',
    billingOwner: 'user',
    modelRole: 'chat',
    messages: [{ role: 'user', content: userText }],
    idempotencyKey: newId(),
    meta: { conversationKind: 'direct' },
  });

  const statusHistory = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          'SELECT count(*) n FROM model_access.upstream_status WHERE upstream_id = $1',
          [upstreamId],
        )
      ).rows[0]!.n,
    );
  const errorCodes = async (userId: string) =>
    (
      await db.query<{ error_code: string | null; charged_micros: string }>(
        'SELECT error_code, charged_micros FROM model_access.usage_records WHERE user_id = $1 ORDER BY created_at, id',
        [userId],
      )
    ).rows;
  const wallet = async (userId: string) =>
    (
      await db.query<{ balance_micros: string; held_micros: string }>(
        'SELECT balance_micros, held_micros FROM billing.accounts WHERE user_id = $1',
        [userId],
      )
    ).rows[0];

  it('401 / 403 普通正文、密钥自检通过：上游保持正常，调用方拿到 content_rejected；不暂停、不冷却、不记失败、不扣费', async () => {
    const user = await newUser('isolation_selfcheck_ok');
    const service = app.get(UpstreamService);
    const scheduler = app.get(UpstreamScheduler);
    const history = await statusHistory();
    const before = await wallet(user);
    for (const m of ['auth403', 'auth401'] as const) {
      mode = m;
      expect(await gateway.generateText(privateReply(user))).toEqual({
        ok: false,
        error: 'content_rejected',
      });
    }
    // 日常场景同样适用（任何服务商、任何场景，判定都在网关里）。
    mode = 'auth403';
    expect(await gateway.generateText(dailyReply(user))).toEqual({
      ok: false,
      error: 'content_rejected',
    });
    expect(calls).toBe(3); // 每次只调一次：不重试、不换账号
    expect(probes).toBe(1); // 同一上游 60 秒内只自检一次
    const row = await service.get(upstreamId);
    expect(row.status).toBe('active');
    expect(row.consecutiveFailures).toBe(0);
    expect(row.cooldownUntil).toBeNull();
    expect(scheduler.isRouteCooling(modelKey, upstreamId)).toBe(false);
    expect((await scheduler.plan(modelKey, null)).map((r) => r.upstreamId)).toContain(upstreamId);
    expect(await statusHistory()).toBe(history);
    const records = await errorCodes(user);
    expect(records.map((r) => r.error_code)).toEqual([
      'content_rejected',
      'content_rejected',
      'content_rejected',
    ]);
    expect(records.every((r) => Number(r.charged_micros) === 0)).toBe(true);
    expect(await wallet(user)).toEqual(before);
    mode = 'ok';
    expect(await gateway.generateText(privateReply(user))).toMatchObject({
      ok: true,
      value: { text: output },
    });
    expect(logs.capture.text).not.toContain(key);
  });

  it('401 / 403 普通正文、密钥自检也失败：按原逻辑把上游标 invalid', async () => {
    const user = await newUser('isolation_selfcheck_bad');
    mode = 'auth403';
    modelsStatus = 401;
    expect(await gateway.generateText(privateReply(user))).toEqual({
      ok: false,
      error: 'provider_unavailable',
    });
    expect(calls).toBe(1);
    expect(probes).toBe(1);
    expect((await app.get(UpstreamService).get(upstreamId)).status).toBe('invalid');
    expect((await errorCodes(user)).map((r) => r.error_code)).toEqual(['invalid_key']);
  });

  it('自检缓存：同时到达的请求共用一次自检；60 秒内不再自检，过期后重新自检', async () => {
    const user = await newUser('isolation_selfcheck_cache');
    mode = 'auth403';
    const results = await Promise.all(
      [1, 2, 3].map(() => gateway.generateText(privateReply(user))),
    );
    expect(results).toEqual(Array(3).fill({ ok: false, error: 'content_rejected' }));
    expect(calls).toBe(3);
    expect(probes).toBe(1);
    clock.advance(KEY_SELF_CHECK_TTL_MS - 1);
    expect((await gateway.generateText(privateReply(user))).ok).toBe(false);
    expect(probes).toBe(1);
    clock.advance(1);
    expect(await gateway.generateText(privateReply(user))).toEqual({
      ok: false,
      error: 'content_rejected',
    });
    expect(probes).toBe(2);
    expect((await app.get(UpstreamService).get(upstreamId)).status).toBe('active');
  });

  it('用户 A 1 小时内被拦 5 次后只限制 A 的私密回复：B 同一时间照常请求服务商；上游不变；限制到期后 A 恢复', async () => {
    const a = await newUser('isolation_limit_a');
    const b = await newUser('isolation_limit_b');
    const service = app.get(UpstreamService);
    const scheduler = app.get(UpstreamScheduler);
    const history = await statusHistory();
    mode = 'policy403';
    for (let i = 0; i < PRIVATE_BLOCK_LIMIT.threshold; i++) {
      expect(await gateway.generateText(privateReply(a))).toEqual({
        ok: false,
        error: 'content_rejected',
      });
      clock.advance(MINUTE);
    }
    // 第 5 次被拦在 4 分钟时，限制到 64 分钟；现在是 5 分钟。
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold);
    // B 也被拦过一次：B 的计数与 A 无关。
    expect((await gateway.generateText(privateReply(b))).ok).toBe(false);
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 1);

    mode = 'ok';
    const walletA = await wallet(a);
    const recordsA = (await errorCodes(a)).length;
    // A 受限：不请求服务商，直接按内容被拒返回；不冻结、不扣费、不写用量记录。
    expect(await gateway.generateText(privateReply(a))).toEqual({
      ok: false,
      error: 'content_rejected',
    });
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 1);
    expect(await wallet(a)).toEqual(walletA);
    expect((await errorCodes(a)).length).toBe(recordsA);
    // 同一时间 B 的私密回复照常请求服务商。
    expect(await gateway.generateText(privateReply(b))).toMatchObject({
      ok: true,
      value: { text: output },
    });
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 2);
    // 限制只管私密回复：A 的日常聊天照常。
    expect((await gateway.generateText(dailyReply(a))).ok).toBe(true);
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 3);
    // 任何用户被拦都不改上游状态、不冷却线路。
    expect((await service.get(upstreamId)).status).toBe('active');
    expect(scheduler.isRouteCooling(modelKey, upstreamId)).toBe(false);
    expect(await statusHistory()).toBe(history);
    // 结构化日志：只有用户 ID、次数（和到期时间），不含内容。
    const limited = logs.capture
      .records()
      .filter((r) => r.code === 'private_block_limited' && r.userId === a);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ userId: a, blockedCount: PRIVATE_BLOCK_LIMIT.threshold });
    expect(JSON.stringify(limited)).not.toContain('ISOLATION_CANARY_TEXT');
    expect(
      logs.capture.records().some((r) => r.code === 'private_block_limited' && r.userId === b),
    ).toBe(false);

    // 到期前一刻仍受限，到期后恢复请求服务商。
    clock.advance(PRIVATE_BLOCK_LIMIT.limitMs - MINUTE - 1);
    expect(await gateway.generateText(privateReply(a))).toEqual({
      ok: false,
      error: 'content_rejected',
    });
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 3);
    clock.advance(1);
    expect(await gateway.generateText(privateReply(a))).toMatchObject({
      ok: true,
      value: { text: output },
    });
    expect(calls).toBe(PRIVATE_BLOCK_LIMIT.threshold + 4);
  });

  it('被拦消息按会话隔离：A 会话登记的消息不影响 B 会话', async () => {
    const [convA, convB, userId, character] = [newId(), newId(), newId(), newId()];
    const history = [1, 2, 3, 4, 5].map((seq) => ({ seq }));
    expect(
      await recordBlocked(db, {
        userId,
        characterId: character,
        conversationId: convA,
        seqs: [3, 4],
        planId: null,
        source: 'auto',
        at: clock.now(),
      }),
    ).toBe(2);
    expect((await withoutBlocked(db, convA, history)).map((m) => m.seq)).toEqual([1, 2, 5]);
    expect(await withoutBlocked(db, convB, history)).toEqual(history);
    expect((await blockedSeqs(db, convB)).size).toBe(0);
    // B 会话登记同样序号，也不会改变 A 会话的登记。
    await recordBlocked(db, {
      userId,
      characterId: character,
      conversationId: convB,
      seqs: [1],
      planId: null,
      source: 'auto',
      at: clock.now(),
    });
    expect([...(await blockedSeqs(db, convA))].sort()).toEqual([3, 4]);
    expect([...(await blockedSeqs(db, convB))]).toEqual([1]);
  });
});
