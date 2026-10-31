/**
 * 聊天多样性护栏（对照表 v3、草案 §1）：会话压制、语音护栏、表情包 20 条去重与保底偏置。
 * 只用桩，不发起真实模型调用。
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Message, ModelGatewayMediaPort } from '@weiban/contracts';
import { MediaAiService } from './media-ai.js';
import type { PlanBatchRequest, PlanResult } from './planner.js';

const happy = { stickerId: 'happy', mediaId: 'happy-media', description: '开心哈哈大笑' };

function characterMessage(i: number, type: 'text' | 'voice' | 'sticker' = 'text'): Message {
  return {
    messageId: `m${i}`,
    conversationId: 'conversation',
    seq: i,
    senderParticipantId: 'character-participant',
    senderKind: 'character',
    content:
      type === 'text'
        ? { type: 'text', text: '普通消息' }
        : type === 'voice'
          ? { type: 'voice', mediaId: 'v', durationMs: 1000, transcript: '你好' }
          : {
              type: 'sticker',
              source: 'library',
              stickerId: 'happy',
              mediaId: 'happy-media',
              description: '开心哈哈大笑',
            },
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(i).toISOString(),
    recalledAt: null,
  };
}

function userMessage(i: number, text: string): Message {
  return {
    messageId: `u${i}`,
    conversationId: 'conversation',
    seq: i,
    senderParticipantId: 'user-participant',
    senderKind: 'user',
    content: { type: 'text', text },
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(i).toISOString(),
    recalledAt: null,
  };
}

function setup() {
  const listStickersForCharacter = vi.fn(async () => [happy]);
  const getVoice = vi.fn(async () => ({ enabled: true }));
  const decideBatch = vi.fn(async (req: PlanBatchRequest): Promise<Record<string, PlanResult>> =>
    Object.fromEntries(
      req.questions.map((q) => [
        q.questionId,
        {
          choice: q.questionId === 'voice' ? 'voice' : 'keep_sticker',
          confidence: 0.9,
          reason: 'test',
          implementation: 'jev',
          fallback: null,
          usageRecordId: 'usage',
        },
      ]),
    ),
  );
  const service = new MediaAiService(
    ...([
      {
        isServiceEnabled: async () => true,
        synthesizeSpeech: (async () => ({
          ok: true,
          value: {
            mediaId: 'voice-media',
            durationMs: 1000,
            chargedMicros: 200,
            usageRecordId: 'tts-usage',
            latencyMs: 1,
            modelKey: 'selected-tts',
          },
        })) as ModelGatewayMediaPort['synthesizeSpeech'],
        webSearch: async () => {
          throw new Error('search disabled');
        },
      },
      {},
      { listStickersForCharacter, getVoice },
      { preview: vi.fn() },
      { listUsableWorkLinks: async () => [] },
      { getDefaultVoiceId: async () => null },
      {},
      {},
      {},
      { getInconvenientUntil: async (): Promise<string | null> => null },
      { nowMs: () => 1000 },
      {
        generate: async () => {
          throw new Error('images disabled');
        },
      },
      { decideBatch },
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
  return { service, decideBatch, listStickersForCharacter };
}

function baseInput(history: Message[], userText = '今天有好事', bubbles = ['哈哈，好开心']) {
  return {
    ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
    triggerId: 'turn',
    bubbles,
    userText,
    history,
    voiceId: 'selected-voice',
  };
}

const tenTexts = () => Array.from({ length: 10 }, (_, i) => characterMessage(i));

describe('会话压制', () => {
  it('用户说「别发表情包了」：不问表情包，只问语音', async () => {
    const s = setup();
    const history = [userMessage(0, '别发表情包了'), ...tenTexts()];
    const result = await s.service.planExtras(baseInput(history));
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['voice']);
    expect(result?.map((c) => c.type)).toEqual(['voice']);
  });

  it('用户后来明确要表情包：压制恢复', async () => {
    const s = setup();
    const history = [userMessage(0, '别发表情包了'), ...tenTexts(), userMessage(99, '发个表情包')];
    await s.service.planExtras(baseInput(history));
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual([
      'voice',
      'sticker',
    ]);
  });

  it('用户说「不要发语音」：不问语音', async () => {
    const s = setup();
    const history = [userMessage(0, '不要发语音'), ...tenTexts()];
    await s.service.planExtras(baseInput(history));
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['sticker']);
  });
});

describe('语音护栏', () => {
  it('20 条内已有 2 条语音：不再主动发语音', async () => {
    const s = setup();
    const history = Array.from({ length: 30 }, (_, i) =>
      characterMessage(i, i === 15 || i === 25 ? 'voice' : 'text'),
    );
    await s.service.planExtras(baseInput(history));
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['sticker']);
  });

  it('上次语音后不足 5 条文字：不连发语音', async () => {
    const s = setup();
    const history = [
      ...Array.from({ length: 25 }, (_, i) => characterMessage(i)),
      characterMessage(25, 'voice'),
      characterMessage(26),
      characterMessage(27),
      characterMessage(28),
    ];
    await s.service.planExtras(baseInput(history));
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['sticker']);
  });

  it('主动穿插只挑 80 字以内；用户明确要语音时放宽到 120 字硬上限', async () => {
    const s = setup();
    const bubbles90 = ['啊'.repeat(90)];
    const result = await s.service.planExtras(baseInput(tenTexts(), '今天有好事', bubbles90));
    expect(result).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
    const s2 = setup();
    const requested = await s2.service.planExtras(baseInput([], '发条语音', bubbles90));
    // 明确要语音时不问决策层，直接合成。
    expect(s2.decideBatch).not.toHaveBeenCalled();
    expect(requested?.map((c) => c.type)).toEqual(['voice']);
  });
});

describe('表情包去重与保底', () => {
  it('20 条内发过的同一张不重复选', async () => {
    const s = setup();
    const history = tenTexts();
    history[5]!.content = {
      type: 'sticker',
      source: 'library',
      stickerId: 'happy',
      mediaId: 'happy-media',
      description: '开心哈哈大笑',
    };
    const result = await s.service.planExtras(baseInput(history));
    // 唯一合义的图在 20 条内发过：不选它；语音仍可正常问。
    expect(result?.map((c) => c.type)).toEqual(['voice']);
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['voice']);
  });

  it('保底：最近 9 条都没带表情包时，规则版与保守版都倾向保留', async () => {
    const s = setup();
    await s.service.planExtras(baseInput(tenTexts()));
    const stickerQ = s.decideBatch.mock.calls[0]![0].questions.find(
      (q) => q.questionId === 'sticker',
    );
    expect(stickerQ?.ruleChoice).toBe('keep_sticker');
    expect(stickerQ?.conservative).toBe('keep_sticker');
  });
});
