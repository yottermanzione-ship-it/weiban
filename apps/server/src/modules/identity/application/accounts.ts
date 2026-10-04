/**
 * 账号：邀请码注册、登录、退出、注销申请（ACC-01、ACC-06）。规则见 docs/backend/identity.md 第 4、5 节。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AuthResponse, CurrentUser, DeviceInfo, SessionKind } from '@weiban/contracts';
import { and, eq, sql } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  LOGGER,
  OUTBOX,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import {
  normalizeInviteCode,
  passwordWeakness,
  throttleKey,
  isValidTimeZone,
} from '../domain/rules.js';
import { invites, profiles, users } from '../infra/db/schema.js';
import { LoginThrottle } from '../infra/login-throttle.js';
import { PasswordHasher } from '../infra/password-hasher.js';
import { invalidTimeZone, SettingsService } from './settings.js';
import { SessionService, type CreatedSession } from './sessions.js';
import { hashUserId } from './user-hash.js';

export const PASSWORD_HASHER = Symbol('weiban.identity.password-hasher');
export const LOGIN_THROTTLE = Symbol('weiban.identity.login-throttle');

type UserRow = typeof users.$inferSelect;

export interface RegisterInput {
  username: string;
  password: string;
  inviteCode: string;
  device: DeviceInfo;
}

export interface LoginInput {
  username: string;
  password: string;
  device: DeviceInfo;
  kind: SessionKind;
}

/** PostgreSQL 唯一约束冲突。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class AccountService {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_THROTTLE) private readonly throttle: LoginThrottle,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'identity' });
  }

  // ---------- 注册 ----------

  /**
   * 邀请码注册。返回 created = false 表示这是同一次注册的重试（邀请码已被这个用户名用掉、密码也对），
   * 此时不新建账号，只给这台设备发一个新会话。
   */
  async register(input: RegisterInput, ip: string): Promise<{ response: AuthResponse; created: boolean }> {
    if (!isValidTimeZone(input.device.timeZone)) throw invalidTimeZone('device.timeZone');
    const ipKey = throttleKey('ip', ip);
    if (await this.throttle.isLocked([ipKey])) {
      throw new AppError('rate_limited', '尝试次数太多，请 15 分钟后再试');
    }
    const weakness = passwordWeakness(input.password, input.username);
    if (weakness) throw new AppError('password_too_weak', weakness);

    const code = normalizeInviteCode(input.inviteCode);
    const passwordHash = await this.hasher.hash(input.password);

    let outcome: { response: AuthResponse; created: boolean } | 'invite_invalid';
    try {
      outcome = await this.database.transaction(async (tx) => {
        const now = this.clock.now();
        // 锁住邀请码行：同一个码并发注册时排队，只有第一个能用掉它
        const [invite] = await tx.db
          .select()
          .from(invites)
          .where(eq(invites.code, code))
          .for('update');
        const existing = await this.findUserByUsername(tx, input.username);

        // 重试：码已被这个用户名用掉，且密码正确 → 视为同一次注册
        if (invite && existing && invite.usedBy === existing.id && existing.status === 'active') {
          if (await this.hasher.verify(existing.passwordHash, input.password)) {
            const session = await this.sessions.create(tx, existing.id, 'app', input.device);
            return { response: await this.authResponse(tx, existing, session), created: false };
          }
        }
        const usable =
          invite &&
          invite.usedAt === null &&
          (invite.expiresAt === null || invite.expiresAt.getTime() > now.getTime());
        if (!usable) return 'invite_invalid' as const;
        if (existing) throw new AppError('username_taken', '用户名已被占用');

        const userId = newId();
        await tx.db.insert(users).values({
          id: userId,
          username: input.username,
          passwordHash,
          role: 'user',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
        await this.settings.createDefaults(tx, userId, input.device.timeZone);
        await tx.db
          .update(invites)
          .set({ usedAt: now, usedBy: userId })
          .where(and(eq(invites.code, code), sql`${invites.usedAt} is null`));
        const session = await this.sessions.create(tx, userId, 'app', input.device);
        await this.outbox.publish(tx, 'identity.user_registered', 'identity', { userId });
        const [user] = await tx.db.select().from(users).where(eq(users.id, userId));
        this.log.info({ userId }, '新用户注册');
        return { response: await this.authResponse(tx, user as UserRow, session), created: true };
      });
    } catch (error) {
      // 两个请求同时用不同邀请码注册同一个用户名：后到的撞上唯一索引
      if (isUniqueViolation(error)) throw new AppError('username_taken', '用户名已被占用');
      throw error;
    }
    if (outcome === 'invite_invalid') {
      await this.throttle.recordFailure([ipKey]);
      throw new AppError('invite_invalid', '邀请码无效、已被使用或已过期');
    }
    return outcome;
  }

  // ---------- 登录 ----------

  async login(input: LoginInput, ip: string): Promise<AuthResponse> {
    if (!isValidTimeZone(input.device.timeZone)) throw invalidTimeZone('device.timeZone');
    const keys = [throttleKey('username', input.username), throttleKey('ip', ip)];
    // 锁定期间连正确密码也不接受，也不去校验密码
    if (await this.throttle.isLocked(keys)) {
      throw new AppError('account_locked', '连续输错次数太多，请 15 分钟后再试');
    }
    const user = await this.findUserByUsername(this.database, input.username);
    let ok = false;
    if (user && user.status === 'active') {
      ok = await this.hasher.verify(user.passwordHash, input.password);
    } else {
      // 用户名不存在（或账号注销中）也花同样的时间，防止靠响应时间探测用户名
      await this.hasher.verifyDummy(input.password);
    }
    if (!user || !ok) {
      await this.throttle.recordFailure(keys);
      this.log.info({ reason: 'invalid_credentials' }, '登录失败');
      throw new AppError('invalid_credentials', '用户名或密码错误');
    }
    await this.throttle.clear(keys);
    if (input.kind === 'admin' && user.role !== 'admin') {
      throw new AppError('forbidden', '该账号不是管理员，不能登录管理后台');
    }
    return this.database.transaction(async (tx) => {
      const session = await this.sessions.create(tx, user.id, input.kind, input.device);
      if (input.kind === 'admin') {
        await this.audit.record(
          {
            module: 'identity',
            action: 'admin_session.created',
            actorType: 'admin',
            actorId: user.id,
            targetType: 'session',
            targetId: session.sessionId,
          },
          tx,
        );
      }
      this.log.info({ userId: user.id, sessionId: session.sessionId, kind: input.kind }, '登录成功');
      return this.authResponse(tx, user, session);
    });
  }

  // ---------- 退出 ----------

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.database.transaction((tx) => this.sessions.revoke(tx, userId, sessionId, 'logout'));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const done = await this.database.transaction((tx) =>
      this.sessions.revoke(tx, userId, sessionId, 'revoked'),
    );
    if (!done) throw new AppError('not_found', '这台设备已经下线或不存在');
  }

  // ---------- 当前用户 ----------

  async currentUser(userId: string): Promise<CurrentUser> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError('unauthenticated', '登录已失效，请重新登录');
    return this.toCurrentUser(this.database, user);
  }

  // ---------- 注销 ----------

  /**
   * 注销申请（ACC-06，security-and-privacy.md 第 5.1 节）：核对密码 → 标记注销中 → 作废全部会话
   * → 删除该用户的数据密钥 → 发布 identity.user_deletion_requested。之后的删除由 DeletionService 编排。
   */
  async requestDeletion(userId: string, password: string): Promise<void> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'active') throw new AppError('unauthenticated', '登录已失效');
    const usernameKey = throttleKey('username', user.username);
    if (await this.throttle.isLocked([usernameKey])) {
      throw new AppError('account_locked', '连续输错次数太多，请 15 分钟后再试');
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      await this.throttle.recordFailure([usernameKey]);
      // 用 403 而不是默认的 401：密码输错不代表登录失效，客户端不应因此退出登录
      throw new AppError('invalid_credentials', '密码错误', { status: 403 });
    }
    await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      const updated = await tx.db
        .update(users)
        .set({ status: 'deleting', deletionRequestedAt: now, updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .returning({ id: users.id });
      if (updated.length === 0) throw new AppError('unauthenticated', '登录已失效');
      await this.sessions.revokeAll(tx, userId, 'account_deleting');
      await this.crypto.destroyKey(userId, tx);
      await this.outbox.publish(tx, 'identity.user_deletion_requested', 'identity', {
        userId,
        requestedAt: now.toISOString(),
      });
      await this.audit.record(
        {
          module: 'identity',
          action: 'user.deletion_requested',
          actorType: 'user',
          targetType: 'user_hash',
          targetId: hashUserId(userId),
        },
        tx,
      );
    });
    this.log.info({ userId }, '账号进入注销流程');
  }

  // ---------- 内部 ----------

  private async findUserByUsername(
    executor: Database | DbTx,
    username: string,
  ): Promise<UserRow | null> {
    const [row] = await executor.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    return row ?? null;
  }

  private async toCurrentUser(executor: Database | DbTx, user: UserRow): Promise<CurrentUser> {
    const [profile] = await executor.db
      .select({ nickname: profiles.nickname })
      .from(profiles)
      .where(eq(profiles.userId, user.id));
    return {
      userId: user.id,
      username: user.username,
      role: user.role === 'admin' ? 'admin' : 'user',
      profileCompleted: !!profile?.nickname,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async authResponse(
    tx: DbTx,
    user: UserRow,
    session: CreatedSession,
  ): Promise<AuthResponse> {
    return {
      session: {
        sessionId: session.sessionId,
        token: session.token,
        kind: session.kind,
        expiresAt: session.expiresAt.toISOString(),
      },
      user: await this.toCurrentUser(tx, user),
    };
  }
}
