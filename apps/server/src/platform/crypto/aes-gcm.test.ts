import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aesGcmOpen, aesGcmSeal, DecryptionError } from './envelope.js';

describe('AES-256-GCM', () => {
  const key = randomBytes(32);

  it('加密解密往返；同一明文两次加密结果不同（随机 nonce）', () => {
    const a = aesGcmSeal(key, 'aad', Buffer.from('hello'));
    const b = aesGcmSeal(key, 'aad', Buffer.from('hello'));
    expect(a.equals(b)).toBe(false);
    expect(aesGcmOpen(key, 'aad', a).toString()).toBe('hello');
  });

  it('AAD 不同、密钥不同、密文被改都解不开', () => {
    const sealed = aesGcmSeal(key, 'upstream:1', Buffer.from('secret'));
    expect(() => aesGcmOpen(key, 'upstream:2', sealed)).toThrow(DecryptionError);
    expect(() => aesGcmOpen(randomBytes(32), 'upstream:1', sealed)).toThrow(DecryptionError);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => aesGcmOpen(key, 'upstream:1', tampered)).toThrow(DecryptionError);
  });
});
