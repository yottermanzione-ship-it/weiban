/**
 * 角色广场「添加热度」排序（T-20261025）：只用真实添加人数，不看点赞 / 评论 / 下载；
 * 整份候选集先排完再分页，人数相同用稳定 id 次序，翻页不重复、不漏项。
 * 这里用假的角色端口与通讯录统计端口跑服务层真实代码，不连数据库。
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PlazaOfficialService } from '../application/plaza-official.service.js';
import { decodeOffset, orderByAddCount } from './rules.js';

function serviceWith(options: {
  ids: string[];
  counts: Map<string, number>;
  likes?: Map<string, number>;
}) {
  /** 每次统计端口收到的角色 id 列表：用来确认是整份候选集一次拿完，不是只算当前一页。 */
  const counted: string[][] = [];
  const contactStats = {
    hasAnyActiveContact: async () => true,
    countContactUsers: async (ids: string[]) => {
      counted.push([...ids]);
      return new Map(ids.map((id) => [id, options.counts.get(id) ?? 0]));
    },
  };
  const characters = {
    listOfficialIds: async () => options.ids,
    getOfficialCards: async (_viewer: string, pageIds: string[]) =>
      pageIds.map((id) => ({ characterId: id, name: id, tagline: '', added: false })),
    getOfficialProfile: async () => null,
  };
  const service = new PlazaOfficialService({} as never, characters as never, contactStats as never);
  // 点赞 / 评论计数故意给出会打乱「添加热度」的值：排序不应看它们。
  Object.assign(service as unknown as Record<string, unknown>, {
    stats: async () => ({ likes: options.likes ?? new Map(), comments: new Map() }),
    likedBy: async () => new Set<string>(),
  });
  return { service, counted };
}

const idsOf = (page: { items: Array<{ character: { characterId: string } }> }) =>
  page.items.map((item) => item.character.characterId);

describe('角色广场添加热度排序', () => {
  it('orderByAddCount：按人数降序，人数相同保持传入次序，不改入参', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const counts = new Map([
      ['a', 1],
      ['b', 3],
      ['c', 3],
      ['d', 0],
    ]);
    expect(orderByAddCount(ids, counts)).toEqual(['b', 'c', 'a', 'd']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('只看被用户添加的人数，点赞再多也不改顺序', async () => {
    const ids = ['char-a', 'char-b', 'char-c'];
    const { service } = serviceWith({
      ids,
      counts: new Map([
        ['char-a', 0],
        ['char-b', 3],
        ['char-c', 1],
      ]),
      // a 的点赞最多：如果排序还看点赞，a 会跑到第一。
      likes: new Map([
        ['char-a', 99],
        ['char-c', 50],
      ]),
    });
    const page = await service.list('viewer', { sort: 'added', limit: 10 });
    expect(idsOf(page)).toEqual(['char-b', 'char-c', 'char-a']);
  });

  it('没有通讯录统计端口时退回角色库稳定次序，不编造人数', async () => {
    const ids = ['p-1', 'p-2', 'p-3'];
    const characters = {
      listOfficialIds: async () => ids,
      getOfficialCards: async (_viewer: string, pageIds: string[]) =>
        pageIds.map((id) => ({ characterId: id, name: id, tagline: '', added: false })),
      getOfficialProfile: async () => null,
    };
    const service = new PlazaOfficialService({} as never, characters as never);
    Object.assign(service as unknown as Record<string, unknown>, {
      stats: async () => ({ likes: new Map(), comments: new Map() }),
      likedBy: async () => new Set<string>(),
    });
    const page = await service.list('viewer', { sort: 'added', limit: 10 });
    expect(idsOf(page)).toEqual(ids);
  });

  it('人数相同按稳定 id 次序，翻页不重复、不漏项', async () => {
    const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
    const { service } = serviceWith({
      ids,
      counts: new Map([
        ['id-1', 2],
        ['id-2', 5],
        ['id-3', 2],
        ['id-4', 5],
        ['id-5', 1],
      ]),
    });
    const first = await service.list('viewer', { sort: 'added', limit: 2 });
    const second = await service.list('viewer', {
      sort: 'added',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await service.list('viewer', {
      sort: 'added',
      limit: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(decodeOffset(first.nextCursor ?? undefined)).toBe(2);
    const seen = [...idsOf(first), ...idsOf(second), ...idsOf(third)];
    expect(seen).toEqual(['id-2', 'id-4', 'id-1', 'id-3', 'id-5']);
    expect(new Set(seen).size).toBe(ids.length);
    expect(third.nextCursor).toBeNull();
  });

  it('搜索后的结果集也在整份候选集上排名，不是只重排当前一页', async () => {
    const matched = ['m-1', 'm-2', 'm-3', 'm-4'];
    const { service, counted } = serviceWith({
      ids: matched,
      counts: new Map(matched.map((id) => [id, Number(id.slice(2))])),
    });
    const page = await service.list('viewer', { sort: 'added', q: '角色', limit: 2 });
    // 统计端口一次拿到整份命中结果（4 个），不是只拿分页里的 2 个。
    expect(counted[0]).toEqual(matched);
    expect(idsOf(page)).toEqual(['m-4', 'm-3']);
  });

  it('旧的 hot / most_liked 仍然可用（向后兼容，不改旧客户端行为）', async () => {
    const ids = ['k-1', 'k-2'];
    const { service } = serviceWith({
      ids,
      counts: new Map(),
      likes: new Map([
        ['k-1', 1],
        ['k-2', 9],
      ]),
    });
    const hot = await service.list('viewer', { sort: 'most_liked', limit: 10 });
    expect(idsOf(hot)).toEqual(['k-2', 'k-1']);
    const fallback = await service.list('viewer', { sort: 'default', limit: 10 });
    expect(idsOf(fallback)).toEqual(ids);
  });
});
