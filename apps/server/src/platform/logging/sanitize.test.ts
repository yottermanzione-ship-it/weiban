import { describe, expect, it } from 'vitest';
import { isSensitiveKey, REDACTED, redactString, sanitize } from './sanitize.js';

const CANARY = 'sk-weiban-canary-0123456789abcdef';

describe('日志脱敏 sanitize', () => {
  it('按字段名整值打码（大小写、下划线、嵌套都能识别）', () => {
    const out = sanitize({
      apiKey: 'abc',
      nested: { Authorization: 'x', session_token: 'y', user: { password: 'p' } },
      content: '聊天正文',
      messages: [{ role: 'user' }],
      conversationId: '0199f0a0-0000-7000-8000-000000000001',
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED);
    expect(out.content).toBe(REDACTED);
    expect(out.messages).toBe(REDACTED);
    expect(out.nested).toEqual({
      Authorization: REDACTED,
      session_token: REDACTED,
      user: { password: REDACTED },
    });
    expect(out.conversationId).toBe('0199f0a0-0000-7000-8000-000000000001');
  });

  it('不误伤普通字段（contentScope、inputTokens、eventType）', () => {
    expect(isSensitiveKey('contentScope')).toBe(false);
    expect(isSensitiveKey('inputTokens')).toBe(false);
    expect(isSensitiveKey('eventType')).toBe(false);
    expect(isSensitiveKey('refreshToken')).toBe(true);
    expect(isSensitiveKey('secretCiphertext')).toBe(true);
  });

  it('按内容打码：sk- 密钥、Bearer 令牌、32 位以上长串；UUID 保留', () => {
    const text = `key=${CANARY} auth=Bearer abc.def-123 hash=${'a'.repeat(40)} id=0199f0a0-0000-7000-8000-000000000001`;
    const out = redactString(text);
    expect(out).not.toContain(CANARY);
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain('a'.repeat(40));
    expect(out).toContain('0199f0a0-0000-7000-8000-000000000001');
  });

  it('Error 的 message、stack、cause 都会打码；循环引用不崩溃', () => {
    const error = new Error(`上游拒绝了密钥 ${CANARY}`, { cause: new Error(`Bearer ${CANARY}`) });
    const circular: Record<string, unknown> = { name: 'a' };
    circular.self = circular;
    const out = JSON.stringify(sanitize({ err: error, circular }));
    expect(out).not.toContain(CANARY);
    expect(out).toContain('[Circular]');
  });

  it('二进制内容不输出', () => {
    expect(sanitize({ data: Buffer.from(CANARY) })).toEqual({ data: '[Binary]' });
  });
});
