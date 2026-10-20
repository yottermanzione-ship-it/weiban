/**
 * growth 模块：熟悉度、认识天数与纪念日。
 * 需求：GRW-03、GRW-04；参数见 P-25。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

// ---------- 熟悉度 ----------

/**
 * 好感度阶段（3.25 起六阶段，沿用旧版微伴说法，docs/refactor/11 C13「10-21 好感度改回旧版说法」）：
 * 1 粉丝 / 2 朋友 / 3 亲密好友 / 4 暧昧 / 5 恋人 / 6 伴侣。3.24 及以前是五级（初识…知己），字段名沿用 level。
 */
export const FamiliarityLevel = z.number().int().min(1).max(6);
export type FamiliarityLevel = z.infer<typeof FamiliarityLevel>;

/** 3.25：六个阶段的名称（下标 = level - 1）。服务端与各客户端都从这里取，不各写一份。 */
export const FAMILIARITY_STAGE_NAMES = [
  '粉丝',
  '朋友',
  '亲密好友',
  '暧昧',
  '恋人',
  '伴侣',
] as const;

/**
 * 3.25：从未充值、也不是 PRO+ 会员的账号，好感度最高停在第几阶段（3 = 亲密好友）；充值或开通会员后解除。
 * 未成年设定的角色同样最高停在这一阶段（不进入暧昧及以上）。
 */
export const FAMILIARITY_FREE_CEILING_LEVEL = 3;

/**
 * 3.25：阶段被卡住的原因。membership = 从未充值且非会员（充值 / 开会员后解除）；minor = 未成年设定角色（不解除）。
 * 接收端容错解析。
 */
export const FamiliarityCapReasonValue = z.enum(['membership', 'minor']);
export const FamiliarityCapReason = tolerantEnum(FamiliarityCapReasonValue);

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
  /** 当前阶段（3.25 起 1–6，名称见 FAMILIARITY_STAGE_NAMES）。被卡住时为卡住后的阶段。 */
  level: FamiliarityLevel,
  /** 当前阶段已积累点数。 */
  pointsInLevel: z.number().int().nonnegative(),
  /** 升到下一阶段所需点数；最高阶段时为 null（被卡住时仍给出，界面按 capReason 提示）。 */
  pointsToNextLevel: z.number().int().positive().nullable(),
  /** 累计总点数（被卡住时点数照常累计，解除后按点数直接升到对应阶段）。 */
  totalPoints: z.number().int().nonnegative(),
  updatedAt: Timestamp,
  /** 3.25：当前阶段名称（= FAMILIARITY_STAGE_NAMES[level - 1]）。 */
  stageName: z.string().optional(),
  /** 3.25：阶段被卡住的原因；没被卡住为 null / 不带。 */
  capReason: FamiliarityCapReason.nullable().optional(),
  /** 3.25：用户明确要求暂停恋爱 / 暧昧表达（例「别叫我宝贝」「先当朋友」），说「可以继续」等恢复。 */
  romancePaused: z.boolean().optional(),
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
  /**
   * 3.0.2（T-076）：自定义纪念日「每年提醒」（`l3-companion.md` 第 5 节）。true 时每年这天都算纪念日、
   * nextOccurrence 为下一周年；系统纪念日恒为 false。旧服务器不返回时按 false。
   */
  repeatYearly: z.boolean().default(false),
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
  /** 3.0.2（T-076）：每年提醒，不传为 false。 */
  repeatYearly: z.boolean().optional(),
});
export type AddAnniversaryRequest = z.infer<typeof AddAnniversaryRequest>;

/** 3.0.2（T-076）：编辑自定义纪念日（GRW-04 第 4 条「添加、编辑、删除」）。至少传一个字段。 */
export const UpdateAnniversaryRequest = z
  .object({
    label: z.string().trim().min(1).max(30).optional(),
    date: LocalDate.optional(),
    repeatYearly: z.boolean().optional(),
  })
  .refine((v) => v.label !== undefined || v.date !== undefined || v.repeatYearly !== undefined, {
    message: '至少修改一项',
  });
export type UpdateAnniversaryRequest = z.infer<typeof UpdateAnniversaryRequest>;

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

  updateAnniversary: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/growth/:characterId/anniversaries/:anniversaryId`,
    auth: 'user',
    params: z.object({ characterId: Id, anniversaryId: Id }),
    body: UpdateAnniversaryRequest,
    response: Anniversary,
    summary:
      '3.0.2：编辑自定义纪念日（名称、日期、每年提醒）；系统纪念日不可编辑（not_found）。GRW-04',
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

// ---------- 3.25：后台调整阶段阈值 ----------

/**
 * 3.25：好感度六阶段的累计点数阈值（下标 = level - 1）：第一项固定 0，严格递增。默认 [0, 100, 400, 500, 600, 700]
 * ——点数规则（16 号 §11：每条有效消息 +4、每日上限等）不变，只把原来的满级 700 映射到六阶段，
 * 约 100 条有效消息到「亲密好友」。后台改阈值后，已达到的阶段不回落（只升不降）。
 */
export const FamiliarityStageThresholds = z
  .array(z.number().int().nonnegative().max(1_000_000))
  .length(6)
  .refine((v) => v[0] === 0, { message: '第一阶段的阈值必须是 0' })
  .refine((v) => v.every((n, i) => i === 0 || n > v[i - 1]!), { message: '阈值必须逐级递增' });

export const FamiliarityStageSettings = z.object({
  thresholds: FamiliarityStageThresholds,
  /** 阶段名称（只读，= FAMILIARITY_STAGE_NAMES）。 */
  stageNames: z.array(z.string()).length(6),
  /** 未充值且非会员、以及未成年设定角色的最高阶段（只读，= FAMILIARITY_FREE_CEILING_LEVEL）。 */
  freeCeilingLevel: FamiliarityLevel,
  /** 最近一次修改时间；从未改过（用默认值）为 null。 */
  updatedAt: Timestamp.nullable(),
});
export type FamiliarityStageSettings = z.infer<typeof FamiliarityStageSettings>;

export const UpdateFamiliarityStageSettingsRequest = z.object({
  thresholds: FamiliarityStageThresholds,
});
export type UpdateFamiliarityStageSettingsRequest = z.infer<
  typeof UpdateFamiliarityStageSettingsRequest
>;

export const GrowthAdminEndpoints = {
  getFamiliarityStages: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/growth/familiarity-stages`,
    auth: 'admin',
    response: FamiliarityStageSettings,
    summary: '3.25：好感度六阶段阈值（后台可调）',
  }),
  updateFamiliarityStages: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/growth/familiarity-stages`,
    auth: 'admin',
    body: UpdateFamiliarityStageSettingsRequest,
    response: FamiliarityStageSettings,
    summary: '3.25：修改好感度阶段阈值（写审计）；已达到的阶段不回落',
  }),
} as const;
