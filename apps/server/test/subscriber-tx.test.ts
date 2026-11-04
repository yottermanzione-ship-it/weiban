/**
 * T-20261104f 回归：事件订阅者在自己的事务里先写会话行、再经 ChatReadPort 读同一会话，传事务后不会卡。
 *
 * 2026-11-04 事故同类：订阅者事务写聊天消息时锁住会话行，随后不传 tx 调端口读同一会话 → 端口另开连接
 * `SELECT … FOR SHARE/UPDATE` 同一行，外层等内层、内层等外层，要等 lock_timeout（10 秒）才报错、事件重投。
 * 契约 5.7 起 ChatReadPort 全部读方法接受可选 tx：传了就在调用方事务里读，毫秒级完成。
 *
 * 同时把真实订阅者（ai-runtime / growth / proactive / official 等）跑一遍：用户发一条私聊消息，
 * 所有 chat.message_created 订阅者都要在超时内处理成功（收件箱里都有记录）。
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  CharacterCard,
  type ChatAdminPort,
  type ChatReadPort,
  type ChatUserPort,
  type Conversation,
  type Message,
  type ModelGatewayPort,
  type Participant,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  EVENT_BUS,
  EVENT_DISPATCHER,
  JOB_QUEUE,
  TestClock,
  newId,
  type Database,
  type EventBus,
  type EventDispatcher,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { CHAT_ADMIN_PORT, CHAT_READ_PORT, CHAT_USER_PORT } from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

/** 远小于 lock_timeout（10 秒）：超过就说明订阅者又在事务里另开连接等会话行锁了。 */
const FAST_MS = 5_000;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('事件分发卡住：疑似订阅者事务内另开连接锁同一会话行')),
          20_000,
        );
      }),
    ]);
    return { value, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ProbeResult {
  eventId: string;
  conversation: Conversation | null;
  participants: Participant[];
  direct: Conversation | null;
  official: Conversation | null;
  messages: Message[];
  message: Message | null;
}

describeDb('事件订阅者事务内写会话后经端口读同一会话不卡（真实 PG）', () => {
  let app: INestApplication;
  let db: Database;
  let chatRead: ChatReadPort;
  let characterId: string;
  let userId: string;
  let conversationId: string;
  const probes: ProbeResult[] = [];
  const clock = new TestClock('2026-11-04T03:00:00Z');
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw Error('unused');
    },
    // 订阅者只投递任务，不在分发器事务里调模型
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
    // 订阅者在同一事务里投递 pg-boss 任务
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    chatRead = app.get<ChatReadPort>(CHAT_READ_PORT);

    const identity = app.get(IdentityCommands);
    const adminId = await identity.createAdmin('subtx_admin', 'horse battery staple');
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
        name: '订阅事务测试',
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

    const username = `subtx_${newId().replaceAll('-', '').slice(-16)}`;
    userId = await identity.createAdmin(username, 'horse battery staple');
    await identity.setRole(username, 'user');
    const contacts = app.get(ContactsCommands);
    await contacts.add(userId, { characterId, greeting: '你好' });
    const contact = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(Math.max(0, contact.accept_after.getTime() - clock.nowMs()));
    await contacts.accept({ userId, characterId, requestId: contact.request_id });
    conversationId = (await chatRead.findDirectConversation(userId, characterId))!.conversationId;

    // 测试订阅者：先写会话行（系统提示 = 推进 lastSeq、锁住会话行），再经端口传 tx 读同一会话
    const chatAdmin = app.get<ChatAdminPort>(CHAT_ADMIN_PORT);
    app.get<EventBus>(EVENT_BUS).subscribe({
      consumer: 'test.tx_write_then_read',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationId !== conversationId || p.senderKind !== 'user') return;
        await chatAdmin.postSystemMessage(tx, {
          conversationId: p.conversationId,
          code: 'tx_probe',
          idempotencyKey: `test:tx_probe:${p.messageId}`,
        });
        probes.push({
          eventId: event.eventId,
          conversation: await chatRead.getConversation(p.conversationId, tx),
          participants: await chatRead.getParticipants(p.conversationId, tx),
          direct: await chatRead.findDirectConversation(userId, characterId, tx),
          official: await chatRead.findOfficialConversation(userId, tx),
          messages: await chatRead.readMessages(
            { conversationId: p.conversationId, scopes: ['normal'], limit: 20 },
            tx,
          ),
          message: await chatRead.getMessage(p.messageId, ['normal'], tx),
        });
      },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  async function dispatchAll() {
    const dispatcher = app.get<EventDispatcher>(EVENT_DISPATCHER);
    let failed = 0;
    for (let i = 0; i < 20; i++) {
      const summary = await dispatcher.dispatchOnce(200);
      failed += summary.failed + summary.dead;
      if (summary.claimed === 0) return { failed };
    }
    throw Error('event backlog');
  }

  it('订阅者写会话后传 tx 读同一会话：毫秒级完成，读到本事务刚写的内容；所有消息订阅者都处理成功', async () => {
    // 先把加好友等事件处理完，只计量用户这条消息的分发
    await dispatchAll();
    const ack = await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, conversationId, {
      clientMsgId: newId(),
      content: { type: 'text', text: '在吗，今天好累' },
    });

    const { value, ms } = await timed(dispatchAll);
    expect(value.failed).toBe(0);
    expect(ms).toBeLessThan(FAST_MS);

    expect(probes).toHaveLength(1);
    const probe = probes[0]!;
    expect(probe.conversation?.conversationId).toBe(conversationId);
    expect(probe.direct?.conversationId).toBe(conversationId);
    expect(probe.participants.map((p) => p.kind).sort()).toEqual(['character', 'user']);
    expect(probe.message?.messageId).toBe(ack.message.messageId);
    // 同一事务里刚写的系统提示读得到（不传 tx 另开连接时读不到未提交的行）
    expect(
      probe.messages.some((m) => m.content?.type === 'system' && m.content.code === 'tx_probe'),
    ).toBe(true);

    // 不传 tx 的读法照旧（5.6 行为）：结果与事务内一致
    expect((await chatRead.getConversation(conversationId))?.conversationId).toBe(conversationId);
    expect(
      (await chatRead.getParticipants(conversationId)).map((p) => p.participantId).sort(),
    ).toEqual(probe.participants.map((p) => p.participantId).sort());
    expect((await chatRead.findDirectConversation(userId, characterId))?.conversationId).toBe(
      conversationId,
    );
    expect((await chatRead.findOfficialConversation(userId))?.conversationId ?? null).toBe(
      probe.official?.conversationId ?? null,
    );
    expect((await chatRead.getMessage(ack.message.messageId, ['normal']))?.messageId).toBe(
      ack.message.messageId,
    );

    // 这条用户消息的全部订阅者（含本次改为传 tx 的 ai / growth / proactive / official）都已处理成功
    const registered = app
      .get<EventBus>(EVENT_BUS)
      .subscribersOf('chat.message_created')
      .map((s) => s.consumer);
    expect(registered).toEqual(
      expect.arrayContaining([
        'ai.memory_on_message',
        'ai.on_user_message',
        'ai.quiet_state',
        'ai.ecology_user_request',
        'ai.card_on_user_message',
        'ai.group_invite_intent',
        'ai.group_on_user_message',
        'proactive.on_user_message',
        'growth.familiarity_on_user_message',
      ]),
    );
    const processed = (
      await db.query<{ consumer: string }>(
        `SELECT consumer FROM platform.event_inbox WHERE event_id = $1`,
        [probe.eventId],
      )
    ).rows.map((r) => r.consumer);
    expect(processed.sort()).toEqual([...registered].sort());
  }, 60_000);
});
