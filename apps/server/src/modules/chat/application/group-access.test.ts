/**
 * 10-25 会员 v6：群聊只对 PRO+ 开放——创建群聊与在群里发新消息的服务端校验。
 * 免费用户不是被前端挡住，而是这里返回 403 membership_required + details.benefit。
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { IdentityMembershipReadPort } from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';
import { GROUP_CHAT_BENEFIT, assertGroupChatEligible } from './group-access.js';

function membership(pro: boolean, calls: Array<unknown[]> = []): IdentityMembershipReadPort {
  return {
    getMembership: async () => {
      throw new Error('不应在群聊校验里读整条会员信息');
    },
    isProPlus: async (...args: unknown[]) => {
      calls.push(args);
      return pro;
    },
  } as unknown as IdentityMembershipReadPort;
}

async function rejection(pro: boolean, action: 'create_group' | 'send_group_message') {
  try {
    await assertGroupChatEligible(membership(pro), 'user-1', action);
    return null;
  } catch (error) {
    return error as AppError;
  }
}

describe('群聊会员校验', () => {
  it('免费用户发起群聊 → 403 membership_required（指明权益与动作）', async () => {
    const error = await rejection(false, 'create_group');
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe('membership_required');
    expect(error!.status).toBe(403);
    expect(error!.message).toContain('PRO+');
    expect(error!.details).toEqual({
      benefit: GROUP_CHAT_BENEFIT,
      action: 'create_group',
      requiredTier: 'pro_plus',
    });
  });

  it('免费用户在群里发新消息 → 403 membership_required，并说明历史消息仍可看', async () => {
    const error = await rejection(false, 'send_group_message');
    expect(error!.code).toBe('membership_required');
    expect(error!.status).toBe(403);
    expect(error!.details).toMatchObject({ action: 'send_group_message' });
    expect(error!.message).toContain('历史消息');
  });

  it('PRO+ 直接放行，并把事务传给统一会员判断', async () => {
    const calls: unknown[][] = [];
    const tx = { db: {} };
    await expect(
      assertGroupChatEligible(membership(true, calls), 'user-1', 'send_group_message', tx as never),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([['user-1', tx]]);
  });
});
