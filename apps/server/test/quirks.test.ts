import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  QuirkService,
  ReplyPlanStore,
  ReplySnapshot,
  replyPlans,
  type ReplyPlan,
  type QuirkAction,
  type QuirkKind,
} from '../src/modules/ai-runtime/testing.js';
import { TestClock, newId, JOB_QUEUE, type JobQueue } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('私聊小巧思真实PG配额、抢占、重试和注销', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let service: QuirkService;
  let store: ReplyPlanStore;
  let userId: string;
  const characterId = newId();
  const clock = new TestClock('2026-10-11T15:59:00Z');
  beforeAll(async () => {
    await resetTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    userId = await moduleRef
      .get(IdentityCommands)
      .createAdmin('quirks_owner', 'correct horse battery');
    service = moduleRef.get(QuirkService);
    store = moduleRef.get(ReplyPlanStore);
    await moduleRef.get<JobQueue>(JOB_QUEUE).start();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await moduleRef?.close();
  });

  async function plan(character = characterId): Promise<ReplyPlan> {
    const [row] = await store.db.db
      .insert(replyPlans)
      .values({
        id: newId(),
        userId,
        characterId: character,
        conversationId: newId(),
        triggerId: newId(),
        triggerSeq: 1,
        kind: 'message',
        status: 'generating',
        dueAt: clock.now(),
        createdAt: clock.now(),
        leaseId: newId(),
        leaseUntil: new Date(clock.nowMs() + 120_000),
      })
      .returning();
    return row!;
  }
  function action(kind: QuirkKind): QuirkAction {
    return {
      kind,
      respondAt: new Date(clock.nowMs() + 30_000).toISOString(),
      typingCycles: kind === 'shy_typing' ? 2 : 0,
    };
  }
  function reserve(row: ReplyPlan, kind: QuirkKind) {
    return store.db.transaction((tx) => service.reserve(tx, row, action(kind), 'Asia/Shanghai'));
  }

  it('并发预留不突破P11；害羞输入与已读延迟共享同一日配额', async () => {
    const plans = await Promise.all(Array.from({ length: 12 }, () => plan()));
    const results = await Promise.all(
      plans.map((row, i) => reserve(row, i % 2 ? 'shy_typing' : 'read_delay')),
    );
    expect(results.filter((r) => r.kind !== 'none')).toHaveLength(1);
    expect((await reserve(await plan(), 'shy_typing')).kind).toBe('none');
    const count = await store.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM ai_runtime.quirk_actions WHERE user_id=$1 AND character_id=$2',
      [userId, characterId],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
  });

  it('当地午夜重置，其他角色隔离；错字并发最多2次', async () => {
    clock.advance(120_000);
    expect((await reserve(await plan(), 'read_delay')).kind).toBe('read_delay');
    expect((await reserve(await plan(newId()), 'read_delay')).kind).toBe('read_delay');
    const days = await store.db.query<{ local_date: string }>(
      'SELECT DISTINCT local_date FROM ai_runtime.quirk_actions WHERE user_id=$1 AND character_id=$2 ORDER BY local_date',
      [userId, characterId],
    );
    expect(days.rows.map((r) => r.local_date)).toEqual(['2026-10-11', '2026-10-12']);
    const plans = await Promise.all(Array.from({ length: 10 }, () => plan()));
    const results = await Promise.all(plans.map((row) => reserve(row, 'typo')));
    expect(results.filter((r) => r.kind === 'typo')).toHaveLength(2);
    const chosen = plans[results.findIndex((r) => r.kind === 'typo')]!;
    expect((await reserve(chosen, 'typo')).kind).toBe('typo');
    expect((await reserve(await plan(), 'typo')).kind).toBe('none');
  });

  it('过期生成租约或伪造所属用户不能消耗配额', async () => {
    const row = await plan(newId());
    expect((await reserve({ ...row, leaseId: newId() }, 'recall')).kind).toBe('none');
    const outsider = await moduleRef
      .get(IdentityCommands)
      .createAdmin('quirks_other', 'correct horse battery');
    expect((await reserve({ ...row, userId: outsider }, 'recall')).kind).toBe('none');
    expect((await reserve(row, 'recall')).kind).toBe('recall');
  });

  it('新的消息取消冷落延迟，已生成密文清除，不被旧计划阻塞', async () => {
    const row = await plan(newId());
    expect((await reserve(row, 'read_delay')).kind).toBe('read_delay');
    await store.db.db
      .update(replyPlans)
      .set({
        status: 'sending',
        inputCiphertext: Buffer.from('old-input'),
        resultCiphertext: Buffer.from('old-result'),
      })
      .where(eq(replyPlans.id, row.id));
    await store.db.transaction((tx) =>
      store.enqueue(tx, {
        userId,
        characterId: row.characterId,
        conversationId: row.conversationId,
        triggerId: newId(),
        triggerSeq: 2,
        kind: 'message',
      }),
    );
    const current = await store.get(row.id);
    expect(current?.status).toBe('cancelled');
    expect(current?.inputCiphertext).toBeNull();
    expect(current?.resultCiphertext).toBeNull();
  });

  it('害羞输入变体在并发worker和重试中最多消费一次', async () => {
    const row = await plan(newId());
    expect((await reserve(row, 'shy_typing')).kind).toBe('shy_typing');
    await store.db.db
      .update(replyPlans)
      .set({ status: 'sending' })
      .where(eq(replyPlans.id, row.id));
    const results = await Promise.all(Array.from({ length: 8 }, () => service.consumeTyping(row)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await service.consumeTyping(row)).toBe(false);
  });

  it('关怀与疑似高风险根本不调用规划层', async () => {
    const row = await plan(newId());
    const decide = vi.spyOn(service.planner, 'decide');
    const snapshot = ReplySnapshot.parse({
      triggerAt: clock.now().toISOString(),
      deadlineAt: new Date(clock.nowMs() + 60_000).toISOString(),
      epoch: newId(),
      participantId: newId(),
      scope: 'normal',
      lastUserSeq: 1,
      messages: [],
      personaVersion: 1,
      promptTemplateVersion: 'test',
      instantReply: false,
      splitBubbles: false,
      highRisk: false,
      forceCareFallback: false,
      careActive: false,
      suspected: false,
      careVariant: 0,
      careFallback: '我在这里',
      fallbackGreetings: [],
      deflect: '换个话题',
      addressAs: null,
      policy: { isMinor: false, isRealPerson: false, romanceAllowed: true },
      personaFit: 5,
      personaTags: ['tsundere'],
      typoStyle: 'pinyin',
      userText: '今天看到了猫',
    });
    for (const flags of [
      { highRisk: true },
      { careActive: true },
      { suspected: true },
      { healthUsed: true },
    ])
      expect((await service.choose(row, { ...snapshot, ...flags })).kind).toBe('none');
    expect(decide).not.toHaveBeenCalled();
    decide.mockRestore();
  });

  it('注销清除行为配额，迟到worker不重建用户数据', async () => {
    const row = await plan(newId());
    await store.db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [userId]);
    await store.purgeUser(userId);
    expect((await reserve(row, 'recall')).kind).toBe('none');
    expect(await store.countUserData(userId)).toBe(0);
  });
});
