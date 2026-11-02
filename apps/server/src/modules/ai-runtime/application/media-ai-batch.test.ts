import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Message, ModelGatewayMediaPort } from '@weiban/contracts';
import { MediaAiService } from './media-ai.js';
import type { PlanBatchRequest, PlanResult } from './planner.js';

/** 回填后的标签：tags[0] 是主标签。 */
const happy = {
  stickerId: 'happy',
  mediaId: 'happy-media',
  description: '表情 1',
  tags: ['happy', '小猫捧腹大笑', '适合聊到开心事时'],
};
const comfort = {
  stickerId: 'comfort',
  mediaId: 'comfort-media',
  description: '表情 2',
  tags: ['comfort', '小熊抱抱', '适合对方难过时安慰'],
};
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
const stickerAt = (list: Message[], i: number, s: typeof happy = comfort) => {
  list[i]!.content = {
    type: 'sticker',
    source: 'library',
    stickerId: s.stickerId,
    mediaId: s.mediaId,
    description: s.description,
  };
};
const history = () => Array.from({ length: 10 }, (_, i) => textMessage(i));
const input = () => ({
  ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
  triggerId: 'turn',
  bubbles: ['哈哈，好开心'],
  userText: '今天有好事',
  history: history(),
  voiceId: 'selected-voice',
  stickerMood: 'happy' as const,
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
  const listStickersForCharacter = vi.fn(async () => [happy, comfort]);
  const getVoice = vi.fn(async () => ({ enabled: true }));
  const getInconvenientUntil = vi.fn(async (): Promise<string | null> => null);
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

describe('T-20261103d 表情包由模型标记决定：没有关键词闸门、抽签和决策层审批', () => {
  it('模型标了情绪就挑对应情绪的图，决策层只问语音、不再问表情', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const result = await s.service.planExtras(input());
    expect(result).toEqual([
      { type: 'text', text: '哈哈，好开心' },
      expect.objectContaining({ type: 'sticker', stickerId: 'happy', mediaId: 'happy-media' }),
    ]);
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('没有标记就不发，哪怕回复里写着「哈哈、开心」', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    expect(await s.service.planExtras({ ...input(), stickerMood: null })).toBeNull();
    expect(s.listStickersForCharacter).not.toHaveBeenCalled();
  });
  it('回复里没有任何关键词时，模型标了情绪照样能发（关键词闸门已去掉）', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const result = await s.service.planExtras({
      ...input(),
      bubbles: ['那我们周末去公园走走'],
      userText: '我考完试了',
    });
    expect(result?.at(-1)).toMatchObject({ type: 'sticker', stickerId: 'happy' });
  });
  it('该情绪没有可用的图：不发、不换别的情绪兜底、不报错', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    expect(await s.service.planExtras({ ...input(), stickerMood: 'goodnight' })).toBeNull();
  });
  it('用户说过不要表情包（suppressedForms）：标了也不发', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const recent = history();
    recent[2] = {
      ...textMessage(2),
      senderKind: 'user',
      content: { type: 'text', text: '别发表情包了' },
    };
    expect(await s.service.planExtras({ ...input(), history: recent })).toBeNull();
  });
  it('严肃场景只允许安慰：标开心不发，标安慰发安慰图', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const serious = { ...input(), userText: '我失业了很难过', bubbles: ['我陪着你'] };
    expect(await s.service.planExtras(serious)).toBeNull();
    expect(
      (await s.service.planExtras({ ...serious, stickerMood: 'comfort' }))?.at(-1),
    ).toMatchObject({ type: 'sticker', stickerId: 'comfort' });
  });
  it('不连发：上一条角色消息是表情包，这轮标了也不发', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const recent = history();
    stickerAt(recent, 9);
    expect(await s.service.planExtras({ ...input(), history: recent })).toBeNull();
  });
  it('软上限：10 条里已有 3 个就不发；2 个时还能发（放宽后的安全阀）', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const three = history();
    stickerAt(three, 2);
    stickerAt(three, 4);
    stickerAt(three, 6);
    expect(await s.service.planExtras({ ...input(), history: three })).toBeNull();
    const two = history();
    stickerAt(two, 4);
    stickerAt(two, 6);
    expect((await s.service.planExtras({ ...input(), history: two }))?.at(-1)).toMatchObject({
      type: 'sticker',
      stickerId: 'happy',
    });
  });
  it('20 条内发过的同一张不重复', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    const recent = history();
    stickerAt(recent, 3, happy);
    expect(await s.service.planExtras({ ...input(), history: recent })).toBeNull();
  });
  it('素材列表在语音判断之后才读：等待期间被停用的图不会发出', async () => {
    const s = setup();
    s.decideBatch.mockImplementation(async () => {
      s.listStickersForCharacter.mockResolvedValue([]);
      return { voice: { choice: 'voice' } } as never;
    });
    const result = await s.service.planExtras(input());
    expect(result?.map((c) => c.type)).toEqual(['voice']);
  });
});

describe('independent voice and sticker decisions in real planExtras', () => {
  it('asks only the voice question and returns voice plus sticker without duplicate text', async () => {
    const s = setup();
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['voice', 'sticker']);
    expect(s.decideBatch).toHaveBeenCalledTimes(1);
    expect(s.decideBatch.mock.calls[0]![0].questions.map((q) => q.questionId)).toEqual(['voice']);
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
  it('keeps the marked sticker independent of denied voice', async () => {
    const s = setup();
    s.decideBatch.mockImplementation(async () => ({ voice: { choice: 'text' } }) as never);
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
    expect(s.decideBatch).not.toHaveBeenCalled();
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
  it('does not make a decision call if no eligible optional action remains', async () => {
    const s = setup();
    s.isServiceEnabled.mockResolvedValue(false);
    s.listStickersForCharacter.mockResolvedValue([]);
    expect(await s.service.planExtras(input())).toBeNull();
    expect(s.decideBatch).not.toHaveBeenCalled();
  });
  it('keeps text and the marked sticker when synthesis fails', async () => {
    const s = setup();
    s.synthesizeSpeech.mockResolvedValue({ ok: false, error: 'insufficient_balance' });
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['text', 'sticker']);
    expect(s.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
  it('uses no random positive fallback after judgment failure', async () => {
    const s = setup();
    s.decideBatch.mockRejectedValue(new Error('timeout'));
    expect(await s.service.planExtras({ ...input(), stickerMood: null })).toBeNull();
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
  });
  it.each(['private', 'health'] as const)(
    'skips autonomous media for %s replies even when a sticker was marked',
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
      (await s.service.planExtras({ ...input(), quiet: true, userText: '发条语音' }))?.map(
        (c) => c.type,
      ),
    ).toEqual(['voice']);
  });
  it('rechecks inconvenient status after approval without discarding the marked sticker', async () => {
    const s = setup();
    s.getInconvenientUntil
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Date(10_000).toISOString());
    const result = await s.service.planExtras(input());
    expect(result?.map((content) => content.type)).toEqual(['text', 'sticker']);
    expect(s.synthesizeSpeech).not.toHaveBeenCalled();
  });
});

describe('T-20261103d 提示词阶段：stickerPrompt 与发送阶段同一套硬规则', () => {
  const promptInput = (recent = history(), userText = '今天有好事') => ({
    ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
    history: recent,
    userText,
  });
  it('能配时列出该角色挑得出图的情绪（中文名）和标记写法', async () => {
    const s = setup();
    const text = await s.service.stickerPrompt(promptInput());
    expect(text).toContain('开心、安慰');
    expect(text).toContain('[表情:情绪]');
    expect(text).toContain('你已经连着好几条没配表情了');
  });
  it('最近刚配过：不加保底提醒', async () => {
    const s = setup();
    const recent = history();
    stickerAt(recent, 5);
    expect(await s.service.stickerPrompt(promptInput(recent))).not.toContain('好几条没配');
  });
  it('严肃场景只列安慰，也不催', async () => {
    const s = setup();
    const text = await s.service.stickerPrompt(promptInput(history(), '我失业了很难过'));
    expect(text).toContain('只能从这几个里选一个：安慰。');
    expect(text).not.toContain('好几条没配');
  });
  it('用户说过不要、上一条就是表情、软上限、私密、健康、树洞、没有可用图：都不给说明', async () => {
    const s = setup();
    const suppressed = history();
    suppressed[1] = {
      ...textMessage(1),
      senderKind: 'user',
      content: { type: 'text', text: '不要表情包' },
    };
    const last = history();
    stickerAt(last, 9);
    const full = history();
    stickerAt(full, 7);
    stickerAt(full, 3);
    stickerAt(full, 5);
    expect(await s.service.stickerPrompt(promptInput(suppressed))).toBe('');
    expect(await s.service.stickerPrompt(promptInput(last))).toBe('');
    expect(await s.service.stickerPrompt(promptInput(full))).toBe('');
    expect(
      await s.service.stickerPrompt({
        ...promptInput(),
        ctx: { ...promptInput().ctx, modelRole: 'adult' },
      }),
    ).toBe('');
    expect(await s.service.stickerPrompt({ ...promptInput(), sensitive: true })).toBe('');
    expect(await s.service.stickerPrompt({ ...promptInput(), quiet: true })).toBe('');
    s.listStickersForCharacter.mockResolvedValue([]);
    expect(await s.service.stickerPrompt(promptInput())).toBe('');
  });
});
