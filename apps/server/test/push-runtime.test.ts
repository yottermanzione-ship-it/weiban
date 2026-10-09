import 'reflect-metadata';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthResponse, Events, type ModelNotificationReadPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  MODEL_ACCESS_POLICY,
  MODEL_NOTIFICATION_READ_PORT,
} from '../src/modules/model-access/index.js';
import {
  CatalogService,
  UpstreamService,
  UPSTREAM_PROBE,
} from '../src/modules/model-access/testing.js';
import { PriceService } from '../src/modules/billing/testing.js';
import { PUSH_PORT } from '../src/modules/push/index.js';
import {
  PushDeviceService,
  PushRequestStore,
  PushDeliveryEngine,
  PushLifecycle,
  PushService,
  AdminAlertService,
  PUSH_HTTP,
  type PushHttpPort,
} from '../src/modules/push/testing.js';
import {
  DATABASE,
  JOB_QUEUE,
  SystemClock,
  newId,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, testKekRing, captureLogger } from './support/fixtures.js';

describeDb('push主应用端口、模型故障目标与独立worker真实HTTP', () => {
  let app: INestApplication;
  let worker: INestApplicationContext | undefined;
  let appClosed = false;
  let db: Database;
  let base: string;
  let users: AuthResponse[];
  const ring = testKekRing().ring;
  const clock = new SystemClock();
  const logs = captureLogger();
  const directory = mkdtempSync(join(tmpdir(), 'weiban-push-runtime-'));
  const path = join(directory, 'push.json');
  const bodies: Record<string, unknown>[] = [];
  let providerBase: string;
  let fail = false;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    bodies.push(JSON.parse(body));
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from('fixture-key:fixture-secret').toString('base64')}`,
    );
    res.writeHead(fail ? 503 : 200).end(fail ? '{}' : '{"msg_id":9223372036854775806}');
  });
  const http: PushHttpPort = {
    async post(input) {
      expect(input.url.href).toBe('https://api.jpush.cn/v3/push');
      const response = await fetch(`${providerBase}/v3/push`, {
        method: 'POST',
        headers: Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k, String(v)])),
        body: new Uint8Array(Buffer.from(input.body)),
      });
      return { status: response.status, body: await response.text() };
    },
  };
  const builder = (role: 'web' | 'worker', background: boolean) =>
    Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: role, PUSH_CREDENTIALS_FILE: path }),
          clock,
          kekRing: ring,
          logger: logs.logger,
          background,
        }),
      ],
    })
      .overrideProvider(PUSH_HTTP)
      .useValue(http)
      .overrideProvider(UPSTREAM_PROBE)
      .useValue({ test: async () => ({ ok: true }) })
      .overrideProvider(MODEL_ACCESS_POLICY)
      .useValue({ checkModelForCharacter: async () => ({ allowed: true }) });
  beforeAll(async () => {
    await resetTestDatabase();
    writeFileSync(
      path,
      JSON.stringify({ jpush: { appKey: 'fixture-key', masterSecret: 'fixture-secret' } }),
      { mode: 0o600 },
    );
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('provider_listen_failed');
    providerBase = `http://127.0.0.1:${address.port}`;
    const module = await builder('web', false).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, testConfig({ APP_ROLE: 'web', PUSH_CREDENTIALS_FILE: path }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(DATABASE);
    await app.get<JobQueue>(JOB_QUEUE).start();
    users = [];
    for (const username of [
      'push_runtime_default',
      'push_runtime_other',
      'push_runtime_override',
    ]) {
      await app.get(IdentityCommands).createAdmin(username, 'runtime-password-long-enough');
      const user = AuthResponse.parse(
        (
          await request(base)
            .post('/api/v1/auth/login')
            .send({
              username,
              password: 'runtime-password-long-enough',
              device: {
                platform: 'web',
                name: 'runtime fixture',
                appVersion: 'test',
                timeZone: 'UTC',
              },
            })
            .expect(200)
        ).body,
      );
      users.push(user);
      await app.get(PushDeviceService).register(user.user.userId, user.session.sessionId, {
        kind: 'android',
        provider: 'jpush',
        token: `runtime-registration-${user.user.userId}`,
      });
    }
  }, 60000);
  afterAll(async () => {
    await worker?.close();
    if (!appClosed) await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  it('直接端口按免打扰拒绝主动来电；queued不能冒充accepted；厂商覆盖ID持久保存', async () => {
    const user = users[0]!;
    const send = app.get<PushService>(PUSH_PORT);
    const input = {
      userId: user.user.userId,
      kind: 'call' as const,
      title: '微伴',
      body: '来电',
      deepLink: '/me',
      conversationId: newId(),
      dedupeKey: 'runtime:call',
      dedupeWindowHours: 24,
      respectsDoNotDisturb: true,
    };
    expect(await send.send(input)).toEqual({ delivered: false, reason: 'do_not_disturb' });
    await request(base)
      .patch('/api/v1/me/notification-settings')
      .auth(user.session.token, { type: 'bearer' })
      .send({
        proactiveCallsEnabled: true,
        doNotDisturb: { enabled: true, start: '00:00', end: '00:00' },
      })
      .expect(200);
    expect(await send.send(input)).toEqual({ delivered: false, reason: 'do_not_disturb' });
    const accepted = {
      ...input,
      kind: 'system' as const,
      respectsDoNotDisturb: false,
      dedupeKey: 'runtime:accepted',
    };
    expect(await send.send(accepted)).toEqual({ delivered: true });
    expect(await send.send(accepted)).toEqual({ delivered: false, reason: 'deduplicated' });
    expect(await send.send({ ...accepted, dedupeKey: 'runtime:accepted-2' })).toEqual({
      delivered: true,
    });
    const latest = bodies.at(-1)! as {
      options: { override_msg_id?: number };
      notification: { android: { alert_type: number } };
    };
    expect(latest.options.override_msg_id).toBeDefined();
    expect(latest.notification.android.alert_type).toBe(0);
    const rows = await db.query<{ provider_message_id: string }>(
      "SELECT provider_message_id FROM push.deliveries WHERE status='delivered'",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.provider_message_id === '9223372036854775806')).toBe(true);
    fail = true;
    expect(await send.send({ ...accepted, dedupeKey: 'runtime:queued' })).toEqual({
      delivered: false,
    });
    fail = false;
  });
  it('平台默认、明确选择和角色覆盖筛选故障用户；恢复后旧事件不通知；故障24小时去重', async () => {
    const admin = users[0]!.user.userId;
    const upstream = await app.get(UpstreamService).create(admin, {
      name: 'notification fixture',
      kind: 'openai_compatible',
      baseUrl: 'https://fixture.invalid/v1',
      apiKey: 'sk-notification-fixture-secret',
    });
    const price = await app.get(PriceService).createDraft(admin, {
      versionLabel: 'push-runtime',
      note: null,
      items: ['push/default', 'push/other'].flatMap((modelKey) => [
        {
          modelKey,
          unit: 'input_tokens_per_million' as const,
          priceMicros: 1000,
          costMicros: 100,
          band: null,
        },
        {
          modelKey,
          unit: 'cached_input_tokens_per_million' as const,
          priceMicros: 1000,
          costMicros: 100,
          band: null,
        },
        {
          modelKey,
          unit: 'output_tokens_per_million' as const,
          priceMicros: 1000,
          costMicros: 100,
          band: null,
        },
      ]),
    });
    await app.get(PriceService).activate(admin, price.priceVersionId, null);
    for (const modelKey of ['push/default', 'push/other'])
      await app.get(CatalogService).upsert(admin, modelKey, {
        modelKey,
        displayName: 'fixture',
        vendorName: 'fixture',
        upstreamId: upstream.upstreamId,
        upstreamModelId: 'fixture',
        capabilities: [],
        tags: [],
        leaderboardRank: null,
        sortOrder: 0,
        defaultFor: modelKey === 'push/default' ? ['chat'] : [],
        enabled: true,
      });
    for (const user of users.slice(1))
      await request(base)
        .patch('/api/v1/model/selection')
        .auth(user.session.token, { type: 'bearer' })
        .send({ chat: { modelKey: 'push/other' } })
        .expect(200);
    // fixture仅替换角色资格端口；模型选择、事务、读取与通知规则均为真实实现。
    await request(base)
      .put(`/api/v1/model/character-overrides/${newId()}`)
      .auth(users[2]!.session.token, { type: 'bearer' })
      .send({ chat: { modelKey: 'push/default' } })
      .expect(200);
    const read = app.get<ModelNotificationReadPort>(MODEL_NOTIFICATION_READ_PORT);
    const ids = users.map((u) => u.user.userId);
    expect(await read.affectedUsers(ids, 'push/default')).toEqual([]);
    await app
      .get(UpstreamService)
      .reportStatus(upstream.upstreamId, 'unavailable', 'gateway', 'network_error');
    expect(new Set(await read.affectedUsers(ids, 'push/default'))).toEqual(
      new Set([ids[0], ids[2]]),
    );
    const notice = {
      eventId: newId(),
      modelKey: 'push/default',
      occurredAt: clock.now().toISOString(),
    };
    await app.get(PushLifecycle).modelNotice(notice);
    await app.get(PushLifecycle).modelNotice({ ...notice, eventId: newId() });
    const rows = await db.query<{ user_id: string }>(
      "SELECT user_id FROM push.requests WHERE kind='model_status'",
    );
    expect(new Set(rows.rows.map((r) => r.user_id))).toEqual(new Set([ids[0], ids[2]]));
    expect(rows.rows).toHaveLength(2);
    await app.get(UpstreamService).reportStatus(upstream.upstreamId, 'active', 'probe');
    expect(await read.affectedUsers(ids, 'push/default')).toEqual([]);
    const queued = await db.query<{ id: string }>(
      "SELECT id FROM push.deliveries WHERE request_id IN (SELECT id FROM push.requests WHERE kind='model_status')",
    );
    expect(queued.rows).toHaveLength(2);
    for (const row of queued.rows) await app.get(PushDeliveryEngine).run(row.id);
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM push.deliveries WHERE request_id IN (SELECT id FROM push.requests WHERE kind='model_status')",
        )
      ).rows.every((r) => r.status === 'cancelled'),
    ).toBe(true);
    await app.get(PushLifecycle).modelNotice({ ...notice, eventId: newId() });
    expect(
      (await db.query("SELECT id FROM push.requests WHERE kind='model_status'")).rows,
    ).toHaveLength(2);
  });
  it('默认模型下架保留事件用途，隐式用户仍能提醒；新的默认已选定则不发旧故障', async () => {
    const catalog = app.get(CatalogService);
    const model = (await catalog.adminList()).find((m) => m.modelKey === 'push/default')!;
    const { updatedAt: _updatedAt, ...body } = model;
    await catalog.upsert(users[0]!.user.userId, model.modelKey, {
      ...body,
      enabled: false,
      defaultFor: [],
    });
    const events = await db.query<{ event: unknown }>(
      "SELECT event FROM platform.outbox WHERE event_type='model_access.model_status_changed' AND event->'payload'->>'reason'='model_removed' ORDER BY created_at DESC LIMIT 1",
    );
    const event = Events.ModelStatusChanged.parse(events.rows[0]!.event);
    expect(event.payload.previousDefaultFor).toEqual(['chat']);
    const read = app.get<ModelNotificationReadPort>(MODEL_NOTIFICATION_READ_PORT);
    const ids = users.map((u) => u.user.userId);
    expect(
      new Set(
        await read.affectedUsers(ids, model.modelKey, undefined, event.payload.previousDefaultFor),
      ),
    ).toEqual(new Set([ids[0], ids[2]]));
    // 清除上一场景通知元数据，使实际下架事件能独立验证发送对象。
    await db.query(
      "DELETE FROM push.deliveries WHERE request_id IN (SELECT id FROM push.requests WHERE kind='model_status')",
    );
    await db.query("DELETE FROM push.requests WHERE kind='model_status'");
    await app.get(PushLifecycle).modelNotice({
      eventId: event.eventId,
      modelKey: event.payload.modelKey,
      occurredAt: event.occurredAt,
      previousDefaultFor: event.payload.previousDefaultFor,
    });
    expect(
      new Set(
        (
          await db.query<{ user_id: string }>(
            "SELECT user_id FROM push.requests WHERE kind='model_status'",
          )
        ).rows.map((r) => r.user_id),
      ),
    ).toEqual(new Set([ids[0], ids[2]]));
    const replacement = (await catalog.adminList()).find((m) => m.modelKey === 'push/other')!;
    const { updatedAt: _replacementUpdatedAt, ...replacementBody } = replacement;
    await catalog.upsert(users[0]!.user.userId, replacement.modelKey, {
      ...replacementBody,
      defaultFor: ['chat'],
    });
    expect(
      await read.affectedUsers(ids, model.modelKey, undefined, event.payload.previousDefaultFor),
    ).toEqual([ids[2]]);
  });
  it('info提升warning仅首次提醒，不被后续info降级', async () => {
    const service = app.get(AdminAlertService);
    const facts = {
      kind: 'platform_budget_warning' as const,
      dedupeKey: 'runtime:escalation',
      summary: '平台成本提醒',
    };
    const raise = (severity: 'info' | 'warning' | 'critical') =>
      db.transaction((tx) => service.raise(tx, { ...facts, severity }));
    expect((await raise('info')).shouldPush).toBe(false);
    expect((await raise('warning')).shouldPush).toBe(true);
    expect((await raise('critical')).shouldPush).toBe(false);
    const repeated = await raise('info');
    expect(repeated.shouldPush).toBe(false);
    expect(repeated.alert.severity).toBe('critical');
  });
  it('web退出后独立worker读取持久ID任务，真实HTTP厂商接收且重投不再发送', async () => {
    // 清掉本夹具前面故意失败的重试及故障提醒，给本项独立时延观测窗口。
    await db.query(
      "UPDATE push.deliveries SET status='cancelled',payload_ciphertext=NULL WHERE status='queued'",
    );
    const userId = users[1]!.user.userId;
    const store = app.get(PushRequestStore);
    const result = await db.transaction((tx) =>
      store.enqueue(tx, {
        userId,
        eventId: newId(),
        dedupeKey: 'runtime:worker',
        dedupeWindowHours: 0,
        notification: {
          v: 1,
          kind: 'system',
          title: '微伴',
          body: 'WORKER_PUSH_BODY_CANARY',
          deepLink: '/me',
          conversationId: null,
          collapseKey: 'runtime:worker',
          count: 1,
          sound: true,
          sentAt: clock.now().toISOString(),
        },
      }),
    );
    expect(result.ids).toHaveLength(1);
    await app.close();
    appClosed = true;
    const module = await builder('worker', true).compile();
    worker = await module.init();
    db = worker.get(DATABASE);
    const started = performance.now();
    await vi.waitFor(
      async () => {
        const [row] = (
          await db.query<{ status: string; accepted_at: Date; created_at: Date }>(
            'SELECT status,accepted_at,created_at FROM push.deliveries WHERE id=$1',
            [result.ids[0]],
          )
        ).rows;
        expect(row!.status).toBe('delivered');
        expect(row!.accepted_at.getTime() - row!.created_at.getTime()).toBeLessThan(2000);
      },
      { timeout: 10000, interval: 50 },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    // worker也会恢复此前持久化的模型告警；只按本条delivery的稳定通知ID验证重投。
    const receivedForDelivery = () =>
      bodies.filter((body) => {
        const notification = body.notification as {
          android: { extras: { weiban: { notificationId: string } } };
        };
        return notification.android.extras.weiban.notificationId === result.ids[0];
      });
    expect(receivedForDelivery()).toHaveLength(1);
    await worker.get(PushDeliveryEngine).run(result.ids[0]!);
    expect(receivedForDelivery()).toHaveLength(1);
    expect(logs.capture.text).not.toContain('WORKER_PUSH_BODY_CANARY');
    expect(logs.capture.text).not.toContain('fixture-secret');
  }, 30000);
});
