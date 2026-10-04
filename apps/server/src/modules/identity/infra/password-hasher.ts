/**
 * 密码哈希：argon2id（ADR-0006 结论 1）。用 @node-rs/argon2（Rust 实现，各平台预编译，不需要本机编译）。
 *
 * 参数取 OWASP 密码存储建议中 argon2id 的基线配置：内存 19 MiB、迭代 2 次、并行 1。
 * 哈希结果是 PHC 字符串（$argon2id$v=19$m=…,t=…,p=…$盐$哈希），参数和盐都在里面，
 * 以后调高参数时旧哈希照样能校验。
 */
import { hash, verify } from '@node-rs/argon2';

const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  async hash(password: string): Promise<string> {
    return hash(password, PARAMS);
  }

  /** 校验密码；哈希串损坏等异常一律当作不匹配。 */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** 用户名不存在时也做一次同样耗时的校验，让「用户名不存在」和「密码错」响应时间一样（防探测用户名）。 */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= hash('weiban-dummy-password', PARAMS);
    await this.verify(await this.dummyHash, password);
  }
}
