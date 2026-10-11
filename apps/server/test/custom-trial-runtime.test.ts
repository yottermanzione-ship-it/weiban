import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AuthResponse,
  type ChatReadPort,
  type ChatUserPort,
  type GenerateTextInput,
  type ModelGatewayPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  EVENT_DISPATCHER,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type UserDataRegistry,
  TestClock,
  newId,
  type Database,
  type EventDispatcher,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { DeletionService } from '../src/modules/identity/testing.js';
import { CHAT_READ_PORT, CHAT_USER_PORT } from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { ReplyEngine, ReplyPlanStore } from '../src/modules/ai-runtime/testing.js';
import { CharacterTrialService } from '../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('CHR-07 保存前试聊：真实会话/回复/关闭/授权/过期', () => {
  let app: INestApplication;
  let db: Database;
  let userId: string;
  let token: string;
  let otherToken: string;
  const clock = new TestClock('2026-10-11T08:00:00Z');
  const calls: GenerateTextInput[] = [];
  let gate: Promise<void> | null = null;
  let entered = () => {};
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw new Error('unused');
    },
    generateText: async (input) => {
      calls.push(input);
      entered();
      if (gate) await gate;
      return {
        ok: true,
        value: {
          text: '我在这儿呢\n今天想聊点什么？',
          modelKey: 'test/model',
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
          chargedMicros: 1,
          latencyMs: 1,
          usageRecordId: newId(),
        },
      };
    },
  };
  const http = () => request(app.getHttpServer());
  const auth = (value = token) => `Bearer ${value}`;
  const body = {
    name: '临时试聊角色',
    description:
      '这是一位喜欢观察日常生活的原创角色，性格温柔耐心，喜欢晴天散步和读书，说话自然简洁，尊重他人边界，不编造真实经历。',
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
    tags: ['shy'],
    catchphrases: ['慢慢说'],
    speechStyle: '自然简短',
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
      .overrideProvider(MODEL_GATEWAY_PORT)
      .useValue(gateway)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    const identity = app.get(IdentityCommands);
    userId = await identity.createAdmin('trial_owner', 'horse battery staple');
    await identity.setRole('trial_owner', 'user');
    await identity.createAdmin('trial_other', 'horse battery staple');
    await identity.setRole('trial_other', 'user');
    async function login(username: string) {
      return AuthResponse.parse(
        (
          await http()
            .post('/api/v1/auth/login')
            .send({
              username,
              password: 'horse battery staple',
              kind: 'app',
              device: {
                platform: 'web',
                name: 'trial',
                appVersion: '0.1.0',
                timeZone: 'Asia/Shanghai',
              },
            })
            .expect(200)
        ).body,
      ).session.token;
    }
    token = await login('trial_owner');
    otherToken = await login('trial_other');
  });
  afterAll(async () => {
    await app?.close();
  });
  async function createTrial() {
    return (
      await http()
        .post('/api/v1/characters/custom/trial')
        .set('Authorization', auth())
        .send(body)
        .expect(200)
    ).body as { characterId: string; conversationId: string; expiresAt: string };
  }
  async function dispatch() {
    for (let i = 0; i < 20; i++)
      if ((await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200)).claimed === 0)
        return;
    throw new Error('event backlog');
  }
  async function send(conversationId: string) {
    await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, conversationId, {
      clientMsgId: newId(),
      content: { type: 'text', text: '今天散步看到了蓝色的天空' },
    });
    await dispatch();
    const row = await db.query<{ id: string }>(
      'SELECT id FROM ai_runtime.reply_plans WHERE conversation_id=$1 ORDER BY trigger_seq DESC LIMIT 1',
      [conversationId],
    );
    expect(row.rows[0]).toBeDefined();
    return row.rows[0]!.id;
  }
  async function finish(id: string) {
    const store = app.get(ReplyPlanStore);
    for (let i = 0; i < 6; i++) {
      const row = await store.get(id);
      if (!row || ['done', 'cancelled', 'waiting'].includes(row.status)) return;
      clock.advance(Math.max(0, row.dueAt.getTime() - clock.nowMs()));
      await app.get(ReplyEngine).run(id);
    }
    throw new Error('reply did not finish');
  }
  it('保存前临时角色不出现在我的角色，不可添加好友，但真实消息能收到回复', async () => {
    const trial = await createTrial();
    await http()
      .patch(`/api/v1/characters/custom/${trial.characterId}`)
      .set('Authorization', auth())
      .send({ name: '试图改变临时快照' })
      .expect(404);
    const list = await http()
      .get('/api/v1/characters/custom')
      .set('Authorization', auth())
      .expect(200);
    expect(list.body.items).toEqual([]);
    await http()
      .post('/api/v1/contacts')
      .set('Authorization', auth())
      .send({ characterId: trial.characterId })
      .expect(422);
    const id = await send(trial.conversationId);
    await finish(id);
    expect((await app.get(ReplyPlanStore).get(id))?.status).toBe('done');
    const messages = await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .readMessages({ conversationId: trial.conversationId, scopes: ['normal'], limit: 20 });
    expect(
      messages
        .filter((m) => m.senderKind === 'character')
        .map((m) => (m.content?.type === 'text' ? m.content.text : '')),
    ).toEqual(['我在这儿呢', '今天想聊点什么？']);
    expect(
      messages
        .filter((m) => m.senderKind === 'character')
        .every((m) => m.labels?.includes('trial')),
    ).toBe(true);
    const visible = await http()
      .get('/api/v1/conversations')
      .set('Authorization', auth())
      .expect(200);
    expect(visible.body.items).toEqual([]);
    await dispatch();
    for (const table of ['memories', 'memory_states', 'simulation_states', 'quirk_actions'])
      expect(
        (
          await db.query(`SELECT 1 FROM ai_runtime.${table} WHERE character_id=$1`, [
            trial.characterId,
          ])
        ).rows,
      ).toHaveLength(0);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth(otherToken))
      .expect(404);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(
      await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(trial.conversationId),
    ).toBeNull();
    expect(await app.get(ReplyPlanStore).get(id)).toBeNull();
    expect(
      (await db.query('SELECT id FROM characters.characters WHERE id=$1', [trial.characterId]))
        .rows,
    ).toHaveLength(0);
  });
  it('模型生成期间关闭，晚到结果不创建消息或复活试聊', async () => {
    const trial = await createTrial();
    const id = await send(trial.conversationId);
    clock.advance(3000);
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const generating = app.get(ReplyEngine).run(id);
    try {
      await reached;
      await http()
        .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
        .set('Authorization', auth())
        .expect(200);
    } finally {
      gate = null;
      entered = () => {};
      release();
    }
    await generating;
    expect(await app.get(ReplyPlanStore).get(id)).toBeNull();
    expect(
      await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(trial.conversationId),
    ).toBeNull();
    expect(
      (
        await db.query('SELECT id FROM chat.messages WHERE conversation_id=$1', [
          trial.conversationId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it('已保存角色的试聊使用独立快照，关闭不清除已有好友会话', async () => {
    const saved = (
      await http()
        .post('/api/v1/characters/custom')
        .set('Authorization', auth())
        .send(body)
        .expect(200)
    ).body as { characterId: string };
    const commands = app.get(ContactsCommands);
    await commands.add(userId, { characterId: saved.characterId });
    const contact = (await new ContactsTestQueries(db).row(userId, saved.characterId))!;
    clock.advance(contact.accept_after.getTime() - clock.nowMs());
    await commands.accept({
      userId,
      characterId: saved.characterId,
      requestId: contact.request_id,
    });
    const formal = (await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .findDirectConversation(userId, saved.characterId))!;
    await app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, formal.conversationId, {
      clientMsgId: newId(),
      content: { type: 'text', text: '正式好友历史要保留' },
    });
    const before = await app
      .get<ChatReadPort>(CHAT_READ_PORT)
      .readMessages({ conversationId: formal.conversationId, scopes: ['normal'], limit: 20 });
    const trial = (
      await http()
        .post(`/api/v1/characters/custom/${saved.characterId}/trial`)
        .set('Authorization', auth())
        .expect(200)
    ).body as { conversationId: string };
    expect(trial.conversationId).not.toBe(formal.conversationId);
    const reused = await http()
      .post(`/api/v1/characters/custom/${saved.characterId}/trial`)
      .set('Authorization', auth())
      .expect(200);
    expect(reused.body.conversationId).toBe(trial.conversationId);
    const id = await send(trial.conversationId);
    await finish(id);
    expect((await app.get(ReplyPlanStore).get(id))?.status).toBe('done');
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(
      await app
        .get<ChatReadPort>(CHAT_READ_PORT)
        .readMessages({ conversationId: formal.conversationId, scopes: ['normal'], limit: 20 }),
    ).toEqual(before);
    expect((await new ContactsTestQueries(db).row(userId, saved.characterId))?.status).toBe(
      'active',
    );
  });
  it('来源角色资格变严后，旧试聊快照不得继续发送', async () => {
    const saved = (
      await http()
        .post('/api/v1/characters/custom')
        .set('Authorization', auth())
        .send(body)
        .expect(200)
    ).body as { characterId: string };
    const trial = (
      await http()
        .post(`/api/v1/characters/custom/${saved.characterId}/trial`)
        .set('Authorization', auth())
        .expect(200)
    ).body as { conversationId: string };
    const id = await send(trial.conversationId);
    clock.advance(3000);
    await app.get(ReplyEngine).run(id);
    expect((await app.get(ReplyPlanStore).get(id))?.status).toBe('sending');
    await http()
      .patch(`/api/v1/characters/custom/${saved.characterId}`)
      .set('Authorization', auth())
      .send({ classification: { ...body.classification, ageSetting: 'minor' } })
      .expect(200);
    await finish(id);
    expect((await app.get(ReplyPlanStore).get(id))?.status).toBe('cancelled');
    expect(
      (
        await app
          .get<ChatReadPort>(CHAT_READ_PORT)
          .readMessages({ conversationId: trial.conversationId, scopes: ['normal'], limit: 20 })
      ).filter((m) => m.senderKind === 'character'),
    ).toHaveLength(0);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth())
      .expect(200);
  });
  it('并发启动已保存角色只复用同一试聊，编辑快照独立且继承分类限制', async () => {
    const saved = (
      await http()
        .post('/api/v1/characters/custom')
        .set('Authorization', auth())
        .send(body)
        .expect(200)
    ).body as { characterId: string };
    const starts = await Promise.all(
      Array.from({ length: 5 }, () =>
        http()
          .post(`/api/v1/characters/custom/${saved.characterId}/trial`)
          .set('Authorization', auth())
          .expect(200),
      ),
    );
    expect(new Set(starts.map((response) => response.body.conversationId)).size).toBe(1);
    const preview = (
      await http()
        .post('/api/v1/characters/custom/trial')
        .set('Authorization', auth())
        .send({ ...body, sourceCharacterId: saved.characterId, name: '编辑中的新名字' })
        .expect(200)
    ).body as { conversationId: string };
    expect(preview.conversationId).not.toBe(starts[0]!.body.conversationId);
    await http()
      .post('/api/v1/characters/custom/trial')
      .set('Authorization', auth(otherToken))
      .send({ ...body, sourceCharacterId: saved.characterId })
      .expect(404);
    await http()
      .patch(`/api/v1/characters/custom/${saved.characterId}`)
      .set('Authorization', auth())
      .send({ classification: { ...body.classification, ageSetting: 'minor' } })
      .expect(200);
    await http()
      .post('/api/v1/characters/custom/trial')
      .set('Authorization', auth())
      .send({ ...body, sourceCharacterId: saved.characterId })
      .expect(403);
    for (const conversationId of [preview.conversationId, starts[0]!.body.conversationId])
      await http()
        .delete(`/api/v1/characters/custom/trial/${conversationId}`)
        .set('Authorization', auth())
        .expect(200);
  });
  it('过期试聊不再生成，定时清理物理删除临时快照和会话', async () => {
    const trial = await createTrial();
    const id = await send(trial.conversationId);
    clock.advance(30 * 60_000);
    await expect(
      app.get<ChatUserPort>(CHAT_USER_PORT).sendMessage(userId, trial.conversationId, {
        clientMsgId: newId(),
        content: { type: 'text', text: '已过期的试聊消息' },
      }),
    ).rejects.toThrow();
    const before = calls.length;
    await finish(id);
    expect(calls.length).toBe(before);
    expect((await app.get(ReplyPlanStore).get(id))?.status).toBe('cancelled');
    await app.get(CharacterTrialService).expire();
    expect(
      await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(trial.conversationId),
    ).toBeNull();
    expect(
      (
        await db.query(
          'SELECT conversation_id FROM characters.trial_sessions WHERE conversation_id=$1',
          [trial.conversationId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('编辑文本删去儿童词仍继承原角色检测标记', async () => {
    const saved = (
      await http()
        .post('/api/v1/characters/custom')
        .set('Authorization', auth())
        .send({ ...body, description: `这个角色只有8岁，在读小学。${body.description}` })
        .expect(200)
    ).body as { characterId: string; childFeaturesDetected: boolean };
    expect(saved.childFeaturesDetected).toBe(true);
    const trial = (
      await http()
        .post('/api/v1/characters/custom/trial')
        .set('Authorization', auth())
        .send({ ...body, sourceCharacterId: saved.characterId })
        .expect(200)
    ).body as { characterId: string; conversationId: string };
    const role = await http()
      .get(`/api/v1/characters/${trial.characterId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(
      (
        await db.query<{ detected: boolean }>(
          'SELECT child_features_detected AS detected FROM characters.characters WHERE id=$1',
          [trial.characterId],
        )
      ).rows[0]?.detected,
    ).toBe(true);
    expect(role.body.classification.derived.adultModeEligible).toBe(false);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.conversationId}`)
      .set('Authorization', auth())
      .expect(200);
  });
  it('真实注销编排清除试聊、会话与回复计划，晚到回复不能重建数据', async () => {
    const trial = await createTrial();
    const id = await send(trial.conversationId);
    await http()
      .delete('/api/v1/me')
      .set('Authorization', auth())
      .send({ password: 'horse battery staple', confirm: 'DELETE' })
      .expect(202);
    await dispatch();
    const registry = app.get<UserDataRegistry>(USER_DATA_REGISTRY);
    // Web 进程只投递任务；显式执行真实 worker 处理器，保持回复计划由测试控制。
    for (const module of registry.modules().filter((module) => module !== 'identity'))
      await app.get(DeletionService).runPurgeJob({ userId, module });
    await dispatch();
    expect(await app.get(IdentityCommands).verifyPurged(userId)).toEqual(
      registry.modules().map((module) => ({ module, count: 0 })),
    );
    await app.get(ReplyEngine).run(id);
    expect(await app.get(ReplyPlanStore).get(id)).toBeNull();
    expect(
      await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(trial.conversationId),
    ).toBeNull();
    expect(
      (
        await db.query('SELECT character_id FROM characters.trial_sessions WHERE user_id=$1', [
          userId,
        ])
      ).rows,
    ).toHaveLength(0);
  }, 120_000);
});
