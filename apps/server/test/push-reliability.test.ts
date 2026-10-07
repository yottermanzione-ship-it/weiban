import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { AuthResponse } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { PushModule } from '../src/modules/push/index.js';
import {
  PUSH_CHANNELS,
  PushDeviceService,
  PushDeliveryEngine,
  PushRequestStore,
  type ChannelResult,
  type PushEnvelope,
} from '../src/modules/push/testing.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  newId,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, testKekRing, captureLogger } from './support/fixtures.js';
describeDb('push持久重试、换绑、失效与物理清除', () => {
  let app: INestApplication;
  let db: Database;
  let store: PushRequestStore;
  let a: AuthResponse;
  let b: AuthResponse;
  let base: string;
  const clock = new TestClock('2026-10-07T08:00:00Z');
  const password = 'test-password-long-enough';
  const credential = { kind: 'android', provider: 'jpush', token: 'RETRY_DEVICE_PRIVATE_CANARY' };
  const calls: PushEnvelope[] = [];
  let result: ChannelResult = 'temporary_failure';
  const logs = captureLogger();
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
      .useValue({
        publicKey: () => null,
        validate: () => undefined,
        send: async (_device: unknown, envelope: PushEnvelope) => {
          calls.push(envelope);
          return result;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(DATABASE);
    store = app.get(PushRequestStore);
    await app.get<JobQueue>(JOB_QUEUE).start();
    const commands = app.get(IdentityCommands);
    await commands.createAdmin('push_retry_a', password);
    await commands.createAdmin('push_retry_b', password);
    const login = async (username: string) =>
      AuthResponse.parse(
        (
          await request(base)
            .post('/api/v1/auth/login')
            .send({
              username,
              password,
              device: { platform: 'web', name: 'retry test', appVersion: 'test', timeZone: 'UTC' },
            })
            .expect(200)
        ).body,
      );
    a = await login('push_retry_a');
    b = await login('push_retry_b');
    await app.get(PushDeviceService).register(a.user.userId, a.session.sessionId, credential);
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  const enqueue = async (userId = a.user.userId) =>
    db.transaction((tx) =>
      store.enqueue(tx, {
        userId,
        eventId: newId(),
        dedupeKey: `system:${newId()}`,
        dedupeWindowHours: 0,
        notification: {
          v: 1,
          kind: 'system',
          collapseKey: `case:${newId()}`,
          title: '微伴',
          body: 'RETRY_NOTIFICATION_PRIVATE_CANARY',
          count: 1,
          deepLink: '/me',
          conversationId: null,
          sound: true,
          sentAt: clock.now().toISOString(),
        },
      }),
    );
  const row = async (id: string) =>
    (
      await db.query<{
        status: string;
        attempts: number;
        due_at: Date;
        payload_ciphertext: Buffer | null;
        request_id: string;
      }>(
        'SELECT status,attempts,due_at,payload_ciphertext,request_id FROM push.deliveries WHERE id=$1',
        [id],
      )
    ).rows[0]!;
  it('临时失败持久退避重试三次后结束，同一notificationId，早到任务不调用通道', async () => {
    const id = (await enqueue()).ids[0]!;
    const before = calls.length;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await app.get(PushDeliveryEngine).run(id);
      const state = await row(id);
      expect(state.attempts).toBe(attempt);
      if (attempt < 4) {
        expect(state.status).toBe('queued');
        expect(state.payload_ciphertext).not.toBeNull();
        await app.get(PushDeliveryEngine).run(id);
        expect(calls.length - before).toBe(attempt);
        clock.advance(state.due_at.getTime() - clock.nowMs());
      } else {
        expect(state.status).toBe('failed');
        expect(state.payload_ciphertext).toBeNull();
      }
    }
    expect(calls.length - before).toBe(4);
    expect(new Set(calls.slice(before).map((c) => c.notificationId)).size).toBe(1);
    expect(
      (
        await db.query(
          'SELECT 1 FROM push.requests WHERE id=$1 AND payload_ciphertext IS NOT NULL',
          [(await row(id)).request_id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('无效凭证删除绑定、取消其他待投递并清密文；新会话重绑旧任务不串账号', async () => {
    const invalid = (await enqueue()).ids[0]!;
    const another = (await enqueue()).ids[0]!;
    result = 'invalid_device';
    await app.get(PushDeliveryEngine).run(invalid);
    expect(
      (await db.query('SELECT 1 FROM push.devices WHERE user_id=$1', [a.user.userId])).rows,
    ).toHaveLength(0);
    expect((await row(another)).status).toBe('cancelled');
    expect((await row(another)).payload_ciphertext).toBeNull();
    await app.get(PushDeviceService).register(a.user.userId, a.session.sessionId, credential);
    const stale = (await enqueue()).ids[0]!;
    await app.get(PushDeviceService).register(b.user.userId, b.session.sessionId, credential);
    const before = calls.length;
    result = 'accepted';
    await app.get(PushDeliveryEngine).run(stale);
    expect(calls).toHaveLength(before);
    expect((await row(stale)).status).toBe('cancelled');
  });
  it('注销状态拒绝迟到创建，模块重复清除后零残留；90天投递日志清理', async () => {
    await request(base)
      .delete('/api/v1/me')
      .auth(a.session.token, { type: 'bearer' })
      .send({ password, confirm: 'DELETE' })
      .expect(202);
    const late = await enqueue();
    expect(late.ids).toHaveLength(0);
    await expect(
      app.get(PushDeviceService).register(a.user.userId, a.session.sessionId, credential),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await store.purgeUser(a.user.userId)).toBeGreaterThan(0);
    expect(await store.countUserData(a.user.userId)).toBe(0);
    expect(await store.purgeUser(a.user.userId)).toBe(0);
    const pending = (await enqueue(b.user.userId)).ids[0]!;
    clock.advance(91 * 24 * 60 * 60 * 1000);
    await store.prune();
    expect(
      (await db.query('SELECT 1 FROM push.deliveries WHERE id=$1', [pending])).rows,
    ).toHaveLength(0);
    expect(logs.capture.text).not.toContain('RETRY_NOTIFICATION_PRIVATE_CANARY');
    expect(logs.capture.text).not.toContain(credential.token);
  });
});
