/**
 * 3.8：帮助与反馈、投诉（总经理 10-14 总对照表 Q9，节点 T4.10.8「帮助与反馈」、资料页 / 广场作品「投诉」）。数据归 support。
 *
 * 流程：用户提交反馈（类型 + 文字 + 最多 9 张截图 + 可选关联会话 / 角色）或投诉（对象 = 角色 / 广场作品 + 原因 + 文字 + 截图），
 * 状态 open；管理员回复（replied，可同时标记解决）或直接标记已解决（resolved）；用户可以在未解决时补充说明（回到 open）。
 * 管理员每次回复 / 标记解决：置用户红点（unseen）、发 data.changed(support)，并推送一条系统通知（deepLink /support/tickets/{id}）。
 * 截图先用 POST /media 上传，purpose = support_image（只有上传者本人可读；管理员经详情取短期链接）。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';

export const SupportTicketKind = z.enum(['feedback', 'complaint']);
export type SupportTicketKind = z.infer<typeof SupportTicketKind>;

/** 反馈类型。 */
export const FeedbackCategory = z.enum([
  'bug', // 功能异常
  'suggestion', // 产品建议
  'character', // 角色表现（不像、说错话等）
  'billing', // 积分与充值
  'account', // 账号与登录
  'other',
]);
export type FeedbackCategory = z.infer<typeof FeedbackCategory>;

/** 投诉对象。character = 角色（预设角色 / 自定义角色）；plaza_work = 人设广场作品。 */
export const ComplaintTargetType = z.enum(['character', 'plaza_work']);
export type ComplaintTargetType = z.infer<typeof ComplaintTargetType>;

export const ComplaintReason = z.enum([
  'inappropriate', // 内容低俗、不适
  'harassment', // 辱骂、骚扰
  'infringement', // 侵权（冒用作品、肖像）
  'real_person', // 冒充身边真人
  'minor', // 涉及未成年人不当内容
  'fraud', // 诈骗、引流
  'other',
]);
export type ComplaintReason = z.infer<typeof ComplaintReason>;

export const SupportTicketStatus = z.enum(['open', 'replied', 'resolved']);
export type SupportTicketStatus = z.infer<typeof SupportTicketStatus>;

export const SUPPORT_MAX_IMAGES = 9 as const;

export const SupportImage = z.object({
  mediaId: Id,
  /** 短期访问链接；图片已删除时为 null。 */
  url: z.url().nullable(),
});

export const SupportReply = z.object({
  replyId: Id,
  /** admin = 官方回复；user = 用户补充说明。 */
  from: z.enum(['admin', 'user']),
  text: z.string().max(2000),
  createdAt: Timestamp,
});
export type SupportReply = z.infer<typeof SupportReply>;

export const SupportTicket = z.object({
  ticketId: Id,
  kind: tolerantEnum(SupportTicketKind),
  /** 反馈类型；投诉为 null。 */
  category: tolerantEnum(FeedbackCategory).nullable(),
  /** 投诉对象；反馈为 null。 */
  target: z.object({ type: tolerantEnum(ComplaintTargetType), id: Id }).nullable(),
  /** 投诉原因；反馈为 null。 */
  reason: tolerantEnum(ComplaintReason).nullable(),
  text: z.string().max(2000),
  images: z.array(SupportImage).max(SUPPORT_MAX_IMAGES),
  /** 关联的会话 / 角色（反馈时可选）。 */
  conversationId: Id.nullable(),
  characterId: Id.nullable(),
  status: tolerantEnum(SupportTicketStatus),
  /** 回复与补充说明（最早在前）。 */
  replies: z.array(SupportReply),
  /** 官方回复 / 处理后我还没看过（红点）。 */
  unseen: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});
export type SupportTicket = z.infer<typeof SupportTicket>;

export const CreateSupportTicket = z.object({
  /** 客户端生成的幂等键：同一键重复提交返回同一工单。 */
  clientRequestId: Id,
  kind: SupportTicketKind,
  /** kind = feedback 时必填。 */
  category: FeedbackCategory.optional(),
  /** kind = complaint 时必填。 */
  target: z.object({ type: ComplaintTargetType, id: Id }).optional(),
  /** kind = complaint 时必填。 */
  reason: ComplaintReason.optional(),
  /** 投诉可以只选原因不写字（服务器填原因名）；反馈至少 1 个字。 */
  text: z.string().trim().max(2000).default(''),
  imageIds: z.array(Id).max(SUPPORT_MAX_IMAGES).optional(),
  conversationId: Id.nullable().optional(),
  characterId: Id.nullable().optional(),
});

const TicketParams = z.object({ ticketId: Id });

export const SupportEndpoints = {
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/support/tickets`,
    auth: 'user',
    body: CreateSupportTicket,
    response: SupportTicket,
    summary:
      '3.8：提交反馈或投诉（clientRequestId 幂等）。反馈缺 category / 文字、投诉缺 target / reason、' +
      '截图不是本人上传的 support_image 时 400 bad_request；同一用户 24 小时内最多 20 条，超过 429 rate_limited',
  }),
  listMine: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/support/tickets`,
    auth: 'user',
    query: z.object({
      kind: SupportTicketKind.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(SupportTicket).extend({
      /** 有官方回复 / 处理后还没看过的条数（「帮助与反馈」入口红点）。 */
      unseenCount: z.number().int().nonnegative(),
    }),
    summary: '3.8：我的反馈与投诉（最新在前）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/support/tickets/:ticketId`,
    auth: 'user',
    params: TicketParams,
    response: SupportTicket,
    summary: '3.8：详情；查看后清除该条红点（发 data.changed(support)）',
  }),
  addReply: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/support/tickets/:ticketId/replies`,
    auth: 'user',
    params: TicketParams,
    body: z.object({ text: z.string().trim().min(1).max(2000) }),
    response: SupportTicket,
    summary: '3.8：补充说明（状态回到 open）；已解决的 409 conflict；每条最多 40 条往来',
  }),
  markAllSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/support/tickets/seen`,
    auth: 'user',
    response: NoContent,
    summary: '3.8：打开「我的反馈」列表后清除全部红点',
  }),
} as const;

// ---------- 管理端 ----------

export const AdminSupportTicket = SupportTicket.extend({
  userId: Id,
  /** 提交人用户名（后台展示）；账号已注销为 null。 */
  username: z.string().nullable(),
  /** 最近处理的管理员。 */
  handledBy: Id.nullable(),
});
export type AdminSupportTicket = z.infer<typeof AdminSupportTicket>;

export const SupportAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/support/tickets`,
    auth: 'admin',
    query: z.object({
      kind: SupportTicketKind.optional(),
      status: SupportTicketStatus.optional(),
      userId: Id.optional(),
      /** 投诉对象（例：看某个角色收到的全部投诉）。 */
      targetId: Id.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: cursorPage(AdminSupportTicket).extend({
      /** 待处理（open）总数，后台菜单红点。 */
      openCount: z.number().int().nonnegative(),
    }),
    summary: '3.8：反馈与投诉列表（status = open 时最早在前，其余最新在前）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/support/tickets/:ticketId`,
    auth: 'admin',
    params: TicketParams,
    response: AdminSupportTicket,
    summary: '3.8：详情（截图带短期链接）',
  }),
  reply: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/support/tickets/:ticketId/reply`,
    auth: 'admin',
    params: TicketParams,
    body: z.object({
      text: z.string().trim().min(1).max(2000),
      /** 同时标记已解决。 */
      resolve: z.boolean().default(false),
    }),
    response: AdminSupportTicket,
    summary: '3.8：回复（open → replied，resolve = true 时 → resolved）；通知用户；写审计',
  }),
  resolve: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/support/tickets/:ticketId/resolve`,
    auth: 'admin',
    params: TicketParams,
    response: AdminSupportTicket,
    summary: '3.8：标记已解决（已解决再标记幂等）；通知用户；写审计',
  }),
  reopen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/support/tickets/:ticketId/reopen`,
    auth: 'admin',
    params: TicketParams,
    response: AdminSupportTicket,
    summary: '3.8：重新打开（resolved → open，不通知用户）；写审计',
  }),
} as const;

// ---------- 3.9：设置 › 插件（总对照表 Q10，节点 T4.10.9） ----------

/** 插件。目前只有外部渠道接入（真微信 / QQ / 微博），都还没开放；真正的接入在下一张任务卡做。 */
export const PluginId = z.enum(['wechat', 'qq', 'weibo']);
export type PluginId = z.infer<typeof PluginId>;

/** coming_soon = 即将推出（点了提示）；available = 可以开启；enabled = 已开启。 */
export const PluginStatus = z.enum(['coming_soon', 'available', 'enabled']);

export const Plugin = z.object({
  pluginId: tolerantEnum(PluginId),
  name: z.string().max(20),
  description: z.string().max(100),
  status: tolerantEnum(PluginStatus),
});
export type Plugin = z.infer<typeof Plugin>;

export const PluginEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plugins`,
    auth: 'user',
    response: z.object({ items: z.array(Plugin) }),
    summary: '3.9：设置 › 插件列表（微信 / QQ / 微博接入，目前都是 coming_soon）',
  }),
} as const;
