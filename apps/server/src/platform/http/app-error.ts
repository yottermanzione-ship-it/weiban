/**
 * 统一错误：业务代码抛 AppError，全局异常过滤器把它转成契约的 ApiError 格式
 * {"error": {"code", "message", "requestId", "details?"}}（engineering-standards.md 第 4 节）。
 *
 *   throw new AppError('contact_limit_reached', '通讯录已满');
 *
 * 错误码只能用契约 ErrorCode 里有的（新增错误码要走契约变更申请）。
 * HTTP 状态码默认按 DEFAULT_ERROR_STATUS，个别接口需要不同状态码时传 status 覆盖。
 * message 是给人看的中文说明，会原样返回给客户端：不要放内部细节、SQL、密钥。
 */
import type { ErrorCode } from '@weiban/contracts';

/**
 * 每个错误码默认的 HTTP 状态码。用 Record<ErrorCode, …> 保证契约新增错误码时这里必须补上（否则类型检查失败）。
 * 依据：engineering-standards.md 第 4 节第 2 条；契约接口说明里写明了状态码的以契约为准。
 */
export const DEFAULT_ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
  client_too_old: 426,
  invalid_credentials: 401,
  account_locked: 429,
  invite_invalid: 422,
  username_taken: 409,
  password_too_weak: 422,
  model_unavailable: 503,
  model_not_allowed: 403,
  insufficient_balance: 422,
  upstream_test_failed: 422,
  price_version_immutable: 409,
  contact_limit_reached: 422,
  contact_exists: 409,
  restore_choice_required: 409,
  character_not_available: 422,
  classification_change_forbidden: 403,
  recall_window_expired: 422,
  not_conversation_member: 403,
  sync_cursor_expired: 410,
  adult_mode_not_eligible: 403,
  romance_not_allowed: 403,
  policy_denied: 403,
  adult_model_missing: 422,
};

export interface AppErrorOptions {
  status?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = options.status ?? DEFAULT_ERROR_STATUS[code];
    if (options.details) this.details = options.details;
  }
}
