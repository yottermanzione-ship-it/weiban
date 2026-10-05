/**
 * 登录失败计数与锁定（security-and-privacy.md 第 2 节「防暴力破解」）：
 * 同一用户名或同一 IP 连续 5 次失败，锁定 15 分钟。规则本身在 domain/rules.ts。
 */
import { eq, inArray } from 'drizzle-orm';
import type { Clock, Database } from '../../../platform/index.js';
import { isLocked, nextFailureState } from '../domain/rules.js';
import { loginThrottle } from './db/schema.js';

export class LoginThrottle {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /** 任一键处于锁定中即返回 true。 */
  async isLocked(keys: Buffer[]): Promise<boolean> {
    const now = this.clock.now();
    const rows = await this.database.db
      .select()
      .from(loginThrottle)
      .where(inArray(loginThrottle.key, keys));
    return rows.some((row) => isLocked(row, now));
  }

  /** 每个键记一次失败（到第 5 次锁定）。 */
  async recordFailure(keys: Buffer[]): Promise<void> {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      for (const key of keys) {
        const [current] = await tx.db
          .select()
          .from(loginThrottle)
          .where(eq(loginThrottle.key, key))
          .for('update');
        const next = nextFailureState(current ?? null, now);
        await tx.db
          .insert(loginThrottle)
          .values({ key, ...next })
          .onConflictDoUpdate({ target: loginThrottle.key, set: next });
      }
    });
  }

  /** 成功后清零（「连续」失败才算）。 */
  async clear(keys: Buffer[]): Promise<void> {
    await this.database.db.delete(loginThrottle).where(inArray(loginThrottle.key, keys));
  }
}
