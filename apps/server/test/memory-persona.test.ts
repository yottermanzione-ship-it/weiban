import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  MediaObject,
  type GenerateTextInput,
  type ModelGatewayPort,
  type ChatUserPort,
  type ChatParticipantPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
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
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_READ_PORT,
  CHAT_USER_PORT,
  CHAT_PARTICIPANT_PORT,
} from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT, ADULT_MODEL_READ_PORT } from '../src/modules/model-access/index.js';
import {
  ReplyPlanStore,
  ReplyEngine,
  replyPlans,
  MemoryService,
  ReplyContext,
  PrivateDigestService,
  ImageCaptionStore,
} from '../src/modules/ai-runtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
describeDb('L2记忆与人设：真实PG/HTTP/聊天/加密；模型网关假返回', () => {
  let app: INestApplication;
  let db: Database;
  let store: ReplyPlanStore;
  let engine: ReplyEngine;
  let adminId: string;
  let userId: string;
  let token: string;
  let characterId: string;
  let cid: string;
  const clock = new TestClock('2026-10-06T12:00:00Z');
  const logs = captureLogger();
  const ring = testKekRing().ring;
  const calls: GenerateTextInput[] = [];
  let failure: string | null = null;
  let adultAvailability: 'not_configured' | 'model_removed' | 'provider_unavailable' | null =
    'not_configured';
  let generationGate: Promise<void> | null = null;
  let response = '我听着呢\n今天过得怎么样？';
  let emulateCache = false;
  const cachedAnswers = new Map<string, string>();
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw Error('unused');
    },
    generateText: async (input) => {
      calls.push(input);
      if (generationGate) await generationGate;
      const answer = emulateCache
        ? (cachedAnswers.get(input.idempotencyKey) ?? response)
        : response;
      if (emulateCache && !failure) cachedAnswers.set(input.idempotencyKey, answer);
      return failure
        ? { ok: false, error: failure as 'provider_unavailable' }
        : {
            ok: true,
            value: {
              text: answer,
              modelKey: 'test/model',
              usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
              chargedMicros: 1,
              latencyMs: 1,
              usageRecordId: newId(),
            },
          };
    },
  };
  const memory = () => app.get(MemoryService);
  const memoryPath = () => `/api/v1/characters/${characterId}/memories`;
  const job = async () => ({
    userId,
    characterId,
    conversationId: cid,
    urgent: true,
    epoch: (await new ContactsTestQueries(db).row(userId, characterId))!.request_id,
  });
  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  async function startApp() {
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: logs.logger,
          kekRing: ring,
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
      .overrideProvider(ADULT_MODEL_READ_PORT)
      .useValue({
        getAdultModelStatus: async () => ({
          available: adultAvailability === null,
          reason: adultAvailability,
        }),
      })
      .overrideProvider(MODEL_GATEWAY_PORT)
      .useValue(gateway)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0, '127.0.0.1');
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    store = app.get(ReplyPlanStore);
    engine = app.get(ReplyEngine);
  }
  beforeAll(async () => {
    await resetTestDatabase();
    await startApp();
    const identity = app.get(IdentityCommands);
    adminId = await identity.createAdmin('ai_admin', 'correct horse battery');
    userId = await identity.createAdmin('ai_user', 'correct horse battery');
    await identity.setRole('ai_user', 'user');
    token = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'ai_user',
            password: 'correct horse battery',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'test',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
    const service = app.get(CharacterService);
    const draft = await service.create(
      adminId,
      AdminCharacterWrite.parse({
        name: 'AI role',
        tagline: '测试',
        intro: '原创成年',
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
        fallbackGreetings: ['你好，很高兴认识你'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: draft.characterId, adminId, revision: 1 });
    characterId = (await service.publish(adminId, draft.characterId)).characterId;
    const commands = app.get(ContactsCommands);
    await commands.add(userId, { characterId, greeting: 'AI_GREETING_PRIVATE_CANARY' });
    const contact = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(contact.accept_after.getTime() - clock.nowMs());
    await commands.accept({ userId, characterId, requestId: contact.request_id });
    cid = (await app.get(CHAT_READ_PORT).findDirectConversation(userId, characterId))!
      .conversationId;
  });
  afterAll(async () => {
    await app?.close();
  });
  const plans = () =>
    db.db.select().from(replyPlans).orderBy(replyPlans.createdAt, replyPlans.triggerSeq);
  async function dispatch() {
    for (let i = 0; i < 20; i++)
      if ((await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200)).claimed === 0)
        return;
    throw Error('event backlog');
  }
  async function finish(id: string) {
    for (let i = 0; i < 6; i++) {
      const row = await store.get(id);
      if (!row || ['done', 'cancelled', 'waiting'].includes(row.status)) return;
      clock.advance(Math.max(0, row.dueAt.getTime() - clock.nowMs()));
      await engine.run(id);
    }
    throw Error('reply did not finish');
  }
  async function user(text: string) {
    await app
      .get<ChatUserPort>(CHAT_USER_PORT)
      .sendMessage(userId, cid, { clientMsgId: newId(), content: { type: 'text', text } });
    await dispatch();
    return (await plans()).at(-1)!;
  }
  it('HTTP鉴权、幂等并发写入、分页、加密与跨用户访问拒绝', async () => {
    await http().get(memoryPath()).expect(401);
    const clientMemoryId = newId();
    const replies = await Promise.all(
      Array.from({ length: 10 }, () =>
        http()
          .post(memoryPath())
          .set('Authorization', auth())
          .send({ clientMemoryId, category: 'people', content: 'PRIVATE_MEMORY_CANARY：猫叫团子' })
          .expect(201),
      ),
    );
    expect(new Set(replies.map((r) => (r.body as { memoryId: string }).memoryId)).size).toBe(1);
    const stored = await db.query<{ ciphertext: Buffer }>(
      'SELECT ciphertext FROM ai_runtime.memories WHERE user_id=$1',
      [userId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.ciphertext.toString('utf8')).not.toContain('PRIVATE_MEMORY_CANARY');
    expect(logs.capture.text).not.toContain('PRIVATE_MEMORY_CANARY');
    await expect(memory().list(adminId, characterId, { limit: 50 })).rejects.toMatchObject({
      code: 'not_found',
    });
    await http()
      .post(memoryPath())
      .set('Authorization', auth())
      .send({ clientMemoryId: newId(), category: 'basic', content: '喜欢星星', scope: 'adult' })
      .expect(400);
    await memory().create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'preference',
      content: '喜欢茶',
    });
    const page = await memory().list(userId, characterId, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await memory().list(userId, characterId, { limit: 1, afterId: page.nextCursor! });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.memoryId).not.toBe(page.items[0]?.memoryId);
  });
  it('真实聊天来源抽取/修正/过去状态/摘要加密；未知来源模型输出拒绝', async () => {
    await user('我喜欢咖啡，MEMORY_SOURCE_CANARY');
    const source = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: '喜欢咖啡',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [newId()],
        },
      ],
    });
    emulateCache = true;
    await expect(memory().extract(await job())).rejects.toThrow('memory_unknown_source');
    const invalidKey = calls.at(-1)!.idempotencyKey;
    const callsBeforeBackoff = calls.length;
    await memory().extract(await job());
    expect(calls.length).toBe(callsBeforeBackoff);
    response = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: '喜欢咖啡',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [source.messageId],
        },
      ],
      summary: '曾谈到喜欢咖啡。',
    });
    clock.advance(3600000);
    await memory().extract(await job());
    expect(calls.at(-1)!.idempotencyKey).not.toBe(invalidKey);
    emulateCache = false;
    const coffee = (await memory().list(userId, characterId, { limit: 50 })).items.find(
      (m) => m.content === '喜欢咖啡',
    )!;
    expect(coffee.sourceMessageIds).toEqual([source.messageId]);
    expect(coffee.createdBy).toBe('extracted');
    await user('我戒咖啡了，现在喜欢茶');
    const correction = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'MARK_PAST',
          memoryId: coffee.memoryId,
          content: '旧偏好',
          category: 'preference',
          importance: 7,
          sourceMessageIds: [correction.messageId],
        },
        {
          action: 'ADD',
          content: '现在喜欢茶',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [correction.messageId],
        },
      ],
    });
    await memory().extract(await job());
    expect(
      (await memory().list(userId, characterId, { limit: 50 })).items.find(
        (m) => m.memoryId === coffee.memoryId,
      )?.status,
    ).toBe('past');
    const summaries = await db.query<{ summary_ciphertext: Buffer }>(
      'SELECT summary_ciphertext FROM ai_runtime.memory_states WHERE user_id=$1',
      [userId],
    );
    expect(summaries.rows[0]!.summary_ciphertext.toString('utf8')).not.toContain('咖啡');
    response = '我听着呢\n今天过得怎么样？';
  });
  it('删除阻止旧来源复活并清除生成缓存；20轮无旧事实，新消息再次提起才可抽取', async () => {
    const created = await memory().create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'status',
      content: 'DELETE_MEMORY_CANARY：准备考研',
    });
    const pending = await user('我在准备考研，DELETE_MEMORY_CANARY');
    clock.advance(3000);
    await engine.run(pending.id);
    expect((await store.get(pending.id))?.status).toBe('sending');
    await memory().remove(userId, characterId, created.memoryId);
    const reset = (await store.get(pending.id))!;
    expect(reset.status).toBe('queued');
    expect(reset.inputCiphertext).toBeNull();
    expect(reset.resultCiphertext).toBeNull();
    for (let i = 0; i < 20; i++) await user(`闲聊第${i + 1}轮，没有再次提起`);
    const newest = (await plans()).at(-1)!;
    const snapshot = await app.get(ReplyContext).build(newest);
    expect(JSON.stringify(snapshot?.messages)).not.toContain('DELETE_MEMORY_CANARY');
    const before = calls.length;
    response = JSON.stringify({ operations: [] });
    await memory().extract(await job());
    expect(JSON.stringify(calls.slice(before))).not.toContain('DELETE_MEMORY_CANARY');
    await user('我又开始准备考研了，NEW_MEMORY_SOURCE');
    const source = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: '再次准备考研',
          category: 'status',
          importance: 6,
          sourceMessageIds: [source.messageId],
        },
      ],
    });
    await memory().extract(await job());
    expect(
      (await memory().context(userId, characterId, 'normal', '准备什么')).items.some(
        (m) => m.content === '再次准备考研',
      ),
    ).toBe(true);
    response = '我听着呢\n今天过得怎么样？';
  });
  it('抽取期间删除/手改版本变更，旧模型响应不写回；手改保护及秘密共享闸门', async () => {
    const entry = await memory().create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'preference',
      content: '最喜欢茶',
    });
    await user('其实现在喜欢白开水，只跟你说不要告诉别人');
    const source = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'UPDATE',
          memoryId: entry.memoryId,
          content: '喜欢白开水',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [source.messageId],
        },
      ],
    });
    let release!: () => void;
    generationGate = new Promise<void>((r) => {
      release = r;
    });
    const before = calls.length;
    const extraction = memory().extract(await job());
    for (let i = 0; i < 100 && calls.length === before; i++)
      await new Promise<void>((r) => setTimeout(r, 10));
    expect(calls.length).toBeGreaterThan(before);
    await memory().update(userId, characterId, entry.memoryId, { content: '手改：最喜欢红茶' });
    release();
    await extraction;
    generationGate = null;
    expect(
      (await memory().list(userId, characterId, { limit: 50 })).items.find(
        (m) => m.memoryId === entry.memoryId,
      )?.content,
    ).toBe('手改：最喜欢红茶');
    await user('只跟你说，秘密：我爱看星星');
    const secret = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: '爱看星星',
          category: 'preference',
          importance: 5,
          sharingClass: 'shareable',
          sourceMessageIds: [secret.messageId],
        },
      ],
    });
    await memory().extract(await job());
    const item = (await memory().list(userId, characterId, { limit: 50 })).items.find(
      (m) => m.content === '爱看星星',
    )!;
    expect(item.sharingClass).toBe('never');
    expect(item.knownBy).toEqual([characterId]);
    response = '我听着呢\n今天过得怎么样？';
  });
  it('尚未撤回的角色初稿也不提交长期记忆抽取，游标仍前进', async () => {
    const original = response;
    response = JSON.stringify({ operations: [] });
    try {
      for (let i = 0; i < 10; i++) await memory().extract(await job());
      const conversation = await app.get(CHAT_READ_PORT).getConversation(cid);
      const participant = conversation.participants.find(
        (p: { kind: string }) => p.kind === 'character',
      )!;
      const posted = await app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT).postMessage({
        conversationId: cid,
        senderParticipantId: participant.participantId,
        content: { type: 'text', text: 'QUIRK_DRAFT_NOT_A_REAL_MEMORY' },
        labels: ['quirk_draft'],
        idempotencyKey: newId(),
      });
      expect(posted.ok).toBe(true);
      await user('今天喜欢蓝色的天空');
      const before = calls.length;
      await memory().extract(await job());
      expect(calls.length).toBeGreaterThan(before);
      expect(JSON.stringify(calls.slice(before))).not.toContain('QUIRK_DRAFT_NOT_A_REAL_MEMORY');
      expect(JSON.stringify(calls.slice(before))).toContain('今天喜欢蓝色的天空');
      const state = await db.query<{ cursor_seq: string }>(
        'SELECT cursor_seq FROM ai_runtime.memory_states WHERE user_id=$1',
        [userId],
      );
      if (posted.ok) expect(Number(state.rows[0]!.cursor_seq)).toBeGreaterThan(posted.value.seq);
    } finally {
      response = original;
    }
  });
  it('成人与普通批次不混摘要/来源；普通上下文不含成人事实，经期内容不提交模型', async () => {
    response = JSON.stringify({ operations: [] });
    await memory().extract(await job());
    const changedScope = await memory().create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'preference',
      content: '普通范围的原始偏好',
    });
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'adult' });
    const adult = await memory().create(userId, characterId, {
      clientMemoryId: newId(),
      category: 'episode',
      content: 'ADULT_MEMORY_CANARY',
    });
    expect(adult.scope).toBe('adult');
    await user('更正：现在的偏好是 ADULT_SOURCE_CANARY');
    const adultSource = (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['adult'], limit: 1 })
    )[0]!;
    response = JSON.stringify({
      operations: [
        {
          action: 'UPDATE',
          memoryId: changedScope.memoryId,
          content: 'ADULT_UPDATED_MEMORY_CANARY',
          category: 'preference',
          importance: 8,
          sourceMessageIds: [adultSource.messageId],
        },
      ],
    });
    await memory().extract(await job());
    expect(
      (await memory().list(userId, characterId, { limit: 50 })).items.find(
        (m) => m.memoryId === changedScope.memoryId,
      )?.scope,
    ).toBe('adult');
    expect(JSON.stringify(await memory().context(userId, characterId, 'normal', ''))).not.toContain(
      'ADULT_UPDATED_MEMORY_CANARY',
    );
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'normal' });
    await user('我喜欢普通日常 NORMAL_SOURCE_CANARY');
    await user('经期数据 PERIOD_PRIVATE_CANARY');
    const normalSnapshot = await app.get(ReplyContext).build((await plans()).at(-1)!);
    // H2（20 号 §2.4 第 2 条）：日常范围不再读私密模式原文与私密记忆（以切出时的「干净整理」代替）。
    expect(JSON.stringify(normalSnapshot?.messages)).not.toContain('ADULT_SOURCE_CANARY');
    expect(JSON.stringify(normalSnapshot?.messages)).not.toContain('ADULT_UPDATED_MEMORY_CANARY');
    expect(JSON.stringify(normalSnapshot?.messages)).toContain('私密模式期间的经历整理');
    response = JSON.stringify({ operations: [], summary: '本批次摘要。' });
    const before = calls.length;
    for (let i = 0; i < 4; i++) await memory().extract(await job());
    for (const call of calls.slice(before)) {
      const input = JSON.stringify(call.messages);
      expect(input).not.toContain('PERIOD_PRIVATE_CANARY');
      const data = JSON.parse(call.messages[1]!.content) as { messages: { scope: string }[] };
      expect(new Set(data.messages.map((m) => m.scope)).size).toBeLessThanOrEqual(1);
      if (data.messages[0]?.scope === 'normal') expect(input).not.toContain('ADULT_MEMORY_CANARY');
    }
    expect(JSON.stringify(await memory().context(userId, characterId, 'normal', ''))).not.toContain(
      'ADULT_MEMORY_CANARY',
    );
    await http()
      .post(memoryPath())
      .set('Authorization', auth())
      .send({ clientMemoryId: newId(), category: 'status', content: '痛经记录' })
      .expect(400);
    response = '我听着呢\n今天过得怎么样？';
  });
  it('模式资格、缺成人模型拒绝，儿童自定义恋爱关系拒绝，人设与20轮细节注入', async () => {
    const settingsPath = `/api/v1/characters/${characterId}/companion-settings`;
    await http()
      .patch(settingsPath)
      .set('Authorization', auth())
      .send({ scenarioMode: 'adult' })
      .expect(422);
    await http()
      .patch(settingsPath)
      .set('Authorization', auth())
      .send({ personaFit: 5, scenarioMode: 'tsundere' })
      .expect(200);
    const oldRelationshipPlan = await user('修改关系前正在生成的回复');
    clock.advance(Math.max(0, oldRelationshipPlan.dueAt.getTime() - clock.nowMs()));
    await engine.run(oldRelationshipPlan.id);
    expect(await store.get(oldRelationshipPlan.id)).toMatchObject({
      status: 'sending',
      nextBubble: 0,
    });
    expect((await store.get(oldRelationshipPlan.id))?.inputCiphertext).not.toBeNull();
    await http()
      .patch(`/api/v1/contacts/${characterId}`)
      .set('Authorization', auth())
      // 3.27（H1）：关系类型已删除；改专属称呼同样作废正在生成的回复。
      .send({ addressAs: '小饭团' })
      .expect(200);
    await dispatch();
    expect((await store.get(oldRelationshipPlan.id))?.inputCiphertext).toBeNull();
    const first = await user('RECENT_TWENTY_ROUNDS_CANARY：晚饭吃麻辣烫');
    await finish(first.id);
    for (let i = 0; i < 19; i++) {
      const row = await user(`闲聊${i}`);
      await finish(row.id);
    }
    const row = await user('我晚饭吃了啥？');
    const snapshot = await app.get(ReplyContext).build(row);
    const prompt = JSON.stringify(snapshot?.messages);
    expect(prompt).toContain('RECENT_TWENTY_ROUNDS_CANARY');
    expect(prompt).toContain('人设贴合度5/5');
    expect(prompt).not.toContain('用户明确选择的关系');
    await db.query("UPDATE characters.characters SET age_setting='minor' WHERE id=$1", [
      characterId,
    ]);
    const modes = (
      await http()
        .get(`/api/v1/characters/${characterId}/scenario-modes`)
        .set('Authorization', auth())
        .expect(200)
    ).body as { items: { id: string }[] };
    expect(modes.items.map((m) => m.id)).not.toContain('adult');
    expect(modes.items.map((m) => m.id)).not.toContain('romance');
    // 3.27（H1）：关系类型选择已删除——旧客户端传的 relationship 被忽略，不写入也不返回。
    const ignored = await http()
      .patch(`/api/v1/contacts/${characterId}`)
      .set('Authorization', auth())
      .send({ relationship: '我的男朋友' })
      .expect(200);
    expect(ignored.body.relationship).toBeUndefined();
    await db.query("UPDATE characters.characters SET age_setting='adult' WHERE id=$1", [
      characterId,
    ]);
  }, 120000);
  it('成人模型明确选择后模式/范围/系统消息同事务，临时故障不换模型，下架退出日常', async () => {
    const path = `/api/v1/characters/${characterId}/companion-settings`;
    adultAvailability = null;
    await http()
      .patch(path)
      .set('Authorization', auth())
      .send({ scenarioMode: 'adult' })
      .expect(200);
    expect((await app.get(CHAT_READ_PORT).getConversation(cid)).contentScope).toBe('adult');
    const row = await user('成人模式中也保持身份');
    await finish(row.id);
    expect(calls.at(-1)?.modelRole).toBe('adult');
    adultAvailability = 'provider_unavailable';
    expect(
      (await http().get(path).set('Authorization', auth()).expect(200)).body.scenarioMode,
    ).toBe('adult');
    // 4.1（dead31c）：私密模型下架 / 不可用时不再静默切回日常（否则之后的敏感输入会落进 normal），
    // 保留私密设置与消息范围，只发一次「私密模型不可用」提示，由用户自己切换。
    adultAvailability = 'model_removed';
    expect(
      (await http().get(path).set('Authorization', auth()).expect(200)).body.scenarioMode,
    ).toBe('adult');
    expect((await app.get(CHAT_READ_PORT).getConversation(cid)).contentScope).toBe('adult');
    const messages = await app
      .get(CHAT_READ_PORT)
      .readMessages({ conversationId: cid, scopes: ['normal', 'adult'], limit: 5 });
    expect(
      messages.some(
        (m: { content?: { type: string; code?: string } | null }) =>
          m.content?.code === 'scenario_mode_unavailable',
      ),
    ).toBe(true);
    // 用户主动切回日常：范围回到 normal（下一条用例从日常起步）。
    await http()
      .patch(path)
      .set('Authorization', auth())
      .send({ scenarioMode: 'daily' })
      .expect(200);
    expect((await app.get(CHAT_READ_PORT).getConversation(cid)).contentScope).toBe('normal');
    adultAvailability = 'not_configured';
  });
  it('H2：切出私密模式由私密模型生成干净整理且只一次；日常不读私密原文；私密模式拒绝语音', async () => {
    const path = `/api/v1/characters/${characterId}/companion-settings`;
    adultAvailability = null;
    const original = response;
    try {
      await http()
        .patch(path)
        .set('Authorization', auth())
        .send({ scenarioMode: 'adult' })
        .expect(200);
      // 私密模式只开放文字与图片：语音消息（语音输入）被拒。
      await expect(
        app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, cid, {
          clientMsgId: newId(),
          content: { type: 'voice', mediaId: newId(), durationMs: 1000, transcript: null },
        }),
      ).rejects.toThrow('私密模式只支持文字和图片');
      const row = await user('PRIVATE_RAW_CANARY 今晚想抱着你');
      await finish(row.id);
      const count = async () =>
        Number(
          (
            await db.query<{ n: string }>(
              'SELECT count(*) n FROM ai_runtime.private_digests WHERE conversation_id=$1',
              [cid],
            )
          ).rows[0]!.n,
        );
      const before = await count();
      await http()
        .patch(path)
        .set('Authorization', auth())
        .send({ scenarioMode: 'daily' })
        .expect(200);
      // 没有切换（日常 → 日常）不登记。
      await http()
        .patch(path)
        .set('Authorization', auth())
        .send({ scenarioMode: 'daily', personaFit: 4 })
        .expect(200);
      expect(await count()).toBe(before + 1);
      const digest = (
        await db.query<{ id: string }>(
          'SELECT id FROM ai_runtime.private_digests WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1',
          [cid],
        )
      ).rows[0]!;
      response = JSON.stringify({
        summary: '用户和角色在私密模式里很亲密，有过亲密行为；用户说今晚想抱着角色。',
      });
      const callsBefore = calls.length;
      await app.get(PrivateDigestService).run(digest.id);
      const digestCalls = calls.slice(callsBefore);
      expect(digestCalls).toHaveLength(1);
      expect(digestCalls[0]).toMatchObject({
        purpose: 'memory',
        modelRole: 'adult',
        billingOwner: 'user',
      });
      expect(JSON.stringify(digestCalls[0]!.messages)).toContain('PRIVATE_RAW_CANARY');
      // 同一次切出再跑：不再调用模型、不再写记忆。
      await app.get(PrivateDigestService).run(digest.id);
      expect(calls.length).toBe(callsBefore + 1);
      const done = await db.query<{ status: string; memory_id: string | null }>(
        'SELECT status, memory_id FROM ai_runtime.private_digests WHERE id=$1',
        [digest.id],
      );
      expect(done.rows[0]).toMatchObject({ status: 'done' });
      const written = await db.query<{ scope: string }>(
        'SELECT scope FROM ai_runtime.memories WHERE client_id=$1',
        [digest.id],
      );
      expect(written.rows).toEqual([{ scope: 'normal' }]);
      let entry: { content: string } | undefined;
      let afterId: string | undefined;
      for (let page = 0; page < 20 && !entry; page++) {
        const list = await memory().list(userId, characterId, {
          limit: 50,
          ...(afterId ? { afterId } : {}),
        });
        entry = list.items.find((m) => m.memoryId === done.rows[0]!.memory_id);
        if (!list.nextCursor) break;
        afterId = list.nextCursor;
      }
      expect(entry?.content).toContain('私密模式期间的经历整理');
      expect(entry?.content).not.toContain('PRIVATE_RAW_CANARY');
      // 日常范围的回复上下文不含私密原文。
      response = original;
      const daily = await user('还记得我们之前很亲密吗');
      const snapshot = await app.get(ReplyContext).build(daily);
      expect(JSON.stringify(snapshot?.messages)).not.toContain('PRIVATE_RAW_CANARY');
      expect(snapshot?.scope).toBe('normal');
    } finally {
      response = original;
      adultAvailability = 'not_configured';
    }
  }, 120000);
  it('儿童继承全局恋爱默认使用日常，不能反复作废正在构建的回复', async () => {
    await db.query(
      'DELETE FROM ai_runtime.companion_settings WHERE user_id=$1 AND character_id=$2',
      [userId, characterId],
    );
    await db.query("UPDATE characters.characters SET age_setting='minor' WHERE id=$1", [
      characterId,
    ]);
    try {
      // 3.27（H1）：「情侣暧昧」不再可选；旧数据里残留的 romance 默认对儿童角色仍按日常。
      await http()
        .patch('/api/v1/me/companion-defaults')
        .set('Authorization', auth())
        .send({ scenarioMode: 'romance' })
        .expect(400);
      await http()
        .patch('/api/v1/me/companion-defaults')
        .set('Authorization', auth())
        .send({ scenarioMode: 'tsundere' })
        .expect(200);
      await db.query(
        "UPDATE ai_runtime.companion_settings SET scenario_mode='romance' WHERE user_id=$1 AND character_id IS NULL",
        [userId],
      );
      const pending = await user('今天有什么有趣的事？');
      clock.advance(Math.max(0, pending.dueAt.getTime() - clock.nowMs()));
      await engine.run(pending.id);
      expect(await store.get(pending.id)).toMatchObject({ status: 'sending', nextBubble: 0 });
      expect(calls.at(-1)?.meta?.scenarioMode).toBe('daily');
      await finish(pending.id);
      expect((await store.get(pending.id))?.status).toBe('done');
    } finally {
      await db.query("UPDATE characters.characters SET age_setting='adult' WHERE id=$1", [
        characterId,
      ]);
      await http()
        .patch('/api/v1/me/companion-defaults')
        .set('Authorization', auth())
        .send({ scenarioMode: 'daily' })
        .expect(200);
    }
  });
  it('H3 描述加密、按用户与范围隔离、重复存档只保留首次；注销清单覆盖', async () => {
    const captions = app.get(ImageCaptionStore);
    const mediaId = newId();
    const base = {
      userId,
      mediaId,
      messageId: null,
      conversationId: null,
      modelKey: 'test/model',
      caption: {
        kind: 'pet' as const,
        description: 'CAPTION_CAT_CANARY',
        textInImage: '',
        people: [],
      },
    };
    await captions.save({ ...base, scope: 'adult' });
    expect((await captions.load(userId, [mediaId], ['normal'])).size).toBe(0);
    expect((await captions.load(adminId, [mediaId], ['adult'])).size).toBe(0);
    expect((await captions.load(userId, [mediaId], ['adult'])).get(mediaId)?.description).toBe(
      'CAPTION_CAT_CANARY',
    );
    await captions.save({
      ...base,
      scope: 'adult',
      caption: { ...base.caption, description: '重复覆盖' },
    });
    await captions.save({
      ...base,
      scope: 'normal',
      caption: { ...base.caption, description: '日常猫咪' },
    });
    expect(
      (await captions.load(userId, [mediaId], ['normal', 'adult'])).get(mediaId)?.description,
    ).toBe('日常猫咪');
    const rows = await db.query<{ caption_ciphertext: Buffer }>(
      'SELECT caption_ciphertext FROM ai_runtime.image_captions WHERE media_id=$1',
      [mediaId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => !r.caption_ciphertext.toString('utf8').includes('CANARY'))).toBe(
      true,
    );
  });
  it('H3 新图在同一次回复中看懂并存档，后续只读描述；撤回后拒绝迟到存档', async () => {
    const original = response;
    try {
      const image = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#ffaa00' },
      })
        .png()
        .toBuffer();
      const uploaded = MediaObject.parse(
        (
          await http()
            .post('/api/v1/media?purpose=chat_image')
            .set('Authorization', auth())
            .attach('file', image, { filename: 'cat.png', contentType: 'image/png' })
            .expect(201)
        ).body,
      );
      const ack = await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, cid, {
        clientMsgId: newId(),
        content: { type: 'image', mediaId: uploaded.mediaId, width: 8, height: 8 },
      });
      await dispatch();
      const pending = (await plans()).at(-1)!;
      response =
        '猫猫好可爱\n<图片描述>[{"n":1,"kind":"pet","description":"H3_ORANGE_CAT_CANARY 橘猫趴窗台"}]</图片描述>';
      const before = calls.length;
      await finish(pending.id);
      const turn = calls.slice(before).filter((c) => c.purpose === 'chat_reply');
      expect(turn).toHaveLength(1);
      expect(turn[0]!.messages.flatMap((m) => m.images ?? [])).toEqual([
        { mediaId: uploaded.mediaId, ownerUserId: userId },
      ]);
      const captions = app.get(ImageCaptionStore);
      expect(
        (await captions.load(userId, [uploaded.mediaId], ['normal'])).get(uploaded.mediaId)
          ?.description,
      ).toContain('H3_ORANGE_CAT_CANARY');
      const visible = await app.get(CHAT_READ_PORT).readMessages({
        conversationId: cid,
        scopes: ['normal'],
        afterSeq: ack.message.seq,
        limit: 10,
      });
      expect(JSON.stringify(visible)).not.toContain('<图片描述>');
      expect(
        visible.some((m: { content: { type: string; text?: string } | null }) =>
          m.content?.text?.includes('猫猫好可爱'),
        ),
      ).toBe(true);
      const next = await user('刚才的猫猫呢');
      const snapshot = await app.get(ReplyContext).build(next);
      expect(JSON.stringify(snapshot?.messages)).toContain('H3_ORANGE_CAT_CANARY');
      expect(snapshot?.messages.flatMap((m) => m.images ?? [])).toEqual([]);
      await http()
        .post(`/api/v1/conversations/${cid}/messages/${ack.message.messageId}/recall`)
        .set('Authorization', auth())
        .expect(200);
      await dispatch();
      await captions.save({
        userId,
        mediaId: uploaded.mediaId,
        scope: 'normal',
        messageId: ack.message.messageId,
        conversationId: cid,
        modelKey: 'late',
        caption: { kind: 'pet', description: '迟到描述', textInImage: '', people: [] },
      });
      expect((await captions.load(userId, [uploaded.mediaId], ['normal'])).size).toBe(0);
    } finally {
      response = original;
    }
  }, 120_000);
  it('长消息抽取按完整来源分批，网关输入有界且不跳过剩余游标', async () => {
    response = JSON.stringify({ operations: [] });
    // 先把前面用例留下的待抽取消息清空（固定跑 4 次不一定够：H2 / H3 用例会多留几条），最多 20 次。
    const pendingCount = async () =>
      (
        await db.query<{ pending_count: number }>(
          'SELECT pending_count FROM ai_runtime.memory_states WHERE user_id=$1',
          [userId],
        )
      ).rows[0]?.pending_count ?? 0;
    for (let i = 0; i < 20; i++) {
      await memory().extract(await job());
      if (i >= 3 && (await pendingCount()) === 0) break;
    }
    for (let i = 0; i < 65; i++)
      await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, cid, {
        clientMsgId: newId(),
        content: { type: 'text', text: `长消息${i}：${'日常聊天'.repeat(825)}` },
      });
    await dispatch();
    const before = calls.length;
    await memory().extract(await job());
    const input = calls[before]!;
    expect(input.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThan(60000);
    const first = JSON.parse(input.messages[1]!.content) as {
      messages: { id: string; text: string }[];
    };
    expect(first.messages.length).toBeGreaterThan(0);
    expect(first.messages.every((m) => m.text.endsWith('日常聊天'))).toBe(true);
    const state = await db.query<{ cursor_seq: string; pending_count: number }>(
      'SELECT cursor_seq,pending_count FROM ai_runtime.memory_states WHERE user_id=$1',
      [userId],
    );
    expect(Number(state.rows[0]!.cursor_seq)).toBeLessThan(
      (await app.get(CHAT_READ_PORT).getConversation(cid)).lastSeq,
    );
    expect(state.rows[0]!.pending_count).toBeGreaterThan(0);
    await memory().extract(await job());
    const second = JSON.parse(calls[before + 1]!.messages[1]!.content) as {
      messages: { id: string }[];
    };
    expect(second.messages.some((m) => first.messages.some((f) => f.id === m.id))).toBe(false);
    response = '我听着呢\n今天过得怎么样？';
  }, 120_000); // 65条真实加密消息及事件派发；验证批次完整性，不是单次回复延迟指标。
  it('后台预算失败保留游标待重试，注销清单包含记忆；彻底删除只清除旧会话', async () => {
    await user('后台余额失败也不能丢这条记忆');
    failure = 'budget_exceeded';
    const before = await db.query<{ cursor_seq: string }>(
      'SELECT cursor_seq FROM ai_runtime.memory_states WHERE user_id=$1',
      [userId],
    );
    await memory().extract(await job());
    const after = await db.query<{ cursor_seq: string }>(
      'SELECT cursor_seq FROM ai_runtime.memory_states WHERE user_id=$1',
      [userId],
    );
    expect(after.rows).toEqual(before.rows);
    failure = null;
    expect(await store.countUserData(userId)).toBeGreaterThan(0);
    await app.get(ContactsCommands).remove(userId, characterId, 'purge');
    await dispatch();
    expect(
      (await db.query('SELECT id FROM ai_runtime.memories WHERE user_id=$1', [userId])).rows,
    ).toHaveLength(0);
    await store.purgeUser(userId);
    expect(await store.countUserData(userId)).toBe(0);
  });
});
