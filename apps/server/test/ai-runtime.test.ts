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
  TimelineSummaryResponse,
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
import {
  EcologySettingsService,
  ReplyPlanStore,
  ReplyEngine,
  replyPlans,
} from '../src/modules/ai-runtime/testing.js';
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
    // 一次生成 + 每条一次发送：T-20261103h 起一次回复最多 8 条（P-02 总上限），留足余量。
    for (let i = 0; i < 12; i++) {
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
  it('时间线真实HTTP校验身份/会话归属/查询；缺席12小时按后台预算生成', async () => {
    const path = `/api/v1/conversations/${cid}/timeline-summary`;
    const lastActiveAt = new Date(clock.nowMs() - 12 * 3600_000).toISOString();
    const query = { characterId, lastActiveAt };
    const eventDate = clock.now().toISOString().slice(0, 10);
    const createdAt = new Date(clock.nowMs() - 3600_000);
    await db.query(
      `INSERT INTO ai_runtime.daily_events
       (id,user_id,character_id,event_date,seq,kind,summary,created_at)
       VALUES ($1,$2,$3,$4,0,'work','时间线HTTP事件',$5)`,
      [newId(), userId, characterId, eventDate, createdAt],
    );
    const before = calls.length;
    await http().get(path).query(query).expect(401);
    await http().get(path).set('Authorization', auth()).expect(400);
    await http()
      .get(path)
      .query({ ...query, lastActiveAt: 'invalid' })
      .set('Authorization', auth())
      .expect(400);
    await http()
      .get(`/api/v1/conversations/${newId()}/timeline-summary`)
      .query(query)
      .set('Authorization', auth())
      .expect(404);
    await http()
      .get(path)
      .query({ ...query, characterId: newId() })
      .set('Authorization', auth())
      .expect(404);
    const short = TimelineSummaryResponse.parse(
      (
        await http()
          .get(path)
          .query({
            characterId,
            lastActiveAt: new Date(clock.nowMs() - 2 * 3600_000).toISOString(),
          })
          .set('Authorization', auth())
          .expect(200)
      ).body,
    );
    expect(short.summary).toBeNull();
    expect(calls).toHaveLength(before);
    // v5（57b7ba5）：「你不在时」摘要只给开着角色生态的 PRO+ 用户生成；没开时只列事件、不调模型。
    const inactive = TimelineSummaryResponse.parse(
      (await http().get(path).query(query).set('Authorization', auth()).expect(200)).body,
    );
    expect(inactive.events.map((e) => e.summary)).toEqual(['时间线HTTP事件']);
    expect(inactive.summary).toBeNull();
    expect(calls).toHaveLength(before);
    // 下面按「生态已开」验证生成路径（会员与开关由 ecology 模块自己的用例覆盖）。
    const ecologyActive = vi
      .spyOn(app.get(EcologySettingsService), 'isActive')
      .mockResolvedValue(true);
    // 5 分钟内重复进入视为同一次进入，沿用同一缺席基准（12 小时）。
    const result = TimelineSummaryResponse.parse(
      (await http().get(path).query(query).set('Authorization', auth()).expect(200)).body,
    );
    expect(result.events.map((e) => e.summary)).toEqual(['时间线HTTP事件']);
    expect(result.summary).toBe(response);
    expect(calls.at(-1)).toMatchObject({
      userId,
      characterId,
      conversationId: cid,
      purpose: 'behavior_planning',
      modelRole: 'background',
      countAsBackground: true,
    });
    failure = 'budget_exceeded';
    expect(
      (await http().get(path).query(query).set('Authorization', auth()).expect(200)).body.summary,
    ).toBeNull();
    failure = null;
    ecologyActive.mockRestore();
    await db.query('DELETE FROM ai_runtime.daily_events WHERE user_id=$1', [userId]);
    // 本用例的网关观测与事件夹具不进入后续回复用例的计数基线。
    calls.splice(before);
  });
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
    // T-20261103e：小巧思按 Math.random 抽签，抽中「撤回」会多发一条草稿（共 3 条），这正是 CI 上偶发
    // 「expected 3 to be 2」的来源。本用例只验证重启续发，固定不演小巧思（撤回续发由下面的撤回用例覆盖）。
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    const row = await user('重启前的问题');
    clock.advance(3000);
    try {
      await engine.run(row.id);
    } finally {
      choice.mockRestore();
    }
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
  }, 120000);
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
      // c4773a3：安全检查改走可信平台端口（平台付费），普通高危聊天不再带 safetyPriority 借透支；
      // 网关任何错误都由免费规则模板兜底，这里断言兜底完成且没有调用带透支标记。
      expect(calls.every((call) => !call.safetyPriority)).toBe(true);
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
  it('撤回小巧思真实发送：草稿撤回后正文清空，重启续发不重复', async () => {
    clock.advance(24 * 3600_000);
    const choice = vi.spyOn(engine.quirks, 'choose').mockResolvedValue({
      kind: 'recall',
      respondAt: clock.now().toISOString(),
      typingCycles: 0,
    });
    try {
      const row = await user('今天窗外阳光很好');
      clock.advance(3000);
      await engine.run(row.id);
      let pending = (await store.get(row.id))!;
      clock.advance(Math.max(0, pending.dueAt.getTime() - clock.nowMs()));
      await engine.run(row.id);
      pending = (await store.get(row.id))!;
      expect(pending.nextBubble).toBe(1);
      const draftId = ((await store.open(pending, 'result')) as { quirkDraftMessageId: string })
        .quirkDraftMessageId;
      expect(draftId).toBeTruthy();
      choice.mockRestore();
      await app.close();
      await startApp();
      await finish(row.id);
      await engine.run(row.id);
      const messages = await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 100 });
      const sent = messages.filter(
        (m: { seq: number; senderKind: string }) =>
          m.seq > row.triggerSeq && m.senderKind === 'character',
      );
      expect(sent).toHaveLength(3);
      expect(sent.find((m: { messageId: string }) => m.messageId === draftId)).toMatchObject({
        status: 'recalled',
        content: null,
        labels: ['quirk_draft'],
      });
      expect(
        sent
          .filter((m: { status: string }) => m.status === 'normal')
          .map((m: { content: { text: string } }) => m.content.text)
          .sort(),
      ).toEqual(response.split('\n').sort());
      expect((await store.get(row.id))?.resultCiphertext).toBeNull();
    } finally {
      choice.mockRestore();
    }
  });
  it('拼音错字小巧思真实发送：只改白名单同音词，独立更正气泡，幂等重试', async () => {
    const original = response;
    response = '我已经到家了';
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'typo', respondAt: clock.now().toISOString(), typingCycles: 0 });
    try {
      const row = await user('今天散步很舒服');
      await finish(row.id);
      await engine.run(row.id);
      const messages = await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 100 });
      expect(
        messages
          .filter(
            (m: { seq: number; senderKind: string }) =>
              m.seq > row.triggerSeq && m.senderKind === 'character',
          )
          .map((m: { content: { text: string } }) => m.content.text)
          .sort(),
      ).toEqual(['我以经到家了', '*已经'].sort());
      expect((await store.get(row.id))?.status).toBe('done');
    } finally {
      response = original;
      choice.mockRestore();
    }
  });
  it('已读延迟真实发送：首轮不立即发气泡，进程重启后按原定时间完成', async () => {
    const respondAt = new Date(clock.nowMs() + 60000).toISOString();
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'read_delay', respondAt, typingCycles: 0 });
    try {
      const row = await user('午后的云朵真好看');
      clock.advance(3000);
      await engine.run(row.id);
      const pending = (await store.get(row.id))!;
      expect(pending.status).toBe('sending');
      expect(pending.nextBubble).toBe(0);
      expect(pending.dueAt.getTime()).toBe(Date.parse(respondAt) - 1000);
      await engine.run(row.id);
      expect((await store.get(row.id))?.nextBubble).toBe(0);
      choice.mockRestore();
      await app.close();
      await startApp();
      await finish(row.id);
      expect((await store.get(row.id))?.status).toBe('done');
      expect(clock.nowMs()).toBeGreaterThanOrEqual(Date.parse(respondAt));
    } finally {
      choice.mockRestore();
    }
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
  it('模型写的表情标记在发出前剥掉：用户收到的正文里没有「[表情:…]」', async () => {
    response = '【正文】\n哈哈，太好了\n[表情:开心]';
    try {
      const row = await user('我今天考试过了');
      await finish(row.id);
      expect((await store.get(row.id))?.status).toBe('done');
      const messages = await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 10 });
      const replies = messages.filter(
        (m: { senderKind: string; seq: number }) =>
          m.senderKind === 'character' && m.seq > row.triggerSeq,
      );
      expect(replies.map((m: { content: unknown }) => m.content)).toContainEqual({
        type: 'text',
        text: '哈哈，太好了',
      });
      expect(JSON.stringify(replies)).not.toContain('表情:');
    } finally {
      response = '我听着呢\n今天过得怎么样？';
    }
  });
  it('T-20261103g：模型写的照片标记在发出前剥掉；没有素材时不发图', async () => {
    response = '【正文】\n给你看看我上周去的地方\n[照片]';
    try {
      const row = await user('最近去哪玩了');
      await finish(row.id);
      expect((await store.get(row.id))?.status).toBe('done');
      const messages = await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 10 });
      const replies = messages.filter(
        (m: { senderKind: string; seq: number }) =>
          m.senderKind === 'character' && m.seq > row.triggerSeq,
      );
      expect(replies.map((m: { content: unknown }) => m.content)).toContainEqual({
        type: 'text',
        text: '给你看看我上周去的地方',
      });
      expect(JSON.stringify(replies)).not.toContain('[照片]');
      expect(replies.some((m: { content: { type: string } }) => m.content.type === 'image')).toBe(
        false,
      );
    } finally {
      response = '我听着呢\n今天过得怎么样？';
    }
  });
  const repliesAfter = async (seq: number) =>
    (
      await app
        .get(CHAT_READ_PORT)
        .readMessages({ conversationId: cid, scopes: ['normal'], limit: 100 })
    ).filter(
      (m: { seq: number; senderKind: string }) => m.seq > seq && m.senderKind === 'character',
    );
  const sevenLines = '第一句\n第二句\n第三句\n第四句\n第五句\n第六句\n第七句';
  it('T-20261103h 六条正文 + 撤回草稿共 7 条：全部发完不合并，next_bubble = 7', async () => {
    clock.advance(24 * 3600_000);
    response = '第一句\n第二句\n第三句\n第四句\n第五句\n第六句';
    const choice = vi.spyOn(engine.quirks, 'choose').mockResolvedValue({
      kind: 'recall',
      respondAt: clock.now().toISOString(),
      typingCycles: 0,
    });
    try {
      const row = await user('给我讲讲今天发生的事');
      await finish(row.id);
      const ended = (await store.get(row.id))!;
      expect(ended).toMatchObject({ status: 'done', nextBubble: 7, resultCiphertext: null });
      const sent = await repliesAfter(row.triggerSeq);
      expect(sent).toHaveLength(7);
      const recalled = sent.filter((m: { status: string }) => m.status === 'recalled');
      expect(recalled).toHaveLength(1);
      expect(recalled[0]).toMatchObject({ labels: ['quirk_draft'] });
      expect(
        sent
          .filter((m: { status: string }) => m.status === 'normal')
          .map((m: { content: { text: string } }) => m.content.text)
          .sort(),
      ).toEqual(['第一句', '第二句', '第三句', '第四句', '第五句', '第六句'].sort());
    } finally {
      choice.mockRestore();
      response = '我听着呢\n今天过得怎么样？';
    }
  });
  it('T-20261103h 七行正文并成 6 条文字，再附一个作品链接共 7 条：照常发完', async () => {
    clock.advance(24 * 3600_000);
    response = sevenLines;
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    const link = {
      type: 'link' as const,
      url: 'https://example.com/work',
      title: '新歌',
      source: null,
      description: null,
      coverMediaId: null,
      appHint: 'web' as const,
    };
    // 附加内容由 planExtras 决定（真实素材库里没有表情 / 作品），这里固定附一个链接：文字 6 条 + 1 = 7 条。
    const extras = vi
      .spyOn(engine.mediaAi, 'planExtras')
      .mockImplementation(async (input) => [
        ...input.bubbles.map((text) => ({ type: 'text' as const, text })),
        link,
      ]);
    try {
      const row = await user('推荐一首你的歌');
      await finish(row.id);
      expect(extras.mock.calls[0]?.[0].bubbles).toEqual([
        '第一句',
        '第二句',
        '第三句',
        '第四句',
        '第五句',
        '第六句\n第七句',
      ]);
      expect(await store.get(row.id)).toMatchObject({
        status: 'done',
        nextBubble: 7,
        resultCiphertext: null,
      });
      const sent = await repliesAfter(row.triggerSeq);
      expect(sent.map((m: { content: { type: string } }) => m.content.type)).toEqual([
        ...Array<string>(6).fill('text'),
        'link',
      ]);
      expect(sent.at(-1)?.content).toMatchObject({ type: 'link', url: link.url });
    } finally {
      extras.mockRestore();
      choice.mockRestore();
      response = '我听着呢\n今天过得怎么样？';
    }
  });
  it('T-20261103h next_bubble 能写到 8：结果里有 8 条、已发到第 6 条的计划续发完；回滚迁移把超过 4 的压回', async () => {
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    const row = await user('结果里有八条');
    clock.advance(3000);
    try {
      await engine.run(row.id);
    } finally {
      choice.mockRestore();
    }
    const pending = (await store.get(row.id))!;
    expect(pending.status).toBe('sending');
    const result = (await store.open(pending, 'result')) as Record<string, unknown>;
    result.contents = ['一', '二', '三', '四', '五', '六', '七', '八'].map((text) => ({
      type: 'text',
      text,
    }));
    await db.transaction(async (tx) => {
      const cipher = await store.seal(tx, pending, 'result', result);
      await tx.db
        .update(replyPlans)
        .set({ resultCiphertext: cipher, nextBubble: 6 })
        .where(eq(replyPlans.id, row.id));
    });
    await finish(row.id);
    expect(await store.get(row.id)).toMatchObject({
      status: 'done',
      nextBubble: 8,
      resultCiphertext: null,
    });
    // 只续发第 7、8 条（前 6 条在这个构造里没真的发过）。
    expect(
      (await repliesAfter(row.triggerSeq)).map((m: { content: { text: string } }) => m.content.text),
    ).toEqual(['七', '八']);
    // 9 条超出约束：数据库直接拒绝（next_bubble 永远不超过 P-02 总上限 8）。
    await expect(
      db.query('UPDATE ai_runtime.reply_plans SET next_bubble=9 WHERE id=$1', [row.id]),
    ).rejects.toHaveProperty('code', '23514');

    // 回滚 0155：发送中的超 4 计划压回 4 并收尾，已结束的只改计数；之后再执行 0155 恢复 8 条上限。
    const sending = await user('回滚时还在发第 6 条');
    clock.advance(3000);
    const quiet = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    try {
      await engine.run(sending.id);
    } finally {
      quiet.mockRestore();
    }
    expect((await store.get(sending.id))?.status).toBe('sending');
    await db.query('UPDATE ai_runtime.reply_plans SET next_bubble=6 WHERE id=$1', [sending.id]);
    const sql = (name: string) =>
      readFileSync(resolve(import.meta.dirname, `../drizzle/${name}`), 'utf8');
    try {
      await db.query(sql('0155_reply_bubble_cap_8.down.sql'));
      const rows = (
        await db.query<{
          id: string;
          status: string;
          next_bubble: number;
          result_ciphertext: unknown;
        }>(
          'SELECT id,status,next_bubble,result_ciphertext FROM ai_runtime.reply_plans WHERE id = ANY($1)',
          [[row.id, sending.id]],
        )
      ).rows;
      expect(rows.find((r) => r.id === row.id)).toMatchObject({ status: 'done', next_bubble: 4 });
      expect(rows.find((r) => r.id === sending.id)).toMatchObject({
        status: 'done',
        next_bubble: 4,
        result_ciphertext: null,
      });
      await expect(
        db.query('UPDATE ai_runtime.reply_plans SET next_bubble=5 WHERE id=$1', [row.id]),
      ).rejects.toHaveProperty('code', '23514');
    } finally {
      await db.query(sql('0155_reply_bubble_cap_8.sql'));
    }
    await db.query('UPDATE ai_runtime.reply_plans SET next_bubble=8 WHERE id=$1', [row.id]);
  });
  it('T-20261103e 确定性数据库错误直接作废、不交给队列反复重试、已发的不重发；临时错误仍照常重试', async () => {
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    const row = await user('这句会碰到确定性错误');
    clock.advance(3000);
    try {
      await engine.run(row.id);
    } finally {
      choice.mockRestore();
    }
    let pending = (await store.get(row.id))!;
    clock.advance(Math.max(0, pending.dueAt.getTime() - clock.nowMs()));
    await engine.run(row.id);
    pending = (await store.get(row.id))!;
    expect(pending.nextBubble).toBe(1);
    clock.advance(Math.max(0, pending.dueAt.getTime() - clock.nowMs()));
    const post = vi.spyOn(engine.writer, 'postMessage');
    try {
      // 临时错误：照旧抛给任务队列重试，计划保持发送中。
      post.mockRejectedValueOnce(
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
      );
      await expect(engine.run(row.id)).rejects.toThrow('connection reset');
      expect((await store.get(row.id))?.status).toBe('sending');
      // 确定性错误（违反检查约束，Drizzle 把驱动错误包在 cause 里）：不再抛，计划作废并记原因。
      post.mockRejectedValueOnce(
        Object.assign(new Error('Failed query'), {
          cause: Object.assign(new Error('violates check constraint "reply_plan_counters"'), {
            code: '23514',
          }),
        }),
      );
      await expect(engine.run(row.id)).resolves.toBeUndefined();
    } finally {
      post.mockRestore();
    }
    expect(await store.get(row.id)).toMatchObject({
      status: 'cancelled',
      failure: 'db_23514',
      nextBubble: 1,
      resultCiphertext: null,
      inputCiphertext: null,
    });
    expect(logs.capture.text).toContain('ai_reply_permanent_failure');
    // 队列再投、对账再跑都不会再发：已发的第一条只有一条，第二条不发。
    await store.reconcile();
    await engine.run(row.id);
    expect(await repliesAfter(row.triggerSeq)).toHaveLength(1);
  });
  it('T-20261103e 等待巡检：临时故障按退避恢复并带「稍等」提示；超过 6 小时作废；积分不足的不碰', async () => {
    const choice = vi
      .spyOn(engine.quirks, 'choose')
      .mockResolvedValue({ kind: 'none', respondAt: null, typingCycles: 0 });
    try {
      // 1. 单次调用失败、没有「模型恢复」事件：巡检到点后恢复。
      failure = 'provider_unavailable';
      const row = await user('模型临时不可用时发的话');
      await finish(row.id);
      const waiting = (await store.get(row.id))!;
      expect(waiting.status).toBe('waiting');
      expect(waiting.dueAt.getTime()).toBe(clock.nowMs() + 5 * 60_000);
      failure = null;
      await store.sweepWaiting();
      expect((await store.get(row.id))?.status).toBe('waiting');
      clock.advance(5 * 60_000);
      const before = calls.length;
      expect((await store.sweepWaiting()).recovered).toBe(1);
      expect(await store.get(row.id)).toMatchObject({ status: 'queued', retryEpoch: 1 });
      await finish(row.id);
      expect((await store.get(row.id))?.status).toBe('done');
      expect(calls.length - before).toBe(1);
      expect(
        calls
          .at(-1)!
          .messages.some((m) => m.role === 'system' && String(m.content).includes('有意稍等')),
      ).toBe(true);

      // 2. 再次失败按退避推迟；从用户发消息算起超过 6 小时就作废，不再回复。
      failure = 'provider_unavailable';
      const old = await user('一直没等到回复的话');
      await finish(old.id);
      clock.advance(5 * 60_000);
      expect((await store.sweepWaiting()).recovered).toBe(1);
      await finish(old.id);
      const again = (await store.get(old.id))!;
      expect(again).toMatchObject({ status: 'waiting', retryEpoch: 1 });
      expect(again.dueAt.getTime()).toBe(clock.nowMs() + 10 * 60_000);
      failure = null;
      clock.advance(6 * 3600_000);
      const beforeExpire = calls.length;
      expect((await store.sweepWaiting()).expired).toBeGreaterThanOrEqual(1);
      expect(await store.get(old.id)).toMatchObject({
        status: 'cancelled',
        failure: 'wait_expired',
      });
      expect(calls.length).toBe(beforeExpire);

      // 3. 积分不足：巡检不碰，过了 6 小时也不作废；仍由原触发点（积分恢复 → recover）恢复。
      failure = 'insufficient_balance';
      const broke = await user('积分不足时发的话');
      await finish(broke.id);
      failure = null;
      clock.advance(7 * 3600_000);
      await store.sweepWaiting();
      expect(await store.get(broke.id)).toMatchObject({
        status: 'waiting',
        failure: 'insufficient_balance',
      });
      await store.recover(userId);
      expect((await store.get(broke.id))?.status).toBe('queued');
      await finish(broke.id);
      expect((await store.get(broke.id))?.status).toBe('done');
    } finally {
      failure = null;
      choice.mockRestore();
    }
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
