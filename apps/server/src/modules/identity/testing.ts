/**
 * identity 的测试出口（R10：只给测试用，生产代码 import 会被 lint 拦截）。
 * 集成测试断言 identity 表的状态时用这里的查询工具，不直接引用模块内部文件。
 */
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../platform/index.js';
import { hashToken } from './domain/rules.js';
import { invites, loginThrottle, sessions, users } from './infra/db/schema.js';

export { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_THEME } from './application/settings.js';
export { normalizeInviteCode } from './domain/rules.js';

export class IdentityTestQueries {
  constructor(private readonly database: Database) {}

  async user(username: string) {
    const [row] = await this.database.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    return row ?? null;
  }

  async userById(userId: string) {
    const [row] = await this.database.db.select().from(users).where(eq(users.id, userId));
    return row ?? null;
  }

  async sessionsOf(userId: string) {
    return this.database.db.select().from(sessions).where(eq(sessions.userId, userId));
  }

  /** 按令牌原文查会话（库里只有哈希）。 */
  async sessionByToken(token: string) {
    const [row] = await this.database.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)));
    return row ?? null;
  }

  async invite(normalizedCode: string) {
    const [row] = await this.database.db
      .select()
      .from(invites)
      .where(eq(invites.code, normalizedCode));
    return row ?? null;
  }

  async throttleRows() {
    return this.database.db.select().from(loginThrottle);
  }

  /** identity schema 全部表的全部文本内容（搜索金丝雀 / 令牌原文用）。 */
  async dumpText(): Promise<string> {
    const tables = [
      'users',
      'sessions',
      'profiles',
      'notification_settings',
      'preferences',
      'invites',
      'login_throttle',
      'deletion_progress',
    ];
    const parts: string[] = [];
    for (const table of tables) {
      const { rows } = await this.database.query(`SELECT * FROM identity.${table}`);
      parts.push(JSON.stringify(rows));
    }
    return parts.join('\n');
  }
}
