import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CharacterImageService } from './character-image.js';
import { MediaAiService } from './media-ai.js';
import { safetyStyleText } from '../domain/character-prompt.js';

function setup(
  options: { real?: boolean; historical?: boolean; library?: boolean; policy?: boolean } = {},
) {
  const media = {
    generateImage: vi.fn(() => {
      throw new Error('must never generate');
    }),
    isServiceEnabled: vi.fn(async () => true),
    webSearch: vi.fn(async () => {
      throw new Error('must not search without source verification');
    }),
  };
  const assets = {
    listCardTemplates: vi.fn(async () =>
      options.library === false ? [] : [{ mediaId: 'library', templateId: 'template' }],
    ),
  };
  const policy = {
    getCharacterPolicy: vi.fn(async () =>
      options.policy === false
        ? null
        : { isRealPerson: options.real ?? false, isHistorical: options.historical ?? false },
    ),
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
    previewForUser: vi.fn(async () => ({ reachable: true, coverMediaId: 'unverified-cover' })),
  };
  const service = new CharacterImageService(
    ...([assets, policy, read] as unknown as ConstructorParameters<typeof CharacterImageService>),
  );
  const input = {
    userId: 'user',
    characterId: 'character',
    conversationId: 'conversation',
    scene: '自拍或猫咪，私人聊天金丝雀',
    use: 'chat' as const,
    searchPublic: true,
    wantCharacter: true,
    idempotencyKey: 'turn',
  };
  return { service, media, assets, policy, read, links, input };
}
function extras(s: ReturnType<typeof setup>, assets: unknown = s.assets) {
  return new MediaAiService(
    ...([
      s.media,
      {},
      assets,
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
        decide: async (input: { options?: string[] }) => ({
          choice: input.options?.includes('keep_sticker') ? 'keep_sticker' : 'text',
        }),
      },
    ] as unknown as ConstructorParameters<typeof MediaAiService>),
  );
}

describe('普通图片不再走随机图库、网页封面或生图', () => {
  it('发给角色的能力说明不再承诺图库图片，未实发不能说已经发送', () => {
    const prompt = safetyStyleText({
      safetyStyle: {
        careVoice: '温和',
        deflectStyle: '自然',
        refuseSelfieStyle: '不冒充真人新自拍',
      },
    } as unknown as Parameters<typeof safetyStyleText>[0]);
    expect(prompt).toContain('不从日常图库抽图');
    expect(prompt).toContain('不拿网页封面凑普通图片');
    expect(prompt).toContain('未确认实际发送前');
    expect(prompt).not.toContain('只能分享网上公开图片或素材库图片');
  });
  it.each([
    [false, false, 'chat'],
    [false, false, 'moments'],
    [true, false, 'chat'],
    [true, false, 'moments'],
    [true, true, 'chat'],
    [true, true, 'moments'],
  ] as const)(
    '真人=%s 历史=%s 用途=%s：没有可信来源就不发图、不产生搜索费',
    async (real, historical, use) => {
      const s = setup({ real, historical });
      const onSearchCharged = vi.fn();
      expect(
        await s.service.generate({
          ...s.input,
          use,
          ecologyTask: true,
          countAsBackground: true,
          onSearchCharged,
        }),
      ).toBeNull();
      expect(s.assets.listCardTemplates).not.toHaveBeenCalled();
      expect(s.read.getMedia).not.toHaveBeenCalled();
      expect(s.links.previewForUser).not.toHaveBeenCalled();
      expect(s.media.webSearch).not.toHaveBeenCalled();
      expect(s.media.generateImage).not.toHaveBeenCalled();
      expect(onSearchCharged).not.toHaveBeenCalled();
    },
  );
  it('不能把日常图库伪装成卡片用途绕回普通配图', async () => {
    const s = setup();
    expect(
      await s.service.generate({ ...s.input, use: 'card', cardKind: 'daily_photo' }),
    ).toBeNull();
    expect(s.assets.listCardTemplates).not.toHaveBeenCalled();
  });
  it('卡片与宠物底图仍按原用途及真人/古风限制读取', async () => {
    const s = setup({ real: true, historical: true });
    expect(
      await s.service.generate({ ...s.input, use: 'card', cardKind: 'anniversary' }),
    ).toMatchObject({ mediaId: 'library', source: 'library', chargedMicros: 0 });
    expect(s.assets.listCardTemplates).toHaveBeenLastCalledWith('anniversary', true, true);
    expect(await s.service.generate({ ...s.input, use: 'pet' })).toMatchObject({
      mediaId: 'library',
      source: 'library',
      chargedMicros: 0,
    });
    expect(s.assets.listCardTemplates).toHaveBeenLastCalledWith('pet', true, true);
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
  it('默认卡片沿用moment类别，缺角色策略不读模板', async () => {
    const s = setup();
    expect(await s.service.generate({ ...s.input, use: 'card' })).toMatchObject({
      source: 'library',
    });
    expect(s.assets.listCardTemplates).toHaveBeenCalledWith('moment', false, false);
    const unavailable = setup({ policy: false });
    expect(await unavailable.service.generate({ ...unavailable.input, use: 'pet' })).toBeNull();
    expect(unavailable.assets.listCardTemplates).not.toHaveBeenCalled();
  });
  it('卡片/宠物无模板或媒体失效时不借普通图兜底', async () => {
    const empty = setup({ library: false });
    expect(await empty.service.generate({ ...empty.input, use: 'pet' })).toBeNull();
    const failed = setup();
    failed.read.getMedia.mockRejectedValueOnce(new Error('missing'));
    expect(await failed.service.generate({ ...failed.input, use: 'card' })).toBeNull();
    expect(failed.media.generateImage).not.toHaveBeenCalled();
  });
  it('真实聊天附加路径不拼假图片气泡，也不破坏已有文字', async () => {
    const s = setup();
    const bubbles = ['今天聊得很开心'];
    expect(
      await extras(s).planExtras({
        ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
        triggerId: 'trigger',
        bubbles,
        userText: '发张猫咪图片',
        history: [],
        voiceId: null,
        quiet: true,
      }),
    ).toBeNull();
    expect(bubbles).toEqual(['今天聊得很开心']);
    expect(s.links.previewForUser).not.toHaveBeenCalled();
    expect(s.media.webSearch).not.toHaveBeenCalled();
  });
  it('表情图片仍可由角色选择，不能误关成普通照片', async () => {
    const s = setup();
    const ai = extras(s, {
      listStickersForCharacter: async () => [
        { stickerId: 'sticker', mediaId: 'sticker-media', description: '开心' },
      ],
    });
    expect(
      await ai.planExtras({
        ctx: { userId: 'user', characterId: 'character', conversationId: 'conversation' },
        triggerId: 'sticker-trigger',
        bubbles: ['开心'],
        userText: '你好',
        history: [],
        voiceId: null,
      }),
    ).toContainEqual(
      expect.objectContaining({ type: 'sticker', stickerId: 'sticker', mediaId: 'sticker-media' }),
    );
    expect(s.media.webSearch).not.toHaveBeenCalled();
    expect(s.media.generateImage).not.toHaveBeenCalled();
  });
});
