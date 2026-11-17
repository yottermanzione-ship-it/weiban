import { expect, it } from 'vitest';
import { ApiFailure } from '@weiban/client-core';
import { authFailureMessage, authFailureReason } from '../src/features/auth-errors.js';

it('登录前存储错误与验证通过后的保存失败分别说明，保留真正的密码错误', () => {
  const quota = new DOMException('CANARY_PRIVATE', 'QuotaExceededError');
  expect(authFailureMessage(quota, 'storage_check')).toContain('存储空间不足');
  expect(authFailureMessage(quota, 'storage_check')).not.toContain('验证已通过');
  expect(authFailureMessage(quota, 'session_save')).toContain('验证已通过');
  expect(authFailureMessage(new Error('CANARY_PRIVATE'), 'session_save')).toContain(
    '本机存储暂不可用',
  );
  expect(
    authFailureMessage(new ApiFailure('invalid_credentials', '用户名或密码错误', 422), 'request'),
  ).toBe('用户名或密码错误');
});

it('诊断分类只允许固定值，异常原文与任意异常名称不会进入提示或分类', () => {
  for (const [name, expected] of [
    ['QuotaExceededError', 'quota_exceeded'],
    ['SecurityError', 'storage_denied'],
    ['UnknownError', 'storage_unavailable'],
    ['ZodError', 'invalid_data'],
    ['TypeError', 'type_error'],
    ['CANARY_PRIVATE', 'unknown'],
  ]) {
    const error = { name, message: 'CANARY_PRIVATE_PASSWORD_AND_TOKEN' };
    expect(authFailureReason(error)).toBe(expected);
    expect(authFailureMessage(error, 'request')).not.toContain('CANARY');
    expect(authFailureMessage(error, 'session_save')).not.toContain('CANARY');
  }
  expect(authFailureReason('CANARY_PRIVATE')).toBe('unknown');
});
