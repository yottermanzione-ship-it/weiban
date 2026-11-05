/**
 * 聊天多样性护栏（对照表 v3、草案 §1）：会话压制、语音护栏、表情包 20 条去重与保底提醒。
 * T-20261103d：表情包由模型标记的情绪决定（stickerMood），决策层只剩语音一个问题。
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
  const isServiceEnabled = vi.fn(async () => true);
  const getInconvenientUntil = vi.fn(async (): Promise<string | null> => null);
  const listStickersForCharacter = vi.fn(async () => [happy]);
  const getVoice = vi.fn(async () => ({ enabled: true }));
  const decideBatch = vi.fn(async (req: PlanBatchRequest): Promise<Record<string, PlanResult>> =>
    Object.fromEntries(
      req.questions.map((q) => [
        q.questionId,
        {
          choice: 'voice',
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
        isServiceEnabled,
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
      { getInconvenientUntil },
      { nowMs: () => 1000 },
      {
        generate: async () => {
          throw new Error('images disabled');
        },
      },
      { decideBatch },
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
  return {
    service,
    decideBatch,
    listStickersForCharacter,
    isServiceEnabled,
    getInconvenientUntil,
    getVoice,
  };
}

function baseInput(
  history: Message[],
  userText = '今天有好事',
  bubbles = ['哈哈，好开心'],
  stickerMood: 'happy' | null = 'happy',
) {
  return {
    ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
    triggerId: 'turn',
    bubbles,
    userText,
    history,
    voiceId: 'selected-voice',
    stickerMood,
  };
}

const tenTexts = () => Array.from({ length: 10 }, (_, i) => characterMessage(i));
const questions = (s: ReturnType<typeof setup>) =>
  s.decideBatch.mock.calls[0]?.[0].questions.map((q) => q.questionId) ?? [];

describe('平台语音能力与明确请求', () => {
  it('一句语音绕过主动概率与比例，先给模型真实能力，再发送语音', async () => {
    const s = setup();
    const input = baseInput([], '给我来句语音吧', ['晚安，明天见。'], null);
    expect(await s.service.voiceReplyPrompt({ ...input, sensitive: false })).toContain(
      '当前服务和音色可用',
    );
    expect((await s.service.planExtras(input))?.map((c) => c.type)).toEqual(['voice']);
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('明确不要语音时，本轮不得误触发合成，提示与发送一致', async () => {
    const s = setup();
    const input = baseInput(tenTexts(), '不要发一句语音', ['好，打字聊。'], null);
    expect(await s.service.voiceReplyPrompt({ ...input, sensitive: false })).toContain(
      '用户现在不想收语音',
    );
    expect(await s.service.planExtras(input)).toBeNull();
    expect(s.isServiceEnabled).not.toHaveBeenCalled();
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('临时停用、无音色、不方便、私密和关怀各自给出事实，不编造平台没有语音', async () => {
    const s = setup();
    const input = { ...baseInput([], '发一句语音', ['你好。'], null), sensitive: false };
    s.isServiceEnabled.mockResolvedValue(false);
    expect(await s.service.voiceReplyPrompt(input)).toContain('语音服务当前暂不可用');
    expect(await s.service.planExtras(input)).toBeNull();
    s.isServiceEnabled.mockResolvedValue(true);
    s.getVoice.mockResolvedValue({ enabled: false });
    expect(await s.service.voiceReplyPrompt(input)).toContain('还没有可用音色');
    s.getInconvenientUntil.mockResolvedValue(new Date(100_000).toISOString());
    expect(await s.service.voiceReplyPrompt(input)).toContain('不方便接收语音');
    s.getInconvenientUntil.mockRejectedValue(new Error('quiet state unavailable'));
    expect(await s.service.voiceReplyPrompt(input)).toContain('暂时无法确认');
    expect(await s.service.planExtras(input)).toBeNull();
    expect(
      await s.service.voiceReplyPrompt({ ...input, ctx: { ...input.ctx, modelRole: 'adult' } }),
    ).toContain('私密模式只支持文字和图片');
    expect(await s.service.voiceReplyPrompt({ ...input, sensitive: true })).toContain(
      '关怀或健康话题',
    );
  });
});

describe('会话压制', () => {
  it('用户说「别发表情包了」：模型标了表情也不发，语音照常问', async () => {
    const s = setup();
    const history = [userMessage(0, '别发表情包了'), ...tenTexts()];
    const result = await s.service.planExtras(baseInput(history));
    expect(questions(s)).toEqual(['voice']);
    expect(result?.map((c) => c.type)).toEqual(['voice']);
  });

  it('用户后来明确要表情包：压制恢复', async () => {
    const s = setup();
    const history = [userMessage(0, '别发表情包了'), ...tenTexts(), userMessage(99, '发个表情包')];
    const result = await s.service.planExtras(baseInput(history));
    expect(result?.map((c) => c.type)).toEqual(['voice', 'sticker']);
  });

  it('用户说「不要发语音」：不问语音，表情照模型标记发', async () => {
    const s = setup();
    const history = [userMessage(0, '不要发语音'), ...tenTexts()];
    const result = await s.service.planExtras(baseInput(history));
    expect(s.decideBatch).not.toHaveBeenCalled();
    expect(result?.map((c) => c.type)).toEqual(['text', 'sticker']);
  });
});

describe('语音护栏', () => {
  it('20 条内已有 2 条语音：不再主动发语音', async () => {
    const s = setup();
    const history = Array.from({ length: 30 }, (_, i) =>
      characterMessage(i, i === 15 || i === 25 ? 'voice' : 'text'),
    );
    await s.service.planExtras(baseInput(history));
    expect(s.decideBatch).not.toHaveBeenCalled();
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
    expect(s.decideBatch).not.toHaveBeenCalled();
  });

  it('主动穿插只挑 80 字以内；用户明确要语音时放宽到 120 字硬上限', async () => {
    const s = setup();
    const bubbles90 = ['啊'.repeat(90)];
    const result = await s.service.planExtras(baseInput(tenTexts(), '今天有好事', bubbles90, null));
    expect(result).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
    const s2 = setup();
    const requested = await s2.service.planExtras(baseInput([], '发条语音', bubbles90, null));
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
    // 唯一同情绪的图在 20 条内发过：不选它；语音仍可正常问。
    expect(result?.map((c) => c.type)).toEqual(['voice']);
    expect(questions(s)).toEqual(['voice']);
  });

  it('保底只在提示词里提醒，不由服务端硬塞：连续多条没带、模型也没标时不发', async () => {
    const s = setup();
    const history = Array.from({ length: 30 }, (_, i) => characterMessage(i));
    const result = await s.service.planExtras(baseInput(history, '今天有好事', ['哈哈'], null));
    expect(result?.map((c) => c.type)).toEqual(['voice']);
    expect(await s.service.stickerPrompt({ ...baseInput(history), history })).toContain(
      '你已经连着好几条没配表情了',
    );
  });
});
