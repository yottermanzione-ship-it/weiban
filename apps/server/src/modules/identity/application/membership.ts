import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import {
  SetMembership,
  type Membership,
  type MembershipChange,
  type IdentityMembershipReadPort,
  type IdentityMembershipWritePort,
  type Tx,
} from '@weiban/contracts';
import {
  DATABASE,
  CLOCK,
  AUDIT_LOG,
  OUTBOX,
  AppError,
  asDbTx,
  newId,
  parseContract,
  type Database,
  type Clock,
  type AuditLog,
  type Outbox,
} from '../../../platform/index.js';
import { users, memberships, membershipChanges } from '../infra/db/schema.js';

const BEIJING_OFFSET_MS = 8 * 3_600_000;
/** 按北京时间自然月加 months 个月（月末对齐：1 月 31 日 + 1 月 = 2 月最后一天）。 */
export function addBeijingMonths(at: Date, months: number): Date {
  const local = new Date(at.getTime() + BEIJING_OFFSET_MS);
  const y = local.getUTCFullYear(),
    m = local.getUTCMonth() + months,
    d = local.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const moved = Date.UTC(
    y,
    m,
    Math.min(d, lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(moved - BEIJING_OFFSET_MS);
}
@Injectable()
export class MembershipService implements IdentityMembershipReadPort, IdentityMembershipWritePort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}
  async getMembership(userId: string, input?: Tx): Promise<Membership> {
    const db = input ? asDbTx(input).db : this.database.db;
    const query = db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    const [user] = input ? await query.for('share') : await query;
    if (!user || user.status !== 'active') throw new AppError('not_found', '账号不存在');
    const [row] = await db.select().from(memberships).where(eq(memberships.userId, userId));
    const checkedAt = this.clock.now();
    return {
      checkedAt: checkedAt.toISOString(),
      tier:
        row?.proPlusUntil && row.proPlusUntil.getTime() > checkedAt.getTime() ? 'pro_plus' : 'free',
      expiresAt: row?.proPlusUntil?.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
  /** 3.17 统一「是否 PRO+」：见契约 IdentityMembershipReadPort.isProPlus。 */
  async isProPlus(userId: string, input?: Tx): Promise<boolean> {
    const db = input ? asDbTx(input).db : this.database.db;
    const [row] = await db
      .select({ until: memberships.proPlusUntil, status: users.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.userId, userId));
    return (
      !!row &&
      row.status === 'active' &&
      !!row.until &&
      row.until.getTime() > this.clock.now().getTime()
    );
  }
  /** 3.17：开通 / 续期（契约 IdentityMembershipWritePort），必须在调用方事务里。 */
  async extendProPlus(
    input: { userId: string; months: number; operatorUserId: string | null },
    txInput: Tx,
  ): Promise<{ startsAt: string; endsAt: string }> {
    const tx = asDbTx(txInput);
    const [user] = await tx.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');
    if (!user || user.status !== 'active') throw new AppError('not_found', '账号不存在');
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36)
      throw new AppError('bad_request', '会员时长不正确');
    const now = this.clock.now();
    const [old] = await tx.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, input.userId))
      .for('update');
    const start =
      old?.proPlusUntil && old.proPlusUntil.getTime() > now.getTime() ? old.proPlusUntil : now;
    const until = addBeijingMonths(start, input.months);
    await tx.db
      .insert(memberships)
      .values({
        userId: input.userId,
        proPlusUntil: until,
        grantedBy: input.operatorUserId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: memberships.userId,
        set: { proPlusUntil: until, grantedBy: input.operatorUserId, updatedAt: now },
      });
    await this.audit.record(
      {
        module: 'identity',
        action: 'membership.extended',
        actorType: input.operatorUserId ? 'admin' : 'system',
        actorId: input.operatorUserId,
        targetType: 'user',
        targetId: input.userId,
        details: { months: input.months, expiresAt: until.toISOString() },
      },
      tx,
    );
    await this.outbox.publish(tx, 'identity.profile_updated', 'identity', {
      userId: input.userId,
      changedFields: ['membership'],
    });
    return { startsAt: start.toISOString(), endsAt: until.toISOString() };
  }
  async set(operator: string, userId: string, input: unknown) {
    const body = parseContract(SetMembership, input);
    return this.database.transaction(async (tx) => {
      const [user] = await tx.db.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'active') throw new AppError('not_found', '账号不存在');
      const now = this.clock.now(),
        until = body.expiresAt ? new Date(body.expiresAt) : null;
      if (until && until <= now)
        throw new AppError('bad_request', '请设置未来的到期时间，撤销请清空');
      const [old] = await tx.db.select().from(memberships).where(eq(memberships.userId, userId));
      if (old?.proPlusUntil?.getTime() === until?.getTime() || (old && !old.proPlusUntil && !until))
        return this.getMembership(userId, tx);
      await tx.db
        .insert(memberships)
        .values({ userId, proPlusUntil: until, grantedBy: operator, updatedAt: now })
        .onConflictDoUpdate({
          target: memberships.userId,
          set: { proPlusUntil: until, grantedBy: operator, updatedAt: now },
        });
      // 3.21：手动调整 / 取消记入会员订阅记录（开通 / 续期由 billing 订单记录）。
      await tx.db.insert(membershipChanges).values({
        id: newId(),
        userId,
        previousUntil: old?.proPlusUntil ?? null,
        newUntil: until,
        operatorUserId: operator,
        reason: body.reason || null,
        createdAt: now,
      });
      await this.audit.record(
        {
          module: 'identity',
          action: 'membership.updated',
          actorType: 'admin',
          actorId: operator,
          targetType: 'user',
          targetId: userId,
          details: { expiresAt: body.expiresAt, reason: body.reason ?? null },
        },
        tx,
      );
      await this.outbox.publish(tx, 'identity.profile_updated', 'identity', {
        userId,
        changedFields: ['membership'],
      });
      return this.getMembership(userId, tx);
    });
  }

  /** 3.21：手动调整记录（新到旧）。cursor 为偏移量。 */
  async listChanges(query: {
    userId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<{ items: MembershipChange[]; nextCursor: string | null }> {
    const offset = query.cursor && /^d{1,7}$/.test(query.cursor) ? Number(query.cursor) : 0;
    const rows = await this.database.db
      .select()
      .from(membershipChanges)
      .where(
        and(
          query.userId ? eq(membershipChanges.userId, query.userId) : undefined,
          query.from ? gte(membershipChanges.createdAt, new Date(query.from)) : undefined,
          query.to ? lt(membershipChanges.createdAt, new Date(query.to)) : undefined,
        ),
      )
      .orderBy(desc(membershipChanges.createdAt), desc(membershipChanges.id))
      .limit(query.limit + 1)
      .offset(offset);
    return {
      items: rows.slice(0, query.limit).map((r) => ({
        changeId: r.id,
        userId: r.userId,
        previousExpiresAt: r.previousUntil?.toISOString() ?? null,
        expiresAt: r.newUntil?.toISOString() ?? null,
        operatorUserId: r.operatorUserId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
    };
  }
}
