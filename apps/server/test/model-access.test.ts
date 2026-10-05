/**
 * model-access 模块集成测试（T-027 / D-L0-08，真实 PostgreSQL + 本机假上游 HTTP 服务）。对照任务卡验收标准：
 * - 契约中 model-access 的后端接口全部实现（用户端 6 个、管理端上游 5 个 + 目录 2 个、用量 3 个）；
 * - 平台密钥：数据库里只有密文、接口只返回掩码、日志 / 审计 / 事件里搜不到（金丝雀密钥）；
 * - 无审查模型闸门：无成人资格的角色选不了无审查模型，接口和调用时解析都绕不过去；
 * - 契约 1.3 追加：启用模型查价、每日用量对账（usage_reconciled）、上游状态变化发管理员提醒。
 */
import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdminCatalogEntry,
  AdminUsageRecord,
  AdminUsageSummary,
  ApiError,
  AuthResponse,
  CharacterModelOverride,
  ModelInfo,
  ModelSelection,
  ModelStatus,
  Upstream,
  type DeviceInfo,
  type PolicyDecision,
  type UsageCharge,
} from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { MODEL_ACCESS_POLICY } from '../src/modules/model-access/index.js';
import {
  ChargeQueryUnavailableError,
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_PRICE_SOURCE,
  ModelAccessLifecycle,
  ModelResolver,
  ModelStatusService,
  UpstreamService,
  UsageReconciliationService,
  UsageRecorder,
  type ChargeQuery,
  type ModelTextPrices,
} from '../src/modules/model-access/testing.js';
import { DATABASE, TestClock, type Database } from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase, withClient } from './support/db.js';
import { canaryKey, captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const PASSWORD = 'correct horse battery';
const DEVICE: DeviceInfo = {
  platform: 'web',
  name: 'Chrome on Windows',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};

// ---------- 假上游（OpenAI 兼容的 GET /models） ----------

class FakeUpstream {
  server!: Server;
  baseUrl = '';
  readonly goodKeys = new Set<string>();
  readonly quotaKeys = new Set<string>();
  /** 收到的 Authorization 头（验证密钥确实只发给了上游）。 */
  readonly seenAuth: string[] = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const auth = req.headers.authorization ?? '';
      this.seenAuth.push(auth);
      const key = auth.replace(/^Bearer /, '');
      if (req.url === '/broken/v1/models') {
        res.writeHead(500).end('{"error":"boom"}');
      } else if (req.url !== '/v1/models') {
        res.writeHead(404).end();
      } else if (this.quotaKeys.has(key)) {
        res.writeHead(402).end('{"error":"insufficient"}');
      } else if (this.goodKeys.has(key)) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
      } else {
        // 故意回显部分密钥，验证网关不读不记录上游原文
        res.writeHead(401).end(`{"error":"invalid key ${key}"}`);
      }
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** 一个确定没有服务在监听的地址（网络错误）。 */
async function closedPortUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

// ---------- 假 policy、假价格、假计费查询 ----------

class FakePolicy {
  readonly eligible = new Set<string>();
  readonly missing = new Set<string>();
  readonly calls: Array<{ characterId: string; modelHasAdultContent: boolean }> = [];
  checkModelForCharacter(input: {
    userId: string;
    characterId: string;
    modelHasAdultContent: boolean;
  }): Promise<PolicyDecision> {
    this.calls.push(input);
    if (this.missing.has(input.characterId)) {
      return Promise.resolve({ allowed: false, reason: 'character_not_found' });
    }
    if (input.modelHasAdultContent && !this.eligible.has(input.characterId)) {
      return Promise.resolve({ allowed: false, reason: 'model_not_allowed' });
    }
    return Promise.resolve({ allowed: true });
  }
}

class FakePrices {
  readonly map = new Map<string, ModelTextPrices>();
  textPrices(keys: readonly string[]): Promise<Map<string, ModelTextPrices>> {
    return Promise.resolve(new Map([...this.map].filter(([k]) => keys.includes(k))));
  }
}

class FakeCharges implements ChargeQuery {
  unavailable = false;
  readonly priced = new Set<string>();
  charges: Array<UsageCharge & { day: string }> = [];
  private check(): void {
    if (this.unavailable) throw new ChargeQueryUnavailableError();
  }
  getChargesByUsageRecordIds(ids: readonly string[]): Promise<UsageCharge[]> {
    this.check();
    if (ids.length > 1000) throw new Error('too many');
    return Promise.resolve(this.charges.filter((c) => ids.includes(c.usageRecordId)));
  }
  listChargesByDay(day: string, page?: { cursor?: string; limit?: number }) {
    this.check();
    const all = this.charges.filter((c) => c.day === day);
    const start = page?.cursor ? Number(page.cursor) : 0;
    const limit = Math.min(page?.limit ?? 500, 2); // 每页 2 条，覆盖分页
    const items = all.slice(start, start + limit);
    return Promise.resolve({
      items,
      nextCursor: start + limit < all.length ? String(start + limit) : null,
    });
  }
  listActivePricedModelKeys(): Promise<string[]> {
    this.check();
    return Promise.resolve([...this.priced]);
  }
}

describeDb('model-access 模块（真实 PostgreSQL）', () => {
  let app: INestApplication;
  let baseUrl: string;
  let database: Database;
  let commands: IdentityCommands;
  let upstreamsSvc: UpstreamService;
  let resolver: ModelResolver;
  let statusSvc: ModelStatusService;
  let recorder: UsageRecorder;
  let reconciliation: UsageReconciliationService;
  let lifecycle: ModelAccessLifecycle;
  let adminToken = '';
  let adminId = '';
  const fake = new FakeUpstream();
  const policy = new FakePolicy();
  const prices = new FakePrices();
  const charges = new FakeCharges();
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  const { logger, capture } = captureLogger('debug');
  let ipCounter = 0;
  let userCounter = 0;
  const canaries: string[] = [];

  beforeAll(async () => {
    await resetTestDatabase();
    await fake.start();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(MODEL_ACCESS_POLICY)
      .useValue(policy)
      .overrideProvider(MODEL_PRICE_SOURCE)
      .useValue(prices)
      .overrideProvider(MODEL_ACCESS_CHARGE_QUERY)
      .useValue(charges)
      .compile();
    app = moduleRef.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    database = app.get<Database>(DATABASE);
    commands = app.get(IdentityCommands);
    upstreamsSvc = app.get(UpstreamService);
    resolver = app.get(ModelResolver);
    statusSvc = app.get(ModelStatusService);
    recorder = app.get(UsageRecorder);
    reconciliation = app.get(UsageReconciliationService);
    lifecycle = app.get(ModelAccessLifecycle);
    await commands.createAdmin('model_boss', PASSWORD);
    await refreshAdmin();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await fake.stop();
  });

  // ---------- 小工具 ----------

  function http() {
    ipCounter += 1;
    const ip = `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
    const agent = request(baseUrl);
    const wrap = <T extends { set(k: string, v: string): T }>(r: T, token?: string) => {
      const withIp = r.set('X-Forwarded-For', ip);
      return token ? withIp.set('Authorization', `Bearer ${token}`) : withIp;
    };
    return {
      get: (path: string, token?: string) => wrap(agent.get(path), token),
      post: (path: string, token?: string) => wrap(agent.post(path), token),
      put: (path: string, token?: string) => wrap(agent.put(path), token),
      patch: (path: string, token?: string) => wrap(agent.patch(path), token),
      delete: (path: string, token?: string) => wrap(agent.delete(path), token),
    };
  }

  const errorCode = (res: { body: unknown }) => ApiError.parse(res.body).error.code;

  let adminLoginAt = 0;
  async function refreshAdmin(): Promise<void> {
    if (adminToken && clock.nowMs() - adminLoginAt < 6 * 3_600_000 && clock.nowMs() >= adminLoginAt)
      return;
    const body = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({ username: 'model_boss', password: PASSWORD, device: DEVICE, kind: 'admin' })
          .expect(200)
      ).body,
    );
    adminToken = body.session.token;
    adminId = body.user.userId;
    adminLoginAt = clock.nowMs();
  }
  beforeEach(refreshAdmin);

  async function newUser(): Promise<{ userId: string; token: string }> {
    userCounter += 1;
    const code = (await commands.createInvite(null, 0)).code;
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        username: `chooser_${userCounter}`,
        password: PASSWORD,
        inviteCode: code,
        device: DEVICE,
      })
      .expect(201);
    const body = AuthResponse.parse(res.body);
    return { userId: body.user.userId, token: body.session.token };
  }

  function newKey(): string {
    const key = canaryKey();
    canaries.push(key);
    fake.goodKeys.add(key);
    return key;
  }

  async function createUpstream(name: string, key = newKey()) {
    const res = await http()
      .post('/api/v1/admin/model/upstreams', adminToken)
      .send({ name, kind: 'openai_compatible', baseUrl: fake.baseUrl, apiKey: key })
      .expect(201);
    return Upstream.parse(res.body);
  }

  function entry(modelKey: string, upstreamId: string, extra: Record<string, unknown> = {}) {
    return {
      modelKey,
      displayName: modelKey.split('/')[1],
      vendorName: '测试厂商',
      upstreamId,
      upstreamModelId: modelKey.split('/')[1],
      capabilities: [],
      tags: ['中文好'],
      leaderboardRank: null,
      sortOrder: 10,
      defaultFor: [],
      enabled: true,
      ...extra,
    };
  }

  function putCatalog(body: { modelKey: string } & Record<string, unknown>, path = body.modelKey) {
    return http()
      .put(`/api/v1/admin/model/catalog/${encodeURIComponent(path)}`, adminToken)
      .send(body);
  }

  async function addModel(
    modelKey: string,
    upstreamId: string,
    extra: Record<string, unknown> = {},
  ): Promise<AdminCatalogEntry> {
    charges.priced.add(modelKey);
    const res = await putCatalog(entry(modelKey, upstreamId, extra)).expect(200);
    return AdminCatalogEntry.parse(res.body);
  }

  async function outboxEvents(type: string): Promise<Array<{ payload: Record<string, unknown> }>> {
    return withClient(async (c) => {
      const { rows } = await c.query<{ event: { payload: Record<string, unknown> } }>(
        `SELECT event FROM platform.outbox WHERE event_type = $1 ORDER BY created_at, id`,
        [type],
      );
      return rows.map((r) => r.event);
    });
  }

  async function audits(action: string): Promise<Array<Record<string, unknown>>> {
    return withClient(async (c) => {
      const { rows } = await c.query<Record<string, unknown>>(
        `SELECT * FROM platform.audit_log WHERE action = $1 ORDER BY occurred_at, id`,
        [action],
      );
      return rows;
    });
  }

  // ---------- 上游与平台密钥 ----------

  describe('上游登记与平台密钥', () => {
    it('登记：先连通测试，成功才保存；只返回掩码；数据库只有密文', async () => {
      const key = newKey();
      const up = await createUpstream('DeepSeek 官方', key);
      expect(up.status).toBe('active');
      expect(up.maskedKey).toBe(`${key.slice(0, 4)}…${key.slice(-4)}`);
      expect(JSON.stringify(up)).not.toContain(key);
      expect(fake.seenAuth).toContain(`Bearer ${key}`);

      const row = await withClient(async (c) => {
        const { rows } = await c.query<{ secret: Buffer; whole: string }>(
          `SELECT secret_ciphertext AS secret, row_to_json(u)::text AS whole
             FROM model_access.upstreams u WHERE id = $1`,
          [up.upstreamId],
        );
        return rows[0];
      });
      expect(row).toBeDefined();
      expect(row?.secret.includes(Buffer.from(key))).toBe(false);
      expect(row?.whole).not.toContain(key);
      expect(row?.whole).not.toContain(key.slice(8, 24));
      // 能解密回原文（只在网关用的方法里）
      expect(await upstreamsSvc.withApiKey(up.upstreamId, (k) => Promise.resolve(k))).toBe(key);

      const list = await http().get('/api/v1/admin/model/upstreams', adminToken).expect(200);
      const items = z.object({ items: z.array(Upstream) }).parse(list.body).items;
      expect(items.map((u) => u.upstreamId)).toContain(up.upstreamId);
      expect(JSON.stringify(list.body)).not.toContain(key);
      expect((await audits('upstream.created')).length).toBeGreaterThan(0);
    });

    it('连通测试失败 422 upstream_test_failed，按原因分类，不保存', async () => {
      const before = (await upstreamsSvc.list()).length;
      const bad = canaryKey();
      canaries.push(bad);
      const quota = canaryKey();
      canaries.push(quota);
      fake.quotaKeys.add(quota);
      const cases: Array<[string, string, string]> = [
        [fake.baseUrl, bad, 'invalid_key'],
        [fake.baseUrl, quota, 'insufficient_balance'],
        [await closedPortUrl(), newKey(), 'network_error'],
        [fake.baseUrl.replace('/v1', '/broken/v1'), newKey(), 'provider_error'],
      ];
      for (const [url, apiKey, reason] of cases) {
        const res = await http()
          .post('/api/v1/admin/model/upstreams', adminToken)
          .send({ name: '坏上游', kind: 'openai_compatible', baseUrl: url, apiKey })
          .expect(422);
        const err = ApiError.parse(res.body).error;
        expect(err.code).toBe('upstream_test_failed');
        expect(err.details).toEqual({ reason });
        expect(JSON.stringify(res.body)).not.toContain(apiKey);
      }
      expect((await upstreamsSvc.list()).length).toBe(before);
      expect((await audits('upstream.test_failed')).length).toBeGreaterThanOrEqual(4);
    });

    it('密钥首尾空白去掉；接口地址带账号密码或查询串 400；参数校验 400', async () => {
      const key = newKey();
      const up = await createUpstream('百炼', `  ${key}\n`);
      expect(await upstreamsSvc.withApiKey(up.upstreamId, (k) => Promise.resolve(k))).toBe(key);
      const res = await http()
        .post('/api/v1/admin/model/upstreams', adminToken)
        .send({
          name: 'x',
          kind: 'openai_compatible',
          baseUrl: `${fake.baseUrl}?k=1`,
          apiKey: newKey(),
        })
        .expect(400);
      expect(errorCode(res)).toBe('bad_request');
      await http()
        .post('/api/v1/admin/model/upstreams', adminToken)
        .send({ name: 'x', kind: 'other', baseUrl: fake.baseUrl, apiKey: newKey() })
        .expect(400);
      await http()
        .post('/api/v1/admin/model/upstreams', adminToken)
        .send({ name: 'x', kind: 'openai_compatible', baseUrl: fake.baseUrl, apiKey: '        x ' })
        .expect(400);
    });

    it('更换密钥：新密钥测试失败 422 且旧密钥不变；成功则替换并审计', async () => {
      const oldKey = newKey();
      const up = await createUpstream('OpenRouter', oldKey);
      const bad = canaryKey();
      canaries.push(bad);
      const fail = await http()
        .put(`/api/v1/admin/model/upstreams/${up.upstreamId}/key`, adminToken)
        .send({ apiKey: bad })
        .expect(422);
      expect(errorCode(fail)).toBe('upstream_test_failed');
      expect(await upstreamsSvc.withApiKey(up.upstreamId, (k) => Promise.resolve(k))).toBe(oldKey);

      const newer = newKey();
      const ok = Upstream.parse(
        (
          await http()
            .put(`/api/v1/admin/model/upstreams/${up.upstreamId}/key`, adminToken)
            .send({ apiKey: newer })
            .expect(200)
        ).body,
      );
      expect(ok.maskedKey).toBe(`${newer.slice(0, 4)}…${newer.slice(-4)}`);
      expect(await upstreamsSvc.withApiKey(up.upstreamId, (k) => Promise.resolve(k))).toBe(newer);
      const rotated = await audits('upstream.key_rotated');
      expect(JSON.stringify(rotated)).not.toContain(newer);
      expect(rotated.some((a) => a.target_id === up.upstreamId)).toBe(true);

      await http()
        .put(`/api/v1/admin/model/upstreams/0192f000-0000-7000-8000-000000000000/key`, adminToken)
        .send({ apiKey: newKey() })
        .expect(404);
    });

    it('手动测试刷新状态：失效 → 发模型状态事件与管理员提醒（critical）；恢复 → recovered 与 info 提醒', async () => {
      const key = newKey();
      const up = await createUpstream('手动测试上游', key);
      await addModel('test/manual-a', up.upstreamId);
      fake.goodKeys.delete(key);
      const down = Upstream.parse(
        (
          await http()
            .post(`/api/v1/admin/model/upstreams/${up.upstreamId}/test`, adminToken)
            .expect(200)
        ).body,
      );
      expect(down.status).toBe('invalid');
      const changed = await outboxEvents('model_access.model_status_changed');
      expect(changed.map((e) => e.payload)).toContainEqual({
        modelKey: 'test/manual-a',
        available: false,
        reason: 'provider_unavailable',
      });
      const alerts = (await outboxEvents('platform.admin_alert_raised')).map((e) => e.payload);
      const invalid = alerts.find((a) => a.dedupeKey === `upstream_invalid:${up.upstreamId}`);
      expect(invalid).toMatchObject({
        kind: 'upstream_invalid',
        severity: 'critical',
        refs: { upstreamId: up.upstreamId },
      });
      expect(JSON.stringify(alerts)).not.toContain(key);

      fake.goodKeys.add(key);
      const up2 = Upstream.parse(
        (
          await http()
            .post(`/api/v1/admin/model/upstreams/${up.upstreamId}/test`, adminToken)
            .expect(200)
        ).body,
      );
      expect(up2.status).toBe('active');
      expect(
        (await outboxEvents('model_access.model_status_changed')).map((e) => e.payload),
      ).toContainEqual({
        modelKey: 'test/manual-a',
        available: true,
        reason: 'recovered',
      });
      const recovered = (await outboxEvents('platform.admin_alert_raised'))
        .map((e) => e.payload)
        .find((a) => a.dedupeKey === `upstream_recovered:${up.upstreamId}`);
      expect(recovered).toMatchObject({ kind: 'upstream_recovered', severity: 'info' });
      const history = await withClient(async (c) =>
        (
          await c.query<{ to_status: string }>(
            `SELECT to_status FROM model_access.upstream_status WHERE upstream_id = $1 ORDER BY changed_at, id`,
            [up.upstreamId],
          )
        ).rows.map((r) => r.to_status),
      );
      expect(history).toEqual(['active', 'invalid', 'active']);
    });

    it('网关报告状态：余额用完 → quota_exhausted 提醒；状态不变不重复发', async () => {
      const up = await createUpstream('网关报告上游');
      expect(await upstreamsSvc.reportStatus(up.upstreamId, 'quota_exhausted', 'gateway')).toBe(
        true,
      );
      expect(await upstreamsSvc.reportStatus(up.upstreamId, 'quota_exhausted', 'gateway')).toBe(
        false,
      );
      const quota = (await outboxEvents('platform.admin_alert_raised'))
        .map((e) => e.payload)
        .filter((a) => a.dedupeKey === `upstream_quota_exhausted:${up.upstreamId}`);
      expect(quota).toHaveLength(1);
      expect(quota[0]).toMatchObject({ severity: 'critical' });
      expect(await upstreamsSvc.reportStatus(up.upstreamId, 'unavailable', 'probe')).toBe(true);
      const unavailable = (await outboxEvents('platform.admin_alert_raised'))
        .map((e) => e.payload)
        .find((a) => a.dedupeKey === `upstream_unavailable:${up.upstreamId}`);
      expect(unavailable).toMatchObject({ severity: 'warning' });
    });

    it('删除：仍有启用模型时 409；停用后可删，密文随之删除', async () => {
      const up = await createUpstream('待删上游');
      await addModel('test/delete-me', up.upstreamId);
      const conflict = await http()
        .delete(`/api/v1/admin/model/upstreams/${up.upstreamId}`, adminToken)
        .expect(409);
      expect(errorCode(conflict)).toBe('conflict');
      await putCatalog(entry('test/delete-me', up.upstreamId, { enabled: false })).expect(200);
      await http().delete(`/api/v1/admin/model/upstreams/${up.upstreamId}`, adminToken).expect(204);
      const left = await withClient(
        async (c) =>
          (await c.query(`SELECT 1 FROM model_access.upstreams WHERE id = $1`, [up.upstreamId]))
            .rowCount,
      );
      expect(left).toBe(0);
      expect((await audits('upstream.deleted')).some((a) => a.target_id === up.upstreamId)).toBe(
        true,
      );
      // 停用条目指向已删除的上游：重新启用 422
      const res = await putCatalog(entry('test/delete-me', up.upstreamId)).expect(422);
      expect(errorCode(res)).toBe('bad_request');
      await http().delete(`/api/v1/admin/model/upstreams/${up.upstreamId}`, adminToken).expect(404);
    });

    it('普通用户 403、未登录 401（管理端全部接口）', async () => {
      const u = await newUser();
      const paths: Array<[keyof ReturnType<typeof http>, string]> = [
        ['get', '/api/v1/admin/model/upstreams'],
        ['post', '/api/v1/admin/model/upstreams'],
        ['put', '/api/v1/admin/model/upstreams/0192f000-0000-7000-8000-000000000000/key'],
        ['post', '/api/v1/admin/model/upstreams/0192f000-0000-7000-8000-000000000000/test'],
        ['delete', '/api/v1/admin/model/upstreams/0192f000-0000-7000-8000-000000000000'],
        ['get', '/api/v1/admin/model/catalog'],
        ['put', '/api/v1/admin/model/catalog/a%2Fb'],
        ['post', '/api/v1/admin/model/usage/summary'],
        ['post', '/api/v1/admin/model/usage/records'],
        ['post', '/api/v1/admin/model/usage/export'],
      ];
      for (const [method, path] of paths) {
        await http()[method](path, u.token).expect(403);
        await http()[method](path).expect(401);
      }
    });
  });

  // ---------- 模型目录 ----------

  describe('模型目录', () => {
    let upstreamId = '';
    beforeAll(async () => {
      upstreamId = (await createUpstream('目录上游')).upstreamId;
    });

    it('新增 / 修改 / 列表；路径与请求体不一致 400；路径格式不对 400', async () => {
      const e = await addModel('deepseek/deepseek-v4-pro', upstreamId, {
        defaultFor: ['chat'],
        sortOrder: 1,
      });
      expect(e.defaultFor).toEqual(['chat']);
      await putCatalog(entry('deepseek/deepseek-v4-pro', upstreamId), 'deepseek/other').expect(400);
      await http()
        .put('/api/v1/admin/model/catalog/no-slash', adminToken)
        .send(entry('no/slash', upstreamId))
        .expect(400);
      const list = z
        .object({ items: z.array(AdminCatalogEntry) })
        .parse((await http().get('/api/v1/admin/model/catalog', adminToken).expect(200)).body);
      expect(list.items.map((i) => i.modelKey)).toContain('deepseek/deepseek-v4-pro');
      expect((await audits('catalog.created')).length).toBeGreaterThan(0);
    });

    it('无审查模型不能设为默认 422 model_not_allowed；默认识图模型必须有 vision；停用的不能是默认', async () => {
      charges.priced.add('dolphin/uncensored');
      const adult = await putCatalog(
        entry('dolphin/uncensored', upstreamId, {
          capabilities: ['adult_content'],
          defaultFor: ['background'],
        }),
      ).expect(422);
      expect(errorCode(adult)).toBe('model_not_allowed');
      charges.priced.add('qwen/no-vision');
      const vision = await putCatalog(
        entry('qwen/no-vision', upstreamId, { defaultFor: ['vision'] }),
      ).expect(422);
      expect(errorCode(vision)).toBe('bad_request');
      await putCatalog(
        entry('qwen/no-vision', upstreamId, { defaultFor: ['chat'], enabled: false }),
      ).expect(422);
    });

    it('契约 1.3：启用时当前价目表没有该模型的价格 → 422 model_unavailable；计费查询未接入 → 503；停用保存不查价', async () => {
      const res = await putCatalog(entry('qwen/unpriced', upstreamId)).expect(422);
      expect(errorCode(res)).toBe('model_unavailable');
      await putCatalog(entry('qwen/unpriced', upstreamId, { enabled: false })).expect(200);
      charges.unavailable = true;
      try {
        const down = await putCatalog(entry('qwen/unpriced', upstreamId)).expect(503);
        expect(errorCode(down)).toBe('service_unavailable');
      } finally {
        charges.unavailable = false;
      }
      charges.priced.add('qwen/unpriced');
      await putCatalog(entry('qwen/unpriced', upstreamId)).expect(200);
    });

    it('每种默认只有一个：设新默认时从原模型上摘掉；改指上游、停用记审计并发事件', async () => {
      await addModel('deepseek/deepseek-flash', upstreamId, { defaultFor: ['background', 'chat'] });
      const list = z
        .object({ items: z.array(AdminCatalogEntry) })
        .parse((await http().get('/api/v1/admin/model/catalog', adminToken).expect(200)).body);
      const pro = list.items.find((i) => i.modelKey === 'deepseek/deepseek-v4-pro');
      const flash = list.items.find((i) => i.modelKey === 'deepseek/deepseek-flash');
      expect(pro?.defaultFor).toEqual([]);
      expect(flash?.defaultFor.sort()).toEqual(['background', 'chat']);
      // 改回 pro 为聊天默认
      await addModel('deepseek/deepseek-v4-pro', upstreamId, {
        defaultFor: ['chat'],
        sortOrder: 1,
      });
      await addModel('deepseek/deepseek-flash', upstreamId, { defaultFor: ['background'] });

      const other = await createUpstream('备用上游');
      await addModel('qwen/qwen3.7-plus', upstreamId);
      await addModel('qwen/qwen3.7-plus', other.upstreamId);
      const updated = await audits('catalog.updated');
      expect(
        updated.some(
          (a) =>
            a.target_id === 'qwen/qwen3.7-plus' &&
            (a.details as Record<string, unknown>).upstreamChangedFrom === upstreamId,
        ),
      ).toBe(true);
      await addModel('qwen/qwen3.7-plus', other.upstreamId, { enabled: false });
      expect(
        (await outboxEvents('model_access.model_status_changed')).map((e) => e.payload),
      ).toContainEqual({
        modelKey: 'qwen/qwen3.7-plus',
        available: false,
        reason: 'model_removed',
      });
    });

    it('用户端模型列表：只列启用的；能力筛选；可用状态；价格档位', async () => {
      await addModel('qwen/qwen-vl-plus', upstreamId, {
        capabilities: ['vision'],
        defaultFor: ['vision'],
      });
      prices.map.set('deepseek/deepseek-flash', {
        inputPerMillionMicros: 1_000_000,
        cachedInputPerMillionMicros: 20_000,
        outputPerMillionMicros: 2_000_000,
      });
      const u = await newUser();
      const all = z
        .object({ items: z.array(ModelInfo) })
        .parse((await http().get('/api/v1/model/models', u.token).expect(200)).body).items;
      const keys = all.map((m) => m.modelKey);
      expect(keys).toContain('deepseek/deepseek-v4-pro');
      expect(keys).not.toContain('qwen/qwen3.7-plus'); // 已停用
      expect(keys).not.toContain('qwen/no-vision');
      expect(all.find((m) => m.modelKey === 'deepseek/deepseek-flash')?.priceTier).toBe('cheap');
      expect(all.find((m) => m.modelKey === 'deepseek/deepseek-v4-pro')?.priceTier).toBe('medium');
      expect(JSON.stringify(all)).not.toContain(upstreamId); // 用户看不到上游
      const vision = z
        .object({ items: z.array(ModelInfo) })
        .parse(
          (await http().get('/api/v1/model/models?capability=vision', u.token).expect(200)).body,
        ).items;
      expect(vision.map((m) => m.modelKey)).toEqual(['qwen/qwen-vl-plus']);
      await http().get('/api/v1/model/models?capability=nope', u.token).expect(400);
      await http().get('/api/v1/model/models').expect(401);
    });
  });

  // ---------- 用户的模型选择与无审查模型闸门 ----------

  describe('用户模型选择与无审查模型闸门', () => {
    let upstreamId = '';
    const ELIGIBLE = '0192f000-0000-7000-8000-00000000e001';
    const MINOR = '0192f000-0000-7000-8000-00000000e002';
    const GHOST = '0192f000-0000-7000-8000-00000000e003';
    beforeAll(async () => {
      upstreamId = (await createUpstream('闸门上游')).upstreamId;
      await addModel('dolphin/dolphin-24b', upstreamId, { capabilities: ['adult_content'] });
      await addModel('test/plain-chat', upstreamId);
      await addModel('test/disabled', upstreamId, { enabled: false });
      policy.eligible.add(ELIGIBLE);
      policy.missing.add(GHOST);
    });

    it('全局 chat / background 选无审查模型 422 model_not_allowed；adult 可以；不存在 / 停用 422 model_unavailable', async () => {
      const u = await newUser();
      const empty = ModelSelection.parse(
        (await http().get('/api/v1/model/selection', u.token).expect(200)).body,
      );
      expect(empty).toEqual({ chat: null, background: null, adult: null });
      for (const field of ['chat', 'background']) {
        const res = await http()
          .patch('/api/v1/model/selection', u.token)
          .send({ [field]: { modelKey: 'dolphin/dolphin-24b' } })
          .expect(422);
        expect(errorCode(res)).toBe('model_not_allowed');
      }
      const missing = await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ chat: { modelKey: 'nope/nope' } })
        .expect(422);
      expect(errorCode(missing)).toBe('model_unavailable');
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ chat: { modelKey: 'test/disabled' } })
        .expect(422);
      const ok = ModelSelection.parse(
        (
          await http()
            .patch('/api/v1/model/selection', u.token)
            .send({
              adult: { modelKey: 'dolphin/dolphin-24b' },
              chat: { modelKey: 'test/plain-chat' },
            })
            .expect(200)
        ).body,
      );
      expect(ok.adult).toEqual({
        modelKey: 'dolphin/dolphin-24b',
        available: true,
        unavailableReason: null,
      });
      expect(ok.chat?.modelKey).toBe('test/plain-chat');
      expect(ok.background).toBeNull();
      // 失败的请求一个字段都不改（chat 合法、background 不合法）
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({
          chat: { modelKey: 'deepseek/deepseek-flash' },
          background: { modelKey: 'dolphin/dolphin-24b' },
        })
        .expect(422);
      const after = ModelSelection.parse(
        (await http().get('/api/v1/model/selection', u.token).expect(200)).body,
      );
      expect(after.chat?.modelKey).toBe('test/plain-chat');
      // null 清除
      const cleared = ModelSelection.parse(
        (await http().patch('/api/v1/model/selection', u.token).send({ adult: null }).expect(200))
          .body,
      );
      expect(cleared.adult).toBeNull();
      const evts = (await outboxEvents('model_access.selection_changed')).map((e) => e.payload);
      expect(evts).toContainEqual({ userId: u.userId, characterId: null });
    });

    it('角色单独模型：无成人资格的角色设无审查模型 403；有资格可以；角色不存在 404；null 恢复默认', async () => {
      const u = await newUser();
      const denied = await http()
        .put(`/api/v1/model/character-overrides/${MINOR}`, u.token)
        .send({ chat: { modelKey: 'dolphin/dolphin-24b' } })
        .expect(403);
      expect(errorCode(denied)).toBe('model_not_allowed');
      expect(
        CharacterModelOverride.parse(
          (await http().get(`/api/v1/model/character-overrides/${MINOR}`, u.token).expect(200))
            .body,
        ).chat,
      ).toBeNull();
      const plain = CharacterModelOverride.parse(
        (
          await http()
            .put(`/api/v1/model/character-overrides/${MINOR}`, u.token)
            .send({ chat: { modelKey: 'test/plain-chat' } })
            .expect(200)
        ).body,
      );
      expect(plain.chat?.modelKey).toBe('test/plain-chat');

      const ok = CharacterModelOverride.parse(
        (
          await http()
            .put(`/api/v1/model/character-overrides/${ELIGIBLE}`, u.token)
            .send({ chat: { modelKey: 'dolphin/dolphin-24b' } })
            .expect(200)
        ).body,
      );
      expect(ok.chat?.modelKey).toBe('dolphin/dolphin-24b');
      expect(policy.calls).toContainEqual({
        userId: u.userId,
        characterId: ELIGIBLE,
        modelHasAdultContent: true,
      });

      const ghost = await http()
        .put(`/api/v1/model/character-overrides/${GHOST}`, u.token)
        .send({ chat: { modelKey: 'test/plain-chat' } })
        .expect(404);
      expect(errorCode(ghost)).toBe('not_found');
      await http()
        .put(`/api/v1/model/character-overrides/${MINOR}`, u.token)
        .send({ chat: { modelKey: 'test/disabled' } })
        .expect(422);
      await http()
        .put(`/api/v1/model/character-overrides/not-a-uuid`, u.token)
        .send({ chat: null })
        .expect(400);

      const reset = CharacterModelOverride.parse(
        (
          await http()
            .put(`/api/v1/model/character-overrides/${ELIGIBLE}`, u.token)
            .send({ chat: null })
            .expect(200)
        ).body,
      );
      expect(reset.chat).toBeNull();
      // 别的用户看不到这个用户的设置
      const other = await newUser();
      expect(
        CharacterModelOverride.parse(
          (await http().get(`/api/v1/model/character-overrides/${MINOR}`, other.token).expect(200))
            .body,
        ).chat,
      ).toBeNull();
    });

    it('调用时闸门绕不过去：管理员事后给全局聊天模型加上 adult_content，解析时无资格角色 / 无角色都被拒', async () => {
      const u = await newUser();
      await addModel('test/turns-adult', upstreamId);
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ chat: { modelKey: 'test/turns-adult' } })
        .expect(200);
      await addModel('test/turns-adult', upstreamId, { capabilities: ['adult_content'] });
      const base = { userId: u.userId, modelRole: 'chat' as const, purpose: 'chat_reply' as const };
      expect(await resolver.resolve({ ...base, characterId: MINOR })).toEqual({
        ok: false,
        error: 'model_not_allowed',
      });
      expect(await resolver.resolve(base)).toEqual({ ok: false, error: 'model_not_allowed' });
      const ok = await resolver.resolve({ ...base, characterId: ELIGIBLE });
      expect(ok.ok && ok.value.modelKey).toBe('test/turns-adult');
      // 成人模式模型同样受闸门约束
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ adult: { modelKey: 'dolphin/dolphin-24b' } })
        .expect(200);
      expect(await resolver.resolve({ ...base, modelRole: 'adult', characterId: MINOR })).toEqual({
        ok: false,
        error: 'model_not_allowed',
      });
    });

    it('解析顺序：角色覆盖 > 全局 > 平台默认；后台沿用聊天模型；成人模式不回落；识图改用默认识图模型', async () => {
      const u = await newUser();
      const base = { userId: u.userId, purpose: 'chat_reply' as const };
      const key = async (r: Promise<Awaited<ReturnType<typeof resolver.resolve>>>) => {
        const x = await r;
        return x.ok ? x.value.modelKey : x.error;
      };
      expect(await key(resolver.resolve({ ...base, modelRole: 'chat' }))).toBe(
        'deepseek/deepseek-v4-pro',
      );
      expect(await key(resolver.resolve({ ...base, modelRole: 'background' }))).toBe(
        'deepseek/deepseek-flash',
      );
      expect(await key(resolver.resolve({ ...base, modelRole: 'adult' }))).toBe('not_configured');
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ chat: { modelKey: 'test/plain-chat' } })
        .expect(200);
      expect(await key(resolver.resolve({ ...base, modelRole: 'background' }))).toBe(
        'test/plain-chat',
      );
      await http()
        .put(`/api/v1/model/character-overrides/${MINOR}`, u.token)
        .send({ chat: { modelKey: 'deepseek/deepseek-flash' } })
        .expect(200);
      expect(await key(resolver.resolve({ ...base, modelRole: 'chat', characterId: MINOR }))).toBe(
        'deepseek/deepseek-flash',
      );
      const vision = await resolver.resolve({ ...base, modelRole: 'chat', purpose: 'vision' });
      expect(vision.ok && vision.value).toMatchObject({
        modelKey: 'qwen/qwen-vl-plus',
        usedVisionDefault: true,
      });
    });
  });

  // ---------- 模型状态 ----------

  describe('模型状态', () => {
    it('余额不足 → insufficient_balance；加余额后可用；角色模型下架 → model_removed 且可回退；上游故障 → provider_unavailable', async () => {
      const u = await newUser();
      const status = async (characterId?: string) =>
        ModelStatus.parse(
          (
            await http()
              .get(
                `/api/v1/model/status${characterId ? `?characterId=${characterId}` : ''}`,
                u.token,
              )
              .expect(200)
          ).body,
        );
      expect(await status()).toMatchObject({ available: false, reason: 'insufficient_balance' });
      await http()
        .post(`/api/v1/admin/billing/accounts/${u.userId}/adjustments`, adminToken)
        .send({
          direction: 'grant',
          amountMicros: 5_000_000,
          reason: '测试加余额',
          idempotencyKey: `ma-${u.userId}`,
        })
        .expect(201);
      expect(await status()).toEqual({
        characterId: null,
        available: true,
        reason: null,
        canFallbackToDefault: false,
      });
      expect(await statusSvc.getModelStatus(u.userId, null)).toEqual({
        available: true,
        reason: null,
      });

      const own = await createUpstream('状态上游');
      await addModel('test/status-model', own.upstreamId);
      const CHAR = '0192f000-0000-7000-8000-00000000f001';
      await http()
        .put(`/api/v1/model/character-overrides/${CHAR}`, u.token)
        .send({ chat: { modelKey: 'test/status-model' } })
        .expect(200);
      await upstreamsSvc.reportStatus(own.upstreamId, 'unavailable', 'gateway');
      expect(await status(CHAR)).toEqual({
        characterId: CHAR,
        available: false,
        reason: 'provider_unavailable',
        canFallbackToDefault: true,
      });
      await upstreamsSvc.reportStatus(own.upstreamId, 'active', 'probe');
      await addModel('test/status-model', own.upstreamId, { enabled: false });
      expect(await status(CHAR)).toMatchObject({
        available: false,
        reason: 'model_removed',
        canFallbackToDefault: true,
      });
      const sel = ModelSelection.parse(
        (
          await http()
            .patch('/api/v1/model/selection', u.token)
            .send({ chat: { modelKey: 'test/plain-chat' } })
            .expect(200)
        ).body,
      );
      expect(sel.chat?.available).toBe(true);
      await http().get('/api/v1/model/status?characterId=bad', u.token).expect(400);
    });
  });

  // ---------- 用量记录、管理后台查询、对账 ----------

  describe('用量记录与管理后台用量查询（ADM-08）', () => {
    let userA = '';
    let userB = '';
    const CHAR = '0192f000-0000-7000-8000-00000000c001';
    const ids: string[] = [];
    let upstreamId = '';

    async function call(
      userId: string,
      over: Partial<{
        purpose: 'chat_reply' | 'memory' | 'admin_eval';
        billingOwner: 'user' | 'platform';
        status: 'succeeded' | 'failed';
        characterId: string;
        charged: number;
        estimated: boolean;
      }> = {},
    ): Promise<string> {
      const { record } = await recorder.start({
        input: {
          userId,
          purpose: over.purpose ?? 'chat_reply',
          billingOwner: over.billingOwner ?? 'user',
          modelRole: 'chat',
          characterId: over.characterId,
          idempotencyKey: `usage-${ids.length}-${userId}`,
          meta: { conversationKind: 'direct' },
        },
        modelKey: 'deepseek/deepseek-v4-pro',
        upstreamId,
        upstreamModelId: 'deepseek-v4-pro',
        countsAsBackground: false,
      });
      const ok = (over.status ?? 'succeeded') === 'succeeded';
      await recorder.attachHold(record.id, {
        holdId: '0192f000-0000-7000-8000-0000000000a1',
        priceVersionId: '0192f000-0000-7000-8000-0000000000b1',
        usedSafetyOverdraft: false,
      });
      await recorder.finish(record.id, {
        status: ok ? 'succeeded' : 'failed',
        errorCode: ok ? null : 'provider_unavailable',
        inputTokens: 100,
        cachedInputTokens: 50,
        outputTokens: 10,
        estimated: over.estimated ?? false,
        latencyMs: 1200,
        ttftMs: null,
        retryCount: ok ? 0 : 3,
      });
      if (ok) {
        await recorder.writeSettleSnapshot(record.id, {
          ledgerEntryId: `0192f000-0000-7000-8000-${String(ids.length).padStart(12, '0')}`,
          amountMicros: over.charged ?? 1000,
          costMicros: 800,
        });
      }
      ids.push(record.id);
      clock.advance(60_000);
      return record.id;
    }

    beforeAll(async () => {
      upstreamId = (await createUpstream('用量上游')).upstreamId;
      userA = (await newUser()).userId;
      userB = (await newUser()).userId;
      clock.set('2026-10-06T01:00:00.000Z'); // 北京 10-06 09:00
      await refreshAdmin();
      await call(userA, { characterId: CHAR, charged: 3000 });
      await call(userA, { characterId: CHAR, estimated: true });
      await call(userA, { status: 'failed' });
      await call(userB, { charged: 5000 });
      await call(adminId, { purpose: 'admin_eval', billingOwner: 'platform', charged: 7000 });
      clock.set('2026-10-06T17:00:00.000Z'); // 北京 10-07 01:00
      await refreshAdmin();
      await call(userB, { purpose: 'memory', charged: 2000 });
      // 进行中的调用不出现在查询里
      await recorder.start({
        input: {
          userId: userA,
          purpose: 'chat_reply',
          billingOwner: 'user',
          modelRole: 'chat',
          idempotencyKey: 'pending-1',
        },
        modelKey: 'deepseek/deepseek-v4-pro',
        upstreamId,
        upstreamModelId: 'deepseek-v4-pro',
        countsAsBackground: false,
      });
    });

    const FILTER = { from: '2026-10-05T16:00:00.000Z', to: '2026-10-07T16:00:00.000Z' };

    it('同一幂等键只有一条用量记录', async () => {
      const again = await recorder.start({
        input: {
          userId: userA,
          purpose: 'chat_reply',
          billingOwner: 'user',
          modelRole: 'chat',
          idempotencyKey: 'pending-1',
        },
        modelKey: 'deepseek/deepseek-v4-pro',
        upstreamId,
        upstreamModelId: 'deepseek-v4-pro',
        countsAsBackground: false,
      });
      expect(again.created).toBe(false);
    });

    it('汇总：按天（北京时间）× 用户；口径：用户扣费只算 user 的成功调用；截断', async () => {
      const res = await http()
        .post('/api/v1/admin/model/usage/summary', adminToken)
        .send({ filter: FILTER, groupBy: ['day'] })
        .expect(200);
      const s = AdminUsageSummary.parse(res.body);
      expect(s.rows.map((r) => r.keys)).toEqual([['2026-10-06'], ['2026-10-07']]);
      expect(s.totals).toMatchObject({
        calls: 6,
        failedCalls: 1,
        inputTokens: 600,
        cachedInputTokens: 300,
        outputTokens: 60,
        totalTokens: 960,
        estimatedTokens: 160,
        chargedMicros: 3000 + 1000 + 5000 + 2000,
        costMicros: 800 * 5,
        absorbedCostMicros: 0,
      });
      expect(s.truncated).toBe(false);

      const top = AdminUsageSummary.parse(
        (
          await http()
            .post('/api/v1/admin/model/usage/summary', adminToken)
            .send({
              filter: FILTER,
              groupBy: ['user', 'character'],
              sort: 'charged_desc',
              limit: 2,
            })
            .expect(200)
        ).body,
      );
      expect(top.truncated).toBe(true);
      expect(top.rows).toHaveLength(2);
      expect(top.rows[0]?.keys).toEqual([userB, '']);
      expect(top.rows[0]?.chargedMicros).toBe(7000);
      expect(top.rows[1]?.keys).toEqual([userA, CHAR]);

      const filtered = AdminUsageSummary.parse(
        (
          await http()
            .post('/api/v1/admin/model/usage/summary', adminToken)
            .send({
              filter: { ...FILTER, purposes: ['memory'], userIds: [userB] },
              groupBy: ['purpose'],
            })
            .expect(200)
        ).body,
      );
      expect(filtered.rows).toEqual([expect.objectContaining({ keys: ['memory'], calls: 1 })]);
      await http()
        .post('/api/v1/admin/model/usage/summary', adminToken)
        .send({ filter: FILTER, groupBy: ['day', 'day'] })
        .expect(400);
      await http()
        .post('/api/v1/admin/model/usage/summary', adminToken)
        .send({ filter: { from: FILTER.to, to: FILTER.from }, groupBy: ['day'] })
        .expect(400);
    });

    it('明细：按时间倒序分页，不含内容；状态筛选', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = z
          .object({ items: z.array(AdminUsageRecord), nextCursor: z.string().nullable() })
          .parse(
            (
              await http()
                .post('/api/v1/admin/model/usage/records', adminToken)
                .send({ filter: FILTER, limit: 4, ...(cursor ? { cursor } : {}) })
                .expect(200)
            ).body,
          );
        seen.push(...page.items.map((i) => i.usageRecordId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual([...ids].reverse());
      const failed = z.object({ items: z.array(AdminUsageRecord) }).parse(
        (
          await http()
            .post('/api/v1/admin/model/usage/records', adminToken)
            .send({ filter: { ...FILTER, status: 'failed' } })
            .expect(200)
        ).body,
      ).items;
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        errorCode: 'provider_unavailable',
        retryCount: 3,
        chargedMicros: 0,
      });
      const keys = Object.keys(failed[0] ?? {});
      for (const k of ['content', 'text', 'prompt', 'messages']) expect(keys).not.toContain(k);
      await http()
        .post('/api/v1/admin/model/usage/records', adminToken)
        .send({ filter: FILTER, cursor: 'garbage' })
        .expect(400);
    });

    it('导出：返回全部明细并写审计', async () => {
      const res = z
        .object({ items: z.array(AdminUsageRecord), truncated: z.boolean() })
        .parse(
          (
            await http()
              .post('/api/v1/admin/model/usage/export', adminToken)
              .send({ filter: FILTER })
              .expect(200)
          ).body,
        );
      expect(res.items).toHaveLength(6);
      expect(res.truncated).toBe(false);
      const exported = await audits('usage.exported');
      expect(exported.at(-1)).toMatchObject({ actor_id: adminId });
    });

    it('契约 1.3 每日用量对账：补写缺失快照、跨零点补查、发现缺扣费 / 多扣费 / 金额不一致，发事件与管理员提醒', async () => {
      const day = '2026-10-06';
      const [a1, a2, failedId, b1, p1] = ids as [string, string, string, string, string];
      // a2 的金额快照缺失（模拟结算后崩溃）：billing 有扣费
      await withClient((c) =>
        c.query(
          `UPDATE model_access.usage_records SET snapshot_at = NULL, charged_micros = 0, cost_micros = 0, ledger_entry_id = NULL WHERE id = $1`,
          [a2],
        ),
      );
      // 已写快照的记录，流水 ID 与快照一致（真实情况）；其他用新的流水 ID
      const ledgerIds = await withClient(
        async (c) =>
          new Map(
            (
              await c.query<{ id: string; ledger_entry_id: string | null }>(
                `SELECT id, ledger_entry_id FROM model_access.usage_records`,
              )
            ).rows.map((r) => [r.id, r.ledger_entry_id]),
          ),
      );
      let seq = 0;
      const ch = (
        usageRecordId: string,
        amountMicros: number,
        d = day,
        absorbed = false,
      ): UsageCharge & { day: string } => ({
        usageRecordId,
        ledgerEntryId:
          (!absorbed && ledgerIds.get(usageRecordId)) ||
          `0192f000-0000-7000-9000-${String((seq += 1)).padStart(12, '0')}`,
        amountMicros,
        costMicros: absorbed ? amountMicros : 800,
        absorbed,
        safetyOverdraft: false,
        chargedAt: '2026-10-06T02:00:00.000Z',
        day: d,
      });
      charges.charges = [
        ch(a1, 3000), // 一致
        ch(a2, 1000), // 快照被补写后一致
        ch(b1, 4999), // 金额不一致
        ch(p1, 7000, '2026-10-07'), // 跨零点：流水记在次日，按 ID 补查后一致
        ch('0192f000-0000-7000-8000-0000000dead0', 1234), // 多扣费：没有用量记录
        ch(failedId, 300, day, true), // 失败调用的平台吸收：快照缺失 → 补写
      ];
      await withClient((c) =>
        c.query(`UPDATE model_access.usage_records SET snapshot_at = NULL WHERE id = $1`, [
          failedId,
        ]),
      );
      const result = await reconciliation.run(day);
      expect(result).toMatchObject({
        day,
        usageWithoutCharge: 0,
        chargeWithoutUsage: 1,
        amountMismatch: 1,
        snapshotsRepaired: 2,
      });
      const repaired = await withClient(
        async (c) =>
          (
            await c.query<{ charged_micros: string; absorbed_cost_micros: string }>(
              `SELECT charged_micros, absorbed_cost_micros FROM model_access.usage_records WHERE id = ANY($1) ORDER BY created_at`,
              [[a2, failedId]],
            )
          ).rows,
      );
      expect(
        repaired.map((r) => [Number(r.charged_micros), Number(r.absorbed_cost_micros)]),
      ).toEqual([
        [1000, 0],
        [0, 300],
      ]);
      const reconciled = (await outboxEvents('model_access.usage_reconciled')).map(
        (e) => e.payload,
      );
      expect(reconciled.at(-1)).toMatchObject({ day, chargeWithoutUsage: 1, amountMismatch: 1 });
      const alert = (await outboxEvents('platform.admin_alert_raised'))
        .map((e) => e.payload)
        .find((a) => a.dedupeKey === `reconciliation_flagged:${day}:usage`);
      expect(alert).toMatchObject({
        kind: 'reconciliation_flagged',
        severity: 'warning',
        refs: { day },
      });
      expect(JSON.stringify(alert)).not.toContain(userA);
      expect((await audits('usage.reconciliation_flagged')).length).toBe(1);

      // 缺扣费：去掉 a1 的扣费
      charges.charges = charges.charges.filter((c) => c.usageRecordId !== a1);
      expect((await reconciliation.run(day)).usageWithoutCharge).toBe(1);

      // 一切正常的一天：发事件、不发提醒
      charges.charges = [];
      const before = (await outboxEvents('platform.admin_alert_raised')).length;
      const clean = await reconciliation.run('2026-10-01');
      expect(clean).toMatchObject({
        usageWithoutCharge: 0,
        chargeWithoutUsage: 0,
        amountMismatch: 0,
      });
      expect((await outboxEvents('platform.admin_alert_raised')).length).toBe(before);

      // 计费查询端口未接入：定时任务跳过，不发假结果
      charges.unavailable = true;
      try {
        const n = (await outboxEvents('model_access.usage_reconciled')).length;
        expect(await reconciliation.runForYesterday()).toBeNull();
        expect((await outboxEvents('model_access.usage_reconciled')).length).toBe(n);
      } finally {
        charges.unavailable = false;
      }
    });

    it('删除清单：注销用户的选择、角色模型、用量记录全部删除；角色彻底删除时删单独模型', async () => {
      const u = await newUser();
      await http()
        .patch('/api/v1/model/selection', u.token)
        .send({ chat: { modelKey: 'deepseek/deepseek-flash' } })
        .expect(200);
      await http()
        .put(`/api/v1/model/character-overrides/${CHAR}`, u.token)
        .send({ chat: { modelKey: 'deepseek/deepseek-flash' } })
        .expect(200);
      await call(u.userId);
      expect(await lifecycle.countUserData(u.userId)).toBe(3);
      await database.transaction((tx) =>
        lifecycle.onContactPurged({ userId: u.userId, characterId: CHAR }, tx),
      );
      expect(await lifecycle.countUserData(u.userId)).toBe(2);
      expect(await lifecycle.purgeUser(u.userId)).toBe(2);
      expect(await lifecycle.countUserData(u.userId)).toBe(0);
      expect(await lifecycle.purgeUser(u.userId)).toBe(0);
    });
  });

  // ---------- 最后：金丝雀密钥全局搜索 ----------

  it('金丝雀密钥在日志、审计、发件箱、上游以外的任何表里都搜不到', async () => {
    expect(canaries.length).toBeGreaterThan(5);
    const logs = capture.text;
    const dump = await withClient(async (c) => {
      const audit = await c.query<{ t: string }>(
        `SELECT details::text AS t FROM platform.audit_log`,
      );
      const outbox = await c.query<{ t: string }>(`SELECT event::text AS t FROM platform.outbox`);
      const ups = await c.query<{ t: string }>(
        `SELECT row_to_json(u)::text AS t FROM model_access.upstreams u`,
      );
      const hist = await c.query<{ t: string }>(
        `SELECT row_to_json(h)::text AS t FROM model_access.upstream_status h`,
      );
      return [...audit.rows, ...outbox.rows, ...ups.rows, ...hist.rows].map((r) => r.t).join('\n');
    });
    for (const key of canaries) {
      expect(logs).not.toContain(key);
      expect(logs).not.toContain(key.slice(-16));
      expect(dump).not.toContain(key);
      expect(dump).not.toContain(key.slice(-16));
    }
  });
});
