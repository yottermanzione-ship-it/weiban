import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  type GenerateTextInput,
  type ModelGatewayPort,
  type ChatUserPort,
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
import { CHAT_ADMIN_PORT, CHAT_READ_PORT, CHAT_USER_PORT } from '../src/modules/chat/index.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { ReplyPlanStore, ReplyEngine, replyPlans } from '../src/modules/ai-runtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
describeDb('ai-runtime 真实PG：设置/加密计划/合并/幂等/关怀/删除', () => {
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
  let generationGate: Promise<void> | null = null;
  let response = '我听着呢\n今天过得怎么样？';
  const gateway: ModelGatewayPort = {
    getModelStatus: async () => {
      throw Error('unused');
    },
    generateText: async (input) => {
      calls.push(input);
      if (generationGate) await generationGate;
      return failure
        ? { ok: false, error: failure as 'provider_unavailable' }
        : {
            ok: true,
            value: {
              text: response,
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
  it('陪伴默认继承；单独设置快照不随全局变化；未知好友拒绝、鉴权、更新同步', async () => {
    await http().get('/api/v1/me/companion-defaults').expect(401);
    expect(
      (await http().get('/api/v1/me/companion-defaults').set('Authorization', auth()).expect(200))
        .body,
    ).toMatchObject({ instantReply: false, splitBubbles: true });
    const path = `/api/v1/characters/${characterId}/companion-settings`;
    expect(
      (await http().get(path).set('Authorization', auth()).expect(200)).body.inheritsDefaults,
    ).toBe(true);
    await http().patch(path).set('Authorization', auth()).send({ instantReply: true }).expect(200);
    await http()
      .patch('/api/v1/me/companion-defaults')
      .set('Authorization', auth())
      .send({ splitBubbles: false })
      .expect(200);
    expect((await http().get(path).set('Authorization', auth()).expect(200)).body).toMatchObject({
      instantReply: true,
      splitBubbles: true,
      inheritsDefaults: false,
    });
    await http()
      .get(`/api/v1/characters/${newId()}/companion-settings`)
      .set('Authorization', auth())
      .expect(404);
  });
  it('十个并发角色设置在同一Tx检查好友资格，不嵌套申请连接耗尽池', async () => {
    const path = `/api/v1/characters/${characterId}/companion-settings`;
    const replies = await Promise.all(
      Array.from({ length: 10 }, () =>
        http().patch(path).set('Authorization', auth()).send({ instantReply: true }).expect(200),
      ),
    );
    expect(replies).toHaveLength(10);
  });
  it('接受事件持久计划；正文只在DEK密文，完成两气泡/重复执行不重复发', async () => {
    await dispatch();
    const row = (await plans()).find((p) => p.kind === 'greeting')!;
    expect(row).toBeDefined();
    await engine.run(row.id);
    const generating = (await store.get(row.id))!;
    expect(generating.status).toBe('sending');
    expect(generating.resultCiphertext!.toString()).not.toContain('我听着');
    expect(generating.inputCiphertext!.toString()).not.toContain('AI_GREETING_PRIVATE_CANARY');
    await finish(row.id);
    const messages = await app
      .get(CHAT_READ_PORT)
      .readMessages({ conversationId: cid, scopes: ['normal'], limit: 50 });
    expect(
      messages.filter((m: { senderKind: string }) => m.senderKind === 'character'),
    ).toHaveLength(2);
    await engine.run(row.id);
    expect(calls).toHaveLength(1);
    expect((await store.get(row.id))?.resultCiphertext).toBeNull();
    expect(logs.capture.text).not.toContain('AI_GREETING_PRIVATE_CANARY');
  });
  it('连续用户消息延后三秒合并，只生成一次最新批次，重复任务幂等', async () => {
    const before = calls.length;
    const first = await user('你好');
    clock.advance(1000);
    const second = await user('我还有一句');
    await engine.run(first.id);
    clock.advance(3000);
    await engine.run(first.id);
    await finish(second.id);
    expect((await store.get(first.id))?.status).toBe('cancelled');
    expect(calls.length - before).toBe(1);
    expect(
      calls
        .at(-1)!
        .messages.filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(''),
    ).toContain('我还有一句');
  });
  it('用户在模型生成中补发：旧回复稍后送达也不能吞掉新批次，两批各生成一次', async () => {
    const first = await user('第一批已经进入生成');
    clock.advance(3000);
    let release = () => {};
    generationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = calls.length;
    const generating = engine.run(first.id);
    let second: typeof first;
    try {
      await vi.waitFor(() => expect(calls.length).toBe(before + 1));
      second = await user('生成中补充的第二批');
      expect(
        calls
          .at(-1)!
          .messages.map((m) => m.content)
          .join(''),
      ).not.toContain('生成中补充的第二批');
    } finally {
      generationGate = null;
      release();
    }
    await generating;
    await finish(first.id);
    await finish(second!.id);
    expect((await store.get(second!.id))?.status).toBe('done');
    expect(calls.length - before).toBe(2);
    expect(
      calls
        .at(-1)!
        .messages.map((m) => m.content)
        .join(''),
    ).toContain('生成中补充的第二批');
  });
  it('已生成并发送第一气泡后重启应用，继续剩余气泡、不重新生成或重发第一条', async () => {
    const row = await user('重启前的问题');
    clock.advance(3000);
    await engine.run(row.id);
    const generated = (await store.get(row.id))!;
    clock.advance(Math.max(0, generated.dueAt.getTime() - clock.nowMs()));
    await engine.run(row.id);
    expect((await store.get(row.id))?.nextBubble).toBe(1);
    const before = calls.length;
    await app.close();
    await startApp();
    await finish(row.id);
    expect(calls.length).toBe(before);
    expect((await store.get(row.id))?.status).toBe('done');
    expect((await store.get(row.id))?.nextBubble).toBe(2);
  });
  it('普通模型不可用保持已送达并等待；恢复多条合并一次，角色不解释技术原因', async () => {
    failure = 'provider_unavailable';
    const first = await user('等你回复');
    await finish(first.id);
    expect((await store.get(first.id))?.status).toBe('waiting');
    const second = await user('另一句');
    await finish(second.id);
    expect((await store.get(second.id))?.status).toBe('waiting');
    failure = null;
    const before = calls.length;
    await store.recover(userId);
    await finish(first.id);
    await finish(second.id);
    expect(calls.length - before).toBe(1);
    expect((await store.get(second.id))?.status).toBe('done');
  });
  it('同一真实会话超过200个待回复批次恢复仍只有最新批次，一次合并、不残留旧waiting', async () => {
    const sender = app.get<ChatUserPort>(CHAT_USER_PORT);
    for (let i = 0; i < 201; i++)
      await sender.sendMessage(userId, cid, {
        clientMsgId: newId(),
        content: { type: 'text', text: `未回复的第${i}句` },
      });
    await dispatch();
    await db.db
      .update(replyPlans)
      .set({ status: 'waiting' })
      .where(eq(replyPlans.status, 'queued'));
    const before = calls.length;
    await store.recover(userId);
    const waiting = (await plans()).filter((p) => p.status === 'waiting');
    const queued = (await plans()).filter((p) => p.status === 'queued');
    expect(waiting).toHaveLength(0);
    expect(queued).toHaveLength(1);
    await finish(queued[0]!.id);
    expect(calls.length - before).toBe(1);
  });
  it('高危所有网关错误仍发免费关怀，不进入恢复补发，不把正文写审计', async () => {
    const fallbackFirsts: string[] = [];
    for (const error of [
      'insufficient_balance',
      'budget_exceeded',
      'provider_unavailable',
      'model_unavailable',
      'not_configured',
      'model_not_allowed',
      'policy_denied',
      'bad_request',
      'content_rejected',
      'capability_missing',
    ]) {
      failure = error;
      const row = await user('我不想活了，AI_SAFETY_PRIVATE_CANARY');
      await finish(row.id);
      expect((await store.get(row.id))?.status).toBe('done');
      expect(calls.at(-1)?.safetyPriority).toBe(true);
      const latest = await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 2 });
      fallbackFirsts.push(latest[0]?.content?.text ?? '');
    }
    const messages = await app
      .get(CHAT_READ_PORT)
      .readMessages({ conversationId: cid, scopes: ['normal'], limit: 50 });
    const roles = messages.filter((m: { senderKind: string }) => m.senderKind === 'character');
    expect(
      roles.map((m: { content: { text?: string } | null }) => m.content?.text ?? '').join(''),
    ).toContain('12356');
    expect(new Set(fallbackFirsts.slice(0, 3)).size).toBe(3);
    expect(fallbackFirsts[3]).toBe(fallbackFirsts[0]);
    const audit = await db.query<{ details: unknown }>(
      "SELECT details FROM platform.audit_log WHERE module='ai_runtime'",
    );
    expect(JSON.stringify(audit.rows)).not.toContain('AI_SAFETY_PRIVATE_CANARY');
    failure = null;
  });
  it('资格在生成前收紧：只本地预筛旧成人触发，不把成人历史交给儿童模型，降normal免费关怀', async () => {
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'adult' });
    const row = await user('我不想活了，PRIVATE_ADULT_HIGH_RISK');
    await db.query("UPDATE characters.characters SET age_setting='minor' WHERE id=$1", [
      characterId,
    ]);
    const before = calls.length;
    await finish(row.id);
    expect(calls.length).toBe(before);
    expect((await store.get(row.id))?.status).toBe('done');
    expect((await app.get(CHAT_READ_PORT).getConversation(cid)).contentScope).toBe('normal');
    const latest = await app
      .get(CHAT_READ_PORT)
      .readMessages({ conversationId: cid, scopes: ['normal'], limit: 2 });
    expect(
      latest.map((m: { content: { text?: string } | null }) => m.content?.text ?? '').join(''),
    ).toContain('12356');
    await db.query("UPDATE characters.characters SET age_setting='adult' WHERE id=$1", [
      characterId,
    ]);
  });
  it('生成后资格收紧或不当称呼：不能沉默或发成人/技术称呼，安全降级仍完整发两气泡', async () => {
    await app.get(CHAT_ADMIN_PORT).setContentScope({ conversationId: cid, scope: 'adult' });
    await app
      .get(ContactsCommands)
      .update(userId, characterId, { addressAs: 'API系统模型余额性交' });
    response = '我是你的男朋友，爱上你了\n我在这里陪你';
    const row = await user('我不想活了');
    clock.advance(3000);
    await engine.run(row.id);
    expect((await store.get(row.id))?.status).toBe('sending');
    await db.query("UPDATE characters.characters SET age_setting='minor' WHERE id=$1", [
      characterId,
    ]);
    await finish(row.id);
    expect((await store.get(row.id))?.status).toBe('done');
    const latest = await app
      .get(CHAT_READ_PORT)
      .readMessages({ conversationId: cid, scopes: ['normal'], limit: 2 });
    const text = latest
      .map((m: { content: { text?: string } | null }) => m.content?.text ?? '')
      .join('');
    expect(text).toContain('12356');
    expect(text).not.toMatch(/爱上你|男朋友|API|系统|模型|余额|性交/iu);
    await db.query("UPDATE characters.characters SET age_setting='adult' WHERE id=$1", [
      characterId,
    ]);
    await app.get(ContactsCommands).update(userId, characterId, { addressAs: null });
    response = '我听着呢\n今天过得怎么样？';
  });
  it('尚未生成的旧计划在删除恢复后不能认领新关系版本，旧事件不产生模型调用', async () => {
    const row = await user('旧关系里尚未生成的请求');
    const before = calls.length;
    const commands = app.get(ContactsCommands);
    await commands.remove(userId, characterId, 'soft');
    await commands.add(userId, { characterId, restoreMode: 'restore' });
    const pending = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(pending.accept_after.getTime() - clock.nowMs());
    await commands.accept({ userId, characterId, requestId: pending.request_id });
    await finish(row.id);
    expect((await store.get(row.id))?.status).toBe('cancelled');
    expect(calls.length).toBe(before);
  });
  it('停机导致待处理计划原期限已过，恢复仍有界调用并回复，不永久waiting', async () => {
    const row = await user('恢复后也请回应这句');
    clock.advance(61000);
    const before = calls.length;
    await finish(row.id);
    expect((await store.get(row.id))?.status).toBe('done');
    expect(calls.length - before).toBe(1);
    expect(Date.parse(calls.at(-1)!.deadlineAt!)).toBeGreaterThan(clock.nowMs());
  });
  it('生成中删除好友；旧计划不得在恢复的同一会话发言；物理清除与账号清单', async () => {
    const row = await user('再见');
    clock.advance(3000);
    await engine.run(row.id);
    expect((await store.get(row.id))?.status).toBe('sending');
    const commands = app.get(ContactsCommands);
    await commands.remove(userId, characterId, 'soft');
    await commands.add(userId, { characterId, restoreMode: 'restore' });
    const pending = (await new ContactsTestQueries(db).row(userId, characterId))!;
    clock.advance(pending.accept_after.getTime() - clock.nowMs());
    await commands.accept({ userId, characterId, requestId: pending.request_id });
    await finish(row.id);
    expect((await store.get(row.id))?.status).toBe('cancelled');
    await store.purgeUser(userId);
    expect(await store.countUserData(userId)).toBe(0);
    expect(await store.purgeUser(userId)).toBe(0);
    await db.db.delete(replyPlans).where(eq(replyPlans.userId, userId));
  });
});
