import { ApiFailure } from '@weiban/client-core';

export type AuthFailureStage = 'storage_check' | 'device' | 'request' | 'session_save';
export type AuthFailureReason =
  | 'quota_exceeded'
  | 'storage_denied'
  | 'storage_unavailable'
  | 'invalid_data'
  | 'type_error'
  | 'unknown';

/** 只按固定类别判断；不展示或上报异常原文（可能含账号、密码或响应数据）。 */
export function authFailureReason(error: unknown): AuthFailureReason {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
  if (name === 'QuotaExceededError') return 'quota_exceeded';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'storage_denied';
  if (name === 'InvalidStateError' || name === 'UnknownError' || name === 'AbortError')
    return 'storage_unavailable';
  if (name === 'ZodError') return 'invalid_data';
  if (name === 'TypeError') return 'type_error';
  return 'unknown';
}

export function authFailureMessage(error: unknown, stage: AuthFailureStage): string {
  if (error instanceof ApiFailure) return error.message;
  const reason = authFailureReason(error);
  if (stage === 'storage_check' || stage === 'session_save') {
    const prefix = stage === 'session_save' ? '验证已通过，但' : '';
    if (reason === 'quota_exceeded')
      return `${prefix}本机存储空间不足，无法保存登录状态，请释放一些空间后重试`;
    if (reason === 'storage_denied')
      return `${prefix}浏览器限制了本机存储，无法保存登录状态，请检查浏览器设置后重试`;
    return `${prefix}本机存储暂不可用，无法保存登录状态，请重试；仍失败请关闭并重新打开页面`;
  }
  return '登录数据处理异常，请刷新页面后重试；仍失败请联系管理员';
}
