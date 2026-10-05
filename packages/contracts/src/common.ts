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

// ---------- 接收端容错（README「版本规则」） ----------

/**
 * 保留字：客户端遇到不认识的类型 / 取值时统一换成它。任何真实的类型名、枚举值都不得使用 'unsupported'。
 */
export const UNSUPPORTED = 'unsupported' as const;

/**
 * 接收端容错枚举：不认识的字符串取值变成 'unsupported'（新增取值是次版本变更，旧客户端不能因此出错）。
 * 只用于「服务器 → 客户端」方向的字段；客户端发给服务器的字段一律用严格的 z.enum。
 */
export function tolerantEnum<T extends Readonly<Record<string, string>>>(strict: z.ZodEnum<T>) {
  const known = new Set<string>(strict.options);
  return z.preprocess(
    (value) => (typeof value === 'string' && !known.has(value) ? UNSUPPORTED : value),
    z.enum({ ...strict.enum, [UNSUPPORTED]: UNSUPPORTED } as T & {
      readonly [UNSUPPORTED]: typeof UNSUPPORTED;
    }),
  );
}

/**
 * 接收端容错联合类型的前置处理：输入是带 type 字段的对象、且 type 不在已知列表里时，
 * 换成 fallback(原 type) 的结果（一个 type = 'unsupported' 的对象），再交给严格的联合类型校验。
 * 已知 type 但内容不合法的照常校验失败，不掩盖服务器的错误。
 */
export function unknownTypeFallback(
  knownTypes: readonly string[],
  fallback: (originalType: string) => Record<string, unknown>,
) {
  const known = new Set(knownTypes);
  return (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const type = (value as { type?: unknown }).type;
    if (typeof type !== 'string' || known.has(type)) return value;
    return fallback(type);
  };
}

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
  // 情景模式的功能前提（不是硬性边界）
  'adult_model_missing', // 422：没有可用的成人模式模型（不自动改用聊天模型，pm-rulings-2 B2）
  // v1.0 删除：age_not_confirmed、group_conversation（PRD v1.2 取消年龄确认和「群聊只用日常」）
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * 客户端读取错误码时用：不认识的新错误码变成 'unsupported'，按通用失败处理，而不是解析失败。
 * 服务器产生错误时用严格的 ErrorCode。
 */
export const ReceivedErrorCode = tolerantEnum(ErrorCode);
export type ReceivedErrorCode = z.infer<typeof ReceivedErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ReceivedErrorCode,
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
  /** 默认 application/json；二进制媒体响应为实际 MIME。 */
  responseContentType?: string;
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
