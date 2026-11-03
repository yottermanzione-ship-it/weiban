/**
 * T-20261103g：私聊分享照片的素材来源。只用已入库、已审核的微博素材图，排除这个用户收到过的图。
 */
import { describe, expect, it } from 'vitest';
import type { MediaObject, MediaReadPort } from '@weiban/contracts';
import { ChatPhotoService } from './chat-photo.js';
import type { ImageCaptionStore } from './image-captions.js';
import type { ShareableWeiboPhotos, WeiboMaterialService } from './weibo-material-service.js';

const policy = { isMinor: false, isRealPerson: false, romanceAllowed: false };
const none = new Set<string>();

function post(
  updateId: string,
  mediaIds: string[],
  content = '今天去海边拍了日落',
): ShareableWeiboPhotos {
  return { updateId, content, publishedOn: '2026-10-30', mediaIds };
}

function harness(
  posts: ShareableWeiboPhotos[],
  opts: { archived?: string[]; mime?: string; missing?: boolean } = {},
) {
  const saved: Parameters<ImageCaptionStore['save']>[0][] = [];
  const loads: string[][] = [];
  const weibo: Pick<WeiboMaterialService, 'shareable'> = { shareable: async () => posts };
  const mediaRead: MediaReadPort = {
    getMedia: async (_userId, mediaId) => {
      if (opts.missing) throw new Error('not_found');
      return {
        mediaId,
        purpose: 'weibo_material',
        mimeType: opts.mime ?? 'image/webp',
        sizeBytes: 1234,
        width: 800,
        height: 600,
        url: 'https://example.com/a',
        urlExpiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as MediaObject;
    },
  };
  const captions: Pick<ImageCaptionStore, 'load' | 'save'> = {
    load: async (_userId, ids) => {
      loads.push([...ids]);
      return new Map(
        (opts.archived ?? [])
          .filter((id) => ids.includes(id))
          .map((id) => [id, { kind: 'other', description: '旧', textInImage: '', people: [] }]),
      ) as Awaited<ReturnType<ImageCaptionStore['load']>>;
    },
    save: async (input) => {
      saved.push(input);
    },
  };
  return { service: new ChatPhotoService(weibo, mediaRead, captions), saved, loads };
}

describe('ChatPhotoService.offer：选一张这个用户没收到过的素材图', () => {
  it('从最新那条微博里挑，带上日期和摘录', async () => {
    const { service } = harness([
      post('u-new', ['n1', 'n2']),
      post('u-old', ['o1'], '旧的一条微博'),
    ]);
    const offer = await service.offer({ userId: 'user', characterId: 'c', received: none, policy });
    expect(offer).not.toBeNull();
    expect(['n1', 'n2']).toContain(offer!.mediaId);
    expect(offer).toMatchObject({
      updateId: 'u-new',
      excerpt: '今天去海边拍了日落',
      publishedOn: '2026-10-30',
    });
  });

  it('聊天记录里发过的、存档里记过的都排除；最新那条用完了换下一条', async () => {
    const { service } = harness(
      [post('u-new', ['n1', 'n2']), post('u-old', ['o1'], '旧的一条微博')],
      {
        archived: ['n2'],
      },
    );
    const offer = await service.offer({
      userId: 'user',
      characterId: 'c',
      received: new Set(['n1']),
      policy,
    });
    expect(offer).toMatchObject({ mediaId: 'o1', updateId: 'u-old', excerpt: '旧的一条微博' });
  });

  it('全都收到过、没有素材、素材文字涉及健康隐私：都返回 null，不去找别的图', async () => {
    const all = harness([post('u', ['a'])], { archived: ['a'] });
    expect(
      await all.service.offer({ userId: 'user', characterId: 'c', received: none, policy }),
    ).toBe(null);
    const empty = harness([]);
    expect(
      await empty.service.offer({ userId: 'user', characterId: 'c', received: none, policy }),
    ).toBe(null);
    expect(empty.loads).toEqual([]);
    const health = harness([post('u', ['a'], '最近生理期肚子好痛')]);
    expect(
      await health.service.offer({ userId: 'user', characterId: 'c', received: none, policy }),
    ).toBe(null);
  });

  it('同一用户同一条素材挑出来的图稳定不变', async () => {
    const { service } = harness([post('u', ['a', 'b', 'c', 'd'])]);
    const input = { userId: 'user', characterId: 'c', received: none, policy };
    const first = await service.offer(input);
    expect((await service.offer(input))?.mediaId).toBe(first?.mediaId);
  });
});

describe('ChatPhotoService.content：发送前复核', () => {
  it('仍在可分享素材里、媒体是图片：拼出图片消息', async () => {
    const { service } = harness([post('u', ['a'])]);
    expect(await service.content('user', 'c', 'a')).toEqual({
      type: 'image',
      mediaId: 'a',
      width: 800,
      height: 600,
      sizeBytes: 1234,
    });
  });

  it('素材已撤下、媒体不在、不是图片：不发', async () => {
    expect(await harness([post('u', ['b'])]).service.content('user', 'c', 'a')).toBe(null);
    expect(
      await harness([post('u', ['a'])], { missing: true }).service.content('user', 'c', 'a'),
    ).toBe(null);
    expect(
      await harness([post('u', ['a'])], { mime: 'video/mp4' }).service.content('user', 'c', 'a'),
    ).toBe(null);
  });
});

describe('ChatPhotoService.remember：发出后记进图片描述存档', () => {
  it('按用户、关联消息存一条「微博配图」描述', async () => {
    const { service, saved } = harness([]);
    await service.remember({
      userId: 'user',
      conversationId: 'conv',
      messageId: 'msg',
      offer: {
        mediaId: 'a',
        updateId: 'u',
        excerpt: '今天去海边拍了日落',
        publishedOn: '2026-10-30',
      },
    });
    expect(saved).toEqual([
      {
        userId: 'user',
        mediaId: 'a',
        scope: 'normal',
        messageId: 'msg',
        conversationId: 'conv',
        caption: {
          kind: 'other',
          description: '微博配图（10月30日的微博：「今天去海边拍了日落」）',
          textInImage: '',
          people: [],
        },
        modelKey: null,
      },
    ]);
  });
});
