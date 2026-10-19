/** 3.15：真实会员档位基础；不代表支付或完整权益已实现。 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, cursorPage, defineEndpoint } from '../common.js';
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

// ---------- 3.17：会员 v5（docs/refactor/16-membership-v5.md §3、§7） ----------

/** 只有一个会员档 PRO+，按时长分月卡 / 季卡 / 年卡。 */
export const MembershipPlanId = z.enum(['month', 'quarter', 'year']);
export type MembershipPlanId = z.infer<typeof MembershipPlanId>;

export const MembershipPlan = z.object({
  planId: MembershipPlanId,
  /** 展示名，例「月卡」。 */
  name: z.string().trim().min(1).max(10),
  /** 时长（自然月数）：月卡 1、季卡 3、年卡 12。续期从当前到期时间往后叠加。 */
  months: z.number().int().min(1).max(36),
  /** 原价（分）。 */
  priceFen: z.number().int().min(0).max(10_000_000),
  /** 首次开通价（分）；每人限一次，任一档用过就不再有。 */
  firstPriceFen: z.number().int().min(0).max(10_000_000),
  /** 开通即一次性赠送的积分（永久有效，扣费先扣赠送）。首次价同样送足额。 */
  bonusPoints: z.number().int().min(0).max(10_000_000),
});
export type MembershipPlan = z.infer<typeof MembershipPlan>;

/** 后台「会员与订单」配置。存 billing 设置，管理员可改。 */
export const MembershipSettings = z.object({
  /** 固定三档，按 month / quarter / year 顺序。 */
  plans: z.array(MembershipPlan).length(3),
  /** 用户端「联系管理员开通」说明。 */
  contactHint: z.string().trim().max(200),
  /** 新用户注册一次性赠送积分（赠送积分，永久有效）；默认 0 = 不送。 */
  signupBonusPoints: z.number().int().min(0).max(1_000_000),
});
export type MembershipSettings = z.infer<typeof MembershipSettings>;

/** 用户端会员页：价格、首次价是否还可用、当前会员状态。现阶段无在线支付。 */
export const MembershipOffer = z.object({
  plans: z.array(MembershipPlan),
  firstPurchaseAvailable: z.boolean(),
  paymentEnabled: z.literal(false),
  contactHint: z.string(),
  membership: Membership,
});
export type MembershipOffer = z.infer<typeof MembershipOffer>;

export const MembershipOrder = z.object({
  orderId: Id,
  userId: Id,
  planId: MembershipPlanId,
  /** 本单价格（分）。 */
  priceFen: z.number().int().nonnegative(),
  /** 当时原价（分）。 */
  listPriceFen: z.number().int().nonnegative(),
  firstPurchase: z.boolean(),
  bonusPoints: z.number().int().nonnegative(),
  /** 本单生效区间（续期时 startsAt = 原到期时间）。 */
  startsAt: Timestamp,
  endsAt: Timestamp,
  operatorUserId: Id.nullable(),
  note: z.string().nullable(),
  createdAt: Timestamp,
});
export type MembershipOrder = z.infer<typeof MembershipOrder>;

export const CreateMembershipOrder = z
  .object({
    /** 后台生成的幂等键：重复提交返回同一订单，不重复发积分。 */
    clientOrderId: Id,
    userId: Id,
    planId: MembershipPlanId,
    /** 默认 true：用户还没用过首次价就按首次价；false = 按原价（例：用户已线下按原价付款）。 */
    useFirstPrice: z.boolean().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const MembershipOfferEndpoints = {
  getOffer: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/me/membership/offer',
    auth: 'user',
    response: MembershipOffer,
    summary: '3.17：PRO+ 价格、首次价是否可用、当前会员状态；无在线支付，提示联系管理员开通',
  }),
} as const;

export const MembershipOrderAdminEndpoints = {
  getSettings: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/admin/membership/settings',
    auth: 'admin',
    response: MembershipSettings,
    summary: '3.17：会员档位价格 / 赠送积分、联系说明、注册赠送积分',
  }),
  updateSettings: defineEndpoint({
    method: 'PUT',
    path: API_PREFIX + '/admin/membership/settings',
    auth: 'admin',
    body: MembershipSettings,
    response: MembershipSettings,
    summary: '3.17：修改会员配置（写审计）',
  }),
  listOrders: defineEndpoint({
    method: 'GET',
    path: API_PREFIX + '/admin/membership/orders',
    auth: 'admin',
    query: z.object({
      userId: Id.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    response: cursorPage(MembershipOrder),
    summary: '3.17：开通订单列表（新到旧，可按用户筛选）',
  }),
  createOrder: defineEndpoint({
    method: 'POST',
    path: API_PREFIX + '/admin/membership/orders',
    auth: 'admin',
    body: CreateMembershipOrder,
    response: z.object({ order: MembershipOrder, membership: Membership }),
    summary:
      '3.17：管理员替用户开通 / 续期 PRO+：记订单（价格、是否首次），到期时间叠加，一次性发赠送积分（同一事务，幂等）',
  }),
} as const;
