import 'reflect-metadata';
import { expect, it } from 'vitest';
import type { Conversation } from '@weiban/contracts';
import { CallService } from './calls.js';

/** H2（契约 3.28）：私密模式只开放文字与图片——通话入口给出 private_mode，拨打被拒。 */
function service(scope: 'normal' | 'adult') {
  const conversation = {
    conversationId: '00000000-0000-4000-8000-000000000001',
    contentScope: scope,
  } as unknown as Conversation;
  const unused = new Proxy({}, { get: () => () => Promise.reject(new Error('unused')) });
  const db = {
    db: {
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
  const svc = new CallService(
    db as never,
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    unused as never, // purgeRegistry（33480b0 新增）
    unused as never,
    { findDirectConversation: async () => conversation } as never,
    unused as never,
    { getActiveContact: async () => ({ characterId: 'c', conversationId: 'x' }) } as never,
    {
      getSpendStatus: async () => ({ depleted: false, insufficient: false, availableMicros: 100 }),
    } as never,
    {} as never,
    { isVoiceCallEnabled: async () => true } as never,
  );
  return svc;
}

it('私密模式：通话入口返回 private_mode，日常照常', async () => {
  expect(await service('adult').availability('00000000-0000-4000-8000-000000000002', 'c')).toEqual({
    available: false,
    reason: 'private_mode',
  });
  const normal = service('normal');
  // 日常范围不因私密规则被拦（后面查进行中的通话等）
  (normal as unknown as { getActiveCall: () => Promise<null> }).getActiveCall = async () => null;
  expect(await normal.availability('00000000-0000-4000-8000-000000000002', 'c')).toEqual({
    available: true,
    reason: null,
  });
});

it('私密模式：发起通话被拒（private_mode_unsupported）', async () => {
  await expect(
    service('adult').startCall('00000000-0000-4000-8000-000000000002', {
      characterId: 'c',
      clientRequestId: 'r',
    }),
  ).rejects.toMatchObject({ code: 'private_mode_unsupported', status: 422 });
});
