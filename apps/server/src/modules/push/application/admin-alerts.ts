import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  AdminAlert,
  AdminAlertFacts,
  Id,
  Timestamp,
  PushAdminEndpoints,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { adminAlerts } from '../infra/db/schema.js';
const cursorSchema = z.object({ at: Timestamp, id: Id });
type AlertRow = typeof adminAlerts.$inferSelect;
const retentionMs = 90 * 24 * 60 * 60 * 1000;
function dto(row: AlertRow): AdminAlert {
  return AdminAlert.parse({
    alertId: row.id,
    kind: row.kind,
    severity: row.severity,
    dedupeKey: row.dedupeKey,
    summary: row.summary,
    refs: row.refs ?? undefined,
    occurrences: row.occurrences,
    firstRaisedAt: row.firstRaisedAt.toISOString(),
    lastRaisedAt: row.lastRaisedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByUserId: row.acknowledgedByUserId,
  });
}
@Injectable()
export class AdminAlertService {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) readonly accounts: IdentityAccountStatusPort,
  ) {}
  async raise(
    tx: DbTx,
    input: AdminAlertFacts,
  ): Promise<{ alert: AdminAlert; first: boolean; shouldPush: boolean }> {
    const facts = parseContract(AdminAlertFacts, input);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('push:admin-alert:' || $1,0))", [
      facts.dedupeKey,
    ]);
    const [old] = await tx.db
      .select()
      .from(adminAlerts)
      .where(and(eq(adminAlerts.dedupeKey, facts.dedupeKey), isNull(adminAlerts.acknowledgedAt)))
      .for('update');
    const now = this.clock.now();
    const values = {
      kind: facts.kind,
      severity: facts.severity,
      summary: facts.summary,
      refs: facts.refs ?? null,
      lastRaisedAt: now,
    };
    if (old) {
      const rank = { info: 0, warning: 1, critical: 2 } as const;
      if (rank[old.severity as keyof typeof rank] > rank[facts.severity])
        values.severity = old.severity as AdminAlertFacts['severity'];
      const [row] = await tx.db
        .update(adminAlerts)
        .set({ ...values, occurrences: old.occurrences + 1 })
        .where(eq(adminAlerts.id, old.id))
        .returning();
      return {
        alert: dto(row!),
        first: false,
        shouldPush: old.severity === 'info' && facts.severity !== 'info',
      };
    }
    const [row] = await tx.db
      .insert(adminAlerts)
      .values({ ...values, id: newId(), dedupeKey: facts.dedupeKey, firstRaisedAt: now })
      .returning();
    return { alert: dto(row!), first: true, shouldPush: facts.severity !== 'info' };
  }
  async list(input: unknown) {
    const query = parseContract(PushAdminEndpoints.listAdminAlerts.query!, input);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (query.cursor) {
      try {
        if (query.cursor.length > 512) throw Error();
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        throw new AppError('bad_request', '无效提醒游标');
      }
    }
    return this.db.transaction(async (tx) => {
      const retained = gt(adminAlerts.lastRaisedAt, new Date(this.clock.nowMs() - retentionMs));
      const rows = await tx.db
        .select()
        .from(adminAlerts)
        .where(
          and(
            retained,
            query.status === 'open' ? isNull(adminAlerts.acknowledgedAt) : undefined,
            cursor
              ? or(
                  lt(adminAlerts.lastRaisedAt, new Date(cursor.at)),
                  and(
                    eq(adminAlerts.lastRaisedAt, new Date(cursor.at)),
                    lt(adminAlerts.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(adminAlerts.lastRaisedAt), desc(adminAlerts.id))
        .limit(query.limit + 1);
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      const [open] = await tx.db
        .select({ n: count() })
        .from(adminAlerts)
        .where(and(retained, isNull(adminAlerts.acknowledgedAt)));
      return PushAdminEndpoints.listAdminAlerts.response.parse({
        items: items.map(dto),
        openCount: open!.n,
        nextCursor:
          rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({ at: last.lastRaisedAt.toISOString(), id: last.id }),
              ).toString('base64url')
            : null,
      });
    });
  }
  async acknowledge(userId: string, id: string): Promise<AdminAlert> {
    parseContract(Id, id);
    return this.db.transaction(async (tx) => {
      if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
        throw new AppError('unauthenticated', '账号已失效');
      const [old] = await tx.db
        .select()
        .from(adminAlerts)
        .where(
          and(
            eq(adminAlerts.id, id),
            gt(adminAlerts.lastRaisedAt, new Date(this.clock.nowMs() - retentionMs)),
          ),
        )
        .for('update');
      if (!old) throw new AppError('not_found', '提醒不存在');
      if (old.acknowledgedAt) return dto(old);
      const [row] = await tx.db
        .update(adminAlerts)
        .set({ acknowledgedAt: this.clock.now(), acknowledgedByUserId: userId })
        .where(eq(adminAlerts.id, id))
        .returning();
      return dto(row!);
    });
  }
  async prune(): Promise<void> {
    await this.db.db
      .delete(adminAlerts)
      .where(lt(adminAlerts.lastRaisedAt, new Date(this.clock.nowMs() - retentionMs)));
  }
}
