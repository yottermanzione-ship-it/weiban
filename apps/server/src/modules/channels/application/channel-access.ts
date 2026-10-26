/**
 * 微信 / 微博接入的权限判定（2026-10-25 补的服务端校验）。
 *
 * - 发起绑定、查扫码状态、换出口角色、提交微博凭据 = **PRO+ 权益**（403 membership_required，
 *   details.benefit = 'external_channel'，客户端据此引导开通，不解析 message）。
 * - **解绑与查看状态不需要 PRO+**：会员到期后仍必须能解绑，也仍要能看到当前绑定。
 * - 用身份模块的 IdentityMembershipReadPort.isProPlus 统一判断，不自己读会员表；
 *   传事务时和其他读写落在同一个事务里，避免先查后写之间档位漂移。
 */
import type { IdentityMembershipReadPort, Tx } from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';

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
