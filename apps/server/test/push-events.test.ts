import 'reflect-metadata';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AuthResponse,
  AdminCharacterWrite,
  CharacterCard,
  type ChatReadPort,
  type ChatAdminPort,
  type ChatParticipantPort,
} from '@weiban/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { PushModule } from '../src/modules/push/index.js';
import {
  PUSH_CHANNELS,
  PushDeviceService,
  PushDeliveryEngine,
  type PushEnvelope,
} from '../src/modules/push/testing.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import {
  CHAT_READ_PORT,
  CHAT_ADMIN_PORT,
  CHAT_PARTICIPANT_PORT,
} from '../src/modules/chat/index.js';
import { PresenceService } from '../src/modules/realtime/testing.js';
import {
  DATABASE,
  JOB_QUEUE,
  EVENT_DISPATCHER,
  TestClock,
  newId,
  type Database,
  type JobQueue,
  type EventDispatcher,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, testKekRing, captureLogger } from './support/fixtures.js';
describeDb('push真实聊天事件/隐私与会话', () => {
  let app: INestApplication;
  let db: Database;
  let base: string;
  const clock = new TestClock('2026-10-07T00:00:00Z');
  const logs = captureLogger();
  const pushed: PushEnvelope[] = [];
  const password = 'long-enough-test-password';
  const credential = { kind: 'android', provider: 'jpush', token: 'push-event-credential-canary' };
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
        send: async (_credential: unknown, envelope: PushEnvelope) => {
          pushed.push(envelope);
          return 'accepted';
        },
      })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          childFeaturesDetected: false,
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(DATABASE);
    await app.get<JobQueue>(JOB_QUEUE).start();
    await app.get(IdentityCommands).createAdmin('push_test_a', password);
    const auth = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            device: { platform: 'web', name: 'other device', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    await app.get(PushDeviceService).register(auth.user.userId, auth.session.sessionId, {
      ...credential,
      token: 'other-device-token-canary',
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  it('真实角色消息事件：三气泡合并、adult隐藏正文、前台不建通知、投递前已读/撤回/退出抑制', async () => {
    const auth = AuthResponse.parse(
      (
        await request(base)
          .post('/api/v1/auth/login')
          .send({
            username: 'push_test_a',
            password,
            device: { platform: 'web', name: 'chat app', appVersion: 'test', timeZone: 'UTC' },
          })
          .expect(200)
      ).body,
    );
    await app.get(PushDeviceService).register(auth.user.userId, auth.session.sessionId, credential);
    const sample = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
        'utf8',
      ).match(/```json\s*([\s\S]*?)```/)![1]!,
    );
    const characters = app.get(CharacterService);
    const draft = await characters.create(
      auth.user.userId,
      AdminCharacterWrite.parse({
        name: '推送角色',
        tagline: '测试',
        intro: '原创成年角色',
        categoryId: 'original',
        birthday: '2000-01-02',
        fanName: null,
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好，很高兴见到你'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: draft.characterId, adminId: auth.user.userId, revision: 1 });
    const role = await characters.publish(auth.user.userId, draft.characterId);
    const contacts = app.get(ContactsCommands);
    await contacts.add(auth.user.userId, { characterId: role.characterId, greeting: '你好' });
    const pending = (await new ContactsTestQueries(db).row(auth.user.userId, role.characterId))!;
    clock.advance(pending.accept_after.getTime() - clock.nowMs());
    await contacts.accept({
      userId: auth.user.userId,
      characterId: role.characterId,
      requestId: pending.request_id,
    });
    const chat = app.get<ChatReadPort>(CHAT_READ_PORT);
    const conversation = (await chat.findDirectConversation(auth.user.userId, role.characterId))!;
    const cid = conversation.conversationId;
    const participant = conversation.participants.find((p) => p.kind === 'character')!;
    const writer = app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT);
    const post = async (text: string) => {
      const result = await writer.postMessage({
        conversationId: cid,
        senderParticipantId: participant.participantId,
        content: { type: 'text', text },
        idempotencyKey: `notify:${newId()}`,
      });
      if (!result.ok) throw Error(result.error);
      return result.value;
    };
    const drain = async () => {
      for (let i = 0; i < 20; i++) {
        const result = await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200);
        expect(result.failed).toBe(0);
        if (!result.claimed) return;
      }
      throw Error('outbox did not settle');
    };
    const queued = async () =>
      (
        await db.query<{ id: string; count: number }>(
          "SELECT d.id,d.count FROM push.deliveries d JOIN push.requests r ON r.id=d.request_id WHERE r.conversation_id=$1 AND d.status='queued'",
          [cid],
        )
      ).rows;
    await drain();
    await post('第一句');
    await post('第二句');
    await post('第三句');
    await drain();
    const merged = await queued();
    expect(merged).toHaveLength(2);
    expect(merged.every((r) => r.count === 3)).toBe(true);
    const before = pushed.length;
    for (const row of merged) await app.get(PushDeliveryEngine).run(row.id);
    expect(
      pushed
        .slice(before)
        .every((e) => e.title === '推送角色' && e.body === '推送角色 发来 3 条消息'),
    ).toBe(true);
    expect(
      (
        await app
          .get<ChatAdminPort>(CHAT_ADMIN_PORT)
          .setContentScope({ conversationId: cid, scope: 'adult' })
      ).ok,
    ).toBe(true);
    await post('成人消息推送正文金丝雀');
    await drain();
    for (const row of await queued()) await app.get(PushDeliveryEngine).run(row.id);
    expect(pushed.at(-1)!.body).not.toContain('成人消息');
    await app
      .get<ChatAdminPort>(CHAT_ADMIN_PORT)
      .setContentScope({ conversationId: cid, scope: 'normal' });
    const presence = app.get(PresenceService);
    const connectionId = newId();
    await presence.connect(auth.user.userId, auth.session.sessionId, connectionId);
    await presence.focus(auth.user.userId, auth.session.sessionId, connectionId, {
      v: 1,
      type: 'presence.focus',
      data: { conversationId: cid, foreground: true },
    });
    await post('前台查看不提醒');
    await drain();
    expect(await queued()).toHaveLength(0);
    await presence.disconnect(connectionId);
    const read = await post('之后已读不提醒');
    await drain();
    const readPending = await queued();
    await request(base)
      .post(`/api/v1/conversations/${cid}/read`)
      .auth(auth.session.token, { type: 'bearer' })
      .send({ readSeq: read.seq })
      .expect(204);
    const checkpoint = pushed.length;
    for (const row of readPending) await app.get(PushDeliveryEngine).run(row.id);
    expect(pushed).toHaveLength(checkpoint);
    const recalled = await post('撤回后不提醒');
    await drain();
    const recalledPending = await queued();
    expect(
      (
        await writer.recall({
          conversationId: cid,
          participantId: participant.participantId,
          messageId: recalled.messageId,
        })
      ).ok,
    ).toBe(true);
    for (const row of recalledPending) await app.get(PushDeliveryEngine).run(row.id);
    expect(pushed).toHaveLength(checkpoint);
    await post('退出后不提醒');
    await drain();
    const logoutPending = await queued();
    await request(base)
      .post('/api/v1/auth/logout')
      .auth(auth.session.token, { type: 'bearer' })
      .expect(204);
    await drain();
    for (const row of logoutPending) await app.get(PushDeliveryEngine).run(row.id);
    // 另一台有效会话仍可收到；已退出的这台必须取消，凭证已移除。
    expect(pushed.slice(checkpoint)).toHaveLength(1);
    expect(
      pushed.slice(checkpoint).every((e) => e.recipientSessionId !== auth.session.sessionId),
    ).toBe(true);
    expect(
      (await db.query('SELECT 1 FROM push.devices WHERE session_id=$1', [auth.session.sessionId]))
        .rows,
    ).toHaveLength(0);
  });
});
