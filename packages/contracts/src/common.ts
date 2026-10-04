/**
 * 通用基础类型：ID、时间、错误格式、分页、接口定义辅助。
 * 规则见 docs/architecture/engineering-standards.md 第 4、5 节。
 */
import { z } from 'zod';

// ---------- ID 与时间 ----------

/** 所有实体 ID：UUIDv7 字符串（按时间递增的全局唯一 ID）。 */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** 时间点：ISO 8601，UTC，带 Z。例："2026-10-04T08:30:00.000Z" */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

/** 用户当地日期（无时区）：YYYY-MM-DD。用于生日、认识日期。 */
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;

/** 当地时刻：HH:mm，用于免打扰时段。 */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type LocalTime = z.infer<typeof LocalTime>;

/** IANA 时区名，例："Asia/Shanghai"。 */
export const TimeZone = z.string().min(1).max(64);
export type TimeZone = z.infer<typeof TimeZone>;

/** 客户端生成的幂等编号（UUIDv7）。同一操作重试时必须复用同一个值。 */
export const ClientMsgId = z.uuid();
export type ClientMsgId = z.infer<typeof ClientMsgId>;

/** 会话内递增序号，从 1 开始。 */
export const Seq = z.number().int().positive();
export type Seq = z.infer<typeof Seq>;

/** 每用户更新日志序号，从 1 开始；0 表示「还没有任何更新」。 */
export const UpdateSeq = z.number().int().nonnegative();
export type UpdateSeq = z.infer<typeof UpdateSeq>;

// ---------- 客户端设备 ----------

export const ClientPlatform = z.enum(['android', 'ios_pwa', 'web']);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

export const DeviceInfo = z.object({
  platform: ClientPlatform,
  /** 设备名，展示在「登录设备」列表，例："小米 14" / "Safari on iPhone"。 */
  name: z.string().min(1).max(64),
  appVersion: z.string().max(32),
  timeZone: TimeZone,
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

// ---------- 错误 ----------

/**
 * 错误码。新增错误码属于次版本变更，由架构负责人批准。
 * 硬性边界相关的拒绝统一以 policy_ 或具体原因码返回，HTTP 403。
 */
export const ErrorCode = z.enum([
  // 通用
  'bad_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal_error',
  'service_unavailable',
  'client_too_old',
  // 账号
  'invalid_credentials',
  'account_locked',
  'invite_invalid',
  'username_taken',
  'password_too_weak',
  // 模型与计费（v0.2：BYOK 的 credential_exists、credential_test_failed 已删除）
  'model_unavailable',
  'model_not_allowed', // 无审查模型用于无成人资格的角色，或选为全局聊天 / 后台模型
  'insufficient_balance',
  'upstream_test_failed', // 管理后台：上游连通测试失败
  'price_version_immutable', // 管理后台：已生效的价目表不可修改
  // 角色与通讯录
  'contact_limit_reached',
  'contact_exists',
  'restore_choice_required',
  'character_not_available',
  'classification_change_forbidden',
  // 聊天
  'recall_window_expired',
  'not_conversation_member',
  // 同步
  'sync_cursor_expired',
  // 硬性边界（见 docs/architecture/hard-boundaries.md），HTTP 403
  'adult_mode_not_eligible',
  'romance_not_allowed',
  'policy_denied',
  // 情景模式的功能前提 / 产品规则（不是硬性边界）：是否使用以 PRD v1.2 为准
  'adult_model_missing', // 422：没有可用的成人模式模型
  'age_not_confirmed', // 若 PRD v1.2 取消年龄确认则不再返回，下个主版本删除
  'group_conversation', // 若 PRD v1.2 取消「群聊只用日常」则不再返回，下个主版本删除
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    /** 给人看的中文说明；客户端按 code 做逻辑判断，不要解析 message。 */
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- 分页 ----------

export const CursorPageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CursorPageQuery = z.infer<typeof CursorPageQuery>;

export function cursorPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    /** 下一页游标；为 null 表示没有更多。 */
    nextCursor: z.string().nullable(),
  });
}

// ---------- 接口定义辅助 ----------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** none：无需登录；user：需要普通会话；admin：需要管理会话。 */
export type AuthLevel = 'none' | 'user' | 'admin';

export interface EndpointDef<
  P extends z.ZodType | undefined = z.ZodType | undefined,
  Q extends z.ZodType | undefined = z.ZodType | undefined,
  B extends z.ZodType | undefined = z.ZodType | undefined,
  R extends z.ZodType = z.ZodType,
> {
  method: HttpMethod;
  /** 路径参数用 :name 表示，例："/api/v1/conversations/:conversationId" */
  path: string;
  auth: AuthLevel;
  params?: P;
  query?: Q;
  body?: B;
  /** 成功时的响应体；204 无内容时用 NoContent。 */
  response: R;
  /** 中文说明，对应的 PRD 需求编号。 */
  summary: string;
}

/** 定义一个 HTTP 接口。服务器据此做校验，网页据此生成类型安全的调用函数。 */
export function defineEndpoint<
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
>(def: EndpointDef<P, Q, B, R>): EndpointDef<P, Q, B, R> {
  return def;
}

export const NoContent = z.null();

export const API_PREFIX = '/api/v1' as const;
