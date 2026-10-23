import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PlannerService, type PlanBatchRequest } from './planner.js';
import { plannerConfig, planningDecisions } from '../infra/db/schema.js';

const request = (): PlanBatchRequest => ({
  userId: 'user',
  characterId: 'character',
  conversationId: 'conversation',
  decisionType: 'reply_form',
  path: 'reply',
  idempotencyKey: 'turn-1',
  questions: [
    {
      questionId: 'voice',
      options: ['text', 'voice'],
      ruleChoice: 'voice',
      ruleReason: '规则语音',
      conservative: 'text',
      question: '是否用语音？',
      features: { replyLength: 12, replyTone: 'warm' },
    },
    {
      questionId: 'sticker',
      options: ['no_sticker', 'keep_sticker'],
      ruleChoice: 'keep_sticker',
      ruleReason: '规则表情',
      conservative: 'no_sticker',
      question: '是否附带表情？',
      features: { stickerMeaning: 'affection', replyTone: 'warm', candidateCount: 1 },
    },
  ],
});

function setup(implementation: 'jev' | 'rules' | 'rules_model' = 'jev') {
  const rows: Array<typeof planningDecisions.$inferSelect> = [];
  const config = {
    decisionType: 'reply_form',
    implementation,
    modelKey: 'jev-test',
    confidenceThreshold: 0.55,
    updatedAt: new Date(0),
    updatedBy: null,
    evalReportId: null,
  };
  const select = vi.fn(() => ({
    from: (table: unknown) =>
      table === plannerConfig ? Promise.resolve([config]) : { where: () => Promise.resolve(rows) },
  }));
  const database = {
    db: {
      select,
      insert: () => ({
        values: (row: typeof planningDecisions.$inferSelect) => ({
          onConflictDoNothing: async () => {
            if (!rows.some((stored) => stored.decisionKey === row.decisionKey)) rows.push(row);
          },
        }),
      }),
    },
  };
  const decide = vi.fn(
    async (input: { questions: Array<{ questionId: string; options?: string[] }> }) => ({
      ok: true as const,
      value: {
        usageRecordId: 'usage-1',
        chargedMicros: 1234,
        modelKey: 'jev-test',
        latencyMs: 1,
        answers: input.questions.map((q) => ({
          questionId: q.questionId,
          choice: q.questionId === 'voice' ? 'voice' : 'keep_sticker',
          confidence: 0.9,
          probabilities: Object.fromEntries(
            (q.options ?? []).map((option) => [
              option,
              option === 'voice' || option === 'keep_sticker' ? 0.95 : 0.05,
            ]),
          ),
        })),
      },
    }),
  );
  const generateText = vi.fn(async () => ({
    ok: true,
    value: {
      text: JSON.stringify({
        answers: {
          voice: { probs: { voice: 0.95, text: 0.05 } },
          sticker: { probs: { keep_sticker: 0.95, no_sticker: 0.05 } },
        },
      }),
      usageRecordId: 'text-usage',
      chargedMicros: 456,
    },
  }));
  const spend = vi.fn(async () => ({ chat_reply: 100_000, behavior_planning: 0 }));
  const service = new PlannerService(
    ...([
      database,
      { now: () => new Date(1000), nowMs: () => 1000 },
      { warn: vi.fn() },
      { record: vi.fn() },
      { generateText },
      { decide },
      { getUserDailySpendByPurpose: spend },
      { getProfile: async () => ({ timeZone: 'Asia/Shanghai' }) },
    ] as unknown as ConstructorParameters<typeof PlannerService>),
  );
  return { service, rows, decide, generateText, spend, select };
}

describe('independent planner batches', () => {
  it('asks Jev once, permits both actions, and records the shared charge exactly once', async () => {
    const s = setup();
    const result = await s.service.decideBatch(request());
    expect(result.voice?.choice).toBe('voice');
    expect(result.sticker?.choice).toBe('keep_sticker');
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        billingOwner: 'user',
        purpose: 'behavior_planning',
        characterId: 'character',
        questions: expect.arrayContaining([
          expect.objectContaining({ questionId: 'voice' }),
          expect.objectContaining({ questionId: 'sticker' }),
        ]),
      }),
    );
    expect(s.generateText).not.toHaveBeenCalled();
    expect(s.rows).toHaveLength(2);
    expect(s.rows.map((row) => row.usageRecordId)).toEqual(['usage-1', 'usage-1']);
    expect(s.rows.reduce((sum, row) => sum + row.chargedMicros, 0)).toBe(1234);
  });

  it('replays the same decision despite reordered questions without asking or recording twice', async () => {
    const s = setup();
    const req = request();
    const first = await s.service.decideBatch(req);
    const replay = await s.service.decideBatch({ ...req, questions: [...req.questions].reverse() });
    expect(replay).toEqual(first);
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.rows).toHaveLength(2);
  });

  it('rejects only the low-confidence action, not the independent approved action', async () => {
    const s = setup();
    const base = await s.decide({ questions: [] });
    s.decide.mockClear();
    s.decide.mockResolvedValue({
      ...base,
      value: {
        ...base.value,
        answers: [
          {
            questionId: 'voice',
            choice: 'voice',
            confidence: 0.2,
            probabilities: { voice: 0.6, text: 0.4 },
          },
          {
            questionId: 'sticker',
            choice: 'keep_sticker',
            confidence: 0.9,
            probabilities: { keep_sticker: 0.95, no_sticker: 0.05 },
          },
        ],
      },
    });
    const result = await s.service.decideBatch(request());
    expect(result.voice).toMatchObject({ choice: 'text', fallback: 'low_confidence' });
    expect(result.sticker).toMatchObject({ choice: 'keep_sticker', fallback: null });
  });

  it('does not send raw text or arbitrary new feature values to Jev', async () => {
    const s = setup();
    const req = request();
    req.questions[0]!.features = {
      replyTone: '私密金丝雀',
      replyLength: 20,
      userText: '私聊原文金丝雀',
      imageDescription: '图片金丝雀',
      stickerMeaning: '健康金丝雀',
    };
    await s.service.decideBatch(req);
    const payload = JSON.stringify(s.decide.mock.calls[0]);
    expect(payload).not.toContain('金丝雀');
    expect(payload).toContain('replyLength');
  });

  it.each(['adult', 'periodHint'] as const)(
    'never exports %s or silently switches to another paid model',
    async (flag) => {
      const s = setup();
      const result = await s.service.decideBatch({ ...request(), [flag]: true });
      expect(result.voice?.choice).toBe('text');
      expect(result.sticker?.choice).toBe('no_sticker');
      expect(s.decide).not.toHaveBeenCalled();
      expect(s.generateText).not.toHaveBeenCalled();
    },
  );

  it('uses conservative actions on supplier failure rather than positive rule defaults', async () => {
    const s = setup();
    s.decide.mockRejectedValue(new Error('supplier failure'));
    const result = await s.service.decideBatch(request());
    expect(result.voice).toMatchObject({ choice: 'text', fallback: 'error' });
    expect(result.sticker?.choice).toBe('no_sticker');
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.generateText).not.toHaveBeenCalled();
  });

  it('skips the supplier when the existing cost guard trips', async () => {
    const s = setup();
    s.spend.mockResolvedValue({ chat_reply: 100, behavior_planning: 20 });
    const result = await s.service.decideBatch(request());
    expect(result.voice).toMatchObject({ choice: 'text', fallback: 'cost_guard' });
    expect(s.decide).not.toHaveBeenCalled();
  });

  it('does not call anything for an empty batch or forced-only options', async () => {
    const s = setup();
    expect(await s.service.decideBatch({ ...request(), questions: [] })).toEqual({});
    const req = request();
    req.questions = [
      { ...req.questions[0]!, options: ['text'], ruleChoice: 'text', conservative: 'text' },
    ];
    expect((await s.service.decideBatch(req)).voice?.choice).toBe('text');
    expect(s.decide).not.toHaveBeenCalled();
  });

  it('rejects missing answers and keeps the already-incurred charge in one record', async () => {
    const s = setup();
    const base = await s.decide({ questions: [] });
    s.decide.mockClear();
    s.decide.mockResolvedValue(base);
    const result = await s.service.decideBatch(request());
    expect(result.voice).toMatchObject({ choice: 'text', fallback: 'invalid_choice' });
    expect(result.sticker?.choice).toBe('no_sticker');
    expect(s.rows.reduce((sum, row) => sum + row.chargedMicros, 0)).toBe(1234);
  });

  it('batches the existing text-planner backend into one call as well', async () => {
    const s = setup('rules_model');
    const result = await s.service.decideBatch(request());
    expect(result.voice?.choice).toBe('voice');
    expect(result.sticker?.choice).toBe('keep_sticker');
    expect(s.generateText).toHaveBeenCalledTimes(1);
    expect(s.decide).not.toHaveBeenCalled();
    expect(s.rows.reduce((sum, row) => sum + row.chargedMicros, 0)).toBe(456);
  });

  it('rejects incomplete probability distributions from the text backend', async () => {
    const s = setup('rules_model');
    s.generateText.mockResolvedValue({
      ok: true,
      value: {
        text: '{"answers":{"voice":{"probs":{"voice":1}}}}',
        chargedMicros: 30,
        usageRecordId: 'bad-usage',
      },
    });
    const result = await s.service.decideBatch(request());
    expect(result.voice).toMatchObject({ choice: 'text', fallback: 'invalid_choice' });
    expect(result.sticker?.choice).toBe('no_sticker');
  });

  it('keeps configured rules free without making a model call', async () => {
    const s = setup('rules');
    const result = await s.service.decideBatch(request());
    expect(result.voice?.choice).toBe('voice');
    expect(result.sticker?.choice).toBe('keep_sticker');
    expect(s.generateText).not.toHaveBeenCalled();
    expect(s.decide).not.toHaveBeenCalled();
  });

  it('times out once without a paid retry or an alternate-model fallback', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.decide.mockImplementation(() => new Promise(() => {}));
      const pending = s.service.decideBatch({ ...request(), timeoutMs: 5 });
      await vi.advanceTimersByTimeAsync(10);
      const result = await pending;
      expect(result.voice).toMatchObject({ choice: 'text', fallback: 'timeout' });
      expect(result.sticker?.choice).toBe('no_sticker');
      expect(s.decide).toHaveBeenCalledTimes(1);
      expect(s.generateText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
