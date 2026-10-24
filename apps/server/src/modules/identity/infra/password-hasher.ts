/**
 * 密码哈希：argon2id（ADR-0006 结论 1）。用 @node-rs/argon2（Rust 实现，各平台预编译，不需要本机编译）。
 *
 * 参数取 OWASP 密码存储建议中 argon2id 的基线配置：内存 19 MiB、迭代 2 次、并行 1。
 * 哈希结果是 PHC 字符串（$argon2id$v=19$m=…,t=…,p=…$盐$哈希），参数和盐都在里面，
 * 以后调高参数时旧哈希照样能校验。
 *
 * 迁移兼容（2026-10-24）：旧版微伴用 bcrypt（$2a$/$2b$/$2y$）存密码。迁移期间允许校验旧哈希，
 * 并在登录成功时由调用方升级为 argon2id（needsRehash）。新密码一律只用 argon2id 生成。
 */
import { hash, verify } from '@node-rs/argon2';
import { verify as verifyBcrypt } from '@node-rs/bcrypt';

const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
/** 旧版微伴的 bcrypt 前缀；只用于校验，不用于生成。 */
const LEGACY_BCRYPT = /^\$2[abxy]\$\d{2}\$/;

export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  async hash(password: string): Promise<string> {
    return hash(password, PARAMS);
  }

  /** 校验密码；哈希串损坏等异常一律当作不匹配。 */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      // bcrypt 的库签名是 verify(password, hash)，与 argon2 相反，别写反。
      if (LEGACY_BCRYPT.test(passwordHash)) return await verifyBcrypt(password, passwordHash);
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** 旧版 bcrypt 哈希：登录成功后应立刻用 argon2id 重算并写回。 */
  needsRehash(passwordHash: string): boolean {
    return LEGACY_BCRYPT.test(passwordHash);
  }

  /** 用户名不存在时也做一次同样耗时的校验，让「用户名不存在」和「密码错」响应时间一样（防探测用户名）。 */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= hash('weiban-dummy-password', PARAMS);
    await this.verify(await this.dummyHash, password);
  }
}
