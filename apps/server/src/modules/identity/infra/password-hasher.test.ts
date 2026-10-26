import { describe, expect, it } from 'vitest';
import { hash as bcryptHash } from '@node-rs/bcrypt';
import { PasswordHasher } from './password-hasher.js';

describe('密码哈希（argon2id，ADR-0006）', () => {
  const hasher = new PasswordHasher();

  it('产出 argon2id 的 PHC 字符串，带盐，不含原文', async () => {
    const a = await hasher.hash('correct horse battery');
    const b = await hasher.hash('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // 每次随机盐
    expect(a).not.toContain('correct horse battery');
  });

  it('校验：对的通过，错的不通过，坏哈希不抛错', async () => {
    const h = await hasher.hash('correct horse battery');
    expect(await hasher.verify(h, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(h, 'wrong horse battery')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });

  it('迁移兼容：旧版 bcrypt 哈希能校验，并在登录后要求升级', async () => {
    const legacy = await bcryptHash('correct horse battery', { cost: 4, version: '2a' });
    expect(legacy).toMatch(/^\$2a\$04\$/);
    expect(await hasher.verify(legacy, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(legacy, 'wrong horse battery')).toBe(false);
    expect(hasher.needsRehash(legacy)).toBe(true);
  });

  it('argon2id 与损坏哈希都不要求升级', async () => {
    const current = await hasher.hash('correct horse battery');
    expect(hasher.needsRehash(current)).toBe(false);
    expect(hasher.needsRehash('not-a-hash')).toBe(false);
    expect(await hasher.verify('$2a$04$broken', 'x')).toBe(false);
  });
});
