/**
 * 3.5：角色创建 › 申请制作（总经理 10-14 裁定 2.3；旧版「用户申请角色 → 后台制作 → 通过」，01-old-weiban-review 第 6 项）。
 * 数据归 plaza（角色广场与角色创建同属一个入口）。
 *
 * 流程：用户提交申请（pending）→ 管理员接单（in_progress，可多次填写进度）→ 完成（completed，关联一个已上架的角色，
 * 默认自动走添加流程加到该用户通讯录）或拒绝（rejected，留言必填）。用户在 pending 时可撤回（cancelled）。
 * 每次状态变化：写申请留言、发 data.changed(role_requests) 刷新红点，并推送一条系统通知（deepLink /role-requests/{id}）。
 *
 * 扣积分（3.8，总对照表 Q5）：免费次数内不冻结；超额固定200积分（2 元），与申请在同事务冻结（可用积分不足 422 insufficient_balance），
 * 完成时扣除（pointsCharged = pointsCost，积分明细里一条分类 service 的扣费），被拒或撤回时退回（pointsCharged = 0）。
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
import { CharacterBasis } from './characters.js';

export const RoleRequestStatus = z.enum([
  'pending',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
]);
export type RoleRequestStatus = z.infer<typeof RoleRequestStatus>;

/** 参考图上限（张）。图片先用 POST /media 上传，purpose = role_request_image。 */
export const ROLE_REQUEST_MAX_IMAGES = 9 as const;

export const RoleRequestImage = z.object({
  mediaId: Id,
  /** 短期访问链接；图片已删除时为 null。 */
  url: z.url().nullable(),
});

export const RoleRequest = z.object({
  requestId: Id,
  /** 想要的角色名。 */
  roleName: z.string().max(32),
  /** 类型：真人 / 虚构 / 原创；用户不确定时为 null。 */
  basis: tolerantEnum(CharacterBasis).nullable(),
  /** 分类（角色广场分类 categoryId，见 CharacterEndpoints.listCategories）；null 表示未选。 */
  categoryId: z.string().max(40).nullable(),
  /** 出处 / 作品名（例「原神」「某电视剧」）。 */
  sourceWork: z.string().max(60),
  /** 参考资料文字（人物介绍、性格、说话方式、链接等）。 */
  referenceText: z.string().max(3000),
  referenceImages: z.array(RoleRequestImage).max(ROLE_REQUEST_MAX_IMAGES),
  /** 补充说明。 */
  note: z.string().max(500),
  status: tolerantEnum(RoleRequestStatus),
  /** 管理员最新留言（接单说明、进度、完成说明、拒绝原因）；没有为 null。 */
  adminMessage: z.string().max(500).nullable(),
  /** 完成时关联的角色；其余状态为 null。 */
  characterId: Id.nullable(),
  /** 完成时是否已自动加入通讯录（false 表示需要用户自己点「添加」，例如通讯录已满）。 */
  addedToContacts: z.boolean(),
  /** 提交时的制作价格（积分）；0 表示免费。 */
  pointsCost: z.number().int().nonnegative(),
  /** 3.15：本申请成功提交时占一次免费名额；拒绝/撤回不退次数。旧数据缺省false。 */
  freeQuotaApplied: z.boolean().optional(),
  /** 实际扣除的积分：完成后 = pointsCost；未完成、被拒、撤回为 0。 */
  pointsCharged: z.number().int().nonnegative(),
  /** 状态变化后我还没看过（红点）。 */
  unseen: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type RoleRequest = z.infer<typeof RoleRequest>;

export const RoleRequestConfig = z.object({
  /** 是否开放申请；关闭时提交返回 403 forbidden。 */
  enabled: z.boolean(),
  /** 超额固定200积分；免费按quota判断。后台提交非200会拒绝，提交冻结、完成扣、拒绝撤回退款。 */
  pointsCost: z.number().int().nonnegative().max(1_000_000),
  /** 同一用户同时未完成（pending + in_progress）的申请上限。 */
  maxOpenPerUser: z.number().int().min(1).max(50),
});
export type RoleRequestConfig = z.infer<typeof RoleRequestConfig>;

export const RoleRequestQuota = z.object({
  quotedAt: Timestamp,
  tier: z.enum(['free', 'pro_plus']),
  limit: z.literal(5),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  nextPointsCost: z.union([z.literal(0), z.literal(200)]),
  periodStart: Timestamp,
  periodEnd: Timestamp,
  timeZone: z.literal('Asia/Shanghai'),
});
export type RoleRequestQuota = z.infer<typeof RoleRequestQuota>;
export const CreateRoleRequest = z.object({
  /** 客户端生成的幂等键：同一键重复提交返回同一申请。 */
  clientRequestId: Id,
  /** 3.15：确认本次0/200积分；旧客户端需要收费时必须更新确认，不偷偷冻结。 */
  expectedPointsCost: z.union([z.literal(0), z.literal(200)]).optional(),
  roleName: z.string().trim().min(1).max(32),
  basis: CharacterBasis.nullable().optional(),
  categoryId: z.string().max(40).nullable().optional(),
  sourceWork: z.string().trim().max(60).optional(),
  referenceText: z.string().trim().max(3000).optional(),
  referenceImageIds: z.array(Id).max(ROLE_REQUEST_MAX_IMAGES).optional(),
  note: z.string().trim().max(500).optional(),
});

const RequestParams = z.object({ requestId: Id });

export const RoleRequestEndpoints = {
  getConfig: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/role-requests/config`,
    auth: 'user',
    response: RoleRequestConfig.extend({ quota: RoleRequestQuota }),
    summary: '3.15：真实会员/本期免费次数/0或200积分报价，周期固定北京时间自然月或周一自然周',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/role-requests`,
    auth: 'user',
    body: CreateRoleRequest,
    response: RoleRequest,
    summary:
      '3.5：提交角色制作申请（clientRequestId 幂等）。未开放 403 forbidden；未完成申请达上限 409 conflict；' +
      '3.8：可用积分不足 422 insufficient_balance（details.pointsCost），成功时冻结 pointsCost 积分；' +
      '参考图不是本人上传的 role_request_image 时 400 bad_request',
  }),
  listMine: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/role-requests`,
    auth: 'user',
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(RoleRequest).extend({
      /** 状态变化后还没看过的申请数（「角色创建」入口红点）。 */
      unseenCount: z.number().int().nonnegative(),
    }),
    summary: '3.5：我的制作申请（最新在前）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/role-requests/:requestId`,
    auth: 'user',
    params: RequestParams,
    response: RoleRequest,
    summary: '3.5：申请详情；查看后清除该申请的红点（发 data.changed(role_requests)）',
  }),
  cancel: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/role-requests/:requestId/cancel`,
    auth: 'user',
    params: RequestParams,
    response: RoleRequest,
    summary:
      '3.5：撤回申请（只有 pending 可撤回，否则 409 conflict；已撤回再撤回幂等）；3.8：退回冻结的积分',
  }),
  markAllSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/role-requests/seen`,
    auth: 'user',
    response: NoContent,
    summary: '3.5：打开「我的申请」列表后清除全部红点',
  }),
} as const;

// ---------- 管理端 ----------

export const AdminRoleRequest = RoleRequest.extend({
  userId: Id,
  /** 申请人用户名（登录名，后台展示用）；账号已注销为 null。 */
  username: z.string().nullable(),
  /** 处理的管理员（接单后）。 */
  handledBy: Id.nullable(),
  /** 历次留言与状态变化（最早在前）。 */
  history: z.array(
    z.object({
      status: tolerantEnum(RoleRequestStatus),
      message: z.string().max(500).nullable(),
      at: Timestamp,
    }),
  ),
});
export type AdminRoleRequest = z.infer<typeof AdminRoleRequest>;

const AdminMessage = z.object({ message: z.string().trim().max(500).optional() });

export const RoleRequestAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/role-requests`,
    auth: 'admin',
    query: z.object({
      status: RoleRequestStatus.optional(),
      userId: Id.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: cursorPage(AdminRoleRequest).extend({
      /** 待处理（pending）总数，后台菜单红点。 */
      pendingCount: z.number().int().nonnegative(),
    }),
    summary: '3.5：制作申请列表（pending 最早在前，其余最新在前）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/role-requests/:requestId`,
    auth: 'admin',
    params: RequestParams,
    response: AdminRoleRequest,
    summary: '3.5：申请详情（参考图带短期链接）',
  }),
  accept: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/role-requests/:requestId/accept`,
    auth: 'admin',
    params: RequestParams,
    body: AdminMessage,
    response: AdminRoleRequest,
    summary: '3.5：接单（pending → in_progress）；通知用户；写审计。已是 in_progress 时幂等',
  }),
  progress: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/role-requests/:requestId/progress`,
    auth: 'admin',
    params: RequestParams,
    body: z.object({ message: z.string().trim().min(1).max(500) }),
    response: AdminRoleRequest,
    summary: '3.5：填写制作进度（pending 自动转 in_progress）；通知用户',
  }),
  complete: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/role-requests/:requestId/complete`,
    auth: 'admin',
    params: RequestParams,
    body: z.object({
      /** 已在角色库建好并上架的预设角色。 */
      characterId: Id,
      message: z.string().trim().max(500).optional(),
      /** 默认 true：走添加流程自动加到该用户通讯录（P-26 上限满时不加，用户收到通知后自己添加）。 */
      addToContacts: z.boolean().default(true),
    }),
    response: AdminRoleRequest,
    summary:
      '3.5：完成并关联角色（角色不存在或未上架 422 character_not_available）；通知用户；写审计。已完成再提交同一角色幂等；' +
      '3.8：扣除冻结的积分',
  }),
  reject: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/role-requests/:requestId/reject`,
    auth: 'admin',
    params: RequestParams,
    body: z.object({ message: z.string().trim().min(1).max(500) }),
    response: AdminRoleRequest,
    summary: '3.5：拒绝（原因必填，展示给用户）；通知用户；写审计；3.8：退回冻结的积分',
  }),
  getConfig: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/role-requests/config`,
    auth: 'admin',
    response: RoleRequestConfig,
    summary: '3.5：申请制作配置',
  }),
  updateConfig: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/role-requests/config`,
    auth: 'admin',
    body: RoleRequestConfig,
    response: RoleRequestConfig,
    summary: '3.15：修改开放/未完成上限；超额价格固定200，拒绝其它价格；写审计',
  }),
} as const;
