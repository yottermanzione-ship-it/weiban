/**
 * 后台角色「彻底删除（硬删）」契约测试：影响面与删除结果都包含四项计数；
 * 删除接口必须显式带 purge=true，避免与将来的普通 DELETE 语义混淆。
 */
import { describe, expect, it } from 'vitest';
import {
  AdminCharacterPurgeCounts,
  AdminCharacterPurgeImpact,
  AdminCharacterPurgeResult,
  CharacterAdminEndpoints,
} from '../src/index.js';

const ID = '01920000-0000-7000-8000-000000000001';
const NOW = '2026-10-24T08:30:00.000Z';

const counts = { contacts: 2, conversations: 1, messages: 7, moments: 3 };

describe('后台彻底删除角色契约', () => {
  it('影响面与删除结果都带联系人 / 会话 / 消息 / 朋友圈计数', () => {
    const impact = AdminCharacterPurgeImpact.parse({
      characterId: ID,
      name: '林夏予',
      status: 'published',
      counts,
    });
    expect(impact.counts).toEqual(counts);

    const result = AdminCharacterPurgeResult.parse({
      characterId: ID,
      purgedAt: NOW,
      counts,
    });
    expect(result.counts).toEqual(counts);
  });

  it('计数必须是非负整数，缺项时拒绝', () => {
    expect(AdminCharacterPurgeCounts.safeParse(counts).success).toBe(true);
    expect(AdminCharacterPurgeCounts.safeParse({ ...counts, messages: -1 }).success).toBe(false);
    expect(AdminCharacterPurgeCounts.safeParse({ ...counts, moments: 1.5 }).success).toBe(false);
    expect(AdminCharacterPurgeCounts.safeParse({ contacts: 1, conversations: 1 }).success).toBe(
      false,
    );
  });

  it('查询影响面是管理员接口，角色不存在时由服务器返回 404', () => {
    expect(CharacterAdminEndpoints.purgeImpact.method).toBe('GET');
    expect(CharacterAdminEndpoints.purgeImpact.auth).toBe('admin');
    expect(CharacterAdminEndpoints.purgeImpact.path).toBe(
      '/api/v1/admin/characters/:characterId/purge-impact',
    );
    expect(CharacterAdminEndpoints.purgeImpact.params?.safeParse({ characterId: ID }).success).toBe(
      true,
    );
  });

  it('彻底删除是 DELETE 且必须显式 purge=true', () => {
    expect(CharacterAdminEndpoints.purge.method).toBe('DELETE');
    expect(CharacterAdminEndpoints.purge.auth).toBe('admin');
    expect(CharacterAdminEndpoints.purge.path).toBe('/api/v1/admin/characters/:characterId');
    expect(CharacterAdminEndpoints.purge.query?.safeParse({ purge: 'true' }).success).toBe(true);
    expect(CharacterAdminEndpoints.purge.query?.safeParse({ purge: 'false' }).success).toBe(false);
    expect(CharacterAdminEndpoints.purge.query?.safeParse({ purge: true }).success).toBe(false);
    expect(CharacterAdminEndpoints.purge.query?.safeParse({}).success).toBe(false);
  });
});
