import { ApiError, ErrorCode } from '@weiban/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, DEFAULT_ERROR_STATUS } from './app-error.js';
import { normalizeError } from './error-filter.js';

describe('统一错误', () => {
  it('契约里每个错误码都有默认 HTTP 状态码', () => {
    for (const code of ErrorCode.options) {
      expect(DEFAULT_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('AppError 保留错误码、状态码与说明，可以覆盖状态码', () => {
    expect(normalizeError(new AppError('sync_cursor_expired', '游标过期'))).toEqual({
      status: 410,
      code: 'sync_cursor_expired',
      message: '游标过期',
    });
    expect(normalizeError(new AppError('conflict', 'x', { status: 422 })).status).toBe(422);
  });

  it('未知异常对外只说「服务器内部错误」，不泄露原始信息', () => {
    const out = normalizeError(new Error('select * from secret_table'));
    expect(out).toEqual({ status: 500, code: 'internal_error', message: '服务器内部错误' });
  });

  it('输出能通过契约 ApiError 校验', () => {
    const out = normalizeError(new AppError('bad_request', '参数不对', { details: { a: 1 } }));
    const body = {
      error: { code: out.code, message: out.message, requestId: 'r-1', details: out.details },
    };
    expect(ApiError.safeParse(body).success).toBe(true);
  });
});
