/**
 * T-20261103c：「微伴角色」详情、点赞、评论都先经 CharacterPlazaPort.getOfficialProfile 校验（assertListed）。
 * characters 侧已改成和列表同一口径（旧卡也算，见 characters/application/plaza-official.test.ts）；
 * 这里用假端口确认 plaza 侧：端口找得到 → 详情可读、点赞成功；端口返回 null → not_found，不写点赞。
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { CharacterPlazaPort, CharacterProfile } from '@weiban/contracts';
import { AppError, TestClock } from '../../../platform/index.js';
import { officialLikes } from '../infra/db/schema.js';
import { PlazaOfficialService } from './plaza-official.service.js';

const ROLE_ID = '0190f3a1-0000-7000-8000-00000000a001';
const VIEWER = '0190f3a1-0000-7000-8000-00000000b001';

/** 旧卡角色的详情（characters 给什么，plaza 原样转出）。 */
const found = {
  profile: { characterId: ROLE_ID, name: '程澈' } as unknown as CharacterProfile,
  persona: {
    summary: '原创成年人物',
    personality: '外冷内热',
    speechStyle: '说话短',
    catchphrases: [],
  },
};

function harness(listed: boolean) {
  const inserted: unknown[] = [];
  let likes = 0;
  const port: Pick<
    CharacterPlazaPort,
    'listOfficialIds' | 'getOfficialCards' | 'getOfficialProfile'
  > = {
    listOfficialIds: async () => (listed ? [ROLE_ID] : []),
    getOfficialCards: async () => [],
    getOfficialProfile: async (_userId, characterId) =>
      listed && characterId === ROLE_ID ? found : null,
  };
  const store = {
    clock: new TestClock('2026-11-03T10:00:00Z'),
    db: {
      db: {
        insert: (table: unknown) => ({
          values: (value: unknown) => ({
            onConflictDoNothing: async () => {
              if (table === officialLikes) {
                inserted.push(value);
                likes += 1;
              }
            },
          }),
        }),
        // likeCount 取 [{ n }]；stats 的 groupBy 计数与 likedBy 在这里不关心具体值。
        select: () => ({
          from: () => ({
            where: () =>
              Object.assign(Promise.resolve([{ n: likes }]), { groupBy: async () => [] }),
          }),
        }),
      },
    },
  };
  return { service: new PlazaOfficialService(store as never, port as never), inserted };
}

describe('PlazaOfficialService：详情 / 点赞走 getOfficialProfile 口径', () => {
  it('端口找得到（含旧卡角色）：详情可读、点赞成功', async () => {
    const { service, inserted } = harness(true);
    const detail = await service.get(VIEWER, ROLE_ID);
    expect(detail.character).toBe(found.profile);
    expect(detail.persona).toEqual(found.persona);
    await expect(service.like(VIEWER, ROLE_ID)).resolves.toEqual({ likeCount: 1, likedByMe: true });
    expect(inserted).toEqual([expect.objectContaining({ characterId: ROLE_ID, userId: VIEWER })]);
  });

  it('端口返回 null（未上架 / 非预设 / 不存在）：详情、点赞都是 not_found，不写点赞', async () => {
    const { service, inserted } = harness(false);
    for (const call of [service.get(VIEWER, ROLE_ID), service.like(VIEWER, ROLE_ID)]) {
      await expect(call).rejects.toBeInstanceOf(AppError);
      await expect(call).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(inserted).toEqual([]);
  });
});
