import 'reflect-metadata';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { GenerateTextInput } from '@weiban/contracts';
import { Database, TestClock, newId, modelTaskKey } from '../src/platform/index.js';
import {
  EcologyService,
  PlannerService,
  ProactiveSchedulerService,
  proactivePlans,
  wakeSlots,
} from '../src/modules/ai-runtime/testing.js';
import { UsageRecorder, TaskOutcomeService } from '../src/modules/model-access/testing.js';
import {
  describeDb,
  resetTestDatabase,
  roundTripMigration,
  requireTestDatabaseUrl,
} from './support/db.js';

describeDb('background model tasks keep one owner across eligible attempts', () => {
  let db: Database;
  const day = '2026-11-20';
  beforeAll(async () => {
    await resetTestDatabase();
    await roundTripMigration('0170_background_model_deferral');
    db = new Database({ url: requireTestDatabaseUrl() });
  });
  afterAll(async () => {
    await db?.close();
  });
  function fixture(reason: string, kind: 'wake' | 'murmur', repeatFailure = false) {
    const clock = new TestClock(day + 'T15:56:00Z'),
      userId = newId();
    let char = newId();
    const range = { min: 1, max: 1 },
      window = { startHour: 0, endHour: 24 };
    while (wakeSlots(userId, char, day, range, window)[0]! >= 940) char = newId();
    let epoch = 'original';
    let insufficient = false;
    const config = { decisionModelKey: 'jev', levels: { often: range }, wakeWindow: window };
    const scope = {
      settings: {
        config: async () => config,
        isActive: async () => true,
        characterEnabled: async () => true,
        row: async () => ({}),
        decisionProblem: async () => null,
        pause: async () => {},
        actionAvailable: async () => null,
      },
      identity: { getProfile: async () => ({ timeZone: 'UTC' }) },
      contacts: {
        listActiveContacts: async () => [{ characterId: char, conversationId: newId() }],
        getActiveContactEpoch: async () => ({ version: epoch }),
      },
      billing: {
        getSpendStatus: async () => ({ insufficient, backgroundRemainingTodayMicros: 0 }),
      },
      db,
      clock,
      taskOutcomes: new TaskOutcomeService(db, clock),
    };
    const paidDecide = vi.fn(async (input: { idempotencyKey: string; taskKey: string }) => {
      if (kind === 'wake' && (repeatFailure || !input.idempotencyKey.includes(':retry:'))) {
        insufficient = reason === 'insufficient_balance';
        return {
          ok: false,
          error: ['insufficient_balance', 'budget_exceeded'].includes(reason)
            ? reason
            : 'provider_unavailable',
          message: reason,
        };
      }
      return {
        ok: true,
        value: {
          answers: [
            {
              questionId: 'message',
              choice: 'act',
              probabilities: { act: 0.98, defer: 0.02 },
              confidence: 0.96,
            },
          ],
          usageRecordId: newId(),
          chargedMicros: 1,
          modelKey: 'jev',
        },
      };
    });
    const text = vi.fn(async (input: GenerateTextInput) => {
      if (kind === 'murmur' && !input.idempotencyKey.includes(':retry:'))
        return {
          ok: false,
          error: ['insufficient_balance', 'budget_exceeded'].includes(reason)
            ? reason
            : 'provider_unavailable',
          message: reason,
        };
      return {
        ok: true,
        value: { text: '今天的茶真香。', chargedMicros: 2, usageRecordId: newId() },
      };
    });
    const action = vi.fn(async () => ({ ok: true, chargedMicros: 3 }));
    const service = Object.assign(Object.create(EcologyService.prototype), scope, {
      buildSnapshot: async () => ({
        local: { date: day, hour: 15, minute: 56 },
        features: {},
        summary: '',
        tools: ['message'],
        autoOff: false,
      }),
      media: { decide: paidDecide },
      gateway: { generateText: text },
      characters: { getForRuntime: async () => ({ profile: { name: '测试角色' } }) },
      policy: { getCharacterPolicy: async () => ({ isMinor: false, isRealPerson: false }) },
      murmurMaterial: async () => '今天喝茶',
      crypto: { seal: async () => Buffer.from([1]) },
      perform: action,
    }) as EcologyService;
    const run = () => service.runForUser(userId);
    const row = async () =>
      (
        await db.query<{
          id: string;
          retry_reason: string;
          retry_at: Date | null;
          retry_count: number;
          charged_micros: string;
          has_text: boolean;
          outcome: string;
        }>(
          'SELECT id,retry_reason,retry_at,retry_count,charged_micros,murmur_ciphertext IS NOT NULL AS has_text,outcome FROM ai_runtime.ecology_runs WHERE user_id=$1',
          [userId],
        )
      ).rows[0]!;
    const receipt = async (key: string) =>
      (
        await db.query<{ state: string; reason: string; retry_at: Date | null }>(
          'SELECT state,reason,retry_at FROM model_access.task_outcomes WHERE task_key=$1',
          [key],
        )
      ).rows[0];
    const restored = () => {
      insufficient = false;
      return db.transaction((tx) => service.balanceRestored(userId, tx));
    };
    return {
      clock,
      userId,
      char,
      scope,
      paidDecide,
      text,
      action,
      run,
      row,
      receipt,
      restored,
      replace: () => {
        epoch = 'new_relationship';
      },
    };
  }

  it('a nearly exhausted budget waits for Beijing midnight, even for a UTC user who tops up; two workers only run the deferred murmur once', async () => {
    const f = fixture('budget_exceeded', 'murmur');
    await f.run();
    const r = await f.row(),
      key = modelTaskKey(f.userId, 'eco:murmur:' + r.id);
    expect(await f.receipt(key)).toMatchObject({
      state: 'deferred',
      retry_at: new Date(day + 'T16:00Z'),
    });
    await f.restored();
    await f.run();
    expect(f.text).toHaveBeenCalledTimes(1);
    f.clock.advance(4 * 60_000);
    await Promise.all([f.run(), f.run()]);
    expect(f.text.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      'eco:murmur:' + r.id,
      'eco:murmur:' + r.id + ':retry:1',
    ]);
    expect(f.paidDecide).toHaveBeenCalledTimes(1);
    expect(f.action).toHaveBeenCalledTimes(1);
    expect(await f.row()).toMatchObject({ has_text: true, charged_micros: '6' });
    expect(await f.receipt(key)).toMatchObject({ state: 'displayed' });
  });

  it('a balance event reopens the same existing decision; its first successful action and the resulting murmur execute once', async () => {
    const f = fixture('insufficient_balance', 'wake');
    await f.run();
    const r = await f.row();
    expect(r.retry_at).toBeNull();
    await f.run();
    expect(f.paidDecide).toHaveBeenCalledTimes(1);
    await f.restored();
    await Promise.all([f.run(), f.run()]);
    await f.run();
    const calls = f.paidDecide.mock.calls.map(([i]) => i);
    expect(calls.map((i) => i.taskKey)).toEqual([
      modelTaskKey(f.userId, 'eco:' + r.id + ':jev'),
      modelTaskKey(f.userId, 'eco:' + r.id + ':jev'),
    ]);
    expect(calls.map((i) => i.idempotencyKey)).toEqual([
      'eco:' + r.id + ':jev',
      'eco:' + r.id + ':jev:retry:1',
    ]);
    expect(await f.receipt(calls[1]!.taskKey)).toMatchObject({
      state: 'saved',
      reason: 'jev_approved',
    });
    expect(f.action).toHaveBeenCalledTimes(1);
  });

  it('an old relationship, an expired item, or an unconfirmed dispatch never sends again', async () => {
    const a = fixture('concurrency_limited', 'murmur');
    await a.run();
    a.replace();
    a.clock.advance(601_000);
    await a.run();
    expect(
      await a.receipt(modelTaskKey(a.userId, 'eco:murmur:' + (await a.row()).id)),
    ).toMatchObject({ state: 'cancelled', reason: 'context_expired' });
    expect(a.text).toHaveBeenCalledTimes(1);
    const b = fixture('insufficient_fallback_time', 'wake');
    await b.run();
    b.clock.advance(3601_000);
    await b.run();
    expect(
      await b.receipt(modelTaskKey(b.userId, 'eco:' + (await b.row()).id + ':jev')),
    ).toMatchObject({ state: 'cancelled', reason: 'expired' });
    expect(b.paidDecide).toHaveBeenCalledTimes(1);
    const c = fixture('interrupted', 'wake');
    await c.run();
    await c.restored();
    c.clock.advance(610_000);
    await c.run();
    expect(c.paidDecide).toHaveBeenCalledTimes(1);
  });

  it('labels a local fallback separately when Jev declined but ecology still applied its own message rule', async () => {
    const f = fixture('not_configured', 'murmur');
    f.paidDecide.mockResolvedValueOnce({
      ok: true,
      value: {
        usageRecordId: newId(),
        chargedMicros: 1,
        modelKey: 'jev',
        answers: [
          {
            questionId: 'message',
            choice: 'defer',
            probabilities: { act: 0.05, defer: 0.95 },
            confidence: 0.9,
          },
        ],
      },
    });
    await f.run();
    expect(f.action).toHaveBeenCalledTimes(1);
    expect(
      await f.receipt(modelTaskKey(f.userId, 'eco:' + (await f.row()).id + ':jev')),
    ).toMatchObject({ state: 'filtered', reason: 'jev_rules_fallback' });
  });

  it('limits repeated settled transient failures to two additional attempts', async () => {
    const f = fixture('concurrency_limited', 'wake', true);
    await f.run();
    for (const wait of [10, 20, 20]) {
      f.clock.advance(wait * 60_000);
      await f.run();
    }
    expect(f.paidDecide).toHaveBeenCalledTimes(3);
    expect(f.action).not.toHaveBeenCalled();
    expect(
      await f.receipt(modelTaskKey(f.userId, 'eco:' + (await f.row()).id + ':jev')),
    ).toMatchObject({ state: 'failed', reason: 'concurrency_limited' });
  });

  it('a deferred proactive plan retains its original event and has a bounded retry count', async () => {
    const f = fixture('concurrency_limited', 'wake'),
      dayEnd = f.clock.now();
    const [plan] = await db.db
      .insert(proactivePlans)
      .values({
        id: newId(),
        userId: f.userId,
        characterId: f.char,
        reason: 'follow_up',
        sourceRef: 'synthetic',
        topicKey: 'synthetic',
        brief: 'test',
        localDate: day,
        priority: 1,
        status: 'generating',
        dueAt: dayEnd,
        createdAt: dayEnd,
        updatedAt: dayEnd,
      })
      .returning();
    type Plan = typeof proactivePlans.$inferSelect;
    const service = Object.assign(Object.create(ProactiveSchedulerService.prototype), f.scope) as {
      deferPlan(p: Plan, reason: string, epoch: string, tz: string): Promise<boolean>;
      expireRetries(userId: string): Promise<void>;
    };
    const schedule = () => service.deferPlan(plan!, 'budget_exceeded', 'original', 'UTC');
    expect((await Promise.all([schedule(), schedule()])).filter(Boolean)).toHaveLength(1);
    await f.restored();
    const check = () =>
      db.query<{ due_at: Date; status: string; outcome: string; retry_count: number }>(
        'SELECT due_at,status,outcome,retry_count FROM ai_runtime.proactive_plans WHERE id=$1',
        [plan!.id],
      );
    expect((await check()).rows[0]).toMatchObject({
      status: 'planned',
      retry_count: 1,
      due_at: new Date(day + 'T16:00Z'),
    });
    f.clock.advance(3601_000);
    await service.expireRetries(f.userId);
    expect((await check()).rows[0]).toMatchObject({ status: 'dropped', outcome: 'expired' });
    expect(await f.receipt(modelTaskKey(f.userId, 'proactive:' + plan!.id))).toMatchObject({
      state: 'cancelled',
      reason: 'expired',
    });
  });

  it.each(['follow_up', 'safety_follow_up'] as const)(
    'the normal scheduler sends %s just once and adopts its matching usage row',
    async (reason) => {
      const f = fixture('concurrency_limited', 'wake'),
        conversationId = newId(),
        messageId = newId(),
        recorder = new UsageRecorder(db, f.clock);
      const paid = vi.fn(async (input: GenerateTextInput) => {
        const usage = await recorder.start({
          input,
          modelKey: 'fixture',
          upstreamId: newId(),
          upstreamModelId: 'fixture',
          countsAsBackground: input.purpose === 'proactive',
        });
        if (reason === 'follow_up' && !input.idempotencyKey.includes(':retry:'))
          return { ok: false, error: 'provider_unavailable', message: 'concurrency_limited' };
        return {
          ok: true,
          value: { usageRecordId: usage.record.id, text: '散步回来啦。', chargedMicros: 0 },
        };
      });
      const post = vi.fn(async () => ({ ok: true, value: { messageId } }));
      const scheduler = Object.assign(Object.create(ProactiveSchedulerService.prototype), f.scope, {
        handlers: [],
        accounts: { getAccountStatus: async () => 'active' },
        identity: {
          getProfile: async () => ({ timeZone: 'UTC', nickname: '朋友' }),
          getNotificationSettings: async () => null,
        },
        contacts: {
          ...f.scope.contacts,
          listActiveContacts: async () => [{ characterId: f.char, conversationId }],
        },
        settings: { get: async () => ({ scenarioMode: 'daily', proactiveFrequency: 'medium' }) },
        ecology: f.scope.settings,
        continuity: { restoreLetters: async () => {} },
        collectCandidates: async () => {},
        quiet: { getInconvenientUntil: async () => null, getFocusUntil: async () => null },
        quota: {
          getDailyCount: async () => 0,
          canSendProactive: async () => true,
          recordSent: async () => {},
        },
        chat: {
          getConversation: async () => ({
            conversationId,
            contentScope: 'normal',
            participants: [{ kind: 'character', refId: f.char, participantId: newId() }],
          }),
          readMessages: async () => [],
        },
        characters: {
          getForRuntime: async () => ({
            profile: { name: '测试角色', kind: 'preset' },
            card: null,
            legacyCard: null,
          }),
        },
        policy: {
          getCharacterPolicy: async () => ({
            adultModeEligible: false,
            isRealPerson: false,
            isMinor: false,
          }),
        },
        growth: { getFamiliarity: async () => ({ level: 1 }) },
        brain: { build: async () => ({ scope: 'normal', prefix: '合成', recall: '' }) },
        adultBoundary: { generate: paid },
        writer: { postMessage: post },
        audit: { record: async () => {} },
        episodes: { record: async () => {} },
      }) as ProactiveSchedulerService;
      const req = {
        userId: f.userId,
        characterId: f.char,
        reason,
        sourceRef: 'scheduled-fixture',
        brief: '散步',
      };
      expect(await scheduler.request(req)).toBe(true);
      expect(await scheduler.request(req)).toBe(false);
      await scheduler.runForUser(f.userId);
      if (reason === 'follow_up') {
        expect(post).not.toHaveBeenCalled();
        f.clock.advance(601_000);
      }
      await Promise.all([scheduler.runForUser(f.userId), scheduler.runForUser(f.userId)]);
      expect(post).toHaveBeenCalledTimes(1);
      const calls = paid.mock.calls.map(([input]) => input);
      expect(calls).toHaveLength(reason === 'follow_up' ? 2 : 1);
      expect(new Set(calls.map((i) => i.taskKey)).size).toBe(1);
      const receipt = await db.query(
        'SELECT o.purpose,o.state,o.reason,u.purpose AS usage_purpose FROM model_access.task_outcomes o JOIN model_access.usage_records u ON u.id=o.usage_record_id WHERE o.task_key=$1',
        [calls[0]!.taskKey],
      );
      const purpose = reason === 'safety_follow_up' ? 'safety_followup' : 'proactive';
      expect(receipt.rows).toEqual([
        { purpose, state: 'delivered', reason: 'proactive_sent', usage_purpose: purpose },
      ]);
    },
  );

  it('a time-sensitive planner stores the rule fallback after a refused call and replays the decision without another provider request', async () => {
    const f = fixture('budget_exceeded', 'wake');
    const gen = vi.fn(async () => ({ ok: false, error: 'budget_exceeded' }));
    const svc = Object.assign(Object.create(PlannerService.prototype), f.scope, {
      circuits: new Map(),
      logger: { warn: vi.fn() },
      config: async () => ({ implementation: 'rules_model', confidenceThreshold: 0.55 }),
      costGuardTripped: async () => false,
      gateway: { generateText: gen },
    }) as PlannerService;
    const req = {
      userId: f.userId,
      characterId: f.char,
      decisionType: 'proactive_slot' as const,
      path: 'proactive' as const,
      idempotencyKey: 'fixed',
      decisionKey: 'fixed',
      options: ['send', 'defer'],
      ruleChoice: 'defer',
      conservative: 'defer',
      ruleReason: 'rule',
      question: 'choose',
      features: {},
    };
    expect((await svc.decide(req)).fallback).toBe('budget');
    await svc.decide(req);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(await f.receipt(modelTaskKey(f.userId, 'plan:proactive_slot:fixed'))).toMatchObject({
      state: 'filtered',
      reason: 'planning_rules_budget',
    });
  });
});
