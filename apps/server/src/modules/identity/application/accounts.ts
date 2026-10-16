/**
 * 账号：开放注册、登录、退出、注销申请；邀请码及新增赠分按11 C8停用。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AuthResponse, CurrentUser, DeviceInfo, SessionKind } from '@weiban/contracts';
import { and, eq, or, sql } from 'drizzle-orm';
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
import { passwordWeakness, throttleKey, isValidTimeZone } from '../domain/rules.js';
import { profiles, users, loginAliases } from '../infra/db/schema.js';
import { LoginThrottle } from '../infra/login-throttle.js';
import { PasswordHasher } from '../infra/password-hasher.js';
import { invalidTimeZone, SettingsService } from './settings.js';
import { SessionService, type CreatedSession } from './sessions.js';
import { hashUserId } from './user-hash.js';

export const PASSWORD_HASHER = Symbol('weiban.identity.password-hasher');
export const LOGIN_THROTTLE = Symbol('weiban.identity.login-throttle');

type UserRow = typeof users.$inferSelect;

/** 注册重试窗口：账号建好 10 分钟内，同用户名同密码再次注册视为同一次注册的重试。 */
const REGISTER_RETRY_WINDOW_MS = 10 * 60 * 1000;

export interface RegisterInput {
  username: string;
  password: string;
  /** @deprecated 旧客户端兼容字段，忽略，不校验或消耗邀请码。 */
  inviteCode?: string | undefined;
  device: DeviceInfo;
}

export interface LoginInput {
  username: string;
  password: string;
  device: DeviceInfo;
  kind: SessionKind;
}

/** PostgreSQL 唯一约束冲突（Drizzle 会把驱动的错误包在 cause 里）。 */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; typeof e === 'object' && e !== null; e = (e as Error).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
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
   * 返回 created = false 表示这是同一次注册的重试（账号刚建好、密码也对），
   * 此时不新建账号，只给这台设备发一个新会话。
   */
  async register(
    input: RegisterInput,
    ip: string,
  ): Promise<{ response: AuthResponse; created: boolean }> {
    if (!isValidTimeZone(input.device.timeZone)) throw invalidTimeZone('device.timeZone');
    const ipKey = throttleKey('ip', ip);
    if (await this.throttle.isLocked([ipKey])) {
      throw new AppError('rate_limited', '尝试次数太多，请 15 分钟后再试');
    }
    const weakness = passwordWeakness(input.password, input.username);
    if (weakness) throw new AppError('password_too_weak', weakness);

    const passwordHash = await this.hasher.hash(input.password);

    let outcome: { response: AuthResponse; created: boolean };
    try {
      outcome = await this.database.transaction(async (tx) => {
        const now = this.clock.now();
        const existing = await this.findUserByUsername(tx, input.username);

        // 重试判断不依赖邀请码：同一用户名的账号刚刚（10 分钟内）建好、仍是正常状态、密码也对
        // → 视为同一次注册的重试（客户端没收到响应又重发），只给这台设备发新会话。
        if (existing && existing.status === 'active') {
          const fresh = now.getTime() - existing.createdAt.getTime() <= REGISTER_RETRY_WINDOW_MS;
          if (fresh && (await this.hasher.verify(existing.passwordHash, input.password))) {
            const session = await this.sessions.create(tx, existing.id, 'app', input.device);
            return { response: await this.authResponse(tx, existing, session), created: false };
          }
        }
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
          .insert(loginAliases)
          .values({ alias: input.username.toLowerCase(), userId, createdAt: now });
        const session = await this.sessions.create(tx, userId, 'app', input.device);
        await this.outbox.publish(tx, 'identity.user_registered', 'identity', {
          userId,
        });
        const [user] = await tx.db.select().from(users).where(eq(users.id, userId));
        this.log.info({ userId }, '新用户注册');
        return { response: await this.authResponse(tx, user as UserRow, session), created: true };
      });
    } catch (error) {
      // 两个请求同时注册同一个用户名：后到的撞上唯一索引
      if (isUniqueViolation(error)) throw new AppError('username_taken', '用户名已被占用');
      throw error;
    }
    return outcome;
  }

  // ---------- 登录 ----------

  async login(input: LoginInput, ip: string): Promise<AuthResponse> {
    if (!isValidTimeZone(input.device.timeZone)) throw invalidTimeZone('device.timeZone');
    const user = await this.findUserByUsername(this.database, input.username);
    const keys = [throttleKey('username', user?.username ?? input.username), throttleKey('ip', ip)];
    // 锁定期间连正确密码也不接受，也不去校验密码
    if (await this.throttle.isLocked(keys)) {
      throw new AppError('account_locked', '连续输错次数太多，请 15 分钟后再试');
    }
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
      this.log.info(
        { userId: user.id, sessionId: session.sessionId, kind: input.kind },
        '登录成功',
      );
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
      .where(
        or(
          sql`lower(${users.username}) = lower(${username})`,
          sql`EXISTS (SELECT 1 FROM ${loginAliases} a WHERE a.user_id = ${users.id} AND a.alias = lower(${username}))`,
        ),
      );
    return row ?? null;
  }

  private async toCurrentUser(executor: Database | DbTx, user: UserRow): Promise<CurrentUser> {
    const [latest] = await executor.db.select().from(users).where(eq(users.id, user.id));
    user = latest ?? user;
    const [profile] = await executor.db
      .select({ nickname: profiles.nickname })
      .from(profiles)
      .where(eq(profiles.userId, user.id));
    return {
      userId: user.id,
      username: user.currentAlias ?? user.username,
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
