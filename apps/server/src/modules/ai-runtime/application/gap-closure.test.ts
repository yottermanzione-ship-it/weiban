/**
 * 3.29 两个缺口的最小用例：
 * 1) 共享检索结算前重核：caller 传 eligibleUserIds 回调，settle 只收仍合格的人；
 * 2) 生态 photo 从微博素材图片里稳定选图，交给既有媒体路径（本用例只验选择，不建消息）。
 */
import { describe, expect, it, vi } from 'vitest';
import { eligibleMembers, sharedSlice } from '../../billing/domain/shared-search.js';
import { SharedWebSearch } from '../../model-access/application/shared-search.js';
import { MomentsAiService } from './moments-ai.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';

describe('共享检索结算资格', () => {
  it('eligibleMembers 只保留重核后仍合格的人；空集合不把费用转给残留用户', () => {
    const members = [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }];
    expect(eligibleMembers(members, ['u2'])).toEqual([{ user_id: 'u2' }]);
    expect(eligibleMembers(members, [])).toEqual([]);
    expect(eligibleMembers(members)).toEqual(members);
    // 3 人分摊时 u2 只承担 1/3，不会在 u1/u3 退出后吃掉全部
    expect(sharedSlice(300, 3, 1, 0)).toBe(100);
  });

  it('SharedWebSearch 把 caller 的 eligible 回调传给 settle（不反向依赖 AI_Runtime）', async () => {
    const settle = vi.fn().mockResolvedValue({
      collectedMicros: 300,
      userCharges: { u2: 300 },
    });
    const begin = vi.fn().mockResolvedValue({
      groupId: 'group-1',
      userIds: ['u1', 'u2'],
      state: 'pending',
    });
    const service = new SharedWebSearch(
      {
        isServiceEnabled: vi.fn().mockResolvedValue(true),
        webSearch: vi.fn().mockResolvedValue({
          ok: true,
          value: { chargedMicros: 300, usageRecordId: 'usage-1', items: [] },
        }),
      } as never,
      {
        internalModel: vi.fn().mockResolvedValue({ modelKey: 'deepseek-search', entry: {} }),
      } as never,
      { begin, settle, cancel: vi.fn() } as never,
      { listAdminUserIds: vi.fn().mockResolvedValue(['admin']) } as never,
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      { now: () => new Date('2026-10-25T00:00:00.000Z') } as never,
    );
    const result = await service.search({
      characterId: 'char-1',
      requesterUserId: 'u1',
      userIds: ['u1', 'u2'],
      query: '微博',
      key: 'weibo:test',
      eligibleUserIds: async () => ['u2'],
    });
    expect(settle).toHaveBeenCalledWith('group-1', 'usage-1', ['u2']);
    expect(result).toMatchObject({ ok: true, requesterChargeMicros: 0 });
  });
});

describe('生态 photo：只从微博素材选图', () => {
  it('同一条微博的图片稳定选一张；没有图片返回 null', async () => {
    const service = Object.create(MomentsAiService.prototype) as MomentsAiService;
    Object.assign(service, {
      weiboMaterial: {
        latest: vi.fn().mockResolvedValue({
          updateId: 'update-1',
          content: '微博原文',
          images: [{ mediaId: 'm1' }, { mediaId: 'm2' }],
        }),
      },
    });
    const first = await service.weiboPhotoForEcology(USER, CHAR);
    expect(['m1', 'm2']).toContain(first?.mediaId);
    await expect(service.weiboPhotoForEcology(USER, CHAR)).resolves.toEqual(first);

    Object.assign(service, {
      weiboMaterial: {
        latest: vi.fn().mockResolvedValue({
          updateId: 'update-2',
          content: '只有文字',
          images: [],
        }),
      },
    });
    await expect(service.weiboPhotoForEcology(USER, CHAR)).resolves.toBeNull();
  });
});
