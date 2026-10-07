import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthResponse, PushDevice, type IdentitySessionReadPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { PushModule } from '../src/modules/push/index.js';
import {
  PUSH_CHANNELS,
  AdminAlertService,
  PushRequestStore,
  PushDeliveryEngine,
  type PushEnvelope,
  type ChannelResult,
  PushDeviceService,
  type PushChannelPort,
} from '../src/modules/push/testing.js';
import { IDENTITY_SESSION_READ_PORT, IdentityCommands } from '../src/modules/identity/index.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  TestClock,
  type Database,
  type EnvelopeCrypto,
  type JobQueue,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('push设备真实PG/HTTP：会话、加密、幂等与跨账号重绑', () => {
  let app: INestApplication;
  let db: Database;
  let base: string;
  let a: AuthResponse;
  let b: AuthResponse;
  const clock = new TestClock('2026-10-07T00:00:00Z');
  const logs = captureLogger();
  const pushed: PushEnvelope[] = [];
  const channelResult: ChannelResult = 'accepted';
  const channels: PushChannelPort = {
    publicKey: () => null,
    validate: () => undefined,
    send: async (_credential, envelope) => {
      pushed.push(envelope);
      return channelResult;
    },
  };
  const credential = {
    kind: 'android',
    provider: 'jpush',
    token: 'push-device-secret-canary-abcdefgh',
  };
  const password = 'long-enough-test-password';
  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ APP_ROLE: 'web' });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
        PushModule,
      ],
    })
      .overrideProvider(PUSH_CHANNELS)
      .useValue(channels)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(DATABASE);
    await app.get<JobQueue>(JOB_QUEUE).start();
    const commands = app.get(IdentityCommands);
    await commands.createAdmin('push_test_a', password);
    await commands.createAdmin('push_test_b', password);
    const login = async (username: string) =>
      AuthResponse.parse(
        (
          await request(base)
            .post('/api/v1/auth/login')
            .send({
              username,
              password,
              device: {
                platform: 'web',
                name: 'push test',
                appVersion: 'test',
                timeZone: 'Asia/Shanghai',
              },
            })
            .expect(200)
        ).body,
      );
    a = await login('push_test_a');
    b = await login('push_test_b');
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  const register = async (auth: AuthResponse) =>
    PushDevice.parse(
      (
        await request(base)
          .post('/api/v1/push/devices')
          .auth(auth.session.token, { type: 'bearer' })
          .send(credential)
          .expect(201)
      ).body,
    );
  it('未配置公钥503；未登录401；设备凭证DEK密文、同会话十并发登记幂等', async () => {
    await request(base)
      .get('/api/v1/push/vapid-public-key')
      .auth(a.session.token, { type: 'bearer' })
      .expect(503);
    await request(base).post('/api/v1/push/devices').send(credential).expect(401);
    const devices = await Promise.all(Array.from({ length: 10 }, () => register(a)));
    expect(new Set(devices.map((d) => d.pushDeviceId)).size).toBe(1);
    const rows = await db.query<{ credential_ciphertext: Buffer }>(
      'SELECT credential_ciphertext FROM push.devices',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.credential_ciphertext.toString()).not.toContain(credential.token);
    const plain = await app
      .get<EnvelopeCrypto>(ENVELOPE_CRYPTO)
      .open(
        a.user.userId,
        `push:device:${devices[0]!.pushDeviceId}`,
        rows.rows[0]!.credential_ciphertext,
      );
    try {
      expect(JSON.parse(plain.toString())).toEqual(credential);
    } finally {
      plain.fill(0);
    }
    expect(logs.capture.text).not.toContain(credential.token);
  });
  it('跨账号重绑只保留新会话；旧账号删除不能删除新绑定，旧DEK不能打开新密文', async () => {
    const old = await register(a);
    const current = await register(b);
    expect(current.pushDeviceId).toBe(old.pushDeviceId);
    await request(base)
      .delete(`/api/v1/push/devices/${current.pushDeviceId}`)
      .auth(a.session.token, { type: 'bearer' })
      .expect(204);
    const row = (
      await db.query<{ user_id: string; credential_ciphertext: Buffer }>(
        'SELECT user_id,credential_ciphertext FROM push.devices WHERE id=$1',
        [current.pushDeviceId],
      )
    ).rows[0]!;
    expect(row.user_id).toBe(b.user.userId);
    await expect(
      app
        .get<EnvelopeCrypto>(ENVELOPE_CRYPTO)
        .open(a.user.userId, `push:device:${current.pushDeviceId}`, row.credential_ciphertext),
    ).rejects.toThrow();
  });
  it('注销/过期会话不能登记；普通会话读端口不接受管理会话', async () => {
    const sessions = app.get<IdentitySessionReadPort>(IDENTITY_SESSION_READ_PORT);
    expect(await sessions.isActiveAppSession(a.user.userId, a.session.sessionId)).toBe(true);
    const adminLogin = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            kind: 'admin',
            device: { platform: 'web', name: 'admin', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    expect(await sessions.isActiveAppSession(a.user.userId, adminLogin.session.sessionId)).toBe(
      false,
    );
    await request(base)
      .post('/api/v1/auth/logout')
      .auth(a.session.token, { type: 'bearer' })
      .expect(204);
    expect(await sessions.isActiveAppSession(a.user.userId, a.session.sessionId)).toBe(false);
    await expect(
      app.get(PushDeviceService).register(a.user.userId, a.session.sessionId, credential),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    clock.advance(91 * 24 * 60 * 60 * 1000);
    expect(await sessions.isActiveAppSession(b.user.userId, b.session.sessionId)).toBe(false);
  });
  it('管理员提醒并发合并、普通会话拒绝、ack幂等、再次发生新建及90天保留', async () => {
    const alerts = app.get(AdminAlertService);
    const facts = {
      kind: 'platform_budget_warning' as const,
      severity: 'warning' as const,
      dedupeKey: 'budget:2026-10-07',
      summary: '平台今日成本达到提醒线',
    };
    const raised = await Promise.all(
      Array.from({ length: 20 }, () => db.transaction((tx) => alerts.raise(tx, facts))),
    );
    expect(new Set(raised.map((r) => r.alert.alertId)).size).toBe(1);
    expect(raised.filter((r) => r.first)).toHaveLength(1);
    const login = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            kind: 'admin',
            device: { platform: 'web', name: 'admin', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    const adminToken = login.session.token;
    await request(base).get('/api/v1/admin/alerts').expect(401);
    const appLogin = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            device: { platform: 'web', name: 'app', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    await request(base)
      .get('/api/v1/admin/alerts')
      .auth(appLogin.session.token, { type: 'bearer' })
      .expect(403);
    const list = (
      await request(base)
        .get('/api/v1/admin/alerts')
        .auth(adminToken, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(list.openCount).toBe(1);
    expect(list.items[0].occurrences).toBe(20);
    const id = list.items[0].alertId;
    const ack = (
      await request(base)
        .post(`/api/v1/admin/alerts/${id}/acknowledge`)
        .auth(adminToken, { type: 'bearer' })
        .expect(201)
    ).body;
    const again = (
      await request(base)
        .post(`/api/v1/admin/alerts/${id}/acknowledge`)
        .auth(adminToken, { type: 'bearer' })
        .expect(201)
    ).body;
    expect(again).toEqual(ack);
    expect(ack.acknowledgedByUserId).toBe(a.user.userId);
    const fresh = await db.transaction((tx) => alerts.raise(tx, facts));
    expect(fresh.first).toBe(true);
    expect(fresh.alert.alertId).not.toBe(id);
    const page = (
      await request(base)
        .get('/api/v1/admin/alerts?status=all&limit=1')
        .auth(adminToken, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.openCount).toBe(1);
    const second = (
      await request(base)
        .get('/api/v1/admin/alerts')
        .query({ status: 'all', limit: 1, cursor: page.nextCursor })
        .auth(adminToken, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(second.items).toHaveLength(1);
    expect(second.items[0].alertId).not.toBe(page.items[0].alertId);
    await request(base)
      .get('/api/v1/admin/alerts?cursor=invalid')
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    clock.advance(91 * 24 * 60 * 60 * 1000);
    expect((await alerts.list({ status: 'all' })).items).toHaveLength(0);
    await alerts.prune();
    expect((await db.query('SELECT 1 FROM push.admin_alerts')).rows).toHaveLength(0);
  });
  it('持久多设备投递、同事件和24小时去重、最后一台完成清共享密文；回调没有凭证正文日志', async () => {
    const auth = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            device: { platform: 'web', name: 'new app', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    const devices = app.get(PushDeviceService);
    await devices.register(auth.user.userId, auth.session.sessionId, credential);
    await devices.register(auth.user.userId, auth.session.sessionId, {
      ...credential,
      token: 'second-device-secret-canary',
    });
    const store = app.get(PushRequestStore);
    const notification = {
      v: 1 as const,
      kind: 'system' as const,
      collapseKey: 'system:test',
      title: '微伴',
      body: '通知正文金丝雀',
      count: 1,
      deepLink: '/me',
      conversationId: null,
      sound: true,
      sentAt: clock.now().toISOString(),
    };
    const input = {
      userId: auth.user.userId,
      eventId: newId(),
      dedupeKey: 'system:test',
      dedupeWindowHours: 24,
      notification,
    };
    const queued = await db.transaction((tx) => store.enqueue(tx, input));
    expect(queued.ids).toHaveLength(2);
    const raw = await db.query<{ payload_ciphertext: Buffer }>(
      'SELECT payload_ciphertext FROM push.requests WHERE user_id=$1',
      [auth.user.userId],
    );
    expect(raw.rows[0]!.payload_ciphertext.toString()).not.toContain('金丝雀');
    expect((await db.transaction((tx) => store.enqueue(tx, input))).reason).toBe('deduplicated');
    expect(
      (await db.transaction((tx) => store.enqueue(tx, { ...input, eventId: newId() }))).reason,
    ).toBe('deduplicated');
    const before = pushed.length;
    await Promise.all(queued.ids.map((id) => app.get(PushDeliveryEngine).run(id)));
    expect(pushed.length - before).toBe(2);
    for (const envelope of pushed.slice(before)) {
      expect(envelope.recipientUserId).toBe(auth.user.userId);
      expect(envelope.recipientSessionId).toBe(auth.session.sessionId);
      expect(envelope.body).toBe('通知正文金丝雀');
    }
    const finished = await db.query<{
      status: string;
      payload_ciphertext: Buffer | null;
      accepted_at: Date;
    }>(
      'SELECT status,payload_ciphertext,accepted_at FROM push.deliveries WHERE id=ANY($1::uuid[])',
      [queued.ids],
    );
    expect(
      finished.rows.every(
        (row) => row.status === 'delivered' && row.payload_ciphertext === null && !!row.accepted_at,
      ),
    ).toBe(true);
    expect(
      (
        await db.query(
          'SELECT 1 FROM push.requests WHERE user_id=$1 AND payload_ciphertext IS NOT NULL',
          [auth.user.userId],
        )
      ).rows,
    ).toHaveLength(0);
    for (const id of queued.ids) await app.get(PushDeliveryEngine).run(id);
    expect(pushed.length - before).toBe(2);
    expect(logs.capture.text).not.toContain('通知正文金丝雀');
    expect(logs.capture.text).not.toContain(credential.token);
  });
});
