/**
 * T-20261103c：生态主动消息接回语音 / 表情包等形式（对照表 v3：这些是基础层，聊天里按场景自己斟酌）。
 *
 * 主动消息发送（ProactiveSchedulerService.send，生态 extras.extra = null）复用聊天回复同一套形式判断
 * （MediaAiService.planExtras）。这里用真实的 planExtras + 桩依赖跑一遍发送：
 * - 形式判断确实被调用（path = proactive、没有用户原话），批准语音 / 表情包时照发；
 *   决策层、语音合成按后台消耗计费，语音费用并进本次总费用，记在第一条消息上；
 * - 用户在聊天里说过「别发语音」「别发表情包」：那种形式不发（suppressedForms）；
 * - 私密模式（成人范围）不进入形式判断，只发文字、不发语音。
 * T-20261103d：表情包由写这条消息的模型自己决定——能配时提示里给情绪清单，模型写「[表情:开心]」，
 * 发送前剥掉标记（用户看不到），按情绪挑图；没写标记就不发。
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type {
  GenerateTextInput,
  Message,
  MessageContent,
  ModelGatewayMediaPort,
} from '@weiban/contracts';
import { MediaAiService } from './media-ai.js';
import type { PlanBatchRequest, PlanResult } from './planner.js';
import { ProactiveSchedulerService, type EcologySendExtras } from './proactive-scheduler.js';

const USER = 'user-1';
const CHARACTER = 'character-1';
const CONVERSATION = 'conversation-1';
const REPLY = '哈哈，好开心';
/** 模型原文：正文最后一行是表情标记。 */
const RAW = `${REPLY}
[表情:开心]`;
const happy = { stickerId: 'happy', mediaId: 'happy-media', description: '开心哈哈大笑' };

function message(i: number, sender: 'user' | 'character', text: string): Message {
  return {
    messageId: `${sender}-${i}`,
    conversationId: CONVERSATION,
    seq: i,
    senderParticipantId: sender === 'user' ? 'user-participant' : 'character-participant',
    senderKind: sender,
    content: { type: 'text', text },
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(i * 1000).toISOString(),
    recalledAt: null,
  };
}

/** 十条角色文字消息：语音占比、间隔、表情包配额都满足。 */
const tenTexts = () =>
  Array.from({ length: 10 }, (_, i) => message(i + 1, 'character', '普通消息'));

/** 真实的 MediaAiService，桩掉网关 / 素材 / 决策层；决策层对每个问题都批准（语音、附表情）。 */
function mediaAi(photos?: unknown) {
  const synthesizeSpeech = vi.fn((async () => ({
    ok: true,
    value: {
      mediaId: 'voice-media',
      durationMs: 1000,
      chargedMicros: 200,
      usageRecordId: 'tts-usage',
      latencyMs: 1,
      modelKey: 'tts',
    },
  })) as ModelGatewayMediaPort['synthesizeSpeech']);
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
          usageRecordId: 'plan-usage',
        },
      ]),
    ),
  );
  const service = new MediaAiService(
    ...([
      { isServiceEnabled: async () => true, synthesizeSpeech },
      {},
      {
        listStickersForCharacter: async () => [happy],
        getVoice: async () => ({ enabled: true }),
      },
      { preview: vi.fn() },
      { listUsableWorkLinks: async () => [] },
      { getDefaultVoiceId: async () => 'preset-voice' },
      {},
      {},
      {},
      { getInconvenientUntil: async (): Promise<string | null> => null },
      { nowMs: () => 1000 },
      {},
      { decideBatch },
      photos,
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
  const planExtras = vi.spyOn(service, 'planExtras');
  return { service, synthesizeSpeech, decideBatch, planExtras };
}

/** T-20261103g：私聊分享照片的素材服务桩（一张这个用户没收到过的微博配图）。 */
const OFFER = {
  mediaId: 'photo-1',
  updateId: 'update-1',
  excerpt: '今天去海边拍了日落',
  publishedOn: '2026-10-30',
};
function photoStub() {
  return {
    offer: vi.fn(async () => OFFER),
    content: vi.fn(async (_u: string, _c: string, mediaId: string) => ({
      type: 'image' as const,
      mediaId,
      width: 800,
      height: 600,
      sizeBytes: 1234,
    })),
    remember: vi.fn(async () => undefined),
  };
}

function harness(
  opts: {
    history?: Message[];
    privateMode?: boolean;
    text?: string;
    photos?: ReturnType<typeof photoStub>;
  } = {},
) {
  const media = mediaAi(opts.photos);
  const warn = vi.fn();
  const posted: Array<{ content: MessageContent; idempotencyKey: string; charge?: unknown }> = [];
  const generate = vi.fn(async (_req: GenerateTextInput, _privateModel: boolean) => ({
    ok: true as const,
    value: { text: opts.text ?? RAW, usageRecordId: 'text-usage', chargedMicros: 100 },
  }));
  const readMessages = vi.fn(async () => opts.history ?? tenTexts());
  const update = () => ({ set: () => ({ where: async () => undefined }) });
  const tx = { query: async () => undefined, db: { update } };
  const transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  const service = Object.create(ProactiveSchedulerService.prototype) as ProactiveSchedulerService;
  Object.assign(service, {
    handlers: [],
    clock: { now: () => new Date('2026-11-03T12:00:00Z'), nowMs: () => 1000 },
    db: { db: { update }, transaction },
    contacts: { getActiveContactEpoch: async () => ({ version: 1 }) },
    characters: {
      getForRuntime: async () => ({
        profile: { kind: 'preset', name: '林晚' },
        card: null,
        legacyCard: null,
      }),
    },
    policy: {
      getCharacterPolicy: async () => ({
        adultModeEligible: !!opts.privateMode,
        isRealPerson: false,
        isMinor: false,
        romanceAllowed: true,
      }),
    },
    chat: {
      getConversation: async () => ({
        conversationId: CONVERSATION,
        contentScope: opts.privateMode ? 'adult' : 'normal',
        participants: [
          { kind: 'character', refId: CHARACTER, participantId: 'character-participant' },
          { kind: 'user', refId: USER, participantId: 'user-participant' },
        ],
      }),
      readMessages,
    },
    settings: {
      get: async () => ({
        splitBubbles: true,
        voiceId: null,
        scenarioMode: 'daily',
        proactiveFrequency: 'medium',
      }),
    },
    growth: { getFamiliarity: async () => ({ level: 1 }) },
    brain: {
      build: async (_u: string, _c: string, scope: 'normal' | 'adult') => ({
        scope,
        prefix: '人设',
        recall: '',
      }),
    },
    adultBoundary: { generate },
    logger: { warn },
    accounts: { getAccountStatus: async () => 'active' },
    quota: { recordSent: vi.fn() },
    writer: {
      postMessage: vi.fn(
        async (input: { content: MessageContent; idempotencyKey: string; charge?: unknown }) => {
          posted.push(input);
          return { ok: true, value: { messageId: `msg-${posted.length}` } };
        },
      ),
    },
    episodes: { record: async () => undefined },
    audit: { record: async () => undefined },
    mediaAi: media.service,
  });
  const plan = {
    id: 'plan-1',
    userId: USER,
    characterId: CHARACTER,
    reason: 'ecology',
    sourceRef: 'ecology:run-1',
    topicKey: 'ecology:run-1',
    brief: '想和对方分享一件开心的小事',
    localDate: '2026-11-03',
    isHoliday: false,
  };
  const ctx = {
    userId: USER,
    timeZone: 'Asia/Shanghai',
    localDate: '2026-11-03',
    localHour: 20,
    nickname: '小明',
    birthday: null,
  };
  const send = (eco: EcologySendExtras = { extra: null }) =>
    (
      service as unknown as {
        send(c: unknown, p: unknown, contact: unknown, e: EcologySendExtras): Promise<unknown>;
      }
    ).send(ctx, plan, { conversationId: CONVERSATION }, eco);
  /** 发给模型的最后一条（系统提示）里有没有表情包说明。 */
  const hinted = () => {
    const req = generate.mock.calls[0]?.[0] as
      { messages?: Array<{ content: string }> } | undefined;
    return (req?.messages?.at(-1)?.content ?? '').includes('[表情:情绪]');
  };
  const prompt = () =>
    (
      generate.mock.calls[0]?.[0] as { messages?: Array<{ content: string }> } | undefined
    )?.messages?.at(-1)?.content ?? '';
  return { ...media, send, posted, generate, hinted, prompt, transaction, warn };
}

const META_SAMPLES = [
  '我们需要回答群聊。需要判断角色。没有指定是谁。',
  '用户给我发了今天日常的事实底稿，还有个系统提示要我自己主动发起聊天。',
  'user and assistant chatting in Chinese. Assistant is a persona? Need send...',
];

describe('主动消息绑定角色并拦截思考', () => {
  it.each(META_SAMPLES.map((text, index) => ({ text, index: index + 1 })))(
    '合成样例 $index 重试一次仍拦截，没有发消息或进入写入事务',
    async ({ text }) => {
      const h = harness({ text });
      expect(await h.send()).toMatchObject({ ok: false, reason: 'output_guard' });
      expect(h.generate).toHaveBeenCalledTimes(2);
      const [first, retry] = h.generate.mock.calls.map(([request]) => request);
      expect(retry!.messages.slice(0, -1)).toEqual(first!.messages);
      expect(retry!.messages.at(-1)).toMatchObject({
        role: 'system',
        content: expect.stringContaining('不写分析'),
      });
      expect(retry!.idempotencyKey).not.toBe(first!.idempotencyKey);
      expect(h.posted).toEqual([]);
      expect(h.transaction).not.toHaveBeenCalled();
      expect(h.planExtras).not.toHaveBeenCalled();
      expect(h.warn.mock.calls).toEqual([
        [
          {
            code: 'ai_meta_reasoning_blocked',
            conversationKind: 'proactive',
            characterId: CHARACTER,
          },
        ],
      ]);
    },
  );

  it.each([false, true])('绑定身份且普通台词原样发送，是否补写 %s', async (retry) => {
    const text = '行，那我先睡了，明天聊。';
    const h = harness({ text });
    h.planExtras.mockResolvedValue(null);
    if (retry)
      h.generate.mockResolvedValueOnce({
        ok: true,
        value: { text: META_SAMPLES[1]!, usageRecordId: 'first', chargedMicros: 100 },
      });
    expect(await h.send()).toMatchObject({ ok: true });
    const system = h.generate.mock.calls[0]![0].messages.filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    expect(system).toContain('你现在是「林晚」');
    expect(system).toContain('只输出要发出去的消息正文');
    expect(h.posted.map((p) => p.content)).toEqual([{ type: 'text', text }]);
    expect(h.generate).toHaveBeenCalledTimes(retry ? 2 : 1);
  });
});

describe('生态主动消息复用聊天回复的形式判断', () => {
  it('形式判断被调用：批准语音和表情包时发语音 + 表情包，按后台消耗计费、费用并进总额', async () => {
    const h = harness();
    const outcome = await h.send();
    expect(h.planExtras).toHaveBeenCalledOnce();
    // 提示里告诉模型可以配表情；模型写的标记在发送前剥掉，情绪交给形式判断。
    expect(h.hinted()).toBe(true);
    expect(h.planExtras.mock.calls[0]![0]).toMatchObject({
      bubbles: [REPLY],
      userText: '',
      stickerMood: 'happy',
      path: 'proactive',
      triggerId: 'proactive:plan-1',
      ctx: { userId: USER, characterId: CHARACTER, conversationId: CONVERSATION },
    });
    // 决策层：主动消息路径（后台消耗）。
    expect(h.decideBatch.mock.calls[0]![0]).toMatchObject({
      path: 'proactive',
      decisionType: 'reply_form',
    });
    // 语音合成：按后台消耗、生态任务计费（与原生态「发语音」同口径）。
    expect(h.synthesizeSpeech).toHaveBeenCalledOnce();
    expect(h.synthesizeSpeech.mock.calls[0]![0]).toMatchObject({
      billingOwner: 'user',
      countAsBackground: true,
      ecologyTask: true,
      text: REPLY,
    });
    expect(h.posted.map((p) => p.content.type)).toEqual(['voice', 'sticker']);
    expect(h.posted[1]!.content).toMatchObject({ stickerId: 'happy' });
    expect(JSON.stringify(h.posted)).not.toContain('[表情');
    // 文字 100 + 语音 200，记在第一条消息上；结果把总费用带回生态。
    expect(h.posted[0]!.charge).toEqual({ usageRecordId: 'text-usage', chargedMicros: 300 });
    expect(h.posted[1]!.charge).toBeUndefined();
    expect(outcome).toEqual({ ok: true, chargedMicros: 300, messageId: 'msg-1' });
    // 文字生成本身的计费参数不变。
    expect(h.generate.mock.calls[0]![0]).toMatchObject({
      billingOwner: 'user',
      countAsBackground: true,
      ecologyTask: true,
      purpose: 'proactive',
    });
  });

  it('suppressedForms 生效：用户说过别发语音、别发表情包，就只发文字', async () => {
    const h = harness({
      history: [
        message(0, 'user', '别发语音了'),
        message(1, 'user', '也别发表情包'),
        ...tenTexts(),
      ],
    });
    const outcome = await h.send();
    expect(h.planExtras).toHaveBeenCalledOnce();
    // 两种形式都被压制：提示里不提表情包，不问决策层、不合成语音；模型照写的标记也剥掉。
    expect(h.hinted()).toBe(false);
    expect(h.decideBatch).not.toHaveBeenCalled();
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
    expect(h.posted.map((p) => p.content)).toEqual([{ type: 'text', text: REPLY }]);
    expect(outcome).toEqual({ ok: true, chargedMicros: 100, messageId: 'msg-1' });
  });

  it('只压制说过的那一种：别发语音时表情包照常斟酌', async () => {
    const h = harness({ history: [message(0, 'user', '别发语音了'), ...tenTexts()] });
    await h.send();
    // 决策层只剩语音一个问题，语音被压制就不问；表情包按模型标记发。
    expect(h.decideBatch).not.toHaveBeenCalled();
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
    expect(h.posted.map((p) => p.content.type)).toEqual(['text', 'sticker']);
  });

  it('私密模式不进入形式判断：只发文字、不发语音', async () => {
    const h = harness({ privateMode: true });
    const outcome = await h.send();
    expect(h.generate.mock.calls[0]![1]).toBe(true);
    expect(h.hinted()).toBe(false);
    expect(h.planExtras).not.toHaveBeenCalled();
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
    expect(h.posted.map((p) => p.content)).toEqual([{ type: 'text', text: REPLY }]);
    expect(outcome).toEqual({ ok: true, chargedMicros: 100, messageId: 'msg-1' });
  });

  it('模型没写表情标记：不发表情包（不由服务端硬塞），语音照常判断', async () => {
    const h = harness({ text: REPLY });
    await h.send();
    expect(h.planExtras.mock.calls[0]![0]).toMatchObject({ bubbles: [REPLY], stickerMood: null });
    expect(h.posted.map((p) => p.content.type)).toEqual(['voice']);
  });

  it('T-20261103g：主动消息同样可以分享照片——提示里给出那张图，模型写 [照片] 后剥掉标记、照片跟在文字后面', async () => {
    const photos = photoStub();
    const h = harness({
      photos,
      text: `${REPLY}
[照片]`,
      // 压掉语音，只看照片。
      history: [message(0, 'user', '别发语音了'), ...tenTexts()],
    });
    await h.send();
    expect(h.prompt()).toContain('这轮可以分享一张你最近的照片');
    expect(h.prompt()).toContain('「今天去海边拍了日落」');
    expect(h.prompt()).toContain('这轮照片和表情包最多选一样');
    expect(h.planExtras.mock.calls[0]![0]).toMatchObject({ photo: OFFER, stickerMood: null });
    expect(h.posted.map((p) => p.content)).toEqual([
      { type: 'text', text: REPLY },
      { type: 'image', mediaId: 'photo-1', width: 800, height: 600, sizeBytes: 1234 },
    ]);
    expect(JSON.stringify(h.posted)).not.toContain('[照片]');
    expect(photos.remember).toHaveBeenCalledWith({
      userId: USER,
      conversationId: CONVERSATION,
      messageId: 'msg-2',
      offer: OFFER,
    });
  });

  it('T-20261103g：给了照片但模型只写了表情标记：只发表情，不发图、不记存档', async () => {
    const photos = photoStub();
    const h = harness({ photos, history: [message(0, 'user', '别发语音了'), ...tenTexts()] });
    await h.send();
    expect(h.posted.map((p) => p.content.type)).toEqual(['text', 'sticker']);
    expect(photos.content).not.toHaveBeenCalled();
    expect(photos.remember).not.toHaveBeenCalled();
  });

  it('私密模式点名发语音仍按原规则拒绝', async () => {
    const h = harness({ privateMode: true });
    const outcome = await h.send({ extra: 'voice' });
    expect(outcome).toMatchObject({ ok: false, reason: 'voice_private_mode' });
    expect(h.posted).toEqual([]);
  });
});
