/**
 * 微信 / QQ / 微博接入的权限判定。
 *
 * - 显式 PUBLIC_ACCESS=1 的渠道向已登录免费账号开放；鉴权、归属与聊天积分计费不变。
 * - 未公开的内测模式保留原规则：发起绑定、查扫码状态、换出口角色、提交凭据需 PRO+（403 membership_required，
 *   details.benefit = 'external_channel'，客户端据此引导开通，不解析 message）。
 * - **解绑与查看状态不需要 PRO+**：会员到期后仍必须能解绑，也仍要能看到当前绑定。
 * - 用身份模块的 IdentityMembershipReadPort.isProPlus 统一判断，不自己读会员表；
 *   传事务时和其他读写落在同一个事务里，避免先查后写之间档位漂移。
 */
import type { ChannelId, IdentityMembershipReadPort, Tx } from '@weiban/contracts';
import { AppError, type AppConfig } from '../../../platform/index.js';
import { isChannelPublic } from './channel-config.js';

/** Public channels are available to free accounts too; authentication, ownership and billing stay separate. */
export async function hasChannelAccess(
  config: AppConfig,
  channel: ChannelId,
  membership: IdentityMembershipReadPort,
  userId: string,
  tx?: Tx,
): Promise<boolean> {
  return isChannelPublic(config, channel) || membership.isProPlus(userId, tx);
}

export async function assertChannelAccess(
  config: AppConfig,
  channel: ChannelId,
  membership: IdentityMembershipReadPort,
  userId: string,
  action: 'bind' | 'new_qr' | 'switch_character',
  tx?: Tx,
): Promise<void> {
  if (isChannelPublic(config, channel)) return;
  return assertChannelProPlus(membership, userId, action, tx);
}

export const CHANNEL_BENEFIT = 'external_channel';

export async function assertChannelProPlus(
  membership: IdentityMembershipReadPort,
  userId: string,
  action: 'bind' | 'new_qr' | 'switch_character',
  tx?: Tx,
): Promise<void> {
  if (await membership.isProPlus(userId, tx)) return;
  const messages = {
    bind: '微信 / 微博接入是 PRO+ 会员权益，开通后可以把角色接到微信、微博里',
    new_qr: '微信接入是 PRO+ 会员权益，开通后才能生成绑定二维码',
    switch_character: '微信 / 微博接入是 PRO+ 会员权益，开通后才能切换出口角色',
  } as const;
  throw new AppError('membership_required', messages[action], {
    details: { benefit: CHANNEL_BENEFIT, action, requiredTier: 'pro_plus' },
  });
}
