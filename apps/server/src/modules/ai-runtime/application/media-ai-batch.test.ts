import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Message, ModelGatewayMediaPort } from '@weiban/contracts';
import { MediaAiService } from './media-ai.js';
import type { PlanBatchRequest, PlanResult } from './planner.js';
import { replyTone, selectReplySticker } from '../domain/reply-media-candidates.js';

const happy = { stickerId: 'happy', mediaId: 'happy-media', description: '开心哈哈大笑' };
const comfort = { stickerId: 'comfort', mediaId: 'comfort-media', description: '抱抱安慰' };
const textMessage = (i: number): Message => ({
  messageId: `m${i}`,
  conversationId: 'conversation',
  seq: i,
  senderParticipantId: 'character-participant',
  senderKind: 'character',
  content: { type: 'text', text: '普通消息' },
  status: 'normal',
  scope: 'normal',
  quote: null,
  clientMsgId: null,
  createdAt: new Date(i).toISOString(),
  recalledAt: null,
});
const history = () => Array.from({ length: 10 }, (_, i) => textMessage(i));
const input = () => ({
  ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
  triggerId: 'turn',
  bubbles: ['哈哈，好开心'],
  userText: '今天有好事',
  history: history(),
  voiceId: 'selected-voice',
});

function setup() {
  const isServiceEnabled = vi.fn(async () => true);
  const synthesizeSpeech = vi.fn<ModelGatewayMediaPort['synthesizeSpeech']>(async () => ({
    ok: true,
    value: {
      mediaId: 'voice-media',
      durationMs: 1000,
      chargedMicros: 200,
      usageRecordId: 'tts-usage',
      latencyMs: 1,
      modelKey: 'selected-tts',
    },
  }));
  const listStickersForCharacter = vi.fn(async () => [happy]);
  const getVoice = vi.fn(async () => ({ enabled: true }));
  const getInconvenientUntil = vi.fn(async (): Promise<string | null> => null);
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
  const generate = vi.fn(async () => {
    throw new Error('images disabled');
  });
  const webSearch = vi.fn(async () => {
    throw new Error('search disabled');
  });
  const preview = vi.fn();
  const service = new MediaAiService(
    ...([
      { isServiceEnabled, synthesizeSpeech, webSearch },
      {},
      { listStickersForCharacter, getVoice },
      { preview },
      { listUsableWorkLinks: async () => [] },
      { getDefaultVoiceId: async () => null },
      {},
      {},
      {},
      { getInconvenientUntil },
      { nowMs: () => 1000 },
      { generate },
      { decideBatch },
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
  return {
    service,
    isServiceEnabled,
    synthesizeSpeech,
    listStickersForCharacter,
    getVoice,
    getInconvenientUntil,
    decideBatch,
    generate,
    webSearch,
  };
}

describe('reply candidates without random substitutes', () => {
  it('requires a known matching meaning, not a matching character or a random fallback', () => {
    expect(selectReplySticker([happy], '我在看一本书', '', 0.1)).toBeNull();
    expect(
      selectReplySticker([{ ...happy, description: '开心鸭 038' }], '开心', '', 0.1),
    ).toBeNull();
    expect(selectReplySticker([happy], '哈哈，开心', '', 0.1)?.meaning).toBe('happy');
  });
  it('does not interpret negated happiness or a serious topic as laughter', () => {
    expect(replyTone('我失业了很难过', '哈哈')).toBe('serious');
    expect(selectReplySticker([happy], '今天不开心', '', 0.1)).toBeNull();
    expect(
      selectReplySticker([happy, comfort], '抱抱，我陪着你', '我失业了很难过', 0.1)?.sticker,
    ).toEqual(comfort);
  });
  it('never repeats an excluded sticker or makes up a meaning for an unlabelled series', () => {
    expect(selectReplySticker([happy], '哈哈', '', 0.1, new Set(['happy']))).toBeNull();
    expect(selectReplySticker([{ ...happy, description: '猫咪日常' }], '你好', '', 0.1)).toBeNull();
  });
});

describe('independent voice and sticker decisions in real planExtras', () => {
  it('evaluates both in one batch and returns voice plus sticker without duplicate text', async () => {
    const s = setup();
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['voice', 'sticker']);
    expect(s.decideBatch).toHaveBeenCalledTimes(1);
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual([
      'voice',
      'sticker',
    ]);
    expect(s.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        billingOwner: 'user',
        voiceId: 'selected-voice',
        format: 'ogg_opus',
      }),
    );
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.webSearch).not.toHaveBeenCalled();
  });
  it('keeps approved sticker independent of denied voice', async () => {
    const s = setup();
    s.decideBatch.mockImplementation(
      async () => ({ voice: { choice: 'text' }, sticker: { choice: 'keep_sticker' } }) as never,
    );
    expect((await s.service.planExtras(input()))?.map((content) => content.type)).toEqual([
      'text',
      'sticker',
    ]);
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
  it('bypasses voice judgment when explicitly requested and does not require historical quota', async () => {
    const s = setup();
    s.listStickersForCharacter.mockResolvedValue([]);
    const result = await s.service.planExtras({ ...input(), history: [], userText: '发条语音' });
    expect(result?.[0]?.type).toBe('voice');
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('does not ask Jev about a voice with no enabled service or sound', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    await s.service.planExtras(input());
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['sticker']);
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
  it('does not make a decision call if no eligible optional action remains', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    s.listStickersForCharacter.mockResolvedValue([]);
    expect(await s.service.planExtras(input())).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('keeps text and the independent sticker when synthesis fails', async () => {
    const s = setup();
    s.synthesizeSpeech.mockResolvedValue({ ok: false, error: 'insufficient_balance' });
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['text', 'sticker']);
    expect(s.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
  it('uses no random positive fallback after judgment failure', async () => {
    const s = setup();
    s.decideBatch.mockRejectedValue(new Error('timeout'));
    expect(await s.service.planExtras(input())).toBeNull();
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
  it('never includes current user or role text in the batch payload', async () => {
    const s = setup();
    await s.service.planExtras({
      ...input(),
      userText: '用户原文金丝雀',
      bubbles: ['角色原文金丝雀，哈哈开心'],
    });
    const payload = JSON.stringify(s.decideBatch.mock.calls[0]);
    expect(payload).not.toContain('金丝雀');
    expect(payload).toContain('happy');
  });
  it.each(['private', 'health'] as const)(
    'skips autonomous media judgment for %s replies',
    async (mode) => {
      const s = setup();
      const req = input();
      expect(
        await s.service.planExtras({
          ...req,
          ...(mode === 'private'
            ? { ctx: { ...req.ctx, modelRole: 'adult' as const } }
            : { sensitive: true }),
        }),
      ).toBeNull();
      expect(s.decideBatch).not.toHaveBeenCalled();
      expect(s.synthesizeSpeech).not.toHaveBeenCalled();
    },
  );
  it('honors the quiet preset but still allows explicitly requested voice', async () => {
    const s = setup();
    expect(await s.service.planExtras({ ...input(), quiet: true })).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
    expect(
      (await s.service.planExtras({ ...input(), quiet: true, userText: '发条语音' }))?.[0]?.type,
    ).toBe('voice');
  });
  it('rechecks inconvenient status after approval without discarding the approved sticker', async () => {
    const s = setup();
    s.getInconvenientUntil
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Date(10_000).toISOString());
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['text', 'sticker']);
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
  it('does not send an approved sticker after it is disabled while waiting', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    s.listStickersForCharacter.mockResolvedValueOnce([happy]).mockResolvedValueOnce([]);
    expect(await s.service.planExtras(input())).toBeNull();
  });
  it('never appends another sticker immediately after a character sticker', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const recent = history();
    recent[9]!.content = { type: 'sticker', source: 'library', ...happy };
    expect(await s.service.planExtras({ ...input(), history: recent })).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('respects the two-per-ten window before asking the decision model', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const recent = history();
    recent[3]!.content = { type: 'sticker', source: 'library', ...comfort };
    recent[6]!.content = { type: 'sticker', source: 'library', ...comfort };
    expect(await s.service.planExtras({ ...input(), history: recent })).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
});
