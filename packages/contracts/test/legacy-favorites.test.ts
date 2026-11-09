import { expect, test } from 'vitest';
import {
  LegacyFavoriteImportRequest,
  LegacyFavoriteSnapshot,
  LegacyFavoritesEndpoints,
} from '../src/http/legacy-favorites.js';

const snapshot = {
  chatKey: '合成角色',
  chatTitle: '合成角色',
  savedAt: 1794182400000,
  message: {
    timestamp: 1794182300000,
    content: '合成收藏',
    type: 'text',
    isMine: false,
    extension: { preserved: true },
  },
};
test('旧毫秒时间戳及扩展字段往返保留，不强行改成新消息序号', () => {
  expect(LegacyFavoriteSnapshot.parse(snapshot)).toEqual(snapshot);
  expect(
    LegacyFavoriteSnapshot.parse({ ...snapshot, message: { ...snapshot.message, timestamp: null } })
      .message.timestamp,
  ).toBeNull();
  expect(LegacyFavoriteSnapshot.parse({ ...snapshot, message: {} }).message).toEqual({});
});
test('导入只接受受限批次与旧账号分区格式', () => {
  const item = { accountKey: 'oldname', itemKey: 'a'.repeat(64), favorite: snapshot };
  expect(LegacyFavoriteImportRequest.safeParse({ items: [item] }).success).toBe(true);
  expect(
    LegacyFavoriteImportRequest.safeParse({ items: Array.from({ length: 26 }, () => item) })
      .success,
  ).toBe(false);
  expect(
    LegacyFavoriteImportRequest.safeParse({ items: [{ ...item, accountKey: '../other' }] }).success,
  ).toBe(false);
  expect(LegacyFavoriteImportRequest.safeParse({ userId: 'someone', items: [item] }).success).toBe(
    false,
  );
});
test('按UTF-8字节限制批次，中文不按单字符误算大小', () => {
  const make = (content: string) => ({
    items: [
      {
        accountKey: 'oldname',
        itemKey: 'a'.repeat(64),
        favorite: { ...snapshot, message: { content } },
      },
    ],
  });
  expect(LegacyFavoriteImportRequest.safeParse(make('汉'.repeat(180000))).success).toBe(false);
  expect(LegacyFavoriteImportRequest.safeParse(make('a'.repeat(180000))).success).toBe(true);
});
test('新接口独立于普通收藏并全部要求用户身份', () => {
  for (const endpoint of Object.values(LegacyFavoritesEndpoints)) {
    expect(endpoint.auth).toBe('user');
    expect(endpoint.path.startsWith('/api/v1/library/legacy-favorites')).toBe(true);
  }
});
