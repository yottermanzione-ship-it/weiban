/**
 * 「这条入站消息是不是这条绑定对面那个人发的？」
 *
 * 唯一规则：入站 sender 必须**等于绑定时由协议确认下来的对面账号 id**，否则一律拒绝（旧版叫 foreign_sender）。
 * 不允许任何「最后发消息的人就是主人」的学习式绑定：
 * - 微信：扫码确认时拿到的 ilink_user_id 就是对面账号，可信。
 * - 微博：ws_token 只能证明「AppID / AppSecret → bot 自己的 uid」，**证明不了「私信你的是谁」**。
 *   所以微博目前没有可信的对面账号，任何 sender 都不匹配 → 入站全拒；
 *   微博通道也因此在 channel-config 里固定按「未联调」处理，绝不假装已打通。
 *
 * 这条判断必须只由这一处实现：渠道不同、以后协议换了，都改这里，不要在调用点另写一套。
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
