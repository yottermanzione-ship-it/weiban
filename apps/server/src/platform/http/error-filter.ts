/**
 * 全局异常过滤器：任何异常都转成契约 ApiError 格式返回，并按级别写日志。
 * - AppError：按其 code / status / message 返回；
 * - NestJS 的 HttpException（路由不存在、请求体不是合法 JSON 等）：按状态码换成通用错误码；
 * - 未配置主密钥：503 service_unavailable；
 * - 其他一切：500 internal_error，对外只说「服务器内部错误」，细节只进日志（日志会脱敏）。
 */
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@weiban/contracts';
import type { Response } from 'express';
import { CryptoUnavailableError } from '../crypto/envelope.js';
import { currentLogContext } from '../logging/log-context.js';
import type { Logger } from '../logging/logger.js';
import { AppError } from './app-error.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
  503: 'service_unavailable',
};

const GENERIC_MESSAGE: Partial<Record<ErrorCode, string>> = {
  bad_request: '请求参数不正确',
  unauthenticated: '请先登录',
  forbidden: '没有权限',
  not_found: '找不到请求的内容',
  conflict: '请求与当前状态冲突',
  rate_limited: '操作太频繁，请稍后再试',
  service_unavailable: '服务暂时不可用，请稍后再试',
  internal_error: '服务器内部错误',
};

interface Normalized {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function normalizeError(error: unknown): Normalized {
  if (error instanceof AppError) {
    const out: Normalized = { status: error.status, code: error.code, message: error.message };
    if (error.details) out.details = error.details;
    return out;
  }
  if (error instanceof CryptoUnavailableError) {
    return {
      status: 503,
      code: 'service_unavailable',
      message: GENERIC_MESSAGE.service_unavailable ?? '',
    };
  }
  const status =
    error instanceof HttpException ? error.getStatus() : clientErrorStatus(error) ?? 500;
  const code: ErrorCode =
    STATUS_TO_CODE[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
  return { status, code, message: GENERIC_MESSAGE[code] ?? '请求失败' };
}

/** express / body-parser 抛出的客户端错误（例如请求体不是合法 JSON）带有 4xx 的 status 字段。 */
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const normalized = normalizeError(error);
    const requestId = currentLogContext().requestId ?? 'unknown';

    if (normalized.status >= 500) {
      this.logger.error({ err: error, code: normalized.code }, '请求处理出错');
    } else {
      this.logger.info({ code: normalized.code, status: normalized.status }, '请求被拒绝');
    }

    const body: ApiError = {
      error: { code: normalized.code, message: normalized.message, requestId },
    };
    if (normalized.details) body.error.details = normalized.details;
    if (response.headersSent) return;
    response.status(normalized.status).json(body);
  }
}
