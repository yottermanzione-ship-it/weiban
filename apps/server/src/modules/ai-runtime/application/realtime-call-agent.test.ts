import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CallAgentSignal,
  CharacterPolicy,
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
} from '@weiban/contracts';
import { CLOCK, DATABASE, TestClock } from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { AdultBoundaryService } from './adult-boundary.js';
import { BrainContextService } from './brain.js';
import { CallAgentService } from './call-agent.js';
import { MediaAiService } from './media-ai.js';
import { MemoryService } from './memory.js';
import { RealtimeAgentSession, realtimeCallInstructions } from './realtime-call-agent.js';
import { CompanionSettingsService } from './settings.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';

afterEach(() => vi.useRealTimers());

const POLICY: CharacterPolicy = {
  isRealPerson: false,
  isMinor: false,
  romanceAllowed: false,
  adultModeEligible: false,
} as CharacterPolicy;

/** 受控的假实时会话：测试推事件、记录角色侧发出的动作；不连任何供应商。 */
function fakeRealtime() {
  const queue: RealtimeVoiceEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const calls = {
    respond: [] as Array<string | undefined>,
    interrupts: 0,
    pushed: 0,
    instructions: [] as string[],
    closed: 0,
  };
  const push = (event: RealtimeVoiceEvent) => {
    queue.push(event);
    const w = wake;
    wake = null;
    w?.();
  };
  const finish = () => {
    ended = true;
    const w = wake;
    wake = null;
    w?.();
  };
  const rt: RealtimeVoiceSession = {
    modelKey: 'qwen/qwen-audio-3.0-realtime-plus',
    outputSampleRate: 24000,
    pushAudio: (chunk) => (calls.pushed += chunk.length),
    respond: (input) => calls.respond.push(input?.instructions),
    interrupt: () => calls.interrupts++,
    updateInstructions: (text) => calls.instructions.push(text),
    async *events() {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
    close: async () => {
      calls.closed++;
      finish();
      return { modelKey: 'qwen/rt', chargedMicros: 0, latencyMs: 0, usageRecordId: 'u' };
    },
  };
  return { rt, push, calls, finish };
}

function setup(
  opts: { direction?: 'outgoing' | 'incoming'; depleted?: boolean; reason?: string } = {},
) {
  const fake = fakeRealtime();
  const enqueueCallExtraction = vi.fn(async (_input: { transcript: string; scope: string }) => {
    void _input;
  });
  const getSpendStatus = vi.fn(async () => ({
    depleted: !!opts.depleted,
    insufficient: !!opts.depleted,
    availableMicros: opts.depleted ? 0 : 1_000_000,
  }));
  const session = new RealtimeAgentSession(
    {
      billing: { getSpendStatus } as never,
      memory: { enqueueCallExtraction } as never,
      clock: new TestClock('2026-10-26T10:00:00Z'),
    },
    {
      epoch: 'e1',
      callId: 'call',
      userId: 'user',
      characterId: 'role',
      conversationId: 'conv',
      direction: opts.direction ?? 'outgoing',
      policy: POLICY,
      callReason: opts.reason ?? null,
      instructions: '基础指令',
    },
    fake.rt,
  );
  const signals: CallAgentSignal[] = [];
  const audio: Uint8Array[] = [];
  session.start();
  const collected = (async () => {
    for await (const s of session.signals()) signals.push(s);
  })();
  const heard = (async () => {
    for await (const a of session.audio()) audio.push(a);
  })();
  return {
    session,
    ...fake,
    signals,
    audio,
    collected,
    heard,
    enqueueCallExtraction,
    getSpendStatus,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('实时语音通话：角色一侧', () => {
  it('接通后角色先开口；主动来电带上打电话的原因', async () => {
    vi.useFakeTimers();
    const out = setup();
    expect(out.calls.respond[0]).toContain('你刚接起');
    await out.session.close({ durationSec: 0, outcome: 'ended' });
    const inc = setup({ direction: 'incoming', reason: '想分享今天的晚霞' });
    expect(inc.calls.respond[0]).toContain('想分享今天的晚霞');
    await inc.session.close({ durationSec: 0, outcome: 'ended' });
  });

  it('角色说话：发 speaking 信号并转发声音；用户开口打断时清空未播放的声音', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.push({ kind: 'response_started' });
    t.push({ kind: 'audio', chunk: new Uint8Array([1, 2]) });
    await flush();
    expect(t.signals).toEqual([{ kind: 'speaking', speaking: true }]);
    expect(t.audio).toHaveLength(1);
    t.push({ kind: 'user_speech_started' });
    await flush();
    expect(t.signals.at(-1)).toEqual({ kind: 'speaking', speaking: false });
    t.session.onBargeIn();
    expect(t.calls.interrupts).toBe(1);
    await t.session.close({ durationSec: 1, outcome: 'ended' });
  });

  it('台词越界（不允许恋爱却自称女朋友）：立即打断、丢弃后续声音、不写进通话记录', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.push({ kind: 'user_transcript', text: '你好呀' });
    t.push({ kind: 'response_started' });
    t.push({ kind: 'audio', chunk: new Uint8Array([1, 2]) });
    t.push({ kind: 'assistant_text', text: ' ', final: false });
    t.push({ kind: 'assistant_text', text: '我是你的女朋友呀', final: false });
    t.push({ kind: 'audio', chunk: new Uint8Array([3, 4]) });
    t.push({ kind: 'assistant_text', text: '我是你的女朋友呀。', final: true });
    t.push({ kind: 'response_done', interrupted: true });
    await flush();
    expect(t.calls.interrupts).toBe(1);
    expect(t.audio).toHaveLength(1);
    await t.session.close({ durationSec: 30, outcome: 'ended' });
    const transcript = t.enqueueCallExtraction.mock.calls[0]?.[0].transcript ?? '';
    expect(transcript).toContain('用户：你好呀');
    expect(transcript).not.toContain('女朋友');
    expect(t.enqueueCallExtraction.mock.calls[0]?.[0].scope).toBe('normal');
  });

  it('用户说出高风险内容：会话指令追加安全关怀（只追加一次）', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.push({ kind: 'user_transcript', text: '我真的不想活了' });
    t.push({ kind: 'user_transcript', text: '我不想活了' });
    await flush();
    expect(t.calls.instructions).toHaveLength(1);
    expect(t.calls.instructions[0]).toContain('基础指令');
    expect(t.calls.instructions[0]).toContain('12356');
    await t.session.close({ durationSec: 1, outcome: 'ended' });
  });

  it('静音键期间不上传声音（不计费）', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.session.onMute(true);
    t.session.onUserAudio(new Uint8Array(640));
    expect(t.calls.pushed).toBe(0);
    t.session.onMute(false);
    t.session.onUserAudio(new Uint8Array(640));
    expect(t.calls.pushed).toBe(640);
    await t.session.close({ durationSec: 1, outcome: 'ended' });
  });

  it('网关结束会话（余额不足以继续）→ 按该结局挂断', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.push({ kind: 'ended', reason: 'insufficient_balance' });
    await flush();
    expect(t.signals).toContainEqual({ kind: 'end', outcome: 'insufficient_balance' });
    await t.session.close({ durationSec: 1, outcome: 'insufficient_balance' });
  });

  it('供应商连接意外断开 → 按故障挂断', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.finish();
    await flush();
    expect(t.signals).toContainEqual({ kind: 'end', outcome: 'failed' });
    await t.session.close({ durationSec: 1, outcome: 'failed' });
  });

  it('余额用完：角色正在说就先打断，等回应结束后道别，再以余额不足挂断', async () => {
    vi.useFakeTimers();
    const t = setup({ depleted: true });
    t.push({ kind: 'response_started' });
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.calls.interrupts).toBe(1);
    t.push({ kind: 'response_done', interrupted: true });
    await flush();
    expect(t.calls.respond.at(-1)).toContain('道别');
    expect(t.signals.some((s) => s.kind === 'end')).toBe(false);
    t.push({ kind: 'response_started' });
    t.push({ kind: 'response_done', interrupted: false });
    await flush();
    expect(t.signals).toContainEqual({ kind: 'end', outcome: 'insufficient_balance' });
    await t.session.close({ durationSec: 60, outcome: 'insufficient_balance' });
  });

  it('55 分钟提醒一次，59 分半道别并以时长上限挂断；道别无回应也在 10 秒内结束', async () => {
    vi.useFakeTimers();
    const t = setup();
    await vi.advanceTimersByTimeAsync(55 * 60_000 - 1);
    expect(t.calls.respond).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls.respond).toHaveLength(2);
    expect(t.calls.respond[1]).toContain('五分钟');
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
    expect(t.calls.respond).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.signals).toContainEqual({ kind: 'end', outcome: 'time_limit' });
    await t.session.close({ durationSec: 3600, outcome: 'time_limit' });
    expect(t.calls.closed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('会话指令：人设前缀 + 通话规则 + 最近聊天 + 记忆，限 2 万字', () => {
    const text = realtimeCallInstructions({
      brain: { scope: 'normal', prefix: '人设前缀', recall: '记忆：下周面试' },
      policy: POLICY,
      history: [
        { role: 'user', content: '今天好累' },
        { role: 'assistant', content: '抱抱你' },
      ],
    });
    expect(text.startsWith('人设前缀')).toBe(true);
    expect(text).toContain('实时语音通话');
    expect(text).toContain('用户：今天好累');
    expect(text).toContain('你：抱抱你');
    expect(text).toContain('记忆：下周面试');
    expect(
      realtimeCallInstructions({
        brain: { scope: 'normal', prefix: 'x'.repeat(30_000), recall: '' },
        policy: POLICY,
        history: [],
      }).length,
    ).toBe(20_000);
  });
});

describe('通话入口按场景路由到实时模型', () => {
  async function service(opts: {
    route: unknown;
    adult?: boolean;
    open?: ReturnType<typeof vi.fn>;
  }) {
    const asr = vi.fn(async () => ({ ok: false, error: 'not_configured' }));
    const open = opts.open ?? vi.fn(async () => ({ ok: true, value: fakeRealtime().rt }));
    const module = await Test.createTestingModule({
      providers: [
        CallAgentService,
        {
          provide: BrainContextService,
          useValue: {
            build: async () => ({ scope: 'normal', prefix: '共享角色前缀', recall: '本轮记忆' }),
          },
        },
        { provide: AdultBoundaryService, useValue: { generate: vi.fn() } },
        { provide: MODEL_GATEWAY_PORT, useValue: { generateText: vi.fn() } },
        {
          provide: MODEL_GATEWAY_MEDIA_PORT,
          useValue: {
            isServiceEnabled: async () => false,
            voiceCallRoute: async () => opts.route,
            openRealtimeVoice: open,
            openRealtimeAsr: asr,
            streamSpeech: vi.fn(),
          },
        },
        {
          provide: BILLING_READ_PORT,
          useValue: {
            getSpendStatus: async () => ({
              depleted: false,
              insufficient: false,
              availableMicros: 1,
            }),
          },
        },
        {
          provide: IDENTITY_READ_PORT,
          useValue: { getProfile: async () => ({ nickname: '朋友' }) },
        },
        {
          provide: AI_CHARACTER_READ,
          useValue: {
            getForRuntime: async () => ({
              card: null,
              profile: { name: '实时测试角色', kind: 'preset' },
            }),
          },
        },
        {
          provide: POLICY_PORT,
          useValue: {
            getCharacterPolicy: async () => ({ ...POLICY, adultModeEligible: !!opts.adult }),
          },
        },
        {
          provide: CONTACTS_READ_PORT,
          useValue: {
            getActiveContact: async () => ({ conversationId: 'conversation', addressAs: '朋友' }),
            getActiveContactEpoch: async () => ({ version: 'contact-epoch' }),
          },
        },
        {
          provide: CHAT_READ_PORT,
          useValue: {
            readMessages: async () => [
              {
                status: 'normal',
                senderKind: 'user',
                content: { type: 'text', text: '晚上好' },
              },
            ],
          },
        },
        { provide: CLOCK, useValue: new TestClock('2026-10-26T10:00:00Z') },
        {
          provide: MemoryService,
          useValue: { context: async () => null, enqueueCallExtraction: vi.fn() },
        },
        { provide: MediaAiService, useValue: { resolveVoice: async () => 'v' } },
        {
          provide: CompanionSettingsService,
          useValue: {
            get: async () => ({ voiceId: null, scenarioMode: opts.adult ? 'adult' : 'daily' }),
          },
        },
        { provide: DATABASE, useValue: {} },
      ],
    }).compile();
    const opened = await module.get(CallAgentService).openSession({
      callId: 'call',
      userId: 'user',
      characterId: 'role',
      conversationId: 'conversation',
      direction: 'outgoing',
    });
    return { module, opened, open, asr };
  }

  it('选了实时模型：不走识别 / 合成，直接打开实时会话（指令含人设与最近聊天）', async () => {
    const s = await service({ route: { kind: 'realtime', modelKey: 'qwen/rt' } });
    try {
      expect(s.opened.ok).toBe(true);
      expect(s.asr).not.toHaveBeenCalled();
      const input = s.open.mock.calls[0]?.[0] as {
        characterId: string;
        sampleRate: number;
        instructions: string;
        idempotencyKey: string;
      };
      expect(input.characterId).toBe('role');
      expect(input.sampleRate).toBe(16000);
      expect(input.instructions).toContain('共享角色前缀');
      expect(input.instructions).toContain('用户：晚上好');
      expect(input.idempotencyKey).toMatch(/^call:call:rt:/);
      if (s.opened.ok) await s.opened.value.close({ durationSec: 0, outcome: 'ended' });
    } finally {
      await s.module.close();
    }
  });

  it('私密范围不开放实时通话', async () => {
    const s = await service({ route: { kind: 'realtime', modelKey: 'qwen/rt' }, adult: true });
    try {
      expect(s.opened).toEqual({ ok: false, error: 'not_available' });
      expect(s.open).not.toHaveBeenCalled();
    } finally {
      await s.module.close();
    }
  });

  it('实时会话打不开（余额不足 / 未配置）映射成通话错误', async () => {
    const poor = await service({
      route: { kind: 'realtime', modelKey: 'qwen/rt' },
      open: vi.fn(async () => ({ ok: false, error: 'insufficient_balance' })),
    });
    expect(poor.opened).toEqual({ ok: false, error: 'insufficient_balance' });
    await poor.module.close();
    const none = await service({ route: { kind: 'unavailable', error: 'not_configured' } });
    expect(none.opened).toEqual({ ok: false, error: 'service_disabled' });
    expect(none.open).not.toHaveBeenCalled();
    await none.module.close();
  });
});
