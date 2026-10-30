/** H3（契约 3.29）：一步看图 + 描述存档后，各处上下文带上描述；私密关怀走平台付费。 */
import { describe, expect, it, vi } from 'vitest';
import type { GenerateTextInput, Message, ModelGatewayPort } from '@weiban/contracts';
import { MediaAiService, imageBudget } from './media-ai.js';
import { readableMessageText } from './content-text.js';
import { callModelForCare } from './safety-care.js';
import type { ImageCaption } from '../domain/image-caption.js';
import { ImageCaptionStore } from './image-captions.js';
import { MemoryService } from './memory.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const CONV = '00000000-0000-4000-8000-000000000003';
const IMG1 = '00000000-0000-4000-8000-0000000000a1';
const IMG2 = '00000000-0000-4000-8000-0000000000a2';
const STK = '00000000-0000-4000-8000-0000000000a3';
const ctx = { userId: USER, characterId: CHAR, conversationId: CONV };

function message(id: string, content: Message['content']): Message {
  return {
    messageId: `00000000-0000-4000-8000-0000000001${id}`,
    conversationId: CONV,
    seq: Number(id),
    senderParticipantId: USER,
    senderKind: 'user',
    content,
    status: 'normal',
    scope: 'normal',
    createdAt: '2026-10-21T08:00:00.000Z',
  } as Message;
}
const image = (mediaId: string) =>
  ({ type: 'image', mediaId, width: 10, height: 10 }) as Message['content'];
const cat: ImageCaption = {
  kind: 'pet',
  description: '橘猫团子趴在窗台',
  textInImage: '',
  people: [],
};

// render 的图片 / 表情分支不碰外部依赖。
const media = Object.create(MediaAiService.prototype) as MediaAiService;

it('描述存档拒绝注销账号，以及已撤回消息的迟到模型结果', async () => {
  const lock = vi.fn().mockResolvedValue(false);
  const getMessage = vi.fn().mockResolvedValue({ ...message('19', null), status: 'recalled' });
  const seal = vi.fn();
  const store = Object.create(ImageCaptionStore.prototype) as ImageCaptionStore;
  Object.assign(store, {
    db: { transaction: (run: (tx: object) => Promise<void>) => run({}) },
    plans: { lock },
    chat: { getMessage },
    crypto: { seal },
  });
  const input = {
    userId: USER,
    mediaId: IMG1,
    scope: 'normal' as const,
    messageId: message('19', null).messageId,
    conversationId: CONV,
    caption: cat,
    modelKey: 'test/model',
  };
  await store.save(input);
  expect(getMessage).not.toHaveBeenCalled();
  expect(seal).not.toHaveBeenCalled();
  lock.mockResolvedValue(true);
  await store.save(input);
  expect(getMessage).toHaveBeenCalledWith(input.messageId, ['normal'], expect.any(Object));
  expect(seal).not.toHaveBeenCalled();
});

it('回复还在生成图片描述时，记忆抽取等待并保留原游标', async () => {
  // 该图片批次已被明确记忆候选选中；普通图片消息不再自动触发事实提炼。
  const state = { cursorSeq: 0, barrierSeq: 0, factTriggerSeq: 20, retryAfter: null };
  const defer = vi.fn();
  const generateText = vi.fn();
  const service = Object.create(MemoryService.prototype) as MemoryService;
  const tx = {};
  Object.assign(service, {
    contacts: {
      getActiveContact: vi.fn().mockResolvedValue({ conversationId: CONV }),
      getActiveContactEpoch: vi.fn().mockResolvedValue({ version: CHAR }),
    },
    db: {
      transaction: (run: (value: object) => Promise<unknown>) => run(tx),
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: CHAR }] }) }) }),
      },
    },
    lock: vi.fn(),
    state: vi.fn().mockResolvedValue(state),
    defer,
    chat: { readMessages: vi.fn().mockResolvedValue([message('20', image(IMG1))]) },
    captions: { forMessages: vi.fn().mockResolvedValue(new Map()) },
    gateway: { generateText },
  });
  const job = { userId: USER, characterId: CHAR, conversationId: CONV, epoch: CHAR, urgent: true };
  await service.extract(job);
  expect(defer).toHaveBeenCalledWith(job, state, 30_000);
  expect(generateText).not.toHaveBeenCalled();
});

describe('H3 私聊上下文里的图片', () => {
  it('历史图片有存档就用描述，不再只说「之前发过一张图片」', async () => {
    const captions = new Map([[IMG1, cat]]);
    const old = await media.render(ctx, message('11', image(IMG1)), {
      fresh: false,
      selfNames: ['程澈'],
      captions,
    });
    expect(old?.text).toBe('[对方之前发过一张图片：（宠物）橘猫团子趴在窗台]');
    expect(old?.images).toBeUndefined();
    const unknown = await media.render(ctx, message('12', image(IMG2)), {
      fresh: false,
      selfNames: [],
      captions,
    });
    expect(unknown?.text).toBe('[对方之前发过一张图片]');
  });

  it('本轮新图附给回复调用（编号、看不到时的说法），预算用完的不附；已有存档的不再附图', async () => {
    const budget = imageBudget(1);
    const fresh = await media.render(ctx, message('13', image(IMG2)), {
      fresh: true,
      selfNames: [],
      captions: new Map(),
      budget,
    });
    expect(fresh?.text).toBe('[对方发来一张图片〔图1〕]');
    expect(fresh?.images).toEqual([{ mediaId: IMG2, ownerUserId: USER }]);
    expect(fresh?.slots?.[0]).toMatchObject({ n: 1, mediaId: IMG2, sticker: false });
    expect(fresh?.blindText).toContain('看不到图片内容');
    const over = await media.render(ctx, message('14', image(IMG1)), {
      fresh: true,
      selfNames: [],
      captions: new Map(),
      budget,
    });
    expect(over?.images).toBeUndefined();
    expect(budget.skipped).toBe(1);
    const known = await media.render(ctx, message('15', image(IMG1)), {
      fresh: true,
      selfNames: [],
      captions: new Map([[IMG1, cat]]),
      budget: imageBudget(),
    });
    expect(known).toEqual({ text: '[对方发来一张图片：（宠物）橘猫团子趴在窗台]' });
  });

  it('用户自己的表情也交给回复模型看；有描述后按表情包理解', async () => {
    const sticker = {
      type: 'sticker',
      stickerId: STK,
      source: 'user',
      mediaId: STK,
      description: null,
    } as Message['content'];
    const fresh = await media.render(ctx, message('16', sticker), {
      fresh: true,
      selfNames: [],
      captions: new Map(),
      budget: imageBudget(),
    });
    expect(fresh?.slots?.[0]?.sticker).toBe(true);
    expect(fresh?.text).toContain('这是表情动作');
    const later = await media.render(ctx, message('17', sticker), {
      fresh: false,
      selfNames: [],
      captions: new Map([[STK, { ...cat, kind: 'meme' as const, description: '熊猫头捂脸笑' }]]),
    });
    expect(later?.text).toContain('表情包：熊猫头捂脸笑');
  });

  it('群聊 / 记忆 / 生态共用的离线写法也读描述', () => {
    const m = message('18', image(IMG1));
    expect(readableMessageText(m)).toBe('[图片，未识别画面，不猜测图片内容]');
    expect(readableMessageText(m, new Map([[IMG1, cat]]))).toBe('[图片：（宠物）橘猫团子趴在窗台]');
  });
});

describe('H3 私密模式的安全关怀由平台付费', () => {
  const base: GenerateTextInput = {
    userId: USER,
    characterId: CHAR,
    conversationId: CONV,
    purpose: 'safety_followup',
    billingOwner: 'user',
    modelRole: 'adult',
    messages: [{ role: 'user', content: '…' }],
    idempotencyKey: 'k',
  };
  const facts = { highRisk: true, careActive: false, suspected: false };

  it('关怀回合 / 风险判断带私密模型角色交给平台端口，不走用户付费网关', async () => {
    const gateway = { generateText: vi.fn() } as unknown as ModelGatewayPort;
    const generatePlatformText = vi.fn().mockResolvedValue({ ok: false, error: 'not_configured' });
    await callModelForCare(gateway, base, facts, { generatePlatformText });
    await callModelForCare(gateway, { ...base, purpose: 'safety_check' }, facts, {
      generatePlatformText,
    });
    expect(gateway.generateText).not.toHaveBeenCalled();
    expect(generatePlatformText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ purpose: 'safety_followup', modelRole: 'adult' }),
    );
    expect(generatePlatformText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ purpose: 'safety_check', modelRole: 'adult' }),
    );
  });

  it('普通聊天回复仍由用户付费', async () => {
    const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'not_configured' });
    const generatePlatformText = vi.fn();
    await callModelForCare(
      { generateText } as unknown as ModelGatewayPort,
      { ...base, purpose: 'chat_reply' },
      facts,
      { generatePlatformText },
    );
    expect(generateText).toHaveBeenCalledOnce();
    expect(generatePlatformText).not.toHaveBeenCalled();
  });
});
