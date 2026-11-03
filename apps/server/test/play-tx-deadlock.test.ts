/**
 * T-20261104c 回归：在一个事务里发聊天消息 / 玩法系统提示，不能再另开连接去锁同一会话行。
 *
 * 2026-11-04 事故：寄信事务先写了私聊消息（锁住会话行），随后 postPlayNotice 用另一条连接
 * `SELECT … FOR SHARE` 同一行 → 外层等内层、内层等外层，数据库看不出来，连接池耗尽、整站 500。
 * 同类：心愿打勾发瞬间卡（卡片系统提示先写私聊）后再发完成提示；官方会话 ensure 锁住会话行后另开连接读消息。
 *
 * 修复后这些请求毫秒级完成、提示都写进了私聊。没修时：寄信 / 心愿要等 lock_timeout（10 秒）才放行且提示丢失，
 * 官方会话第二次 ensure 等锁超时报 500（没有 lock_timeout 时永远卡住）。
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  type ChatReadPort,
  type ModelGatewayPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  newId,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { CHAT_READ_PORT } from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

/** 远小于 lock_timeout（10 秒）：超过就说明又在事务里另开连接等锁了。 */
const FAST_MS = 5_000;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('请求卡住：疑似事务内另开连接锁同一会话行')),
          20_000,
        );
      }),
    ]);
    return { value, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describeDb('事务内发聊天消息 / 玩法提示不卡死（真实 HTTP + PG）', () => {
  let app: INestApplication;
  let db: Database;
  let characterId: string;
  let userId: string;
  let token: string;
  let conversationId: string;
  const clock = new TestClock('2026-11-04T02:00:00Z');
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw Error('unused');
    },
    // 卡片文案、问候等都走模板，不调用外部模型
    generateText: async () => ({ ok: false, error: 'provider_unavailable' }),
  };

  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
          childFeaturesDetected: false,
        }),
      })
      .overrideProvider(MODEL_GATEWAY_PORT)
      .useValue(gateway)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    // 寄信要在同一事务里投递回信任务（pg-boss）
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);

    const identity = app.get(IdentityCommands);
    const adminId = await identity.createAdmin('txfix_admin', 'horse battery staple');
    const sample = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
        'utf8',
      ).match(/```json\s*([\s\S]*?)```/)![1]!,
    );
    const service = app.get(CharacterService);
    const draft = await service.create(
      adminId,
      AdminCharacterWrite.parse({
        name: '寄信测试',
        tagline: '测试',
        intro: '原创成年',
        categoryId: 'original',
        birthday: null,
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
        fallbackGreetings: ['你好呀'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: draft.characterId, adminId, revision: 1 });
    characterId = (await service.publish(adminId, draft.characterId)).characterId;

    const username = `txfix_${newId().replaceAll('-', '').slice(-16)}`;
    userId = await identity.createAdmin(username, 'horse battery staple');
    await identity.setRole(username, 'user');
    const auth = AuthResponse.parse(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            username,
            password: 'horse battery staple',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'tx deadlock test',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    );
    token = auth.session.token;
    const contacts = app.get(ContactsCommands);
    await contacts.add(userId, { characterId, greeting: '你好' });
    const contact = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(Math.max(0, contact.accept_after.getTime() - clock.nowMs()));
    await contacts.accept({ userId, characterId, requestId: contact.request_id });
    conversationId = (await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .findDirectConversation(userId, characterId))!.conversationId;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  const systemKeys = async (prefix: string) =>
    (
      await db.query<{ client_msg_id: string }>(
        `SELECT client_msg_id FROM chat.messages
          WHERE conversation_id = $1 AND sender_kind = 'system' AND client_msg_id LIKE $2`,
        [conversationId, `${prefix}%`],
      )
    ).rows.map((r) => r.client_msg_id);

  it('寄信：信件消息 + 「信已寄出」提示在同一事务里写完，不卡住', async () => {
    const { value: res, ms } = await timed(() =>
      request(app.getHttpServer())
        .post('/api/v1/play/letters')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientRequestId: newId(), characterId, body: '见字如面，今天想给你写封信。' }),
    );
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(FAST_MS);
    const letterId = (res.body as { letter: { letterId: string; messageId: string | null } }).letter
      .letterId;
    expect((res.body as { letter: { messageId: string | null } }).letter.messageId).toBeTruthy();
    expect(await systemKeys(`play:letter_sent:${letterId}`)).toHaveLength(1);
  });

  it('心愿打勾：发瞬间卡（卡片提示先写私聊）后再发完成提示，不卡住', async () => {
    const added = await request(app.getHttpServer())
      .post(`/api/v1/play/wishlists/${characterId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ clientRequestId: newId(), text: '一起看一次日出' })
      .expect(200);
    const itemId = (added.body as { itemId: string }).itemId;
    const { value: res, ms } = await timed(() =>
      request(app.getHttpServer())
        .patch(`/api/v1/play/wishlist-items/${itemId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ completed: true }),
    );
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(FAST_MS);
    // 两条系统提示都在：瞬间卡（growth）与心愿完成（play）
    expect(await systemKeys('growth:card:')).not.toHaveLength(0);
    expect(await systemKeys(`play:wishlist_item_completed:${itemId}:`)).toHaveLength(1);
  });

  it('官方会话 ensure：首次创建发欢迎语；已有会话再次 ensure 不卡住', async () => {
    const ensure = () =>
      request(app.getHttpServer())
        .post('/api/v1/official-assistant/conversation')
        .set('Authorization', `Bearer ${token}`);
    const first = await timed(ensure);
    expect(first.value.status).toBe(200);
    expect(first.ms).toBeLessThan(FAST_MS);
    const officialId = (first.value.body as { conversationId: string }).conversationId;
    const welcome = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chat.messages
        WHERE conversation_id = $1 AND sender_kind = 'official'`,
      [officialId],
    );
    expect(Number(welcome.rows[0]!.n)).toBe(1);
    const second = await timed(ensure);
    expect(second.value.status).toBe(200);
    expect(second.ms).toBeLessThan(FAST_MS);
    expect((second.value.body as { conversationId: string }).conversationId).toBe(officialId);
  });
});
