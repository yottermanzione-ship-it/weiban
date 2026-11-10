/**
 * 3.21（10-20 批 E2）：后台「用户列表」—— 账号资料、会员状态、封禁 / 解封、会员概况。
 * 余额与流水在 billing（后台按 userId 合并）；管理员替用户注销见 AccountService.adminRequestDeletion。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AdminUserOverview, AdminUserSummary } from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type AuthPrincipal,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { loginThrottle, users } from '../infra/db/schema.js';
import { PasswordHasher } from '../infra/password-hasher.js';
import { passwordWeakness, throttleKey } from '../domain/rules.js';
import { PASSWORD_HASHER } from './accounts.js';
import { SessionService } from './sessions.js';

const DAY_MS = 86_400_000;
/** 列表上限：内测规模足够；超过时只返回最新注册的这么多个。 */
const LIST_LIMIT = 5000;

interface Row {
  id: string;
  username: string;
  current_alias: string | null;
  nickname: string | null;
  role: string;
  status: string;
  created_at: Date;
  last_active_at: Date | null;
  banned_at: Date | null;
  ban_reason: string | null;
  banned_by: string | null;
  pro_plus_until: Date | null;
}

const SELECT = `SELECT u.id, u.username, u.current_alias, p.nickname, u.role, u.status, u.created_at,
       u.last_active_at, u.banned_at, u.ban_reason, u.banned_by, m.pro_plus_until
  FROM identity.users u
  LEFT JOIN identity.profiles p ON p.user_id = u.id
  LEFT JOIN identity.memberships m ON m.user_id = u.id`;

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  private toSummary(r: Row, now: number): AdminUserSummary {
    const until = r.pro_plus_until ? new Date(r.pro_plus_until) : null;
    return {
      userId: r.id,
      username: r.current_alias ?? r.username,
      nickname: r.nickname,
      role: r.role === 'admin' ? 'admin' : 'user',
      status: r.status === 'deleting' ? 'deleting' : 'active',
      createdAt: new Date(r.created_at).toISOString(),
      lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
      ban: r.banned_at
        ? {
            bannedAt: new Date(r.banned_at).toISOString(),
            reason: r.ban_reason ?? '',
            operatorUserId: r.banned_by,
          }
        : null,
      membership: {
        tier: until && until.getTime() > now ? 'pro_plus' : 'free',
        expiresAt: until?.toISOString() ?? null,
      },
    };
  }

  async list(): Promise<{ items: AdminUserSummary[] }> {
    const { rows } = await this.database.query<Row>(
      `${SELECT} ORDER BY u.created_at DESC, u.id LIMIT ${LIST_LIMIT}`,
    );
    const now = this.clock.nowMs();
    return { items: rows.map((r) => this.toSummary(r, now)) };
  }

  async get(userId: string): Promise<AdminUserSummary> {
    const { rows } = await this.database.query<Row>(`${SELECT} WHERE u.id = $1`, [userId]);
    if (!rows[0]) throw new AppError('not_found', '账号不存在');
    return this.toSummary(rows[0], this.clock.nowMs());
  }

  async overview(): Promise<AdminUserOverview> {
    const now = this.clock.now();
    const soon = new Date(now.getTime() + 7 * DAY_MS);
    const { rows: counts } = await this.database.query<{ total: string; pro: string }>(
      `SELECT (SELECT count(*) FROM identity.users WHERE status = 'active') AS total,
              (SELECT count(*) FROM identity.memberships m JOIN identity.users u ON u.id = m.user_id
                WHERE u.status = 'active' AND m.pro_plus_until > $1) AS pro`,
      [now],
    );
    const { rows } = await this.database.query<Row>(
      `${SELECT} WHERE u.status = 'active' AND m.pro_plus_until > $1 AND m.pro_plus_until <= $2
        ORDER BY m.pro_plus_until, u.id LIMIT 500`,
      [now, soon],
    );
    return {
      totalUsers: Number(counts[0]?.total ?? 0),
      proPlusUsers: Number(counts[0]?.pro ?? 0),
      expiringSoon: rows.map((r) => ({
        userId: r.id,
        username: r.current_alias ?? r.username,
        nickname: r.nickname,
        expiresAt: new Date(r.pro_plus_until!).toISOString(),
      })),
    };
  }

  /** 封禁：不能登录、全部会话作废；数据保留。重复封禁只更新原因。 */
  async ban(operatorUserId: string, userId: string, reason: string): Promise<AdminUserSummary> {
    await this.database.transaction(async (tx) => {
      const [user] = await tx.db.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'active')
        throw new AppError('not_found', '账号不存在或已在注销中');
      if (user.role === 'admin') throw new AppError('forbidden', '管理员账号不能封禁');
      const now = this.clock.now();
      await tx.db
        .update(users)
        .set({
          bannedAt: user.bannedAt ?? now,
          banReason: reason,
          bannedBy: operatorUserId,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await this.sessions.revokeAll(tx, userId, 'revoked');
      await this.audit.record(
        {
          module: 'identity',
          action: 'user.banned',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'user',
          targetId: userId,
          details: { reason },
        },
        tx,
      );
    });
    return this.get(userId);
  }

  async unban(operatorUserId: string, userId: string): Promise<AdminUserSummary> {
    await this.database.transaction(async (tx) => {
      const [user] = await tx.db.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw new AppError('not_found', '账号不存在');
      if (!user.bannedAt) return;
      await tx.db
        .update(users)
        .set({ bannedAt: null, banReason: null, bannedBy: null, updatedAt: this.clock.now() })
        .where(eq(users.id, userId));
      await this.audit.record(
        {
          module: 'identity',
          action: 'user.unbanned',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'user',
          targetId: userId,
          details: {},
        },
        tx,
      );
    });
    return this.get(userId);
  }

  /** 使用既有密码算法和会话吊销流程；登录名可变，写入始终绑定详情里的用户编号。 */
  async resetPassword(operator: AuthPrincipal, userId: string, password: string) {
    const passwordHash = await this.hasher.hash(password);
    return this.database.transaction(async (tx) => {
      // 散列期间管理员可能退出、过期或被降级；在写入前重查并锁住本次管理身份。
      const actor = await tx.query(
        `SELECT u.id FROM identity.users u JOIN identity.sessions s ON s.user_id=u.id
         WHERE u.id=$1 AND u.role='admin' AND u.status='active' AND u.banned_at IS NULL
           AND s.id=$2 AND s.kind='admin' AND s.expires_at>$3 FOR SHARE OF u,s`,
        [operator.userId, operator.sessionId, this.clock.now()],
      );
      if (!actor.rows.length) throw new AppError('forbidden', '管理登录已失效，请重新登录');
      // 不锁定管理员目标，避免两个管理员相互重置造成交叉加锁。
      const [user] = await tx.db
        .select()
        .from(users)
        .where(and(eq(users.id, userId), eq(users.role, 'user'), eq(users.status, 'active')))
        .for('update');
      if (!user) {
        const [other] = await tx.db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, userId));
        if (other?.role === 'admin') throw new AppError('forbidden', '此入口不支持重置管理员密码');
        throw new AppError('not_found', '账号不存在或已在注销中');
      }
      const aliases = await tx.query<{ alias: string }>(
        'SELECT alias FROM identity.login_aliases WHERE user_id=$1',
        [userId],
      );
      const names = new Set(
        [user.username, user.currentAlias, ...aliases.rows.map((r) => r.alias)].filter(
          (v): v is string => !!v,
        ),
      );
      for (const name of names) {
        const weakness = passwordWeakness(password, name);
        if (weakness) throw new AppError('bad_request', weakness);
      }
      await tx.db
        .update(users)
        .set({ passwordHash, updatedAt: this.clock.now() })
        .where(eq(users.id, userId));
      const revokedSessions = await this.sessions.revokeAll(tx, userId, 'revoked');
      for (const name of names)
        await tx.db
          .delete(loginThrottle)
          .where(eq(loginThrottle.key, throttleKey('username', name)));
      await this.audit.record(
        {
          module: 'identity',
          action: 'password.reset',
          actorType: 'admin',
          actorId: operator.userId,
          targetType: 'user',
          targetId: userId,
          details: { revokedSessions },
        },
        tx,
      );
      return { revokedSessions };
    });
  }
}
