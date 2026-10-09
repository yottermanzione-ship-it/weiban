/**
 * growth 模块：熟悉度、认识天数与纪念日。
 * 需求：GRW-03、GRW-04；参数见 P-25。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, defineEndpoint } from '../common.js';

// ---------- 熟悉度 ----------

/** 熟悉度等级：1 初识 / 2 眼熟 / 3 熟络 / 4 老友 / 5 知己（GRW-03）。 */
export const FamiliarityLevel = z.number().int().min(1).max(5);
export type FamiliarityLevel = z.infer<typeof FamiliarityLevel>;

/**
 * 熟悉度加分事件类型（GRW-03 第 2 条）。
 * 各事件的分值由 P-25 管理；客户端只需知道类型名称。
 */
export const FamiliarityEventType = z.enum([
  'active_chat_day', // 有效聊天日（当天聊了 10 条以上或通话 5 分钟以上）
  'reply_to_proactive', // 回复角色的主动消息
  'moments_interaction', // 在朋友圈互动
  'anniversary_chat', // 纪念日当天聊天
  'first_time_interaction', // 首次完成某类互动
]);
export type FamiliarityEventType = z.infer<typeof FamiliarityEventType>;

export const FamiliarityInfo = z.object({
  characterId: Id,
  /** 当前等级（1–5）。 */
  level: FamiliarityLevel,
  /** 当前等级已积累点数。 */
  pointsInLevel: z.number().int().nonnegative(),
  /** 升到下一级所需点数；L5 时为 null。 */
  pointsToNextLevel: z.number().int().positive().nullable(),
  /** 累计总点数。 */
  totalPoints: z.number().int().nonnegative(),
  updatedAt: Timestamp,
});
export type FamiliarityInfo = z.infer<typeof FamiliarityInfo>;

export const AddFamiliarityPointsRequest = z.object({
  characterId: Id,
  eventType: FamiliarityEventType,
  /**
   * 幂等键：同一业务事件重复调用时必须传相同的值，确保只计一次。
   * 推荐格式：`{eventType}:{conversationId}:{localDate}` 或 `{eventType}:{entityId}`。
   */
  idempotencyKey: z.string().min(1).max(128),
  /** 事件发生时刻（ISO 8601 UTC）；不传则取服务器当前时间。 */
  occurredAt: Timestamp.optional(),
});
export type AddFamiliarityPointsRequest = z.infer<typeof AddFamiliarityPointsRequest>;

export const AddFamiliarityPointsResponse = z.object({
  familiarity: FamiliarityInfo,
  /** 本次实际加了多少点（已满每日上限则为 0）。 */
  pointsAdded: z.number().int().nonnegative(),
  /** 是否因本次加分触发升级。 */
  leveledUp: z.boolean(),
});
export type AddFamiliarityPointsResponse = z.infer<typeof AddFamiliarityPointsResponse>;

// ---------- 认识天数与纪念日 ----------

/** 系统预设纪念日节点（GRW-04 第 2 条）。 */
export const SystemAnniversaryDay = z.number().int().positive();
export type SystemAnniversaryDay = z.infer<typeof SystemAnniversaryDay>;

export const Anniversary = z.object({
  id: Id,
  /** 'system' 为系统预置节点，'custom' 为用户自定义。 */
  kind: z.enum(['system', 'custom']),
  /** 纪念日名称，如「认识 100 天」「第一次通话的日子」。 */
  label: z.string().min(1).max(30),
  /** 该纪念日对应的日期（用户本地日期，YYYY-MM-DD）。 */
  date: LocalDate,
  /** 下一次触达的日期（系统纪念日为每年周年；自定义为 date 本身）；已过则为下一周年。 */
  nextOccurrence: LocalDate.nullable(),
});
export type Anniversary = z.infer<typeof Anniversary>;

export const DaysKnownInfo = z.object({
  characterId: Id,
  /** 认识第 N 天（从添加当天算第 1 天，按用户时区跨天）。 */
  daysKnown: z.number().int().positive(),
  /** 「认识第 N 天」起算的用户当地日期。 */
  knownSince: LocalDate,
  /** 下一个将到来的纪念日；若无则为 null。 */
  nextAnniversary: Anniversary.nullable(),
  /** 全部纪念日列表（系统 + 自定义，按 date 升序）。 */
  anniversaries: z.array(Anniversary),
  /** 当前关系类型为恋人时为 true，用于前端决定显示「在一起第 N 天」还是「认识第 N 天」（GRW-04 第 5 条）。 */
  isRomantic: z.boolean(),
});
export type DaysKnownInfo = z.infer<typeof DaysKnownInfo>;

export const AddAnniversaryRequest = z.object({
  label: z.string().trim().min(1).max(30),
  date: LocalDate,
});
export type AddAnniversaryRequest = z.infer<typeof AddAnniversaryRequest>;

// ---------- 接口定义 ----------

export const GrowthEndpoints = {
  getFamiliarity: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/:characterId/familiarity`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: FamiliarityInfo,
    summary: '查询对某角色的熟悉度（等级、当前进度、累计点数）。GRW-03',
  }),

  addPoints: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/growth/:characterId/familiarity/points`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: AddFamiliarityPointsRequest,
    response: AddFamiliarityPointsResponse,
    summary:
      '为某角色添加熟悉度点数（幂等）。同一 idempotencyKey 重复请求只计一次。每日上限见 P-25。GRW-03',
  }),

  getDaysKnown: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/growth/:characterId/days-known`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: DaysKnownInfo,
    summary: '查询认识天数与纪念日（系统 + 自定义），包括下一个将到来的纪念日。GRW-04',
  }),

  addAnniversary: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/growth/:characterId/anniversaries`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: AddAnniversaryRequest,
    response: Anniversary,
    summary: '添加自定义纪念日（每角色最多 10 个，GRW-04 第 4 条）。超出时返回 bad_request。',
  }),

  removeAnniversary: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/growth/:characterId/anniversaries/:anniversaryId`,
    auth: 'user',
    params: z.object({ characterId: Id, anniversaryId: Id }),
    response: z.null(),
    summary: '删除自定义纪念日（系统预置纪念日不可删除，返回 bad_request）。GRW-04',
  }),
} as const;
