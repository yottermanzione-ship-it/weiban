import 'reflect-metadata';
import { expect, it } from 'vitest';
import type { Conversation } from '@weiban/contracts';
import { CallService } from './calls.js';

/** H2（契约 3.28）：私密模式只开放文字与图片——通话入口给出 private_mode，拨打被拒。 */
function service(scope: 'normal' | 'adult', blocker?: () => Promise<string | null>) {
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
    { isVoiceCallEnabled: async () => true, voiceCallBlocker: blocker } as never,
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

it('V2：实时电话没有可用声音 → 拨打前就拒绝并带明确提示，来电也不发起', async () => {
  const hint = '这个角色还没有能用于实时通话的声音';
  const blocked = service('normal', async () => hint);
  await expect(
    blocked.startCall('00000000-0000-4000-8000-000000000002', {
      characterId: 'c',
      clientRequestId: 'r',
    }),
  ).rejects.toMatchObject({ code: 'service_disabled', message: hint, status: 422 });
  expect(
    await blocked.startIncomingCall({
      userId: '00000000-0000-4000-8000-000000000002',
      characterId: 'c',
      reason: '想你了',
      idempotencyKey: 'k',
    }),
  ).toEqual({ ok: false, error: 'service_disabled' });
});

it('V2：声音检查本身出错不拦拨打（接通时仍有兜底）', async () => {
  const svc = service('normal', () => Promise.reject(new Error('boom')));
  // 走到建档即说明没被声音检查拦下；假建档返回「已有通话」以便断言。
  (svc as unknown as { create: () => Promise<unknown> }).create = async () => ({
    ok: false,
    error: 'busy',
  });
  await expect(
    svc.startCall('00000000-0000-4000-8000-000000000002', {
      characterId: 'c',
      clientRequestId: 'r',
    }),
  ).rejects.toMatchObject({ code: 'call_busy' });
});
