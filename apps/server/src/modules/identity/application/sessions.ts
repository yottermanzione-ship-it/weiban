/**
 * 设备会话：创建、校验（平台鉴权守卫通过 SESSION_VERIFIER 调用）、列表、作废。
 *
 * - 令牌原文只在创建时返回一次；库里只存 SHA-256（ADR-0006）。
 * - 普通会话 90 天滑动续期；管理会话 12 小时，不续期。
 * - 作废 = 删除整行，并在同一事务发布 identity.session_revoked（push 删推送设备、realtime 断开连接）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  type AuthLevel,
  type DeviceInfo,
  type SessionKind,
  type SessionSummary,
  type IdentitySessionReadPort,
  type Tx,
} from '@weiban/contracts';
import { and, desc, eq, gt, lte } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  LOGGER,
  OUTBOX,
  newId,
  asDbTx,
  parseContract,
  type AuthPrincipal,
  type Clock,
  type Database,
  type DbTx,
  type Logger,
  type Outbox,
  type SessionVerifier,
} from '../../../platform/index.js';
import {
  generateSessionToken,
  hashToken,
  sessionExpiresAt,
  shouldTouchSession,
  APP_SESSION_TTL_MS,
} from '../domain/rules.js';
import { sessions, users } from '../infra/db/schema.js';

export type RevokeReason = 'logout' | 'revoked' | 'expired' | 'account_deleting';

export interface CreatedSession {
  sessionId: string;
  token: string;
  kind: SessionKind;
  expiresAt: Date;
}

@Injectable()
export class SessionService implements SessionVerifier, IdentitySessionReadPort {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'identity' });
  }

  /** 在调用方事务里创建会话，返回令牌原文（只此一次）。 */
  async create(
    tx: DbTx,
    userId: string,
    kind: SessionKind,
    device: DeviceInfo,
  ): Promise<CreatedSession> {
    const now = this.clock.now();
    const token = generateSessionToken();
    const id = newId();
    const expiresAt = sessionExpiresAt(kind, now);
    await tx.db.insert(sessions).values({
      id,
      userId,
      kind,
      tokenHash: hashToken(token),
      device,
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
    });
    await tx.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId));
    return { sessionId: id, token, kind, expiresAt };
  }

  /** SessionVerifier：令牌有效则返回登录者；无效、过期、已作废、账号注销中返回 null。 */
  async verify(token: string, _level: Exclude<AuthLevel, 'none'>): Promise<AuthPrincipal | null> {
    const now = this.clock.now();
    const [row] = await this.database.db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        kind: sessions.kind,
        lastActiveAt: sessions.lastActiveAt,
        expiresAt: sessions.expiresAt,
        role: users.role,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)));
    if (!row) return null;
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.database.transaction((tx) =>
        this.revoke(tx, row.userId, row.sessionId, 'expired'),
      );
      return null;
    }
    if (row.status !== 'active') return null;
    if (shouldTouchSession(row.lastActiveAt, now)) {
      await this.touch(row.sessionId, row.userId, row.kind as SessionKind, now);
    }
    return {
      userId: row.userId,
      sessionId: row.sessionId,
      role: row.role === 'admin' ? 'admin' : 'user',
      adminSession: row.kind === 'admin',
    };
  }

  private async touch(sessionId: string, userId: string, kind: SessionKind, now: Date) {
    // 普通会话：使用即续期 90 天；管理会话：只更新最近使用时间
    const set =
      kind === 'app'
        ? { lastActiveAt: now, expiresAt: new Date(now.getTime() + APP_SESSION_TTL_MS) }
        : { lastActiveAt: now };
    await this.database.transaction(async (tx) => {
      await tx.db.update(sessions).set(set).where(eq(sessions.id, sessionId));
      await tx.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId));
    });
  }

  async isActiveAppSession(userId: string, sessionId: string, input?: Tx): Promise<boolean> {
    parseContract(Id, userId);
    parseContract(Id, sessionId);
    const runner = input ? asDbTx(input) : this.database;
    const result = await runner.query(
      `SELECT s.id FROM identity.sessions s JOIN identity.users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.user_id=$2 AND s.kind='app' AND s.expires_at>$3 AND u.status='active'
       ${input ? 'FOR SHARE OF s,u' : ''}`,
      [sessionId, userId, this.clock.now()],
    );
    return result.rows.length > 0;
  }

  /** 我的登录设备（不含已过期的）。 */
  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const now = this.clock.now();
    const rows = await this.database.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.lastActiveAt));
    return rows.map((row) => ({
      sessionId: row.id,
      kind: row.kind as SessionKind,
      device: row.device as DeviceInfo,
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
      current: row.id === currentSessionId,
    }));
  }

  /**
   * 作废 userId 名下的一个会话（删除行 + 发布 session_revoked），返回是否真的删除了。
   * 会话不属于该用户或已不存在时返回 false，不发事件（重复请求不产生重复事件）。
   */
  async revoke(
    tx: DbTx,
    userId: string,
    sessionId: string,
    reason: RevokeReason,
  ): Promise<boolean> {
    const deleted = await tx.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    if (deleted.length === 0) return false;
    await this.outbox.publish(tx, 'identity.session_revoked', 'identity', {
      userId,
      sessionId,
      reason,
    });
    this.log.info({ userId, sessionId, reason }, '会话已作废');
    return true;
  }

  /** 作废某用户的全部会话（可只限某一类），返回作废的个数。 */
  async revokeAll(
    tx: DbTx,
    userId: string,
    reason: RevokeReason,
    kind?: SessionKind,
  ): Promise<number> {
    const rows = await tx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        kind
          ? and(eq(sessions.userId, userId), eq(sessions.kind, kind))
          : eq(sessions.userId, userId),
      );
    let count = 0;
    for (const row of rows) {
      if (await this.revoke(tx, userId, row.id, reason)) count += 1;
    }
    return count;
  }

  /** 清扫全部已过期会话（发 session_revoked(expired)），返回清扫个数。供定时任务 / 运维调用。 */
  async sweepExpired(limit = 500): Promise<number> {
    const now = this.clock.now();
    const rows = await this.database.db
      .select({ id: sessions.id, userId: sessions.userId })
      .from(sessions)
      .where(lte(sessions.expiresAt, now))
      .limit(limit);
    let count = 0;
    for (const row of rows) {
      const done = await this.database.transaction((tx) =>
        this.revoke(tx, row.userId, row.id, 'expired'),
      );
      if (done) count += 1;
    }
    return count;
  }
}
