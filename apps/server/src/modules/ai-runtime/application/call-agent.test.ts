import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CharacterCard,
  type CallAgentSession,
  type CallAgentSignal,
  type GenerateTextInput,
  type PortResult,
  type StreamingTtsResult,
} from '@weiban/contracts';
import { CLOCK, DATABASE, TestClock } from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { CallAgentService } from './call-agent.js';
import { AdultBoundaryService } from './adult-boundary.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { MemoryService } from './memory.js';
import { MediaAiService } from './media-ai.js';
import { CompanionSettingsService } from './settings.js';
import { BrainContextService } from './brain.js';

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function completeSpeech(audio: AsyncIterable<Uint8Array>, abort = vi.fn()): StreamingTtsResult {
  return {
    audio,
    abort,
    done: Promise.resolve({
      ok: true,
      value: { modelKey: 'fixture-tts', chargedMicros: 17, latencyMs: 1, usageRecordId: 'usage' },
    }),
  };
}

async function openControlledSession(
  blockReply = false,
  customVoiceId?: string,
  opts: { adult?: boolean; userSays?: string } = {},
) {
  let releaseReply: (() => void) | undefined;
  const reply = vi.fn(async (_input: GenerateTextInput) => {
    void _input;
    if (blockReply)
      await new Promise<void>((resolveReply) => {
        releaseReply = resolveReply;
      });
    return { ok: true, value: { text: '喂，今天过得怎么样？' } };
  });
  const card = CharacterCard.parse(
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
        'utf8',
      ).match(/```json\s*([\s\S]*?)```/)![1]!,
    ).card,
  );
  if (customVoiceId) card.data.social.voiceId = customVoiceId;
  const enqueueCallExtraction = vi.fn(async (_input: { transcript: string }) => undefined);
  const resolveVoice = vi.fn(async () => customVoiceId ?? 'fixture-voice');
  const results: Array<{ final: boolean; text: string }> = opts.userSays
    ? [{ final: true, text: opts.userSays }]
    : [];
  let releaseAsr: (() => void) | undefined;
  let asrEnded = false;
  let asrError: Error | undefined;
  const wakeAsr = () => {
    const release = releaseAsr;
    releaseAsr = undefined;
    release?.();
  };
  const asr = {
    pushAudio: vi.fn(),
    results: async function* () {
      for (;;) {
        if (asrError) throw asrError;
        if (asrEnded) return;
        const result = results.shift();
        if (result) {
          yield result;
          continue;
        }
        await new Promise<void>((resolveWait) => {
          releaseAsr = resolveWait;
        });
      }
    },
    close: vi.fn(async () => {
      asrEnded = true;
      wakeAsr();
    }),
  };
  const speech = vi.fn(
    async (_input: { text: string }): Promise<PortResult<StreamingTtsResult, string>> => ({
      ok: true,
      value: completeSpeech(
        (async function* () {
          yield new Uint8Array([1, 2]);
        })(),
      ),
    }),
  );
  const spend = vi.fn(async () => ({
    depleted: false,
    insufficient: false,
    availableMicros: 10_000_000,
  }));
  const module = await Test.createTestingModule({
    providers: [
      CallAgentService,
      {
        provide: BrainContextService,
        useValue: {
          build: async () => ({
            scope: opts.adult ? 'adult' : 'normal',
            prefix: '共享角色前缀：用户周末喜欢爬山',
            recall: '本轮记忆：下周三面试',
          }),
        },
      },
      {
        provide: AdultBoundaryService,
        useValue: {
          generate: opts.adult
            ? reply
            : async () => {
                throw Error('普通通话不得走成人生成');
              },
        },
      },
      {
        provide: MODEL_GATEWAY_PORT,
        useValue: { generateText: reply },
      },
      {
        provide: MODEL_GATEWAY_MEDIA_PORT,
        useValue: {
          isServiceEnabled: async () => true,
          openRealtimeAsr: async () => ({ ok: true, value: asr }),
          streamSpeech: speech,
        },
      },
      { provide: BILLING_READ_PORT, useValue: { getSpendStatus: spend } },
      { provide: IDENTITY_READ_PORT, useValue: { getProfile: async () => ({ nickname: '朋友' }) } },
      {
        provide: AI_CHARACTER_READ,
        useValue: {
          getForRuntime: async () => ({
            card,
            profile: { name: '计时测试角色', kind: customVoiceId ? 'custom' : 'preset' },
          }),
        },
      },
      {
        provide: POLICY_PORT,
        useValue: {
          getCharacterPolicy: async () => ({
            isRealPerson: false,
            isMinor: false,
            romanceAllowed: true,
            adultModeEligible: !!opts.adult,
          }),
        },
      },
      {
        provide: CONTACTS_READ_PORT,
        useValue: {
          getActiveContact: async () => ({ conversationId: 'conversation', addressAs: '朋友' }),
          getActiveContactEpoch: async () => ({ version: 'contact-epoch' }),
        },
      },
      { provide: CHAT_READ_PORT, useValue: { readMessages: async () => [] } },
      { provide: CLOCK, useValue: new TestClock('2026-10-11T10:00:00Z') },
      { provide: MemoryService, useValue: { context: async () => null, enqueueCallExtraction } },
      { provide: MediaAiService, useValue: { resolveVoice } },
      {
        provide: CompanionSettingsService,
        useValue: {
          get: async () => ({ voiceId: null, scenarioMode: opts.adult ? 'adult' : 'daily' }),
        },
      },
      { provide: DATABASE, useValue: {} },
    ],
  }).compile();
  vi.useFakeTimers();
  const opened = await module.get(CallAgentService).openSession({
    callId: 'call',
    userId: 'user',
    characterId: 'role',
    conversationId: 'conversation',
    direction: 'outgoing',
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('控制端口未能打开通话');
  const session: CallAgentSession = opened.value;
  const signals: CallAgentSignal[] = [];
  const collected = (async () => {
    for await (const signal of session.signals()) signals.push(signal);
  })();
  await vi.advanceTimersByTimeAsync(0);
  return {
    module,
    reply,
    enqueueCallExtraction,
    resolveVoice,
    session,
    speech,
    spend,
    asr,
    signals,
    collected,
    releaseReply: () => releaseReply?.(),
    emitResult: (text: string, final = true) => {
      results.push({ text, final });
      wakeAsr();
    },
    failAsr: () => {
      asrError = new Error('fixture ASR failure');
      wakeAsr();
    },
  };
}

it('自定义角色通话把已授权角色快照音色传入选择器和语音流端口', async () => {
  const call = await openControlledSession(false, 'custom-library-voice');
  try {
    expect(call.resolveVoice).toHaveBeenCalledWith('role', null, 'custom-library-voice');
    expect(call.speech).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'custom-library-voice' }),
    );
    const request = call.reply.mock.calls[0]?.[0];
    expect(request?.messages[0]?.content).toBe('共享角色前缀：用户周末喜欢爬山');
    expect(request?.messages.some((m) => m.content.includes('本轮记忆：下周三面试'))).toBe(true);
    expect(request?.meta?.stablePrefixChars).toBe('共享角色前缀：用户周末喜欢爬山'.length);
  } finally {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    await call.module.close();
  }
});

it('55分钟前不提醒，到时仅提醒一次，59分半道别结束；关闭后无遗留计时器', async () => {
  const call = await openControlledSession();
  try {
    expect(call.speech).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(55 * 60_000 - 1);
    expect(call.speech).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.speech).toHaveBeenCalledTimes(2);
    expect(call.speech.mock.calls[1]![0]).toMatchObject({
      text: expect.stringContaining('再过五分钟'),
    });
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
    expect(call.speech).toHaveBeenCalledTimes(3);
    expect(call.signals.filter((signal) => signal.kind === 'end')).toEqual([
      { kind: 'end', outcome: 'time_limit' },
    ]);
    await call.session.close({ durationSec: 3570, outcome: 'time_limit' });
    await call.collected;
    expect(vi.getTimerCount()).toBe(0);
    const checks = call.spend.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(call.speech).toHaveBeenCalledTimes(3);
    expect(call.spend).toHaveBeenCalledTimes(checks);
  } finally {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.module.close();
  }
});

it('提前挂断取消提醒、道别和余额轮询，不再合成语音', async () => {
  const call = await openControlledSession();
  try {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    expect(call.asr.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(call.speech).toHaveBeenCalledTimes(1);
    expect(call.spend).toHaveBeenCalledTimes(1);
    expect(call.signals.some((signal) => signal.kind === 'end')).toBe(false);
  } finally {
    await call.module.close();
  }
});

it('轮询发现耗尽即自然道别，语音流阻塞也须在耗尽后30秒内结束', async () => {
  const call = await openControlledSession();
  let releaseSpeech: (() => void) | undefined;
  const abort = vi.fn(() => releaseSpeech?.());
  try {
    call.spend.mockResolvedValue({ depleted: true, insufficient: true, availableMicros: 0 });
    call.speech.mockImplementationOnce(async (_input: { text: string }) => ({
      ok: true,
      value: completeSpeech(
        (async function* () {
          await new Promise<void>((resolveWait) => {
            releaseSpeech = resolveWait;
          });
          yield new Uint8Array(0);
        })(),
        abort,
      ),
    }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(call.speech.mock.calls[1]![0]).toMatchObject({
      text: expect.stringContaining('回头打字接着聊'),
    });
    expect(call.signals.some((signal) => signal.kind === 'end')).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call.signals.filter((signal) => signal.kind === 'end')).toEqual([
      { kind: 'end', outcome: 'insufficient_balance' },
    ]);
    expect(abort).toHaveBeenCalledTimes(1);
    await call.session.close({ durationSec: 30, outcome: 'insufficient_balance' });
    await call.collected;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    releaseSpeech?.();
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.module.close();
  }
});

it('聊天模型仍在等待时，余额道别不能排在回复后面，晚到的回复不再播放', async () => {
  const call = await openControlledSession(true);
  try {
    call.spend.mockResolvedValue({ depleted: true, insufficient: true, availableMicros: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(call.signals.filter((signal) => signal.kind === 'end')).toEqual([
      { kind: 'end', outcome: 'insufficient_balance' },
    ]);
    expect(call.speech).toHaveBeenCalledTimes(1);
    call.releaseReply();
    await vi.advanceTimersByTimeAsync(0);
    expect(call.speech).toHaveBeenCalledTimes(1);
  } finally {
    call.releaseReply();
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    await call.module.close();
  }
});

it.each([
  { adult: true, scope: 'adult', modelRole: 'adult' },
  { adult: false, scope: 'normal', modelRole: 'background' },
])('挂断后按通话范围进入持久抽取队列，不在挂断链路同步调用记忆模型', async ({ adult, scope }) => {
  const call = await openControlledSession(false, undefined, {
    adult,
    userSays: '明天我要去面试',
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await call.session.close({ durationSec: 60, outcome: 'completed' });
    await call.collected;
    const summary = call.reply.mock.calls
      .map((c) => (c as unknown as [{ purpose: string; modelRole: string }])[0])
      .find((input) => input.purpose === 'memory');
    expect(summary).toBeUndefined();
    expect(call.enqueueCallExtraction).toHaveBeenCalledTimes(1);
    expect(call.enqueueCallExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        characterId: 'role',
        callId: 'call',
        scope,
        conversationId: 'conversation',
        epoch: 'contact-epoch',
        transcript: expect.stringContaining('明天我要去面试'),
      }),
    );
  } finally {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.module.close();
  }
});

it.each(['barge_in', 'new_final'] as const)(
  '%s 使仍在等待模型的旧轮次失效，新 final 无须等旧模型返回',
  async (interrupt) => {
    const call = await openControlledSession(true);
    try {
      call.reply.mockImplementation(async () => ({ ok: true, value: { text: '接着聊。' } }));
      if (interrupt === 'barge_in') {
        call.session.onBargeIn();
        await vi.advanceTimersByTimeAsync(0);
        expect(call.speech).not.toHaveBeenCalled();
      }
      call.emitResult('我们继续聊');
      await vi.advanceTimersByTimeAsync(0);
      expect(call.reply).toHaveBeenCalledTimes(2);
      expect(call.speech).toHaveBeenCalledTimes(1);
      expect(call.speech).toHaveBeenCalledWith(
        expect.objectContaining({ text: '接着聊。', billingOwner: 'user', format: 'pcm16_24k' }),
      );
      expect(new Set(call.reply.mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(2);
      call.releaseReply();
      await vi.advanceTimersByTimeAsync(0);
      expect(call.speech).toHaveBeenCalledTimes(1);
      await call.session.close({ durationSec: 60, outcome: 'completed' });
      expect(call.enqueueCallExtraction).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: '用户：我们继续聊\n我：接着聊。' }),
      );
    } finally {
      call.releaseReply();
      await call.session.close({ durationSec: 0, outcome: 'ended' });
      await call.collected;
      await call.module.close();
    }
  },
);

it('连续 final 保留每句用户内容和高危关怀，不把失效开场白写入通话记忆', async () => {
  const call = await openControlledSession(true);
  try {
    call.reply.mockImplementation(async () => ({ ok: true, value: { text: '我在这里。' } }));
    call.emitResult('我想自杀');
    call.emitResult('你还在吗');
    await vi.advanceTimersByTimeAsync(0);
    const request = call.reply.mock.calls.at(-1)![0];
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '我想自杀' }),
        expect.objectContaining({ role: 'user', content: '你还在吗' }),
        expect.objectContaining({ role: 'system', content: expect.stringContaining('关怀为先') }),
      ]),
    );
    call.releaseReply();
    await vi.advanceTimersByTimeAsync(0);
    await call.session.close({ durationSec: 60, outcome: 'completed' });
    const transcript = call.enqueueCallExtraction.mock.calls[0]![0] as unknown as {
      transcript: string;
    };
    expect(transcript.transcript).toContain('用户：我想自杀');
    expect(transcript.transcript).toContain('用户：你还在吗');
    expect(transcript.transcript).not.toContain('喂，今天过得怎么样');
  } finally {
    call.releaseReply();
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    await call.module.close();
  }
});

it('打断清空排队旧音频，忽略 abort 后仍晚到的帧及旧 finally，新流继续输出', async () => {
  const call = await openControlledSession();
  const oldGate = deferred<void>();
  const newGate = deferred<void>();
  const abortOld = vi.fn();
  const chunks: number[][] = [];
  let audioCollected: Promise<void> | undefined;
  try {
    call.speech
      .mockResolvedValueOnce({
        ok: true,
        value: completeSpeech(
          (async function* () {
            yield new Uint8Array([3]);
            await oldGate.promise;
            yield new Uint8Array([9]);
          })(),
          abortOld,
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: completeSpeech(
          (async function* () {
            yield new Uint8Array([7]);
            await newGate.promise;
            yield new Uint8Array([8]);
          })(),
        ),
      });
    call.emitResult('第一句话');
    await vi.advanceTimersByTimeAsync(0);
    call.session.onBargeIn();
    call.emitResult('新的问题');
    await vi.advanceTimersByTimeAsync(0);
    expect(abortOld).toHaveBeenCalledTimes(1);
    expect(call.speech).toHaveBeenCalledTimes(3);
    audioCollected = (async () => {
      for await (const chunk of call.session.audio()) chunks.push([...chunk]);
    })();
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual([[7]]);
    oldGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual([[7]]);
    expect(call.signals.at(-1)).toEqual({ kind: 'speaking', speaking: true });
    newGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual([[7], [8]]);
    expect(call.signals.at(-1)).toEqual({ kind: 'speaking', speaking: false });
  } finally {
    oldGate.resolve();
    newGate.resolve();
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await audioCollected;
    await call.collected;
    await call.module.close();
  }
});

it('合成端口尚未返回也可继续下一句，晚到旧 TTS 只 abort、不播放且仍保留真实结算', async () => {
  const call = await openControlledSession();
  const pending = deferred<PortResult<StreamingTtsResult, string>>();
  const settlement = deferred<Awaited<StreamingTtsResult['done']>>();
  const abort = vi.fn();
  const readOldAudio = vi.fn();
  const oldAudio = (async function* () {
    readOldAudio();
    yield new Uint8Array([9]);
  })();
  try {
    call.speech.mockImplementationOnce(() => pending.promise);
    call.emitResult('旧问题');
    await vi.advanceTimersByTimeAsync(0);
    expect(call.speech).toHaveBeenCalledTimes(2);
    call.emitResult('新问题');
    await vi.advanceTimersByTimeAsync(0);
    expect(call.speech).toHaveBeenCalledTimes(3);
    pending.resolve({ ok: true, value: { audio: oldAudio, abort, done: settlement.promise } });
    await vi.advanceTimersByTimeAsync(0);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(readOldAudio).not.toHaveBeenCalled();
    expect(call.signals.filter((s) => s.kind === 'speaking' && s.speaking)).toHaveLength(2);
    settlement.resolve({
      ok: true,
      value: { modelKey: 'real-upstream', chargedMicros: 31, latencyMs: 99, usageRecordId: 'late' },
    });
    await expect(settlement.promise).resolves.toMatchObject({
      ok: true,
      value: { chargedMicros: 31, usageRecordId: 'late' },
    });
  } finally {
    pending.resolve({ ok: false, error: 'fixture_cleanup' });
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    await call.module.close();
  }
});

it.each(['timeout', 'close', 'barge_in'] as const)(
  '道别合成尚未返回时 %s 仍及时结束，晚到结果不重新播放或重复发 end',
  async (finishBy) => {
    const call = await openControlledSession();
    const pending = deferred<PortResult<StreamingTtsResult, string>>();
    const abort = vi.fn();
    const chunks: number[][] = [];
    let audioCollected: Promise<void> | undefined;
    try {
      call.speech.mockImplementationOnce(() => pending.promise);
      call.spend.mockResolvedValue({ depleted: true, insufficient: true, availableMicros: 0 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(call.speech).toHaveBeenCalledTimes(2);
      audioCollected = (async () => {
        for await (const chunk of call.session.audio()) chunks.push([...chunk]);
      })();
      if (finishBy === 'close') {
        await call.session.close({ durationSec: 20, outcome: 'completed' });
        await audioCollected;
      } else if (finishBy === 'barge_in') {
        call.session.onBargeIn();
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(call.signals.filter((signal) => signal.kind === 'end')).toEqual(
        finishBy === 'close' ? [] : [{ kind: 'end', outcome: 'insufficient_balance' }],
      );
      pending.resolve({
        ok: true,
        value: completeSpeech(
          (async function* () {
            yield new Uint8Array([9]);
          })(),
          abort,
        ),
      });
      call.session.onUserAudio(new Uint8Array([1, 0]));
      call.emitResult('结束后不该再回复');
      await vi.advanceTimersByTimeAsync(0);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(chunks).toEqual([]);
      expect(call.reply).toHaveBeenCalledTimes(1);
      expect(call.asr.pushAudio).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      pending.resolve({ ok: false, error: 'fixture_cleanup' });
      await call.session.close({ durationSec: 0, outcome: 'ended' });
      await audioCollected;
      await call.collected;
      await call.module.close();
    }
  },
);

it('静音期间不送音频、不回应晚到 final，取消静音后下一句可继续对话', async () => {
  const call = await openControlledSession();
  try {
    call.session.onMute(true);
    call.session.onUserAudio(new Uint8Array([1, 0]));
    call.emitResult('静音期间的旧识别');
    await vi.advanceTimersByTimeAsync(0);
    expect(call.asr.pushAudio).not.toHaveBeenCalled();
    expect(call.reply).toHaveBeenCalledTimes(1);
    expect(call.speech).toHaveBeenCalledTimes(1);
    call.session.onMute(false);
    call.session.onUserAudio(new Uint8Array([2, 0]));
    call.emitResult('现在继续聊');
    await vi.advanceTimersByTimeAsync(0);
    expect(call.asr.pushAudio).toHaveBeenCalledWith(new Uint8Array([2, 0]));
    expect(call.reply).toHaveBeenCalledTimes(2);
    expect(call.reply.mock.calls[1]![0].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: '现在继续聊' })]),
    );
    expect(
      call.reply.mock.calls[1]![0].messages.some((m) => m.content.includes('静音期间的旧识别')),
    ).toBe(false);
  } finally {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.collected;
    await call.module.close();
  }
});

it('识别流异常只发一次 failed，停止排队音频和计时器，不冒充余额耗尽', async () => {
  const call = await openControlledSession();
  try {
    call.failAsr();
    await vi.advanceTimersByTimeAsync(0);
    expect(call.signals.filter((signal) => signal.kind === 'end')).toEqual([
      { kind: 'end', outcome: 'failed' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    call.session.onBargeIn();
    call.session.onUserAudio(new Uint8Array([1, 0]));
    expect(call.asr.pushAudio).not.toHaveBeenCalled();
    await call.session.close({ durationSec: 0, outcome: 'failed' });
    await call.collected;
    const drained: Uint8Array[] = [];
    for await (const chunk of call.session.audio()) drained.push(chunk);
    expect(drained).toEqual([]);
  } finally {
    await call.session.close({ durationSec: 0, outcome: 'ended' });
    await call.module.close();
  }
});
