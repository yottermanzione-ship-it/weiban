import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { CharacterCard, type CallAgentSession, type CallAgentSignal } from '@weiban/contracts';
import { CLOCK, DATABASE, TestClock } from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { CallAgentService } from './call-agent.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { MemoryService } from './memory.js';
import { MediaAiService } from './media-ai.js';
import { CompanionSettingsService } from './settings.js';

afterEach(() => vi.useRealTimers());

async function openControlledSession(blockReply = false, customVoiceId?: string) {
  let releaseReply: (() => void) | undefined;
  const reply = vi.fn(async () => {
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
  const resolveVoice = vi.fn(async () => customVoiceId ?? 'fixture-voice');
  let releaseAsr: (() => void) | undefined;
  const asr = {
    pushAudio: vi.fn(),
    results: async function* () {
      await new Promise<void>((resolveWait) => {
        releaseAsr = resolveWait;
      });
      yield { final: false, text: '' };
    },
    close: vi.fn(async () => {
      releaseAsr?.();
    }),
  };
  const speech = vi.fn(async (_input: { text: string }) => ({
    ok: true,
    value: {
      audio: (async function* () {
        yield new Uint8Array([1, 2]);
      })(),
      abort: vi.fn(),
    },
  }));
  const spend = vi.fn(async () => ({
    depleted: false,
    insufficient: false,
    availableMicros: 10_000_000,
  }));
  const module = await Test.createTestingModule({
    providers: [
      CallAgentService,
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
          }),
        },
      },
      {
        provide: CONTACTS_READ_PORT,
        useValue: {
          getActiveContact: async () => ({ conversationId: 'conversation', addressAs: '朋友' }),
        },
      },
      { provide: CHAT_READ_PORT, useValue: { readMessages: async () => [] } },
      { provide: CLOCK, useValue: new TestClock('2026-10-11T10:00:00Z') },
      { provide: MemoryService, useValue: { context: async () => null } },
      { provide: MediaAiService, useValue: { resolveVoice } },
      { provide: CompanionSettingsService, useValue: { get: async () => ({ voiceId: null }) } },
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
    resolveVoice,
    session,
    speech,
    spend,
    asr,
    signals,
    collected,
    releaseReply: () => releaseReply?.(),
  };
}

it('自定义角色通话把已授权角色快照音色传入选择器和语音流端口', async () => {
  const call = await openControlledSession(false, 'custom-library-voice');
  try {
    expect(call.resolveVoice).toHaveBeenCalledWith('role', null, 'custom-library-voice');
    expect(call.speech).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'custom-library-voice' }),
    );
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
      value: {
        audio: (async function* () {
          await new Promise<void>((resolveWait) => {
            releaseSpeech = resolveWait;
          });
          yield new Uint8Array(0);
        })(),
        abort,
      },
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
