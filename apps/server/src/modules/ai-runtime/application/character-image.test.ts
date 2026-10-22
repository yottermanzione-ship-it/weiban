import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CharacterImageService, publicPictureQuery } from './character-image.js';
import { MediaAiService } from './media-ai.js';

function setup(
  options: {
    real?: boolean;
    historical?: boolean;
    library?: boolean;
    enabled?: boolean;
    pictureSearch?: boolean;
  } = {},
) {
  const media = {
    generateImage: vi.fn(() => {
      throw new Error('must never generate');
    }),
    isServiceEnabled: vi.fn(async () => options.enabled ?? true),
    webSearch: vi.fn(async () => ({
      ok: true,
      value: { chargedMicros: 7, items: [{ url: 'https://public.example/picture' }] },
    })),
  };
  const assets = {
    listCardTemplates: vi.fn(async () =>
      options.library === false ? [] : [{ mediaId: 'library', templateId: 'template' }],
    ),
  };
  const policy = {
    getCharacterPolicy: vi.fn(async () => ({
      isRealPerson: options.real ?? false,
      isHistorical: options.historical ?? false,
    })),
    checkImageGeneration: vi.fn(),
  };
  const read = {
    getMedia: vi.fn(async (_user: string, mediaId: string) => ({
      mediaId,
      width: 40,
      height: 30,
      sizeBytes: 100,
    })),
  };
  const links = {
    previewForUser: vi.fn(async () => ({ reachable: true, coverMediaId: 'stored-web-image' })),
  };
  const service = new CharacterImageService(
    ...([
      media,
      assets,
      policy,
      read,
      links,
      { characterPublicPictureSearchEnabled: options.pictureSearch ?? true },
    ] as unknown as ConstructorParameters<typeof CharacterImageService>),
  );
  const input = {
    userId: 'user',
    characterId: 'character',
    conversationId: 'conversation',
    scene: '看看猫咪图片。私人聊天金丝雀',
    use: 'chat' as const,
    searchPublic: true,
    idempotencyKey: 'turn',
  };
  return { service, media, assets, policy, read, links, input };
}

describe('角色分享图片不生图', () => {
  it('发送网图使用安全转存的 mediaId，并仅记录搜索费用', async () => {
    const s = setup();
    const result = await s.service.generate({
      ...s.input,
      ecologyTask: true,
      countAsBackground: true,
    });
    expect(result).toMatchObject({
      mediaId: 'stored-web-image',
      source: 'web',
      chargedMicros: 7,
      sourceUrl: 'https://public.example/picture',
    });
    expect(s.links.previewForUser).toHaveBeenCalledWith('user', 'https://public.example/picture');
    expect(s.media.webSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '猫咪 公开图片',
        purpose: 'web_search',
        billingOwner: 'user',
        ecologyTask: true,
        countAsBackground: true,
        idempotencyKey: 'picture-search:turn',
      }),
    );
    expect(JSON.stringify(s.media.webSearch.mock.calls)).not.toContain('私人聊天金丝雀');
    expect(s.media.generateImage).not.toHaveBeenCalled();
    expect(s.policy.checkImageGeneration).not.toHaveBeenCalled();
  });
  it('真人/历史人物不联网、不生图、不付人脸检查费用，仅筛选合规库图', async () => {
    const s = setup({ real: true, historical: true });
    expect(await s.service.generate(s.input)).toMatchObject({
      mediaId: 'library',
      source: 'library',
      chargedMicros: 0,
    });
    expect(s.assets.listCardTemplates).toHaveBeenCalledWith('daily_photo', true, true);
    expect(s.media.webSearch).not.toHaveBeenCalled();
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('未开通搜索不收费、不检查生图开关，仍能分享库图', async () => {
    const s = setup({ enabled: false });
    expect(await s.service.generate(s.input)).toMatchObject({
      source: 'library',
      chargedMicros: 0,
    });
    expect(s.media.isServiceEnabled).toHaveBeenCalledWith('web_search');
    expect(s.media.webSearch).not.toHaveBeenCalled();
  });
  it('搜索失败或余额不足时库图兜底；没有库图就不发', async () => {
    const s = setup({ library: false });
    s.media.webSearch.mockResolvedValueOnce({ ok: false, error: 'insufficient_balance' } as never);
    expect(await s.service.generate(s.input)).toBeNull();
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('安全抓取拒绝后不发送外链假图，搜索费沿用网关实扣', async () => {
    const s = setup();
    s.links.previewForUser.mockRejectedValueOnce(new Error('blocked private address'));
    expect(await s.service.generate(s.input)).toMatchObject({
      mediaId: 'library',
      source: 'library',
      chargedMicros: 7,
    });
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('搜索成功但安全抓取失败且库空，仍准确回报已经实扣的费用', async () => {
    const s = setup({ library: false });
    s.links.previewForUser.mockRejectedValueOnce(new Error('SSRF blocked'));
    const onSearchCharged = vi.fn();
    expect(await s.service.generate({ ...s.input, onSearchCharged })).toBeNull();
    expect(onSearchCharged).toHaveBeenCalledExactlyOnceWith(7);
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('网关余额不足没有结算则不回报搜索费用', async () => {
    const s = setup();
    s.media.webSearch.mockResolvedValueOnce({ ok: false, error: 'insufficient_balance' } as never);
    const onSearchCharged = vi.fn();
    expect(await s.service.generate({ ...s.input, onSearchCharged })).toMatchObject({
      source: 'library',
      chargedMicros: 0,
    });
    expect(onSearchCharged).not.toHaveBeenCalled();
  });
  it('转存媒体读取失败不发送失效 mediaId', async () => {
    const s = setup({ library: false });
    s.read.getMedia.mockRejectedValueOnce(new Error('not found'));
    expect(await s.service.generate(s.input)).toBeNull();
  });
  it('卡片、宠物、朋友圈及旧自动配图不增加网络搜索费用', async () => {
    const s = setup();
    for (const use of ['card', 'pet', 'moments'] as const) {
      expect(await s.service.generate({ ...s.input, use })).toMatchObject({
        source: 'library',
        chargedMicros: 0,
      });
    }
    await s.service.generate({ ...s.input, searchPublic: false });
    expect(s.media.webSearch).not.toHaveBeenCalled();
    expect(s.assets.listCardTemplates).toHaveBeenCalledWith('pet', false, false);
    expect(s.assets.listCardTemplates).toHaveBeenCalledWith('moment', false, false);
  });
  it('聊天真实附加路径发送转存图片和来源，不将网页URL当mediaId', async () => {
    const s = setup();
    const ai = new MediaAiService(
      ...([
        s.media,
        {},
        s.assets,
        s.links,
        {},
        {},
        {},
        {},
        {},
        { getInconvenientUntil: async () => null },
        { nowMs: () => 0 },
        s.service,
        { decide: async () => ({ choice: 'text' }) },
      ] as unknown as ConstructorParameters<typeof MediaAiService>),
    );
    const onSearchCharged = vi.fn();
    const result = await ai.planExtras({
      ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
      triggerId: 'trigger',
      bubbles: ['看看这张图片'],
      userText: '发张猫咪图片',
      history: [],
      voiceId: null,
      quiet: true,
      onSearchCharged,
    });
    expect(onSearchCharged).toHaveBeenCalledExactlyOnceWith(7);
    expect(result).toContainEqual(
      expect.objectContaining({ type: 'image', mediaId: 'stored-web-image' }),
    );
    expect(result).toContainEqual({
      type: 'text',
      text: '网上找到的图片，来源：https://public.example/picture',
    });
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('图片发送失败时不捏造图片气泡，保留原文字回复', async () => {
    const s = setup({ library: false, enabled: false });
    const ai = new MediaAiService(
      ...([
        s.media,
        {},
        s.assets,
        s.links,
        {},
        {},
        {},
        {},
        {},
        { getInconvenientUntil: async () => null },
        { nowMs: () => 0 },
        s.service,
        { decide: async () => ({ choice: 'text' }) },
      ] as unknown as ConstructorParameters<typeof MediaAiService>),
    );
    expect(
      await ai.planExtras({
        ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
        triggerId: 'trigger',
        bubbles: ['今天聊得很开心'],
        userText: '发张猫咪图片',
        history: [],
        voiceId: null,
        quiet: true,
      }),
    ).toBeNull();
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('保留角色自主选择并发送库内表情，不调用图片模型', async () => {
    const s = setup();
    const stickerAssets = {
      listStickersForCharacter: async () => [
        { stickerId: 'sticker', mediaId: 'sticker-media', description: '开心' },
      ],
    };
    const ai = new MediaAiService(
      ...([
        s.media,
        {},
        stickerAssets,
        s.links,
        {},
        {},
        {},
        {},
        {},
        { getInconvenientUntil: async () => null },
        { nowMs: () => 0 },
        s.service,
        {
          decide: async (input: { options: string[] }) => ({
            choice: input.options.includes('keep_sticker') ? 'keep_sticker' : 'text',
          }),
        },
      ] as unknown as ConstructorParameters<typeof MediaAiService>),
    );
    const result = await ai.planExtras({
      ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
      triggerId: 'trigger',
      bubbles: ['开心'],
      userText: '你好',
      history: [],
      voiceId: null,
    });
    expect(result).toContainEqual(
      expect.objectContaining({ type: 'sticker', stickerId: 'sticker', mediaId: 'sticker-media' }),
    );
    expect(s.media.webSearch).not.toHaveBeenCalled();
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('没有固定公开主题时不外传任意私人文字或人物检索', () => {
    expect(publicPictureQuery('请找某位演员的自拍，聊天金丝雀')).toBeNull();
    expect(publicPictureQuery('家里地址123，想看海滩')).toBe('海滩 公开图片');
  });
});

it('历史人物即使未同时标记真人且实验开关打开，也只使用库图', async () => {
  const s = setup({ historical: true, real: false });
  expect(await s.service.generate(s.input)).toMatchObject({ source: 'library', chargedMicros: 0 });
  expect(s.media.webSearch).not.toHaveBeenCalled();
});

it('角色网上找图开关关闭时不触发搜索或新费用，用户输入图检索开关与此无关', async () => {
  const s = setup({ pictureSearch: false });
  expect(await s.service.generate(s.input)).toMatchObject({ source: 'library', chargedMicros: 0 });
  expect(s.media.webSearch).not.toHaveBeenCalled();
  expect(s.media.generateImage).not.toHaveBeenCalled();
});
