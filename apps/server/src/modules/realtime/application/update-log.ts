import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  SyncEndpoints,
  UserUpdate,
  UserUpdatePayload,
  USER_UPDATE_RETENTION_DAYS,
  type IdentityAccountStatusPort,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  asDbTx,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';

export const REALTIME_UPDATE_CHANNEL = 'weiban_realtime_update';
const RETENTION_MS = USER_UPDATE_RETENTION_DAYS * 86400000;
interface Cursor {
  last: number;
  trimmed: number;
}

/** 序号、密文、通知与调用方业务共享一个事务；回滚不消耗序号、不通知。 */
@Injectable()
export class UpdateLogService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
  ) {}

  async lockUser(tx: DbTx, userId: string): Promise<void> {
    parseContract(Id, userId);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('realtime:' || $1, 0))", [
      userId,
    ]);
  }

  async isActive(tx: DbTx, userId: string): Promise<boolean> {
    await this.lockUser(tx, userId);
    return (await this.accounts.getAccountStatus(userId, tx)) === 'active';
  }

  async appendUpdate(transaction: Tx, userId: string, input: UserUpdatePayload): Promise<number> {
    const tx = asDbTx(transaction);
    const payload = parseContract(UserUpdatePayload, input);
    if (!(await this.isActive(tx, userId))) throw new AppError('unauthenticated', '账号已失效');
    const cursor = await tx.query<{ seq: string }>(
      `INSERT INTO realtime.user_update_cursors (user_id, last_update_seq)
      VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET last_update_seq = realtime.user_update_cursors.last_update_seq + 1
      RETURNING last_update_seq AS seq`,
      [userId],
    );
    const seq = Number(cursor.rows[0]!.seq);
    const sealed = await this.crypto.seal(
      userId,
      `realtime:update:${seq}`,
      JSON.stringify(payload),
      tx,
    );
    await tx.query(
      'INSERT INTO realtime.user_updates (user_id, update_seq, encrypted_payload, occurred_at) VALUES ($1, $2, $3, $4)',
      [userId, seq, sealed, this.clock.now()],
    );
    // PostgreSQL 仅在 COMMIT 后投递。跨 web/worker 进程；载荷没有正文、令牌或个人资料。
    await tx.query('SELECT pg_notify($1, $2)', [
      REALTIME_UPDATE_CHANNEL,
      JSON.stringify({ userId, updateSeq: seq }),
    ]);
    return seq;
  }

  async getState(userId: string): Promise<{ latestUpdateSeq: number }> {
    return this.database.transaction(async (tx) => {
      if (!(await this.isActive(tx, userId))) throw new AppError('unauthenticated', '账号已失效');
      return { latestUpdateSeq: (await this.cursor(tx, userId)).last };
    });
  }

  async getUpdates(
    userId: string,
    input: unknown,
  ): Promise<ReturnType<typeof SyncEndpoints.getUpdates.response.parse>> {
    const query = parseContract(SyncEndpoints.getUpdates.query!, input);
    if (!Number.isSafeInteger(query.since)) throw new AppError('bad_request', '游标不正确');
    return this.database.transaction(async (tx) => {
      if (!(await this.isActive(tx, userId))) throw new AppError('unauthenticated', '账号已失效');
      const cursor = await this.cursor(tx, userId);
      if (query.since < cursor.trimmed)
        throw new AppError('sync_cursor_expired', '同步记录已过期，请重新同步');
      if (query.since > cursor.last) throw new AppError('bad_request', '游标超出当前更新范围');
      const rows = await tx.query<{ seq: string; payload: Buffer; at: Date }>(
        'SELECT update_seq AS seq, encrypted_payload AS payload, occurred_at AS at FROM realtime.user_updates WHERE user_id = $1 AND update_seq > $2 ORDER BY update_seq LIMIT $3',
        [userId, query.since, query.limit],
      );
      const items: UserUpdate[] = [];
      for (const row of rows.rows) {
        const seq = Number(row.seq);
        if (seq !== query.since + items.length + 1)
          throw new AppError('internal_error', '同步记录不完整');
        const plain = await this.crypto.open(userId, `realtime:update:${seq}`, row.payload, tx);
        try {
          const payload = UserUpdatePayload.parse(JSON.parse(plain.toString('utf8')));
          items.push(
            UserUpdate.parse({ ...payload, updateSeq: seq, occurredAt: row.at.toISOString() }),
          );
        } finally {
          plain.fill(0);
        }
      }
      const through = items.at(-1)?.updateSeq ?? query.since;
      if (through < cursor.last && items.length < query.limit)
        throw new AppError('internal_error', '同步记录不完整');
      return { items, latestUpdateSeq: cursor.last, hasMore: through < cursor.last };
    });
  }

  private async cursor(tx: DbTx, userId: string): Promise<Cursor> {
    const result = await tx.query<{ last: string; trimmed: string }>(
      'SELECT last_update_seq AS last, trimmed_through AS trimmed FROM realtime.user_update_cursors WHERE user_id = $1',
      [userId],
    );
    const row = result.rows[0];
    return row ? { last: Number(row.last), trimmed: Number(row.trimmed) } : { last: 0, trimmed: 0 };
  }

  /** 删除连续前缀，保留最高序号/过期边界；即使系统时钟回拨也不制造内部缺口。 */
  async pruneUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const boundary = await tx.query<{ seq: string | null }>(
        'SELECT max(update_seq) AS seq FROM realtime.user_updates WHERE user_id = $1 AND occurred_at < $2',
        [userId, new Date(this.clock.nowMs() - RETENTION_MS)],
      );
      const seq = Number(boundary.rows[0]?.seq ?? 0);
      if (!seq) return 0;
      const removed = await tx.query(
        'DELETE FROM realtime.user_updates WHERE user_id = $1 AND update_seq <= $2',
        [userId, seq],
      );
      await tx.query(
        'UPDATE realtime.user_update_cursors SET trimmed_through = greatest(trimmed_through, $2) WHERE user_id = $1',
        [userId, seq],
      );
      return removed.rowCount ?? 0;
    });
  }

  async pruneExpired(): Promise<void> {
    const users = await this.database.query<{ user_id: string }>(
      'SELECT DISTINCT user_id FROM realtime.user_updates WHERE occurred_at < $1',
      [new Date(this.clock.nowMs() - RETENTION_MS)],
    );
    for (const row of users.rows) await this.pruneUser(row.user_id);
  }

  async purgeUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const a = await tx.query('DELETE FROM realtime.user_updates WHERE user_id = $1', [userId]);
      const b = await tx.query('DELETE FROM realtime.user_update_cursors WHERE user_id = $1', [
        userId,
      ]);
      const c = await tx.query('DELETE FROM realtime.device_presence WHERE user_id = $1', [userId]);
      return (a.rowCount ?? 0) + (b.rowCount ?? 0) + (c.rowCount ?? 0);
    });
  }

  async countUserData(userId: string): Promise<number> {
    const result = await this.database.query<{ n: string }>(
      'SELECT (SELECT count(*) FROM realtime.user_updates WHERE user_id = $1) + (SELECT count(*) FROM realtime.user_update_cursors WHERE user_id = $1) + (SELECT count(*) FROM realtime.device_presence WHERE user_id = $1) AS n',
      [userId],
    );
    return Number(result.rows[0]!.n);
  }
}
