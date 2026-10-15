/** 3.15：真实会员档位基础；不代表支付或完整权益已实现。 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';
export const Membership = z.object({
  /** 服务端取得账号锁后的统一核算时刻，内部额度决策复用。 */
  checkedAt: Timestamp,
  tier: z.enum(['free', 'pro_plus']),
  expiresAt: Timestamp.nullable(),
  updatedAt: Timestamp.nullable(),
});
export type Membership = z.infer<typeof Membership>;
export const SetMembership = z.object({ expiresAt: Timestamp.nullable() }).strict();
export const MembershipEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/me/membership',
    auth: 'user',
    response: Membership,
    summary: '3.15：本人真实会员档位/到期；到期自动视为Free',
  }),
} as const;
export const MembershipAdminEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/admin/users/:userId/membership',
    auth: 'admin',
    params: z.object({ userId: Id }),
    response: Membership,
    summary: '3.15：查询用户真实会员档位',
  }),
  set: defineEndpoint({
    method: 'PUT',
    path: API_PREFIX + '/admin/users/:userId/membership',
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: SetMembership,
    response: Membership,
    summary: '3.15：管理员授予PRO+到期时间/null撤销，审计和profile同步；不记支付/积分',
  }),
} as const;
