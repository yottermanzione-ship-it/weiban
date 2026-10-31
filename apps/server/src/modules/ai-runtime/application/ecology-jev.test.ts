/**
 * 批 EJ：生态主循环接入 Jev 原生判定。全部用假适配器 / 桩，不发起任何真实模型调用。
 * 覆盖：无候选不问、批量一次请求、多项通过与程序排冲突、低把握 / 陌生 ID / 重复 ID / 超时 / 失败一律不做、
 * 不回落文字模型、欠费即停、决策模型必须是判定模型、Jev 只收白名单数字 / 布尔特征与净化后的对话现状摘要。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EcologyActionKey } from '@weiban/contracts';
import {
  DEFAULT_ECOLOGY_CONFIG,
  ECOLOGY_JEV_MIN_CONFIDENCE,
  interpretJevAnswers,
  resolveEcologyConflicts,
} from '../domain/ecology.js';
import { EcologyService, jevSummary } from './ecology.js';
import { EcologySettingsService } from './ecology-settings.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const CONV = '00000000-0000-4000-8000-000000000003';
const JEV = 'jev/jev-latest';

type Answer = { questionId: string; choice: string; confidence: number };

function answer(questionId: string, choice: 'act' | 'defer', confidence: number): Answer {
  return { questionId, choice, confidence };
}

function service(options: {
  tools: EcologyActionKey[];
  decide?: (input?: unknown) => Promise<unknown>;
  decisionProblem?: string | null;
  balanceInsufficient?: boolean;
  privateMode?: boolean;
  features?: Record<string, number | boolean | null>;
  perform?: (
    action: EcologyActionKey,
  ) => Promise<{ ok: boolean; chargedMicros: number; reason?: string }>;
}) {
  const finish = vi.fn().mockResolvedValue(undefined);
  const decide = vi.fn<(input?: unknown) => Promise<unknown>>(
    options.decide ??
      (() =>
        Promise.resolve({
          ok: true,
          value: { answers: [], chargedMicros: 0, modelKey: JEV, latencyMs: 1, usageRecordId: 'u' },
        })),
  );
  const perform = vi.fn((_run: unknown, action: EcologyActionKey) =>
    options.perform ? options.perform(action) : Promise.resolve({ ok: true, chargedMicros: 100 }),
  );
  const generateText = vi.fn();
  const settings = {
    config: vi.fn().mockResolvedValue({ ...DEFAULT_ECOLOGY_CONFIG, decisionModelKey: JEV }),
    decisionProblem: vi.fn().mockResolvedValue(options.decisionProblem ?? null),
    pause: vi.fn().mockResolvedValue(undefined),
    isActive: vi.fn().mockResolvedValue(true),
    row: vi.fn().mockResolvedValue({ disabledActions: [] }),
    actionAvailable: vi.fn().mockResolvedValue(null),
  };
  const svc = Object.create(EcologyService.prototype) as EcologyService;
  Object.assign(svc, {
    clock: { nowMs: () => Date.now(), now: () => new Date() },
    settings,
    media: { decide },
    gateway: { generateText },
    finish,
    perform,
    buildSnapshot: vi.fn().mockResolvedValue({
      features: options.features ?? {
        localHour: 20,
        unansweredCount: 0,
        lateNight: false,
        pointsLow: false,
      },
      summary: '现在是对方当地时间周一 20:00。',
      balanceInsufficient: options.balanceInsufficient ?? false,
      privateMode: options.privateMode ?? false,
      conversationId: CONV,
      tools: options.tools,
      targets: new Map(),
      hasFollowUps: false,
      weiboPhoto: null,
    }),
  });
  const run = { id: 'run-1', userId: USER, characterId: CHAR } as never;
  const wake = () => (svc as unknown as { executeWake(r: never): Promise<void> }).executeWake(run);
  return { wake, finish, decide, perform, generateText, settings };
}

function okDecide(answers: Answer[], chargedMicros = 28) {
  return () =>
    Promise.resolve({
      ok: true,
      value: { answers, chargedMicros, modelKey: JEV, latencyMs: 900, usageRecordId: 'usage-1' },
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Jev 答案解读（纯规则）', () => {
  it('每题独立：act 且把握达标才通过；defer、低把握、非法值分别归类', () => {
    const v = interpretJevAnswers(
      ['message', 'voice', 'nudge', 'status'],
      [
        answer('message', 'act', 0.9),
        answer('voice', 'act', ECOLOGY_JEV_MIN_CONFIDENCE - 0.01),
        answer('nudge', 'defer', 0.99),
        { questionId: 'status', choice: 'maybe', confidence: 0.9 },
      ],
    );
    expect(v.approved).toEqual([{ action: 'message', confidence: 0.9 }]);
    expect(v.lowConfidence).toEqual(['voice']);
    expect(v.declined).toEqual(['nudge']);
    expect(v.invalid).toEqual(['status']);
  });

  it('陌生 ID 忽略；重复 ID、缺答案、把握越界都不做', () => {
    const v = interpretJevAnswers(
      ['message', 'greeting', 'status'],
      [
        answer('message', 'act', 0.9),
        answer('message', 'act', 0.9),
        answer('call_user', 'act', 1),
        { questionId: 'status', choice: 'act', confidence: 1.5 },
      ],
    );
    expect(v.approved).toEqual([]);
    expect(v.unknownIds).toBe(1);
    expect(v.invalid.sort()).toEqual(['greeting', 'message', 'status']);
  });

  it('程序排冲突：同轮只发一条聊天、状态签名二选一、微博同步与转发二选一，总数受上限', () => {
    const r = resolveEcologyConflicts(
      [
        { action: 'nudge', confidence: 0.95 },
        { action: 'message', confidence: 0.9 },
        { action: 'signature', confidence: 0.8 },
        { action: 'status', confidence: 0.85 },
        { action: 'weibo_sync', confidence: 0.7 },
      ],
      2,
    );
    expect(r.selected).toEqual(['nudge', 'status']);
    expect(r.dropped).toEqual(['message', 'signature', 'weibo_sync']);
    const tie = resolveEcologyConflicts(
      [
        { action: 'message', confidence: 0.8 },
        { action: 'care_follow_up', confidence: 0.8 },
      ],
      2,
    );
    expect(tie.selected).toEqual(['care_follow_up']);
  });
});

describe('executeWake 接入原生判定', () => {
  it('无候选：不调用 Jev，记为没做什么', async () => {
    const s = service({ tools: [] });
    await s.wake();
    expect(s.decide).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'idle', outcome: 'no_action', chargedMicros: 0 }),
    );
  });

  it('同情境候选一次批量请求；允许多项通过，排冲突后用户模型逐项执行，费用合计', async () => {
    const s = service({
      tools: ['message', 'nudge', 'status', 'moment_interact'],
      decide: okDecide([
        answer('message', 'act', 0.9),
        answer('nudge', 'act', 0.8),
        answer('status', 'act', 0.7),
        answer('moment_interact', 'defer', 0.9),
      ]),
    });
    await s.wake();
    expect(s.decide).toHaveBeenCalledTimes(1);
    const input = s.decide.mock.calls[0]![0] as unknown as {
      modelKey: string;
      billingOwner: string;
      countAsBackground: boolean;
      ecologyTask: boolean;
      idempotencyKey: string;
      state: { features: Record<string, unknown>; summary: string };
      questions: Array<{ questionId: string; kind: string; options: string[]; prompt: string }>;
    };
    expect(input.modelKey).toBe(JEV);
    expect(input).toMatchObject({
      billingOwner: 'user',
      countAsBackground: true,
      ecologyTask: true,
      idempotencyKey: 'eco:run-1:jev',
    });
    expect(input.questions.map((q) => q.questionId)).toEqual([
      'message',
      'nudge',
      'status',
      'moment_interact',
    ]);
    expect(
      input.questions.every((q) => q.kind === 'choice' && q.options.join() === 'act,defer'),
    ).toBe(true);
    // 特征只有数字 / 布尔 / null；文字只有净化后的对话现状摘要。
    expect(Object.keys(input.state).sort()).toEqual(['features', 'summary']);
    expect(
      Object.values(input.state.features).every(
        (v) => v === null || ['number', 'boolean'].includes(typeof v),
      ),
    ).toBe(true);
    expect(s.perform.mock.calls.map((c) => c[1])).toEqual(['message', 'status']);
    expect(s.generateText).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'done',
        modelKey: JEV,
        chargedMicros: 28 + 100 + 100,
        actionKey: null,
      }),
    );
    const outcome = (s.finish.mock.calls[0]![1] as { outcome: string }).outcome;
    expect(outcome).toMatch(
      /^sent \| ok=message:0\.90,nudge:0\.80,status:0\.70 def=moment_interact drop=nudge$/,
    );
  });

  // 打扰情形（2 条未回）不触发保底，用来单独验证「不通过就不做」。
  // 打扰情形：主线未回复已满 3 次（对照表 v3 上限），保底也不触发。
  const DISTURBING = { localHour: 20, unansweredCount: 3, lateNight: false, pointsLow: false };

  it('低把握不做（不补批、不重试），费用照记判定一次', async () => {
    const s = service({
      tools: ['message'],
      features: DISTURBING,
      decide: okDecide([answer('message', 'act', 0.5)]),
    });
    await s.wake();
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.perform).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'idle',
        outcome: 'jev_low_confidence | low=message',
        chargedMicros: 28,
      }),
    );
  });

  it('保底：全部不通过但不打扰时，发一条主动消息（不挑拍一拍等小动作），记 fb=', async () => {
    const s = service({
      tools: ['message', 'nudge', 'status'],
      decide: okDecide([
        answer('message', 'defer', 0.9),
        answer('nudge', 'act', 0.4),
        answer('status', 'act', 0.5),
      ]),
    });
    await s.wake();
    // 10-28：nudge「想做」可能性 0.4 更高也不选；保底只认主动消息，分数 = 1 − 0.9。
    expect(s.perform).toHaveBeenCalledTimes(1);
    expect(s.perform.mock.calls[0]![1]).toBe('message');
    expect((s.finish.mock.calls[0]![1] as { outcome: string }).outcome).toContain(
      'fb=message:0.10',
    );
  });

  it('保底：主动消息不在候选里就不保底；message 没有有效答案时照样发、分数记 0', async () => {
    const without = service({
      tools: ['nudge', 'sticker'],
      decide: okDecide([answer('nudge', 'act', 0.5), answer('sticker', 'act', 0.5)]),
    });
    await without.wake();
    expect(without.perform).not.toHaveBeenCalled();

    const missing = service({
      tools: ['message', 'nudge'],
      decide: okDecide([answer('nudge', 'defer', 0.9)]),
    });
    await missing.wake();
    expect(missing.perform.mock.calls.map((c) => c[1])).toEqual(['message']);
    expect((missing.finish.mock.calls[0]![1] as { outcome: string }).outcome).toContain(
      'fb=message:0.00',
    );
  });

  it('保底不在深夜、对方在用应用却没回时触发', async () => {
    for (const features of [
      {
        localHour: 2,
        userActiveInApp30m: false,
        unansweredCount: 0,
        lateNight: true,
        pointsLow: false,
      },
      {
        localHour: 20,
        unansweredCount: 1,
        lateNight: false,
        userActiveInApp30m: true,
        pointsLow: false,
      },
    ]) {
      const s = service({
        tools: ['message'],
        features,
        decide: okDecide([answer('message', 'defer', 0.6)]),
      });
      await s.wake();
      expect(s.perform).not.toHaveBeenCalled();
    }
  });

  it('陌生 ID 不做任何事', async () => {
    const s = service({
      tools: ['message'],
      features: DISTURBING,
      decide: okDecide([answer('message', 'defer', 0.9), answer('send_money', 'act', 1)]),
    });
    await s.wake();
    expect(s.perform).not.toHaveBeenCalled();
    expect((s.finish.mock.calls[0]![1] as { outcome: string }).outcome).toBe(
      'jev_declined | def=message unk=1',
    );
  });

  it('网关失败：不做、不回落文字模型判定', async () => {
    const s = service({
      tools: ['message', 'status'],
      decide: () => Promise.resolve({ ok: false, error: 'provider_unavailable' }),
    });
    await s.wake();
    expect(s.perform).not.toHaveBeenCalled();
    expect(s.generateText).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', outcome: 'jev_provider_unavailable' }),
    );
  });

  it('超时：不做、不重试', async () => {
    vi.useFakeTimers();
    const s = service({ tools: ['message'], decide: () => new Promise(() => undefined) });
    const pending = s.wake();
    await vi.advanceTimersByTimeAsync(11_500);
    await pending;
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.perform).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', outcome: 'jev_timeout' }),
    );
  });

  it('判定时余额不足：暂停生态', async () => {
    const s = service({
      tools: ['message'],
      decide: () => Promise.resolve({ ok: false, error: 'insufficient_balance' }),
    });
    await s.wake();
    expect(s.settings.pause).toHaveBeenCalledWith(USER, 'insufficient_balance');
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'paused', outcome: 'insufficient_balance' }),
    );
  });

  it('欠费即停：余额已不足时不向 Jev 付费询问', async () => {
    const s = service({ tools: ['message'], balanceInsufficient: true });
    await s.wake();
    expect(s.decide).not.toHaveBeenCalled();
    expect(s.settings.pause).toHaveBeenCalledWith(USER, 'insufficient_balance');
  });

  it('决策模型不是判定模型：不运行', async () => {
    const s = service({ tools: ['message'], decisionProblem: '不是判定模型' });
    await s.wake();
    expect(s.decide).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'skipped', outcome: 'model_not_decision' }),
    );
  });

  it('执行前复核：动作刚被关掉就不执行；某项失败不影响另一项，成功才记已做', async () => {
    const s = service({
      tools: ['message', 'status'],
      decide: okDecide([answer('message', 'act', 0.9), answer('status', 'act', 0.9)]),
      perform: (action) =>
        Promise.resolve(
          action === 'status'
            ? { ok: false, chargedMicros: 0, reason: 'no_text' }
            : { ok: true, chargedMicros: 50 },
        ),
    });
    await s.wake();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'done',
        actionSummary: '给你发了条消息；更新状态没做成',
      }),
    );
    const s2 = service({
      tools: ['message'],
      decide: okDecide([answer('message', 'act', 0.9)]),
    });
    s2.settings.row.mockResolvedValue({ disabledActions: ['message'] });
    await s2.wake();
    expect(s2.perform).not.toHaveBeenCalled();
    expect(s2.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' }));
  });
});

describe('后台决策模型只允许 Jev 类', () => {
  function settings(status: unknown) {
    const svc = Object.create(EcologySettingsService.prototype) as EcologySettingsService;
    Object.assign(svc, {
      media: { decisionModelStatus: vi.fn().mockResolvedValue(status) },
      quotes: { quote: vi.fn().mockResolvedValue({ ok: true, value: { amountMicros: 1 } }) },
    });
    return svc;
  }

  it('文字模型（没有决策计费上限）保存时被拒', async () => {
    const svc = settings({ ready: false, reason: 'not_decision_model' });
    await expect(
      svc.updateConfig(USER, { ...DEFAULT_ECOLOGY_CONFIG, decisionModelKey: 'deepseek/v4' }),
    ).rejects.toThrow(/不是判定模型/);
  });

  it('网关不提供判定检查时按不可用处理', async () => {
    const svc = Object.create(EcologySettingsService.prototype) as EcologySettingsService;
    Object.assign(svc, { media: {} });
    expect(await svc.decisionProblem(JEV)).toMatch(/无法确认/);
    expect(await settings({ ready: true, reason: null }).decisionProblem(JEV)).toBeNull();
  });
});

describe('给 Jev 的对话现状摘要', () => {
  it('包含时间、未回复、最近要点与今天做过的事；截短并替换隐私与第三方称呼', () => {
    const text = jevSummary({
      local: { hour: 21, minute: 5 },
      weekday: 1,
      recent: [
        { who: 'user', text: '今天和王老师吵架了，' + '很烦'.repeat(60) },
        { who: 'character', text: '抱抱你' },
      ],
      unanswered: 1,
      sinceUserMs: 30 * 60_000,
      doneToday: ['给你发了条消息'],
    });
    expect(text).toContain('周一 21:05');
    expect(text).toContain('30 分钟前');
    expect(text).toContain('还没被回的消息 1 条');
    expect(text).toContain('角色：抱抱你');
    expect(text).toContain('今天已经做过：给你发了条消息');
    expect(text).not.toContain('王老师');
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).toContain('角色最近没有主动找过对方');
  });

  it('写出上次主动多久前，以及对方在用应用却没回（可能在忙）', () => {
    const text = jevSummary({
      local: { hour: 15, minute: 0 },
      weekday: 3,
      recent: [],
      unanswered: 1,
      sinceUserMs: 3 * 3600_000,
      doneToday: [],
      sinceProactiveMs: 26 * 3600_000,
      userActiveRecently: true,
    });
    expect(text).toContain('角色上次主动是 26 小时前');
    expect(text).toContain('可能在忙或暂时不想回');
    const idle = jevSummary({
      local: { hour: 15, minute: 0 },
      weekday: 3,
      recent: [],
      unanswered: 0,
      sinceUserMs: 4 * 86400_000,
      doneToday: [],
      sinceProactiveMs: 3 * 86400_000,
      userActiveRecently: false,
    });
    expect(idle).toContain('角色上次主动是 3 天前');
    expect(idle).toContain('最近半小时不在应用里');
  });
});
