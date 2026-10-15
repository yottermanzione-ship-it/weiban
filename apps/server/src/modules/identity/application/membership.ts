import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  SetMembership,
  type Membership,
  type IdentityMembershipReadPort,
  type Tx,
} from '@weiban/contracts';
import {
  DATABASE,
  CLOCK,
  AUDIT_LOG,
  OUTBOX,
  AppError,
  asDbTx,
  parseContract,
  type Database,
  type Clock,
  type AuditLog,
  type Outbox,
} from '../../../platform/index.js';
import { users, memberships } from '../infra/db/schema.js';
@Injectable()
export class MembershipService implements IdentityMembershipReadPort {
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
    return {
      tier:
        row?.proPlusUntil && row.proPlusUntil.getTime() > this.clock.nowMs() ? 'pro_plus' : 'free',
      expiresAt: row?.proPlusUntil?.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
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
      await this.audit.record(
        {
          module: 'identity',
          action: 'membership.updated',
          actorType: 'admin',
          actorId: operator,
          targetType: 'user',
          targetId: userId,
          details: { expiresAt: body.expiresAt },
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
}
