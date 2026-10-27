/**
 * 回信 peer 的相等判定，不负责推断站内主人。
 * 微信 peer 来自扫码协议；微博 peer 来自绑定的助手凭据鉴权连接，并以密文固定。
 * 微博 token.uid 不是此处的入参，任何来信都不能改写绑定的 user_id 或凭据命名空间。
 */
import type { ChannelId } from '@weiban/contracts';

export function isOwnPeer(
  _channel: ChannelId,
  bindingAccountId: string | null | undefined,
  senderId: string | null | undefined,
): boolean {
  const account = String(bindingAccountId ?? '').trim();
  const sender = String(senderId ?? '').trim();
  if (!account || !sender) return false;
  return account === sender;
}
