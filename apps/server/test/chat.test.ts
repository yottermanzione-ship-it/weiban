import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  ServerFrame,
  AdminCharacterWrite,
  CharacterCard,
  AuthResponse,
  MessageAck,
  MessagePage,
  Conversation,
  type ChatAdminPort,
  type ChatParticipantPort,
  type ChatReadPort,
  type ChatUserPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_PARTICIPANT_PORT,
  CHAT_READ_PORT,
  CHAT_USER_PORT,
} from '../src/modules/chat/index.js';
import { ChatLifecycle, ChatTestQueries } from '../src/modules/chat/testing.js';
import { UpdateLogService } from '../src/modules/realtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('chat 真实事务、HTTP、隔离和历史负记录', () => {
  let app: INestApplication;
  let db: Database;
  let admin: ChatAdminPort;
  let participant: ChatParticipantPort;
  let reader: ChatReadPort;
  let users: ChatUserPort;
  let updates: UpdateLogService;
  let userId: string;
  let otherId: string;
  let token: string;
  let cid: string;
  let rolePid: string;
  const clock = new TestClock('2026-10-06T12:00:00Z');
  const logs = captureLogger();
  const text = (value: string) => ({ type: 'text' as const, text: value });
  const body = (value: string, clientMsgId = newId()) => ({ clientMsgId, content: text(value) });
  const send = (value: string) => users.sendMessage(userId, cid, body(value));
  const http = () => request(app.getHttpServer());
  const path = () => `/api/v1/conversations/${cid}`;
  const auth = () => `Bearer ${token}`;
  beforeAll(async () => {
    await resetTestDatabase();
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
    await app.listen(0, '127.0.0.1');
    db = app.get(DATABASE);
    admin = app.get(CHAT_ADMIN_PORT);
    participant = app.get(CHAT_PARTICIPANT_PORT);
    reader = app.get(CHAT_READ_PORT);
    users = app.get(CHAT_USER_PORT);
    updates = app.get(UpdateLogService);
    const commands = app.get(IdentityCommands);
    userId = await commands.createAdmin('chat_user', 'correct horse battery');
    await commands.setRole('chat_user', 'user');
    otherId = await commands.createAdmin('chat_other', 'correct horse battery');
    const response = await http()
      .post('/api/v1/auth/login')
      .send({
        username: 'chat_user',
        password: 'correct horse battery',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'chat test',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    token = AuthResponse.parse(response.body).session.token;
    const conversation = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, {
        userId,
        characterId: newId(),
        restoreHistory: true,
      }),
    );
    cid = conversation.conversationId;
    rolePid = conversation.participants.find((p) => p.kind === 'character')!.participantId;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('会话创建回滚无残留；未登录与其他账号不能读写', async () => {
    const before = await updates.getState(userId);
    const characterId = newId();
    await expect(
      db.transaction(async (tx) => {
        await admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await reader.findDirectConversation(userId, characterId)).toBeNull();
    expect(await updates.getState(userId)).toEqual(before);
    await http().get(path()).expect(401);
    await expect(users.sendMessage(otherId, cid, body('forbidden'))).rejects.toMatchObject({
      code: 'not_conversation_member',
    });
    await http().get(path()).set('Authorization', auth()).expect(200);
  });
  it('十个并发重试产生同一ACK；不同发送者同键互不混淆，序号连续', async () => {
    const input = body('CHAT_BODY_CANARY');
    const result = await Promise.all(
      Array.from({ length: 10 }, () => users.sendMessage(userId, cid, input)),
    );
    for (const ack of result) expect(ack).toEqual(result[0]);
    expect(result[0]!.message.seq).toBe(1);
    const role = await participant.postMessage({
      conversationId: cid,
      senderParticipantId: rolePid,
      content: text('role reply'),
      idempotencyKey: input.clientMsgId,
    });
    expect(role.ok).toBe(true);
    if (!role.ok) throw new Error('role did not post');
    expect(role.value.seq).toBe(2);
    expect(role.value.messageId).not.toBe(result[0]!.message.messageId);
    const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => send(`parallel ${i}`)));
    expect(parallel.map((a) => a.message.seq).sort((a, b) => a - b)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const rows = await new ChatTestQueries(db).messages(cid);
    expect(rows).toHaveLength(12);
    for (const row of rows)
      expect(row.content_ciphertext?.toString()).not.toContain('CHAT_BODY_CANARY');
    expect(logs.capture.text).not.toContain('CHAT_BODY_CANARY');
    const updatePage = await updates.getUpdates(userId, { since: 1, limit: 100 });
    expect(updatePage.items.filter((u) => u.type === 'message.created')).toHaveLength(12);
    expect(updatePage.items.filter((u) => u.type === 'conversation.updated')).toHaveLength(12);
    const conversation = Conversation.parse(
      (await http().get(path()).set('Authorization', auth()).expect(200)).body,
    );
    expect(conversation.unreadCount).toBe(1);
    expect(conversation.lastSeq).toBe(12);
  });
  it('系统消息与同步日志一起回滚，同事务两条消息不会覆盖序号', async () => {
    const temporary = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, { userId, characterId: newId(), restoreHistory: true }),
    );
    const head = await updates.getState(userId);
    await expect(
      db.transaction(async (tx) => {
        await admin.postSystemMessage(tx, {
          conversationId: temporary.conversationId,
          code: 'contact_accepted',
          idempotencyKey: newId(),
        });
        throw new Error('message rollback');
      }),
    ).rejects.toThrow('message rollback');
    expect((await reader.getConversation(temporary.conversationId))?.lastSeq).toBe(0);
    expect(await updates.getState(userId)).toEqual(head);
    await db.transaction(async (tx) => {
      const first = await admin.postSystemMessage(tx, {
        conversationId: temporary.conversationId,
        code: 'contact_accepted',
        idempotencyKey: newId(),
      });
      const second = await admin.postSystemMessage(tx, {
        conversationId: temporary.conversationId,
        code: 'contact_accepted',
        idempotencyKey: newId(),
      });
      expect([first.seq, second.seq]).toEqual([1, 2]);
    });
    const char = (await reader.getParticipants(temporary.conversationId)).find(
      (p) => p.kind === 'character',
    )!;
    await db.transaction((tx) =>
      admin.purgeDirectConversation(tx, { userId, characterId: char.refId }),
    );
  });
  it('HTTP发送使用同一幂等处理器；不能伪造scope、系统身份或跨会话引用', async () => {
    const input = body('http committed');
    const first = MessageAck.parse(
      (
        await http()
          .post(`${path()}/messages`)
          .set('Authorization', auth())
          .send({ ...input, scope: 'adult' })
          .expect(200)
      ).body,
    );
    expect(first.message.scope).toBe('normal');
    expect(await users.sendMessage(userId, cid, input)).toEqual(first);
    await http()
      .post(`${path()}/messages`)
      .set('Authorization', auth())
      .send({ ...body('bad'), content: { type: 'system', code: 'contact_accepted', params: {} } })
      .expect(400);
    await http()
      .post(`${path()}/messages`)
      .set('Authorization', auth())
      .send({ ...body('bad quote'), quoteMessageId: newId() })
      .expect(400);
    await expect(
      admin.setContentScope({ conversationId: cid, scope: 'adult' }),
    ).resolves.toMatchObject({ ok: false, error: 'adult_mode_not_eligible' });
  });
  it('角色回复和系统提示接受契约规定的稳定幂等键，重复任务不重复发消息', async () => {
    const trigger = await send('trigger');
    const input = {
      conversationId: cid,
      senderParticipantId: rolePid,
      content: text('deterministic role reply'),
      idempotencyKey: `reply:${trigger.message.messageId}:0`,
    };
    const first = await participant.postMessage(input);
    expect(first.ok).toBe(true);
    expect(await participant.postMessage(input)).toEqual(first);
    const system = {
      conversationId: cid,
      code: 'contact_accepted',
      idempotencyKey: `contact:${cid}:accepted`,
    };
    const original = await admin.postSystemMessage(null, system);
    expect(await admin.postSystemMessage(null, system)).toEqual(original);
    expect(
      await participant.recall({
        conversationId: newId(),
        participantId: rolePid,
        messageId: newId(),
      }),
    ).toMatchObject({ ok: false, error: 'not_found' });
  });
  it('隐藏/清空给出同快照coverage；引用与旧键不能找回已删除正文', async () => {
    const input = body('private quote');
    const source = await users.sendMessage(userId, cid, input);
    const quote = await users.sendMessage(userId, cid, {
      ...body('quoting'),
      quoteMessageId: source.message.messageId,
    });
    expect(quote.message.quote?.preview).toBe('private quote');
    await http()
      .post(`${path()}/messages/${source.message.messageId}/hide`)
      .set('Authorization', auth())
      .expect(204);
    const page = MessagePage.parse(
      (
        await http()
          .get(`${path()}/messages?afterSeq=${source.message.seq - 1}&limit=2`)
          .set('Authorization', auth())
          .expect(200)
      ).body,
    );
    expect(page.items.map((m) => m.messageId)).toEqual([quote.message.messageId]);
    expect(page.items[0]!.quote?.preview).toBeNull();
    expect(page.coverage).toEqual({
      fromSeq: source.message.seq,
      throughSeq: quote.message.seq,
      excludedRanges: [
        { fromSeq: source.message.seq, throughSeq: source.message.seq, reason: 'hidden' },
      ],
    });
    expect((await users.sendMessage(userId, cid, input)).message.content).toBeNull();
    await http().post(`${path()}/clear`).set('Authorization', auth()).expect(200);
    const cleared = MessagePage.parse(
      (
        await http()
          .get(`${path()}/messages?afterSeq=0&limit=200`)
          .set('Authorization', auth())
          .expect(200)
      ).body,
    );
    expect(cleared.items).toEqual([]);
    expect(cleared.coverage?.excludedRanges).toEqual([
      { fromSeq: 1, throughSeq: quote.message.seq, reason: 'cleared' },
    ]);
    expect((await users.sendMessage(userId, cid, input)).message.content).toBeNull();
    expect(
      (await reader.readMessages({ conversationId: cid, scopes: ['normal'], limit: 200 })).length,
    ).toBe(quote.message.seq);
  });
  it('撤回物理去除密文与引用预览；P23边界拒绝，重复撤回不产生新更新', async () => {
    const source = await send('recall secret');
    const quote = await users.sendMessage(userId, cid, {
      ...body('reply to recall'),
      quoteMessageId: source.message.messageId,
    });
    const recalled = (
      await http()
        .post(`${path()}/messages/${source.message.messageId}/recall`)
        .set('Authorization', auth())
        .expect(200)
    ).body;
    expect(recalled).toMatchObject({ status: 'recalled', content: null });
    const head = await updates.getState(userId);
    await http()
      .post(`${path()}/messages/${source.message.messageId}/recall`)
      .set('Authorization', auth())
      .expect(200);
    expect(await updates.getState(userId)).toEqual(head);
    expect(
      (await reader.getMessage(quote.message.messageId, ['normal']))?.quote?.preview,
    ).toBeNull();
    expect(
      (await new ChatTestQueries(db).messages(cid)).find((m) => m.id === source.message.messageId)
        ?.content_ciphertext,
    ).toBeNull();
    const boundary = await send('too late');
    clock.advance(120_000);
    await http()
      .post(`${path()}/messages/${boundary.message.messageId}/recall`)
      .set('Authorization', auth())
      .expect(422);
  });
  it('用户已读只前进，手工未读可清除，角色已读单独同步；新消息恢复隐藏会话', async () => {
    const conversation = Conversation.parse(
      (await http().get(path()).set('Authorization', auth()).expect(200)).body,
    );
    await http()
      .post(`${path()}/read`)
      .set('Authorization', auth())
      .send({ readSeq: conversation.lastSeq })
      .expect(204);
    await http().post(`${path()}/unread`).set('Authorization', auth()).expect(204);
    await http()
      .post(`${path()}/read`)
      .set('Authorization', auth())
      .send({ readSeq: 1 })
      .expect(204);
    await participant.markRead({
      conversationId: cid,
      participantId: rolePid,
      readSeq: conversation.lastSeq,
    });
    const state = Conversation.parse(
      (await http().get(path()).set('Authorization', auth()).expect(200)).body,
    );
    expect(state.state).toMatchObject({ readSeq: conversation.lastSeq, markedUnread: false });
    expect(state.peerReadSeq).toBe(conversation.lastSeq);
    await http()
      .patch(`${path()}/state`)
      .set('Authorization', auth())
      .send({ hidden: true, pinned: true, muted: true })
      .expect(200);
    expect(
      (await http().get('/api/v1/conversations').set('Authorization', auth()).expect(200)).body
        .items,
    ).toEqual([]);
    await send('restore visible');
    expect(
      (await http().get('/api/v1/conversations').set('Authorization', auth()).expect(200)).body
        .items[0].state,
    ).toMatchObject({ hidden: false, pinned: true, muted: true });
  });
  it('真实WebSocket发送提交后ACK，HTTP重试仍是同一消息；错误会话返回不可重试错误', async () => {
    const endpoint = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/ws`;
    const ws = new WebSocket(endpoint);
    const frames: ServerFrame[] = [];
    ws.on('message', (data) => frames.push(ServerFrame.parse(JSON.parse(data.toString()))));
    const next = async (type: ServerFrame['type']) => {
      for (let i = 0; i < 500; i++) {
        const index = frames.findIndex((f) => f.type === type);
        if (index >= 0) return frames.splice(index, 1)[0]!;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`missing ${type}`);
    };
    try {
      await once(ws, 'open');
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'auth',
          data: {
            token,
            contractVersion: '2.1',
            lastUpdateSeq: 0,
            device: {
              platform: 'web',
              name: 'chat socket',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          },
        }),
      );
      await next('auth.ok');
      const input = body('socket committed');
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'message.send',
          ref: 'send-one',
          data: { ...input, conversationId: cid },
        }),
      );
      const frame = await next('message.ack');
      if (frame.type !== 'message.ack') throw new Error('wrong frame');
      expect(frame.ref).toBe('send-one');
      expect(await users.sendMessage(userId, cid, input)).toEqual(frame.data);
      const update = await next('update');
      expect(update.type).toBe('update');
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'message.send',
          ref: 'bad',
          data: { ...body('bad'), conversationId: newId() },
        }),
      );
      const error = await next('message.error');
      expect(error).toMatchObject({ ref: 'bad', data: { code: 'not_found', retryable: false } });
    } finally {
      const closed = once(ws, 'close');
      ws.close();
      await closed;
    }
  });
  it('归档停止发送，恢复沿用历史；重新认识和物理删除得到新会话', async () => {
    const characterId = newId();
    const first = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true }),
    );
    await users.sendMessage(userId, first.conversationId, body('old history'));
    await db.transaction((tx) => admin.archiveDirectConversation(tx, { userId, characterId }));
    await expect(
      users.sendMessage(userId, first.conversationId, body('late')),
    ).rejects.toMatchObject({ code: 'not_conversation_member' });
    const restored = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true }),
    );
    expect(restored).toMatchObject({
      conversationId: first.conversationId,
      lastSeq: 1,
      state: { hidden: false },
    });
    await db.transaction((tx) => admin.archiveDirectConversation(tx, { userId, characterId }));
    const fresh = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: false }),
    );
    expect(fresh.lastSeq).toBe(0);
    expect(fresh.conversationId).not.toBe(first.conversationId);
    expect(await reader.getConversation(first.conversationId)).toBeNull();
    await db.transaction((tx) => admin.purgeDirectConversation(tx, { userId, characterId }));
    expect(await reader.findDirectConversation(userId, characterId)).toBeNull();
  });
  it('成人范围重新检查真实角色资格；normal读取不能带出成人消息或引用正文', async () => {
    const sample = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
        'utf8',
      ).match(/```json\s*([\s\S]*?)```/)![1]!,
    ) as { card: unknown };
    const character = await app.get(CharacterService).create(
      otherId,
      AdminCharacterWrite.parse({
        name: 'chat adult role',
        tagline: '测试',
        intro: '原创成年角色',
        categoryId: 'original',
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        birthday: '2000-01-02',
        fanName: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好，欢迎来聊聊天'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: character.characterId, adminId: otherId, revision: 1 });
    await app.get(CharacterService).publish(otherId, character.characterId);
    const conversation = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, {
        userId,
        characterId: character.characterId,
        restoreHistory: true,
      }),
    );
    expect(
      await admin.setContentScope({ conversationId: conversation.conversationId, scope: 'adult' }),
    ).toEqual({ ok: true, value: undefined });
    const adult = await users.sendMessage(
      userId,
      conversation.conversationId,
      body('ADULT_BODY_CANARY'),
    );
    expect(adult.message.scope).toBe('adult');
    expect((await reader.getConversation(conversation.conversationId))?.lastMessage?.text).toBe(
      '[消息]',
    );
    await admin.setContentScope({ conversationId: conversation.conversationId, scope: 'normal' });
    await users.sendMessage(userId, conversation.conversationId, {
      ...body('normal reply'),
      quoteMessageId: adult.message.messageId,
    });
    const normal = await reader.readMessages({
      conversationId: conversation.conversationId,
      scopes: ['normal'],
      limit: 200,
    });
    expect(normal).toHaveLength(1);
    expect(normal[0]!.quote?.preview).toBeNull();
    expect(JSON.stringify(normal)).not.toContain('ADULT_BODY_CANARY');
    await admin.setContentScope({ conversationId: conversation.conversationId, scope: 'adult' });
    const service = app.get(CharacterService);
    let unlock!: () => void;
    let checked!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const original = service.getClassification.bind(service);
    const spy = vi.spyOn(service, 'getClassification').mockImplementationOnce(async (id, tx) => {
      const result = await original(id, tx);
      checked();
      await gate;
      return result;
    });
    const sending = users.sendMessage(
      userId,
      conversation.conversationId,
      body('commit before classification change'),
    );
    await acquired;
    let changed = false;
    const changing = service
      .update(otherId, character.characterId, {
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'minor',
          childAppearance: false,
        },
      })
      .then((value) => {
        changed = true;
        return value;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(changed).toBe(false);
    } finally {
      unlock();
    }
    expect((await sending).message.scope).toBe('adult');
    await changing;
    spy.mockRestore();
    await expect(
      users.sendMessage(
        userId,
        conversation.conversationId,
        body('denied after classification changed'),
      ),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect((await reader.getConversation(conversation.conversationId))?.lastSeq).toBe(3);
  });
  it('删除清单物理清空所属数据且不误删其他账号；重复清理幂等', async () => {
    const other = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, {
        userId: otherId,
        characterId: newId(),
        restoreHistory: true,
      }),
    );
    await users.sendMessage(otherId, other.conversationId, body('other retained'));
    const lifecycle = app.get(ChatLifecycle);
    expect(await lifecycle.countUserData(userId)).toBeGreaterThan(20);
    expect(await lifecycle.purgeUser(userId)).toBeGreaterThan(20);
    expect(await lifecycle.countUserData(userId)).toBe(0);
    expect(await lifecycle.purgeUser(userId)).toBe(0);
    expect(await reader.getConversation(other.conversationId)).not.toBeNull();
  });
  it('账号进入删除状态后，迟到消息与重建会话都被拒绝', async () => {
    const characterId = newId();
    const conversation = await db.transaction((tx) =>
      admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true }),
    );
    await users.sendMessage(userId, conversation.conversationId, body('before account deletion'));
    await http()
      .delete('/api/v1/me')
      .set('Authorization', auth())
      .send({ password: 'correct horse battery', confirm: 'DELETE' })
      .expect(202);
    await expect(
      users.sendMessage(userId, conversation.conversationId, body('late')),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      db.transaction((tx) =>
        admin.ensureDirectConversation(tx, { userId, characterId: newId(), restoreHistory: true }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const lifecycle = app.get(ChatLifecycle);
    expect(await lifecycle.purgeUser(userId)).toBeGreaterThan(0);
    expect(await lifecycle.countUserData(userId)).toBe(0);
    await expect(
      db.transaction((tx) =>
        admin.ensureDirectConversation(tx, { userId, characterId, restoreHistory: true }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await lifecycle.countUserData(userId)).toBe(0);
  });
});
