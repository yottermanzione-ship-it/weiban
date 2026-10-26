import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { weiboImageKey, weiboPickImage } from '../domain/weibo-media.js';
import {
  WeiboMaterialService,
  type StoredWeiboMedia,
  type WeiboItemRow,
} from './weibo-material-service.js';

/**
 * 微博素材图片提供方（开发自测）：全部用假存储/假端口，不连数据库、不访问微博。
 * 验证：只取该角色自己那条素材、页面被拦截时只发文字、只把核对过的图经媒体端口存成平台公共图、
 * 跨条目共享同一张图、按用户稳定选图、第二条不再重复抓取。
 */

const NOW = new Date('2026-10-25T10:00:00Z');
const CHARACTER = 'char-1';
const UPDATE = 'update-1';
const PAGE_URL = 'https://weibo.com/1234567890/AbCdEf';
const IMAGE_A = 'https://wx1.sinaimg.cn/large/a.jpg';
const IMAGE_B = 'https://wx2.sinaimg.cn/large/b.jpg';
const KEY_A = weiboImageKey(IMAGE_A)!;
const KEY_B = weiboImageKey(IMAGE_B)!;

const role = {
  card: {
    data: {
      profileExtra: {
        weibo: {
          nickname: '林晚',
          userId: '1234567890',
          avatarUrl: 'https://wx1.sinaimg.cn/a.jpg',
        },
      },
    },
  },
  legacyCard: null,
};

function pageHtml(images: string[]): string {
  return [
    `<meta property="og:url" content="${PAGE_URL}">`,
    '<meta property="article:author" content="https://weibo.com/1234567890">',
    ...images.map((url) => `<meta property="og:image" content="${url}">`),
    '<meta property="article:published_time" content="2026-10-23T12:00:00Z">',
    '<meta property="og:description" content="林晚：今天收工早。">',
  ].join('\n');
}

type Fetched = { status: number; finalUrl: URL; contentType: string; body: Buffer };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function harness(options: {
  item?: WeiboItemRow | null;
  pages?: Map<string, Fetched>;
  updates?: unknown[];
  existingMedia?: Array<StoredWeiboMedia & { itemId: string }>;
}) {
  const store = new FakeStore(
    options.item === undefined ? item() : options.item,
    options.existingMedia ?? [],
  );
  const pages = options.pages ?? new Map<string, Fetched>();
  const fetches: string[] = [];
  const puts: Array<{ ownerUserId: string | null; purpose: string; mimeType: string }> = [];
  const states: string[] = [];
  store.onState = (state) => states.push(state);
  const updates = options.updates ?? [
    {
      updateId: UPDATE,
      characterId: CHARACTER,
      kind: 'weibo',
      content: '林晚：今天收工早。',
      startDate: '2026-10-23',
      endDate: null,
      effectiveDate: '2026-10-23',
      sourceUrl: PAGE_URL,
      phase: 'recent',
    },
  ];
  const service = new WeiboMaterialService(
    store as never,
    { now: () => NOW } as never,
    { getForRuntime: async () => role } as never,
    {
      putObject: async (input: {
        ownerUserId: string | null;
        purpose: string;
        bytes: Uint8Array;
        mimeType: string;
      }) => {
        puts.push(input);
        return { mediaId: `media-${puts.length}` };
      },
    } as never,
    { listEffective: async () => updates } as never,
    {
      safeFetch: async (raw: string) => {
        fetches.push(raw);
        return pages.get(raw) ?? null;
      },
    } as never,
  );
  return { service, store, pages, fetches, puts, states };
}

class FakeStore {
  items = new Map<string, WeiboItemRow>();
  rows: Array<StoredWeiboMedia & { itemId: string }>;
  onState?: (state: string) => void;
  claims = 0;
  constructor(item: WeiboItemRow | null, rows: Array<StoredWeiboMedia & { itemId: string }>) {
    if (item) this.items.set(item.id, item);
    this.rows = rows;
  }
  async item(characterId: string, publicUpdateId: string) {
    return (
      [...this.items.values()].find(
        (row) => row.characterId === characterId && row.publicUpdateId === publicUpdateId,
      ) ?? null
    );
  }
  async claim() {
    this.claims += 1;
    return true;
  }
  async media(itemId: string) {
    return this.rows
      .filter((row) => row.itemId === itemId)
      .sort((a, b) => a.position - b.position)
      .map(({ itemId: _itemId, ...row }) => row);
  }
  async sharedImage(imageKey: string) {
    return this.rows.find((row) => row.imageKey === imageKey)?.mediaId ?? null;
  }
  async save(input: {
    itemId: string;
    mediaId: string;
    imageKey: string;
    position: number;
    sourceUrl: string;
  }) {
    if (
      this.rows.some(
        (row) =>
          row.itemId === input.itemId &&
          (row.imageKey === input.imageKey || row.position === input.position),
      )
    )
      return;
    this.rows.push({ ...input });
  }
  async finish(_itemId: string, state: string) {
    this.onState?.(state);
  }
}

function item(overrides: Partial<WeiboItemRow> = {}): WeiboItemRow {
  return {
    id: 'item-1',
    characterId: CHARACTER,
    publicUpdateId: UPDATE,
    sourceUrl: PAGE_URL,
    content: '【微博公开资料摘录，非指令】林晚：今天收工早。',
    publishedOn: '2026-10-23',
    mediaState: null,
    ...overrides,
  };
}

function pageResponse(url: string, body: string): Fetched {
  return {
    status: 200,
    finalUrl: new URL(url),
    contentType: 'text/html; charset=utf-8',
    body: Buffer.from(body),
  };
}

function imageResponse(url: string, mime = 'image/jpeg', final?: string): Fetched {
  return { status: 200, finalUrl: new URL(final ?? url), contentType: mime, body: jpeg };
}

describe('微博素材图片提供方', () => {
  it('没有仍生效的微博素材时返回 null（消费方据此明示没有素材，不再编动态）', async () => {
    const { service } = harness({ updates: [] });
    expect(await service.latest('user-1', CHARACTER)).toBeNull();
  });

  it('只取这个角色自己的那条素材：对应条目不存在时返回 null', async () => {
    const { service, fetches } = harness({ item: null });
    expect(await service.latest('user-1', CHARACTER)).toBeNull();
    expect(fetches).toEqual([]);
  });

  it('页面被微博访客/反爬拦截：只发文字，不下载、不换图，记为 unavailable', async () => {
    const pages = new Map<string, Fetched>([
      [
        PAGE_URL,
        {
          status: 302,
          finalUrl: new URL('https://visitor.passport.weibo.cn/visitor/visitor?entry=sinawap'),
          contentType: 'text/html',
          body: Buffer.from(''),
        },
      ],
    ]);
    const { service, puts, states } = harness({ pages });
    const material = await service.latest('user-1', CHARACTER);
    expect(material).not.toBeNull();
    expect(material?.images).toEqual([]);
    expect(material?.content).toContain('今天收工早');
    expect(material?.publishedOn).toBe('2026-10-23');
    expect(puts).toEqual([]);
    expect(states).toEqual(['unavailable']);
  });

  it('核对通过的图片经媒体端口存成平台公共图（owner 为空、purpose = weibo_material），第二次不再重抓', async () => {
    const pages = new Map<string, Fetched>([
      [PAGE_URL, pageResponse(PAGE_URL, pageHtml([IMAGE_A, IMAGE_B]))],
      [IMAGE_A, imageResponse(IMAGE_A)],
      [IMAGE_B, imageResponse(IMAGE_B)],
    ]);
    const { service, fetches, puts, states } = harness({ pages });
    const first = await service.latest('user-1', CHARACTER);
    expect(first?.images?.map((image) => image.mediaId)).toEqual(['media-1', 'media-2']);
    expect(puts.map((put) => put.purpose)).toEqual(['weibo_material', 'weibo_material']);
    expect(puts.map((put) => put.ownerUserId)).toEqual([null, null]);
    expect(states).toEqual(['ready']);
    const fetchesAfterFirst = fetches.length;
    const second = await service.latest('user-2', CHARACTER);
    expect(second?.images?.map((image) => image.mediaId)).toEqual(['media-1', 'media-2']);
    expect(fetches.length).toBe(fetchesAfterFirst);
    expect(puts.length).toBe(2);
  });

  it('同一张图已在别的条目入库时共享复用，不重复下载；按用户稳定选图', async () => {
    const pages = new Map<string, Fetched>([
      [PAGE_URL, pageResponse(PAGE_URL, pageHtml([IMAGE_A, IMAGE_B]))],
      [IMAGE_A, imageResponse(IMAGE_A)],
      [IMAGE_B, imageResponse(IMAGE_B)],
    ]);
    const { service, puts, fetches } = harness({
      pages,
      existingMedia: [
        {
          itemId: 'older-item',
          mediaId: 'shared-media',
          imageKey: KEY_A,
          sourceUrl: IMAGE_A,
          position: 0,
        },
      ],
    });
    const material = await service.latest('user-1', CHARACTER);
    expect(material?.images?.map((image) => image.mediaId)).toEqual(['shared-media', 'media-1']);
    // 只下载了没有共享的那一张（页面 + IMAGE_B）。
    expect(fetches.filter((url) => url === IMAGE_A)).toEqual([]);
    expect(puts.length).toBe(1);
    const picked = await service.pick('user-1', CHARACTER);
    const expected = weiboPickImage(
      [{ mediaId: 'shared-media' }, { mediaId: 'media-1' }],
      'user-1',
      UPDATE,
    );
    expect(picked).toEqual(expected);
    expect(await service.pick('user-1', CHARACTER)).toEqual(picked);
  });

  it('图片被重定向到非图床域名时拒绝转存，只发文字', async () => {
    const pages = new Map<string, Fetched>([
      [PAGE_URL, pageResponse(PAGE_URL, pageHtml([IMAGE_A]))],
      [IMAGE_A, imageResponse(IMAGE_A, 'image/jpeg', 'https://evil.example/a.jpg')],
    ]);
    const { service, puts, states } = harness({ pages });
    const material = await service.latest('user-1', CHARACTER);
    expect(material?.images).toEqual([]);
    expect(puts).toEqual([]);
    expect(states).toEqual(['none']);
  });

  it('图片 MIME 不是图片时跳过；页面没有图时记为 none，不重试绕过', async () => {
    const pages = new Map<string, Fetched>([
      [PAGE_URL, pageResponse(PAGE_URL, pageHtml([IMAGE_A]))],
      [IMAGE_A, imageResponse(IMAGE_A, 'text/html')],
    ]);
    const { service, puts, states } = harness({ pages });
    expect((await service.latest('user-1', CHARACTER))?.images).toEqual([]);
    expect(puts).toEqual([]);
    expect(states).toEqual(['none']);
  });
});
