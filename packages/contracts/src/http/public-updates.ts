/**
 * 公开动态管理接口（D-L3-02，PRD SIM-03、ADM-03）。
 *
 * 公开动态 = 真人角色现实中的公开信息（新作品、演唱会和活动行程、获奖等）。
 * 来源两种：管理员手动录入（manual）；系统联网搜索生成的候选（auto_search）。
 * 只有 status = effective 的动态才会被 AI 运行时读到（hard-boundaries.md SAFE-02 系统层保证）。
 *
 * 状态机：
 *   draft ──submit──▶ pending ──approve──▶ effective ──withdraw──▶ withdrawn
 *                        │
 *                        └──reject──▶ rejected
 *   - 手动录入可直接以 draft / pending / effective 创建（管理员本人录入即视为已审核）。
 *   - 自动候选一律以 pending 创建，永不自动生效。
 *   - draft、pending 可编辑；approve 时可带修改内容（「修改后通过」）。
 *   - 只有 draft、rejected 可物理删除；effective 只能撤回（撤回后角色不再提起，已发消息不追删）。
 *
 * 节日清单管理接口见 http/proactive.ts 的 HolidayAdminEndpoints（ADM-04 第 4 条）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Timestamp, defineEndpoint } from '../common.js';

export const PublicUpdateStatus = z.enum([
  'draft',
  'pending',
  'effective',
  'rejected',
  'withdrawn',
]);
export type PublicUpdateStatus = z.infer<typeof PublicUpdateStatus>;

export const PublicUpdateSource = z.enum(['manual', 'auto_search']);
export type PublicUpdateSource = z.infer<typeof PublicUpdateSource>;

/** 动态类别：新作品 / 活动行程 / 获奖 / 其他。 */
export const PublicUpdateKind = z.enum(['new_work', 'event', 'award', 'other']);
export type PublicUpdateKind = z.infer<typeof PublicUpdateKind>;

const SourceUrl = z.string().trim().url().max(2000);
const Content = z.string().trim().min(1).max(500);

export const PublicUpdate = z.object({
  updateId: Id,
  characterId: Id,
  /** 角色名（列表展示用）。 */
  characterName: z.string(),
  kind: PublicUpdateKind,
  /** 动态内容。角色只说这里写明的内容，不补充细节（SIM-03 第 4 条）。 */
  content: Content,
  /** 活动/事件日期范围起点。 */
  startDate: LocalDate,
  /** 日期范围终点；单日事件为 null。过了终点后动态从「近期」转为「经历」（SIM-03 第 6 条）。 */
  endDate: LocalDate.nullable(),
  /** 生效日期：从这天起角色才知道这条动态。 */
  effectiveDate: LocalDate,
  sourceUrl: SourceUrl,
  source: PublicUpdateSource,
  status: PublicUpdateStatus,
  /** 驳回理由，或撤回理由。 */
  reviewNote: z.string().max(500).nullable(),
  createdBy: Id.nullable(),
  reviewedBy: Id.nullable(),
  reviewedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type PublicUpdate = z.infer<typeof PublicUpdate>;

export const CreatePublicUpdateRequest = z
  .object({
    characterId: Id,
    kind: PublicUpdateKind.default('other'),
    content: Content,
    startDate: LocalDate,
    endDate: LocalDate.nullable().default(null),
    effectiveDate: LocalDate,
    sourceUrl: SourceUrl,
    /** 初始状态：草稿、提交审核、或直接生效（管理员本人录入即审核）。 */
    status: z.enum(['draft', 'pending', 'effective']).default('draft'),
  })
  .strict();
export type CreatePublicUpdateRequest = z.infer<typeof CreatePublicUpdateRequest>;

export const UpdatePublicUpdateRequest = z
  .object({
    kind: PublicUpdateKind.optional(),
    content: Content.optional(),
    startDate: LocalDate.optional(),
    endDate: LocalDate.nullable().optional(),
    effectiveDate: LocalDate.optional(),
    sourceUrl: SourceUrl.optional(),
  })
  .strict();
export type UpdatePublicUpdateRequest = z.infer<typeof UpdatePublicUpdateRequest>;

/** 通过：可同时修改内容（「修改后通过」）。 */
export const ApprovePublicUpdateRequest = UpdatePublicUpdateRequest;
export type ApprovePublicUpdateRequest = z.infer<typeof ApprovePublicUpdateRequest>;

export const ReviewNoteRequest = z
  .object({ note: z.string().trim().max(500).nullable().default(null) })
  .strict();
export type ReviewNoteRequest = z.infer<typeof ReviewNoteRequest>;

/** 一次候选搜索的结果。 */
export const PublicUpdateSearchResult = z.object({
  /**
   * ok = 搜索完成；disabled = 自动候选已关闭；not_eligible = 角色不是已上架真人角色；
   * unavailable = 搜索服务不可用（已按 SIM-03 兜底，只保留手动录入）。
   */
  outcome: z.enum(['ok', 'disabled', 'not_eligible', 'unavailable']),
  /** 本次新提交的候选（去重后，每次最多 5 条）。 */
  created: z.array(PublicUpdate),
  /** 因与已有动态重复被丢弃的条数。 */
  duplicates: z.number().int().nonnegative(),
});
export type PublicUpdateSearchResult = z.infer<typeof PublicUpdateSearchResult>;

/** 自动候选设置（SIM-03 兜底：搜索效果差时可关闭）。 */
export const PublicUpdateSettings = z.object({
  autoSearchEnabled: z.boolean(),
  /** 上次每周自动搜索执行时间。 */
  lastAutoRunAt: Timestamp.nullable(),
  updatedAt: Timestamp.nullable(),
});
export type PublicUpdateSettings = z.infer<typeof PublicUpdateSettings>;

const updateParams = z.object({ updateId: Id });
const characterParams = z.object({ characterId: Id });

export const PublicUpdateAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/public-updates`,
    auth: 'admin',
    query: z.object({
      status: PublicUpdateStatus.optional(),
      source: PublicUpdateSource.optional(),
      characterId: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }),
    response: z.object({ items: z.array(PublicUpdate), nextCursor: z.string().nullable() }),
    summary: 'ADM-03 公开动态列表（按状态/来源/角色筛选，最新在前）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/public-updates/:updateId`,
    auth: 'admin',
    params: updateParams,
    response: PublicUpdate,
    summary: '公开动态详情',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/public-updates`,
    auth: 'admin',
    body: CreatePublicUpdateRequest,
    response: PublicUpdate,
    summary: 'ADM-03 第 1 条：手动录入公开动态（只能录给真人角色）',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/public-updates/:updateId`,
    auth: 'admin',
    params: updateParams,
    body: UpdatePublicUpdateRequest,
    response: PublicUpdate,
    summary: '修改草稿或待审核动态（其他状态返回 409 invalid_state）',
  }),
  submit: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/public-updates/:updateId/submit`,
    auth: 'admin',
    params: updateParams,
    response: PublicUpdate,
    summary: '草稿提交审核（draft → pending）',
  }),
  approve: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/public-updates/:updateId/approve`,
    auth: 'admin',
    params: updateParams,
    body: ApprovePublicUpdateRequest,
    response: PublicUpdate,
    summary: '通过 / 修改后通过（pending → effective）',
  }),
  reject: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/public-updates/:updateId/reject`,
    auth: 'admin',
    params: updateParams,
    body: ReviewNoteRequest,
    response: PublicUpdate,
    summary: '驳回（pending → rejected）',
  }),
  withdraw: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/public-updates/:updateId/withdraw`,
    auth: 'admin',
    params: updateParams,
    body: ReviewNoteRequest,
    response: PublicUpdate,
    summary: 'ADM-03 第 4 条：撤回已生效动态（effective → withdrawn）',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/public-updates/:updateId`,
    auth: 'admin',
    params: updateParams,
    response: NoContent,
    summary: '删除草稿或已驳回动态（其他状态返回 409 invalid_state）',
  }),
  triggerSearch: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/public-updates/search`,
    auth: 'admin',
    params: characterParams,
    response: PublicUpdateSearchResult,
    summary: 'ADM-03 第 2 条：对单个角色手动触发一次候选搜索（费用记平台账户）',
  }),
  getSettings: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/public-updates-settings`,
    auth: 'admin',
    response: PublicUpdateSettings,
    summary: '自动候选设置',
  }),
  updateSettings: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/public-updates-settings`,
    auth: 'admin',
    body: z.object({ autoSearchEnabled: z.boolean() }).strict(),
    response: PublicUpdateSettings,
    summary: '开关每周自动候选搜索（关闭后只保留手动录入）',
  }),
} as const;
