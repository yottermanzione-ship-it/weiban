/**
 * 10-25（会员 v6）：群聊是 PRO+ 权益。
 *
 * 需要 PRO+：
 * - 用户「发起群聊」（POST /groups）；
 * - 在群聊里发**新消息**：文字 / 语音 / 表情 / 图片 / 拍一拍（都走 ChatUserService.sendMessage），
 *   以及把消息转发进群（ChatForwardService.forward 的目标会话）。
 *
 * 不需要 PRO+（免费用户仍然可用）：
 * - 查看已存在群聊的历史消息、会话列表、群信息、成员与图片 / 语音；
 * - 已迁移的旧群不做任何数据变更，只是对免费用户变成「只读」。
 *
 * 角色自己拉群（ai-runtime 经 ChatGroupAdminPort.createGroupConversation，createdByCharacterId 非空）
 * 不走这里：那是 AI 陪伴路径，而且旧数据迁移 / 角色拉群不该被会员规则拦掉；这类群对免费用户同样是只读。
 *
 * 「是否 PRO+」统一用身份模块的 IdentityMembershipReadPort.isProPlus（不自己查 identity 表），
 * 传事务时和其他读取在同一个事务里，避免先查后写之间的档位漂移。
 */
import type { IdentityMembershipReadPort, Tx } from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';

/** 权益标识，放在 details.benefit 里，客户端按它引导开通（不解析 message）。 */
export const GROUP_CHAT_BENEFIT = 'group_chat';

export type GroupChatAction = 'create_group' | 'send_group_message';

const MESSAGE: Record<GroupChatAction, string> = {
  create_group: '群聊是 PRO+ 会员权益，开通后即可发起群聊',
  send_group_message: '群聊是 PRO+ 会员权益，开通后可以在群里发言（历史消息仍可查看）',
};

/** 不是 PRO+ 就抛 403 membership_required（details 指出是哪一项权益、哪个动作）。 */
export async function assertGroupChatEligible(
  membership: IdentityMembershipReadPort,
  userId: string,
  action: GroupChatAction,
  tx?: Tx,
): Promise<void> {
  if (await membership.isProPlus(userId, tx)) return;
  throw new AppError('membership_required', MESSAGE[action], {
    details: { benefit: GROUP_CHAT_BENEFIT, action, requiredTier: 'pro_plus' },
  });
}
