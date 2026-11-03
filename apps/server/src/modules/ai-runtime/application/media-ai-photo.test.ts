/**
 * T-20261103g：私聊分享照片（planExtras / photoPrompt / 聊天记录里的写法）与群聊表情包（groupStickerPrompt /
 * pickGroupSticker）。只用桩，不发起真实模型调用。
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Message, MessageContent } from '@weiban/contracts';
import { MediaAiService } from './media-ai.js';
import type { PhotoOffer } from '../domain/photo-marker.js';

const happy = { stickerId: 'happy', mediaId: 'happy-media', description: '开心哈哈大笑' };
const offer: PhotoOffer = {
  mediaId: 'photo-1',
  updateId: 'update-1',
  excerpt: '今天去海边拍了日落',
  publishedOn: '2026-10-30',
};
const policy = { isMinor: false, isRealPerson: false, romanceAllowed: false };
const ctx = { userId: 'user', characterId: 'character', conversationId: 'conversation' };

let seq = 0;
function msg(
  sender: 'user' | 'character',
  content: MessageContent,
  participant = sender === 'user' ? 'user-p' : 'char-a',
): Message {
  seq++;
  return {
    messageId: `m${seq}`,
    conversationId: 'conversation',
    seq,
    senderParticipantId: participant,
    senderKind: sender,
    content,
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(seq * 1000).toISOString(),
    recalledAt: null,
  };
}
const text = (t = '普通消息'): MessageContent => ({ type: 'text', text: t });
const image = (mediaId: string): MessageContent => ({
  type: 'image',
  mediaId,
  width: null,
  height: null,
});
const stickerMsg = (participant = 'char-a') =>
  msg(
    'character',
    {
      type: 'sticker',
      source: 'library',
      stickerId: 'other',
      mediaId: 'other-media',
      description: '别的表情',
    },
    participant,
  );
const texts = (n: number, participant?: string) =>
  Array.from({ length: n }, () => msg('character', text(), participant));

function setup(opts: { photos?: boolean; reachableLink?: boolean } = {}) {
  const photoContent = vi.fn(
    async (_u: string, _c: string, mediaId: string): Promise<MessageContent | null> => ({
      type: 'image',
      mediaId,
      width: 800,
      height: 600,
      sizeBytes: 1234,
    }),
  );
  const photoOffer = vi.fn(async (): Promise<PhotoOffer | null> => offer);
  const remember = vi.fn(async () => undefined);
  const decideBatch = vi.fn(async () => ({}));
  const service = new MediaAiService(
    ...([
      { isServiceEnabled: async () => false },
      {},
      { listStickersForCharacter: async () => [happy], getVoice: async () => ({ enabled: false }) },
      { preview: async () => ({ reachable: opts.reachableLink ?? true, description: '一首歌' }) },
      {
        listUsableWorkLinks: async () => [
          {
            workLinkId: 'w1',
            url: 'https://example.com/song',
            title: '新歌',
            source: null,
            coverMediaId: null,
            appHint: null,
          },
        ],
        recordLinkCheck: async () => undefined,
      },
      { getDefaultVoiceId: async () => null },
      {},
      {},
      {},
      { getInconvenientUntil: async (): Promise<string | null> => null },
      { nowMs: () => 1000 },
      {},
      { decideBatch },
      opts.photos === false
        ? undefined
        : { offer: photoOffer, content: photoContent, remember },
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
  return { service, photoContent, photoOffer, remember, decideBatch };
}

function extras(
  history: Message[],
  more: Partial<Parameters<MediaAiService['planExtras']>[0]> = {},
) {
  return {
    ctx,
    triggerId: 'turn',
    bubbles: ['给你看看我上周去的地方'],
    userText: '最近去哪玩了',
    history,
    voiceId: null,
    photo: offer,
    ...more,
  };
}
const types = (r: MessageContent[] | null) => r?.map((c) => c.type) ?? null;

describe('planExtras：模型写了 [照片] 才发提示里给的那张', () => {
  it('有素材、模型写了标记：照片跟在文字后面发出，发前复核一次', async () => {
    const s = setup();
    const result = await s.service.planExtras(extras(texts(10)));
    expect(types(result)).toEqual(['text', 'image']);
    expect(result?.[1]).toMatchObject({ type: 'image', mediaId: 'photo-1', sizeBytes: 1234 });
    expect(s.photoContent).toHaveBeenCalledWith('user', 'character', 'photo-1');
  });

  it('没有标记（photo 为空）、没有素材服务、复核不通过：都不发', async () => {
    expect(await setup().service.planExtras(extras(texts(10), { photo: null }))).toBeNull();
    expect(await setup({ photos: false }).service.planExtras(extras(texts(10)))).toBeNull();
    const s = setup();
    s.photoContent.mockResolvedValueOnce(null);
    expect(await s.service.planExtras(extras(texts(10)))).toBeNull();
  });

  it('这张聊天记录里发过：不再发', async () => {
    const history = [msg('character', image('photo-1')), ...texts(10)];
    expect(await setup().service.planExtras(extras(history))).toBeNull();
  });

  it('用户说过别发照片：不发；后来明确要了恢复', async () => {
    const history = [msg('user', text('别发照片了')), ...texts(10)];
    expect(await setup().service.planExtras(extras(history))).toBeNull();
    expect(
      types(await setup().service.planExtras(extras(history, { userText: '发张你的照片给我看看' }))),
    ).toEqual(['text', 'image']);
  });

  it('软上限：20 条里已有 2 张就不发；上一条就是图也不发', async () => {
    const two = [msg('character', image('a')), ...texts(4), msg('character', image('b')), ...texts(4)];
    expect(await setup().service.planExtras(extras(two))).toBeNull();
    expect(
      await setup().service.planExtras(extras([...texts(5), msg('character', image('a'))])),
    ).toBeNull();
  });

  it('严肃场景、树洞、私密、涉及健康：不发', async () => {
    const history = texts(10);
    expect(await setup().service.planExtras(extras(history, { userText: '我好难过' }))).toBeNull();
    expect(await setup().service.planExtras(extras(history, { quiet: true }))).toBeNull();
    expect(await setup().service.planExtras(extras(history, { sensitive: true }))).toBeNull();
    expect(
      await setup().service.planExtras(extras(history, { ctx: { ...ctx, modelRole: 'adult' } })),
    ).toBeNull();
  });

  it('同一轮最多一种媒体附加：照片和表情都标了只发照片；要作品链接时只发链接', async () => {
    const both = await setup().service.planExtras(extras(texts(10), { stickerMood: 'happy' }));
    expect(types(both)).toEqual(['text', 'image']);
    const s = setup();
    const link = await s.service.planExtras(
      extras(texts(10), { userText: '推荐一首歌给我', stickerMood: 'happy' }),
    );
    expect(types(link)).toEqual(['text', 'link']);
    expect(s.photoContent).not.toHaveBeenCalled();
    // 照片复核不通过时，表情照常可以补上。
    const s2 = setup();
    s2.photoContent.mockResolvedValueOnce(null);
    expect(
      types(await s2.service.planExtras(extras(texts(10), { stickerMood: 'happy' }))),
    ).toEqual(['text', 'sticker']);
  });
});

describe('photoPrompt：提示词里要不要给一张可分享的照片', () => {
  const input = (history: Message[], more: Record<string, unknown> = {}) => ({
    ctx,
    history,
    userText: '最近去哪玩了',
    policy,
    ...more,
  });

  it('能分享时给出说明和那张图；聊天记录里发过的图作为「收到过」传给素材挑选', async () => {
    const s = setup();
    const history = [msg('character', image('old')), ...texts(10)];
    const result = await s.service.photoPrompt(input(history, { withSticker: true }));
    expect(result?.offer).toEqual(offer);
    expect(result?.text).toContain('[照片]');
    expect(result?.text).toContain('这轮照片和表情包最多选一样');
    const call = s.photoOffer.mock.calls[0] as unknown as [{ received: Set<string> }];
    expect([...call[0].received]).toEqual(['old']);
  });

  it('私密、树洞、涉及健康、严肃、用户说过不要、上一条是图、没有素材服务、没有可分享的图：都不给', async () => {
    const history = texts(10);
    const s = setup();
    expect(
      await s.service.photoPrompt(input(history, { ctx: { ...ctx, modelRole: 'adult' } })),
    ).toBeNull();
    expect(await s.service.photoPrompt(input(history, { quiet: true }))).toBeNull();
    expect(await s.service.photoPrompt(input(history, { sensitive: true }))).toBeNull();
    expect(await s.service.photoPrompt(input(history, { userText: '最近好焦虑' }))).toBeNull();
    expect(
      await s.service.photoPrompt(input([msg('user', text('不要发图片')), ...history])),
    ).toBeNull();
    expect(
      await s.service.photoPrompt(input([...history, msg('character', image('a'))])),
    ).toBeNull();
    expect(s.photoOffer).not.toHaveBeenCalled();
    expect(await setup({ photos: false }).service.photoPrompt(input(history))).toBeNull();
    const none = setup();
    none.photoOffer.mockResolvedValueOnce(null);
    expect(await none.service.photoPrompt(input(history))).toBeNull();
  });
});

describe('聊天记录里角色发过的照片', () => {
  it('有存档描述时写出是哪条微博的配图；没有时照旧', async () => {
    const s = setup();
    const m = msg('character', image('photo-1'));
    const captions = new Map([
      [
        'photo-1',
        {
          kind: 'other' as const,
          description: '微博配图（10月30日的微博：「今天去海边拍了日落」）',
          textInImage: '',
          people: [],
        },
      ],
    ]);
    expect(await s.service.render(ctx, m, { fresh: false, selfNames: [], captions })).toEqual({
      text: '[你发了一张图片：微博配图（10月30日的微博：「今天去海边拍了日落」）]',
    });
    expect(
      await s.service.render(ctx, m, { fresh: false, selfNames: [], captions: new Map() }),
    ).toEqual({ text: '[你发了一张图片]' });
  });

  it('rememberPhoto 交给素材服务记一笔，失败不抛', async () => {
    const s = setup();
    s.remember.mockRejectedValueOnce(new Error('db down'));
    await expect(
      s.service.rememberPhoto({ userId: 'user', conversationId: 'c', messageId: 'm', offer }),
    ).resolves.toBeUndefined();
    expect(s.remember).toHaveBeenCalledOnce();
  });
});

describe('群聊表情包', () => {
  const base = (history: Message[], roundAfterSeq: number) => ({
    characterId: 'character',
    participantId: 'char-a',
    history,
    userText: '今天好开心',
    roundAfterSeq,
  });

  it('能配时给群聊说法；同一轮已有别的角色带过表情就不给', async () => {
    const s = setup();
    const trigger = msg('user', text('今天好开心'));
    const open = await s.service.groupStickerPrompt(base([...texts(3), trigger], trigger.seq));
    expect(open).toContain('这条群消息可以配一个表情包');
    expect(open).toContain('开心');
    const taken = [...texts(3), trigger, msg('character', text('哈哈'), 'char-b'), stickerMsg('char-b')];
    expect(await s.service.groupStickerPrompt(base(taken, trigger.seq))).toBe('');
    expect(
      await s.service.groupStickerPrompt({ ...base([...texts(3), trigger], trigger.seq), quiet: true }),
    ).toBe('');
  });

  it('pickGroupSticker：按情绪挑图；这轮被占、上一条是自己的表情时不发', async () => {
    const s = setup();
    const trigger = msg('user', text('今天好开心'));
    const pick = (history: Message[]) =>
      s.service.pickGroupSticker({
        ...base(history, trigger.seq),
        mood: 'happy',
        text: '哈哈太好了',
        textCount: 1,
        seed: 'seed',
      });
    expect(await pick([...texts(3), trigger])).toMatchObject({
      type: 'sticker',
      stickerId: 'happy',
    });
    expect(await pick([...texts(3), trigger, stickerMsg('char-b')])).toBeNull();
    const mineLast = [...texts(3), stickerMsg('char-a')];
    const trigger2 = msg('user', text('今天好开心'));
    expect(
      await s.service.pickGroupSticker({
        ...base([...mineLast, trigger2], trigger2.seq),
        mood: 'happy',
        text: '哈哈',
        textCount: 1,
        seed: 'seed',
      }),
    ).toBeNull();
  });
});
