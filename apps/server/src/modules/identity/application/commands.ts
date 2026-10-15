/**
 * 命令行脚本（src/cli/identity.ts）调用的运维操作：创建管理员、重置密码、改角色、生成邀请码、注销核验。
 * 用法见 docs/backend/identity.md 第 7 节。
 */
import { Inject, Injectable } from '@nestjs/common';
import { INVITE_BONUS_MAX_MICROS, Password, Username } from '@weiban/contracts';
import { eq, sql } from 'drizzle-orm';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  USER_DATA_REGISTRY,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { passwordWeakness, throttleKey } from '../domain/rules.js';
import { loginThrottle, users, loginAliases } from '../infra/db/schema.js';
import { PasswordHasher } from '../infra/password-hasher.js';
import { isUniqueViolation, PASSWORD_HASHER } from './accounts.js';
import { InviteService, type Invite } from './invites.js';
import { PurgeVerifier, type PurgeReport } from './purge-verifier.js';
import { SessionService } from './sessions.js';
import { SettingsService } from './settings.js';

export class CommandError extends Error {}

function checkCredentials(username: string, password: string): void {
  if (!Username.safeParse(username).success) {
    throw new CommandError('用户名必须是 4–32 位字母、数字或下划线');
  }
  if (!Password.safeParse(password).success) throw new CommandError('密码长度必须是 10–128 位');
  const weakness = passwordWeakness(password, username);
  if (weakness) throw new CommandError(weakness);
}

@Injectable()
export class IdentityCommands {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(InviteService) private readonly invites: InviteService,
    @Inject(PurgeVerifier) private readonly verifier: PurgeVerifier,
  ) {}

  /** 创建管理员账号（第一个管理员由运维在服务器上执行）。时区默认 Asia/Shanghai，可登录后在资料里改。 */
  async createAdmin(
    username: string,
    password: string,
    timeZone = 'Asia/Shanghai',
  ): Promise<string> {
    checkCredentials(username, password);
    const passwordHash = await this.hasher.hash(password);
    try {
      return await this.database.transaction(async (tx) => {
        const now = this.clock.now();
        const userId = newId();
        await tx.db.insert(users).values({
          id: userId,
          username,
          passwordHash,
          role: 'admin',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
        await this.settings.createDefaults(tx, userId, timeZone);
        await tx.db
          .insert(loginAliases)
          .values({ alias: username.toLowerCase(), userId, createdAt: now });
        await this.audit.record(
          {
            module: 'identity',
            action: 'admin.created',
            actorType: 'system',
            targetType: 'user',
            targetId: userId,
          },
          tx,
        );
        return userId;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CommandError(`用户名 ${username} 已存在；要把已有账号设为管理员请用 set-role`);
      }
      throw error;
    }
  }

  /** 重置密码：同时让该账号所有设备下线、解除登录锁定。 */
  async resetPassword(username: string, password: string): Promise<number> {
    checkCredentials(username, password);
    const passwordHash = await this.hasher.hash(password);
    return this.database.transaction(async (tx) => {
      const [user] = await tx.db
        .select()
        .from(users)
        .where(
          sql`(lower(${users.username}) = lower(${username}) OR EXISTS (SELECT 1 FROM ${loginAliases} a WHERE a.user_id = ${users.id} AND a.alias = lower(${username})))`,
        )
        .for('update');
      if (!user || user.status !== 'active') throw new CommandError(`找不到账号 ${username}`);
      await tx.db
        .update(users)
        .set({ passwordHash, updatedAt: this.clock.now() })
        .where(eq(users.id, user.id));
      const revoked = await this.sessions.revokeAll(tx, user.id, 'revoked');
      await tx.db
        .delete(loginThrottle)
        .where(eq(loginThrottle.key, throttleKey('username', user.username)));
      await this.audit.record(
        {
          module: 'identity',
          action: 'password.reset',
          actorType: 'system',
          targetType: 'user',
          targetId: user.id,
        },
        tx,
      );
      return revoked;
    });
  }

  /**
   * 查一个正常状态的管理员账号 ID（预设角色种子等运维脚本以它作为操作人）。
   * 不传用户名时取最早创建的管理员；找不到时报错，不会创建账号。
   */
  async findAdminId(username?: string): Promise<string> {
    const [user] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(
        username
          ? sql`(lower(${users.username}) = lower(${username}) OR EXISTS (SELECT 1 FROM ${loginAliases} a WHERE a.user_id = ${users.id} AND a.alias = lower(${username}))) AND ${users.role} = 'admin' AND ${users.status} = 'active'`
          : sql`${users.role} = 'admin' AND ${users.status} = 'active'`,
      )
      .orderBy(users.createdAt)
      .limit(1);
    if (!user) throw new CommandError(username ? `找不到管理员 ${username}` : '还没有管理员账号');
    return user.id;
  }

  /** 列出正常状态的普通用户（非管理员），供本机运维脚本（setup:local-model）使用。不返回敏感字段。 */
  async listActiveRegularUsers(): Promise<Array<{ id: string; username: string }>> {
    return this.database.db
      .select({
        id: users.id,
        username: sql<string>`coalesce(${users.currentAlias}, ${users.username})`,
      })
      .from(users)
      .where(sql`${users.role} = 'user' AND ${users.status} = 'active'`)
      .orderBy(users.createdAt);
  }

  /** 改角色。降为普通用户时作废其全部管理会话。 */
  async setRole(username: string, role: 'user' | 'admin'): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [user] = await tx.db
        .select()
        .from(users)
        .where(
          sql`(lower(${users.username}) = lower(${username}) OR EXISTS (SELECT 1 FROM ${loginAliases} a WHERE a.user_id = ${users.id} AND a.alias = lower(${username})))`,
        )
        .for('update');
      if (!user || user.status !== 'active') throw new CommandError(`找不到账号 ${username}`);
      await tx.db
        .update(users)
        .set({ role, updatedAt: this.clock.now() })
        .where(eq(users.id, user.id));
      if (role === 'user') await this.sessions.revokeAll(tx, user.id, 'revoked', 'admin');
      await this.audit.record(
        {
          module: 'identity',
          action: 'role.changed',
          actorType: 'system',
          targetType: 'user',
          targetId: user.id,
          details: { role },
        },
        tx,
      );
    });
  }

  /** 生成邀请码；bonusMicros 为注册赠送余额（微元，默认 0）。 */
  async createInvite(expiresInDays: number | null, bonusMicros = 0): Promise<Invite> {
    if (
      expiresInDays !== null &&
      !(Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 365)
    ) {
      throw new CommandError('有效天数必须是 1–365 的整数');
    }
    if (
      !Number.isInteger(bonusMicros) ||
      bonusMicros < 0 ||
      bonusMicros > INVITE_BONUS_MAX_MICROS
    ) {
      throw new CommandError('注册赠送余额必须是 0–1000 元');
    }
    return this.invites.create({ expiresInDays, bonusMicros }, null);
  }

  /** 注销核验：每个登记了删除清单的模块剩余的数据条数（全部为 0 才算删干净）。 */
  async verifyPurged(userId: string): Promise<Array<{ module: string; count: number }>> {
    return this.registry.countAll(userId);
  }

  /** 完整注销核验（scripts/verify-user-purged，T-080）：删除清单 + 全库扫描 + 平台表 + 对象存储。 */
  async verifyPurgedReport(userId: string): Promise<PurgeReport> {
    return this.verifier.verify(userId);
  }

  /** 清扫已过期会话。 */
  async sweepSessions(): Promise<number> {
    return this.sessions.sweepExpired();
  }
}
