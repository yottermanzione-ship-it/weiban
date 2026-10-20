/**
 * 3.21（10-20 批 E2）：后台「用户列表」—— 账号资料、会员状态、封禁与删除、会员概况。
 * 余额 / 流水仍在 BillingAdminEndpoints（按 userId 合并展示）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const AdminUserBan = z.object({
  bannedAt: Timestamp,
  reason: z.string(),
  operatorUserId: Id.nullable(),
});

export const AdminUserSummary = z.object({
  userId: Id,
  /** 当前登录名（改过登录名时为新名字）。 */
  username: z.string(),
  nickname: z.string().nullable(),
  role: z.enum(['user', 'admin']),
  /** deleting = 注销中（已下线、不能登录，各模块删除完毕后整行删除）。 */
  status: z.enum(['active', 'deleting']),
  createdAt: Timestamp,
  lastActiveAt: Timestamp.nullable(),
  /** 封禁中为对象，未封禁为 null。封禁的账号不能登录，已登录的设备全部下线。 */
  ban: AdminUserBan.nullable(),
  membership: z.object({
    tier: z.enum(['free', 'pro_plus']),
    expiresAt: Timestamp.nullable(),
  }),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

export const AdminUserOverview = z.object({
  /** 状态为 active 的账号数（不含注销中）。 */
  totalUsers: z.number().int().nonnegative(),
  /** 当前有效的 PRO+ 会员数。 */
  proPlusUsers: z.number().int().nonnegative(),
  /** 7 天内到期的 PRO+ 会员（按到期时间从早到晚）。 */
  expiringSoon: z.array(
    z.object({
      userId: Id,
      username: z.string(),
      nickname: z.string().nullable(),
      expiresAt: Timestamp,
    }),
  ),
});
export type AdminUserOverview = z.infer<typeof AdminUserOverview>;

export const BanUserRequest = z.object({ reason: z.string().trim().min(2).max(200) }).strict();

export const AdminDeleteUserRequest = z
  .object({
    /** 二次确认：必须填该账号的登录名（不区分大小写）。 */
    confirmUsername: z.string().trim().min(1).max(64),
    reason: z.string().trim().min(2).max(200),
  })
  .strict();

export const AdminUsersEndpoints = {
  listUsers: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/admin/users',
    auth: 'admin',
    response: z.object({ items: z.array(AdminUserSummary) }),
    summary: '3.21：全部账号（含注销中）的资料、会员、封禁状态；注册时间新到旧',
  }),
  overview: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/admin/users/overview',
    auth: 'admin',
    response: AdminUserOverview,
    summary: '3.21：总用户数、PRO+ 会员数、7 天内到期名单',
  }),
  banUser: defineEndpoint({
    method: 'POST',
    path: API_PREFIX + '/admin/users/:userId/ban',
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: BanUserRequest,
    response: AdminUserSummary,
    summary:
      '3.21：封禁账号（不能登录、全部设备下线；数据保留，可解封）。管理员账号不能封禁（403）；写审计',
  }),
  unbanUser: defineEndpoint({
    method: 'POST',
    path: API_PREFIX + '/admin/users/:userId/unban',
    auth: 'admin',
    params: z.object({ userId: Id }),
    response: AdminUserSummary,
    summary: '3.21：解除封禁；写审计',
  }),
  deleteUser: defineEndpoint({
    method: 'POST',
    path: API_PREFIX + '/admin/users/:userId/deletion',
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: AdminDeleteUserRequest,
    response: z.object({ status: z.literal('deleting') }),
    summary:
      '3.21：管理员替用户注销账号，走与用户自助注销相同的删除流程（不可撤销）。登录名不符 400；管理员账号 403；写审计',
  }),
} as const;
