import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { GenerateTextInput, ModelGatewayPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  BillingAdminService,
  PriceService,
  ReservationService,
} from '../src/modules/billing/testing.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import {
  UpstreamService,
  CatalogService,
  GATEWAY_RETRY_WAIT,
  GenerationCache,
  GatewayMaintenance,
} from '../src/modules/model-access/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('T-029 网关真实装配：假 HTTP 上游、真实目录与计费', () => {
  let app: INestApplication;
  let fake: Server;
  let db: Database;
  let user: string;
  let admin: string;
  let upstreamId: string;
  let gateway: ModelGatewayPort;
  let calls = 0;
  let mode = 'ok';
  let requests: Record<string, unknown>[] = [];
  const key = 'sk-gateway-CANARY-DO-NOT-LOG-8934701';
  const output = '模型私密回答 CANARY-OUTPUT-8934701';
  const logs = captureLogger();
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  const modelKey = 'gateway/test';
  beforeAll(async () => {
    await resetTestDatabase();
    fake = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200).end('{"data":[]}');
        return;
      }
      calls++;
      let body = '';
      for await (const part of req) body += part.toString();
      requests.push(JSON.parse(body));
      expect(req.headers.authorization).toBe(`Bearer ${key}`);
      if (mode === '429' && calls <= 3) {
        res.writeHead(429).end(JSON.stringify({ error: { message: key } }));
        return;
      }
      if (mode === 'down') {
        res.writeHead(503).end(key);
        return;
      }
      if (mode === 'invalid') {
        res.writeHead(401).end(JSON.stringify({ error: { message: key } }));
        return;
      }
      if (mode === 'quota') {
        res.writeHead(429).end('{"error":{"code":"insufficient_quota"}}');
        return;
      }
      const usage = {
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 30 },
        completion_tokens: 20,
      };
      if (mode === 'blocked') {
        res.writeHead(200).end(
          JSON.stringify({
            choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
            usage,
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { content: output } }],
          ...(mode === 'estimated' ? {} : { usage }),
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
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    gateway = app.get(MODEL_GATEWAY_PORT);
    const commands = app.get(IdentityCommands);
    admin = await commands.createAdmin('gateway_admin', 'correct horse battery');
    user = await commands.createAdmin('gateway_user', 'correct horse battery');
    await commands.setRole('gateway_user', 'user');
    await app.get(BillingAdminService).adjust(admin, user, {
      direction: 'grant',
      amountMicros: 1000000,
      reason: 'gateway tests',
      idempotencyKey: newId(),
    });
    const upstream = await app.get(UpstreamService).create(admin, {
      name: 'fake local gateway',
      kind: 'openai_compatible',
      baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`,
      apiKey: key,
    });
    upstreamId = upstream.upstreamId;
    const draft = await app.get(PriceService).createDraft(admin, {
      versionLabel: 'gateway',
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
      displayName: 'Gateway Test',
      vendorName: 'Fake',
      upstreamId,
      upstreamModelId: 'fake',
      capabilities: [],
      tags: [],
      leaderboardRank: null,
      sortOrder: 0,
      defaultFor: ['chat'],
      enabled: true,
    });
  });
  beforeEach(async () => {
    calls = 0;
    mode = 'ok';
    requests = [];
    await app.get(UpstreamService).reportStatus(upstreamId, 'active', 'probe');
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });
  const input = (extra: Partial<GenerateTextInput> = {}): GenerateTextInput => ({
    userId: user,
    purpose: 'chat_reply',
    billingOwner: 'user',
    modelRole: 'chat',
    messages: [{ role: 'user', content: '你好' }],
    idempotencyKey: newId(),
    ...extra,
  });
  it('并发与重复只调用一次、扣一次；准确区分缓存输入；输出加密且用量表无正文', async () => {
    const request = input({ responseFormat: 'json' });
    const [a, b] = await Promise.all([
      gateway.generateText(request),
      gateway.generateText(request),
    ]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
    expect(a).toMatchObject({
      ok: true,
      value: {
        text: output,
        chargedMicros: 330,
        usage: { inputTokens: 70, cachedInputTokens: 30, outputTokens: 20, estimated: false },
      },
    });
    expect(requests[0]).toMatchObject({
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    expect(
      await gateway.generateText({ ...request, messages: [{ role: 'user', content: '不同请求' }] }),
    ).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT * FROM model_access.usage_records')).rows.length).toBe(1);
    const dump =
      JSON.stringify((await db.query('SELECT * FROM model_access.generation_results')).rows) +
      JSON.stringify((await db.query('SELECT * FROM model_access.usage_records')).rows);
    expect(dump).not.toContain(output);
    expect(dump).not.toContain(key);
    const ledger = await db.query<{ upstream_id: string; amount_micros: string }>(
      "SELECT * FROM billing.ledger_entries WHERE type='charge'",
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.upstream_id).toBe(upstreamId);
    expect(Number(ledger.rows[0]?.amount_micros)).toBe(-330);
  });
  it('429重试3次，始终一个冻结；成功只扣一次', async () => {
    mode = '429';
    const result = await gateway.generateText(input());
    expect(result.ok).toBe(true);
    expect(calls).toBe(4);
    if (!result.ok) throw new Error('expected success');
    const record = await db.query<{ retry_count: number }>(
      'SELECT retry_count FROM model_access.usage_records WHERE id=$1',
      [result.value.usageRecordId],
    );
    expect(record.rows[0]?.retry_count).toBe(3);
  });
  it('上游持续故障、失效密钥和额度不足正确分类；失败解冻、不向用户扣款', async () => {
    for (const [failure, status, expectedCalls] of [
      ['down', 'unavailable', 4],
      ['invalid', 'invalid', 1],
      ['quota', 'quota_exhausted', 1],
    ] as const) {
      calls = 0;
      mode = failure;
      await app.get(UpstreamService).reportStatus(upstreamId, 'active', 'probe');
      const before = (
        await db.query<{ balance_micros: string }>(
          'SELECT balance_micros FROM billing.accounts WHERE user_id=$1',
          [user],
        )
      ).rows[0]?.balance_micros;
      expect(await gateway.generateText(input())).toMatchObject({
        ok: false,
        error: 'provider_unavailable',
      });
      expect(calls).toBe(expectedCalls);
      expect((await app.get(UpstreamService).get(upstreamId)).status).toBe(status);
      const after = (
        await db.query<{ balance_micros: string; held_micros: string }>(
          'SELECT balance_micros,held_micros FROM billing.accounts WHERE user_id=$1',
          [user],
        )
      ).rows[0];
      expect(after?.balance_micros).toBe(before);
      expect(Number(after?.held_micros)).toBe(0);
    }
  });
  it('内容拒绝不改变上游状态；已产生的费用平台吸收；日志不包含密钥', async () => {
    mode = 'blocked';
    expect(await gateway.generateText(input())).toMatchObject({
      ok: false,
      error: 'content_rejected',
    });
    expect(calls).toBe(1);
    expect((await app.get(UpstreamService).get(upstreamId)).status).toBe('active');
    const absorbed = await db.query<{ cost_micros: string; upstream_id: string }>(
      'SELECT cost_micros,upstream_id FROM billing.ledger_entries WHERE absorbed=true',
    );
    expect(absorbed.rows).toHaveLength(1);
    expect(Number(absorbed.rows[0]?.cost_micros)).toBe(165);
    expect(absorbed.rows[0]?.upstream_id).toBe(upstreamId);
    expect(logs.capture.text).not.toContain(key);
  });
  it('余额不足先拒绝；安全透支、平台账户、成人生成非法组合无法绕过', async () => {
    const empty = await app
      .get(IdentityCommands)
      .createAdmin('gateway_empty', 'correct horse battery');
    expect(await gateway.generateText(input({ userId: empty }))).toMatchObject({
      ok: false,
      error: 'insufficient_balance',
    });
    for (const extra of [
      { purpose: 'memory', safetyPriority: true },
      { billingOwner: 'platform', purpose: 'chat_reply' },
      { billingOwner: 'platform', purpose: 'admin_eval' },
      { modelRole: 'adult' },
      { maxOutputTokens: 0 },
    ] as Partial<GenerateTextInput>[])
      expect((await gateway.generateText(input(extra))).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('结算异常后从加密结果恢复，不重新调用供应商、不重复扣款', async () => {
    const billing = app.get(ReservationService);
    const spy = vi.spyOn(billing, 'settle').mockRejectedValueOnce(new Error('simulated DB outage'));
    const request = input();
    await expect(gateway.generateText(request)).rejects.toThrow('simulated DB outage');
    const again = await gateway.generateText(request);
    expect(again.ok).toBe(true);
    expect(calls).toBe(1);
    spy.mockRestore();
  });
  it('无usage时按约定估算；24h后回收缓存；故障恢复探测恢复状态', async () => {
    mode = 'estimated';
    expect(await gateway.generateText(input())).toMatchObject({
      ok: true,
      value: { usage: { estimated: true } },
    });
    await app
      .get(UpstreamService)
      .reportStatus(upstreamId, 'unavailable', 'gateway', 'network_error');
    await app.get(GatewayMaintenance).probeUpstreams();
    expect((await app.get(UpstreamService).get(upstreamId)).status).toBe('active');
    const row = await app.get(GenerationCache).claim(input());
    clock.advance(91000);
    await app.get(GatewayMaintenance).recover();
    expect((await app.get(GenerationCache).get(row.row.id))?.phase).toBe('complete');
    clock.advance(86400001);
    await app.get(GatewayMaintenance).recover();
    expect((await db.query('SELECT * FROM model_access.generation_results')).rows).toHaveLength(0);
  });
});
