import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ClientLogBatch,
  ClientLogListQuery,
  ClientLogIssue,
  ClientRuntimeEvent,
  ClientLogAdminEndpoints as A,
  clientLogRoute,
  type ClientLogsPort,
  type IdentityAccountStatusPort,
  type IdentityDirectoryPort,
  type IdentityUserLabel,
  type Tx,
} from '@weiban/contracts';
import {
  DATABASE,
  CLOCK,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  OUTBOX,
  AUDIT_LOG,
  asDbTx,
  newId,
  AppError,
  parseContract,
  type Database,
  type Clock,
  type JobQueue,
  type UserDataRegistry,
  type Outbox,
  type DbTx,
  type AuditLog,
} from '../../../platform/index.js';
import { redactString } from '../../../platform/logging/sanitize.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';

type GroupRow = {
  fingerprint: string;
  kind: string;
  app_kind: string;
  title: string;
  first_seen_at: Date;
  last_seen_at: Date;
  total_count: string;
  first_version: string;
  last_version: string;
  status: string;
  note: string;
  affected_users?: string;
};
type EventRow = {
  id: string;
  user_id: string | null;
  received_at: Date;
  event: ClientRuntimeEvent;
};
const TABLES = ['events', 'group_users', 'sessions', 'rate_windows', 'ticket_events'] as const;
const dayOf = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const labels: Record<ClientRuntimeEvent['kind'], string> = {
  js_error: '脚本异常',
  unhandled_rejection: '未处理异常',
  render_error: '页面渲染异常',
  chunk_load_error: '页面文件加载失败',
  api_failure: '请求失败',
  realtime_issue: '实时连接异常',
  app_crash: '安卓崩溃',
  push_issue: '推送异常',
};
/** No Error.message, URL, user input, response body or stack string enters storage. */
export function safeEvent(input: ClientRuntimeEvent): ClientRuntimeEvent {
  const e = ClientRuntimeEvent.parse(input);
  return {
    ...e,
    page: clientLogRoute(e.page),
    ...(e.api ? { api: { ...e.api, route: clientLogRoute(e.api.route) } } : {}),
  };
}
export function fingerprint(e: ClientRuntimeEvent): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.kind,
        e.appKind,
        e.code,
        e.page,
        e.api?.route,
        e.api?.method,
        e.api?.status,
        e.frames,
        e.components,
      ]),
    )
    .digest('hex');
}
function group(r: GroupRow) {
  return ClientLogIssue.parse({
    fingerprint: r.fingerprint,
    kind: r.kind,
    appKind: r.app_kind,
    title: r.title,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    totalCount: Number(r.total_count),
    affectedUsers: Number(r.affected_users ?? 0),
    firstVersion: r.first_version,
    lastVersion: r.last_version,
    status: r.status,
    note: r.note,
  });
}
const sample = (r: EventRow) => ({
  id: r.id,
  userId: r.user_id,
  receivedAt: r.received_at.toISOString(),
  event: r.event,
});

@Injectable()
export class ClientLogsService implements OnModuleInit, ClientLogsPort {
  private readonly anonymous = new Map<
    string,
    { start: number; count: number; requests: number }
  >();
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly identity: IdentityAccountStatusPort,
    @Optional()
    @Inject(IDENTITY_DIRECTORY_PORT)
    private readonly directory?: IdentityDirectoryPort,
  ) {}

  /** 后台展示「这是谁」：一次批量取昵称 + 登录名，取不到不影响报错信息本身。 */
  private async userLabels(userIds: string[]): Promise<Record<string, IdentityUserLabel>> {
    const ids = [...new Set(userIds)];
    if (!ids.length || !this.directory) return {};
    try {
      return await this.directory.getUserLabels(ids);
    } catch {
      return {};
    }
  }
  async onModuleInit() {
    this.registry.register({
      module: 'client_logs',
      purgeUser: (id) => this.purge(id),
      countUserData: (id) => this.count(id),
    });
    await this.jobs.work('client_logs.retention', () => this.retention());
    await this.jobs.schedule('client_logs.retention', '41 3 * * *', { tz: 'Asia/Shanghai' });
  }
  private anonymousAllowance(ip: string, n: number, request = false): boolean {
    const now = this.clock.nowMs();
    // IP exists only in this bounded in-memory limiter, never as a log or DB field.
    for (const [key, row] of this.anonymous)
      if (now - row.start >= 3600000) this.anonymous.delete(key);
    const row = this.anonymous.get(ip) ?? { start: now, count: 0, requests: 0 };
    if (!this.anonymous.has(ip) && this.anonymous.size >= 10000) return false;
    if (request) row.requests++;
    else row.count += n;
    this.anonymous.set(ip, row);
    return row.requests <= 100 && (request ? row.count < 100 : row.count <= 100);
  }
  async report(userId: string | null, ip: string, input: unknown) {
    const receipt = { accepted: true as const };
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 32768) return receipt;
    const body = parseContract(ClientLogBatch, input);
    const now = this.clock.now();
    const day = dayOf(now);
    // Count submissions at ingress too: retries cannot bypass anonymous request control.
    if (!userId && !this.anonymousAllowance(ip, 0, true)) return receipt;
    await this.db.transaction(async (tx) => {
      if (userId && (await this.identity.getAccountStatus(userId, tx)) !== 'active') return;
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('client_logs:ingest',0))");
      const owner = userId ? `user:${userId}` : `anon:${body.sessionId}`;
      const events = body.events
        .filter(
          (e) =>
            e.sessionId === body.sessionId &&
            e.appKind === body.appKind &&
            e.version === body.version &&
            e.build === body.build,
        )
        .map(safeEvent)
        .filter((e) => Math.abs(new Date(e.occurredAt).getTime() - now.getTime()) <= 30 * 86400000);
      const candidates: Array<{ e: ClientRuntimeEvent; delta: number; id: string; fp: string }> =
        [];
      const seen = new Set<string>();
      for (const e of events) {
        if (seen.has(e.clientEventId)) continue;
        seen.add(e.clientEventId);
        const fp = fingerprint(e);
        const old = await tx.query<{ id: string; count: number; fingerprint: string }>(
          'SELECT id,count,fingerprint FROM client_logs.events WHERE owner_key=$1 AND client_id=$2',
          [owner, e.clientEventId],
        );
        const row = old.rows[0];
        if (row && row.fingerprint !== fp) continue;
        const delta = Math.max(0, e.count - (row?.count ?? 0));
        if (delta) candidates.push({ e, delta, id: row?.id ?? newId(), fp });
      }
      const units = Math.max(
        1,
        candidates.reduce((sum, c) => sum + c.delta, 0),
      );
      const sessionExists = await tx.query(
        'SELECT 1 FROM client_logs.sessions WHERE owner_key=$1 AND session_id=$2',
        [owner, body.sessionId],
      );
      const userUnits =
        candidates.reduce((sum, c) => sum + c.delta, 0) + (sessionExists.rowCount ? 0 : 1);
      if (!userId && !this.anonymousAllowance(ip, userUnits)) return;
      const minute = Math.floor(now.getTime() / 60000);
      if (
        !(await this.quota(
          tx,
          `global:${minute}`,
          null,
          units,
          6000,
          new Date((minute + 1) * 60000),
        ))
      ) {
        const once = await tx.query(
          `INSERT INTO client_logs.rate_windows(key,user_id,expires_at,count) VALUES($1,NULL,$2,1) ON CONFLICT(key) DO NOTHING RETURNING key`,
          [`alert:${minute}`, new Date((minute + 1) * 60000)],
        );
        if (once.rowCount)
          await this.outbox.publish(tx, 'platform.admin_alert_raised', 'client_logs', {
            kind: 'client_error_spike',
            severity: 'warning',
            dedupeKey: `client_logs:rate:${minute}`,
            summary: '客户端运行记录达到每分钟接收上限，超出记录已丢弃',
          });
        return;
      }
      if (
        userId &&
        userUnits > 0 &&
        !(await this.quota(
          tx,
          `user:${userId}:${day}`,
          userId,
          userUnits,
          300,
          new Date(Date.parse(day + 'T00:00:00+08:00') + 86400000),
        ))
      )
        return;
      await tx.query(
        `INSERT INTO client_logs.sessions(owner_key,session_id,user_id,app_kind,version,build,seen_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_key,session_id) DO NOTHING`,
        [owner, body.sessionId, userId, body.appKind, body.version, body.build, now],
      );
      await tx.query(
        `INSERT INTO client_logs.release_versions(app_kind,version,first_seen_at,last_seen_at) VALUES($1,$2,$3,$3) ON CONFLICT(app_kind,version) DO UPDATE SET last_seen_at=$3`,
        [body.appKind, body.version, now],
      );
      for (const { e, delta, id, fp } of candidates) {
        const title = redactString(
          `${labels[e.kind]} · ${e.code}${e.api ? ' · ' + e.api.route : ''}`,
        ).slice(0, 200);
        await tx.query(
          `INSERT INTO client_logs.issue_groups(fingerprint,kind,app_kind,title,first_seen_at,last_seen_at,total_count,first_version,last_version)
          VALUES($1,$2,$3,$4,$5,$5,$6,$7,$7) ON CONFLICT(fingerprint) DO UPDATE SET
          last_seen_at=$5,total_count=client_logs.issue_groups.total_count+$6,
          status=CASE WHEN client_logs.issue_groups.status='resolved' AND $7 ~ '^[0-9]+[.][0-9]+[.][0-9]+$' AND
            CASE WHEN client_logs.issue_groups.last_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'
              THEN string_to_array($7,'.')::int[]>string_to_array(client_logs.issue_groups.last_version,'.')::int[] ELSE true END
            THEN 'open' ELSE client_logs.issue_groups.status END,
          last_version=CASE WHEN $7 ~ '^[0-9]+[.][0-9]+[.][0-9]+$' THEN
            CASE WHEN client_logs.issue_groups.last_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$' THEN
              CASE WHEN string_to_array($7,'.')::int[]>=string_to_array(client_logs.issue_groups.last_version,'.')::int[] THEN $7 ELSE client_logs.issue_groups.last_version END
            ELSE $7 END ELSE client_logs.issue_groups.last_version END`,
          [fp, e.kind, e.appKind, title, now, delta, e.version],
        );
        await tx.query(
          `INSERT INTO client_logs.events(id,fingerprint,owner_key,client_id,user_id,session_id,version,count,event,occurred_at,received_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT(owner_key,client_id) DO UPDATE SET count=$8,event=$9::jsonb,received_at=$11`,
          [
            id,
            fp,
            owner,
            e.clientEventId,
            userId,
            e.sessionId,
            e.version,
            e.count,
            JSON.stringify(e),
            new Date(e.occurredAt),
            now,
          ],
        );
        await tx.query(
          `INSERT INTO client_logs.issue_days(fingerprint,day,count) VALUES($1,$2::date,$3) ON CONFLICT(fingerprint,day) DO UPDATE SET count=client_logs.issue_days.count+$3`,
          [fp, day, delta],
        );
        if (userId) {
          await tx.query(
            `INSERT INTO client_logs.group_users(fingerprint,user_id,last_seen_at) VALUES($1,$2,$3) ON CONFLICT(fingerprint,user_id) DO UPDATE SET last_seen_at=$3`,
            [fp, userId, now],
          );
          const n = await tx.query<{ n: string }>(
            'SELECT count(*) AS n FROM client_logs.group_users WHERE fingerprint=$1 AND last_seen_at>$2',
            [fp, new Date(now.getTime() - 3600000)],
          );
          if (Number(n.rows[0]?.n) >= 20) {
            const changed = await tx.query(
              'UPDATE client_logs.issue_groups SET alerted=true WHERE fingerprint=$1 AND alerted=false RETURNING fingerprint',
              [fp],
            );
            if (changed.rowCount)
              await this.outbox.publish(tx, 'platform.admin_alert_raised', 'client_logs', {
                kind: 'client_error_spike',
                severity: 'warning',
                dedupeKey: `client_logs:${fp}`,
                summary: `一个客户端问题在一小时内影响至少 20 名用户（${labels[e.kind]}）`,
              });
          }
        }
      }
      await this.releaseAlert(tx, body.appKind, now);
    });
    return receipt;
  }
  private async quota(
    tx: DbTx,
    key: string,
    userId: string | null,
    n: number,
    max: number,
    expires: Date,
  ) {
    const result = await tx.query<{ count: number }>(
      `INSERT INTO client_logs.rate_windows(key,user_id,expires_at,count) VALUES($1,$2,$3,$4)
      ON CONFLICT(key) DO UPDATE SET count=least(1000000000,client_logs.rate_windows.count+$4) RETURNING count`,
      [key, userId, expires, n],
    );
    return (result.rows[0]?.count ?? max + 1) <= max;
  }
  private async releaseAlert(tx: DbTx, appKind: string, now: Date) {
    const releases = await tx.query<{ version: string; first_seen_at: Date }>(
      "SELECT version,first_seen_at FROM client_logs.release_versions WHERE app_kind=$1 AND version ~ '^[0-9]+[.][0-9]+[.][0-9]+$' ORDER BY string_to_array(version,'.')::int[] DESC LIMIT 2",
      [appKind],
    );
    const [current, previous] = releases.rows;
    if (!current || !previous || now.getTime() - current.first_seen_at.getTime() > 3600000) return;
    const stats = await tx.query<{ version: string; sessions: string; affected: string }>(
      `SELECT s.version,count(*) sessions,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM client_logs.events e WHERE e.owner_key=s.owner_key AND e.session_id=s.session_id)) affected FROM client_logs.sessions s WHERE s.app_kind=$1 AND s.version=ANY($2::text[]) AND s.seen_at>=$3 GROUP BY s.version`,
      [appKind, [current.version, previous.version], new Date(now.getTime() - 3600000)],
    );
    const a = stats.rows.find((r) => r.version === current.version),
      b = stats.rows.find((r) => r.version === previous.version);
    if (!a || !b || Number(a.sessions) < 20 || Number(b.sessions) < 20 || Number(a.affected) < 5)
      return;
    const before = Number(b.affected) / Number(b.sessions),
      after = Number(a.affected) / Number(a.sessions);
    if (after <= before * 3) return;
    const key = `release:${appKind}:${current.version}`;
    const once = await tx.query(
      `INSERT INTO client_logs.rate_windows(key,user_id,expires_at,count) VALUES($1,NULL,$2,1) ON CONFLICT(key) DO NOTHING RETURNING key`,
      [key, new Date(now.getTime() + 180 * 86400000)],
    );
    if (once.rowCount)
      await this.outbox.publish(tx, 'platform.admin_alert_raised', 'client_logs', {
        kind: 'client_error_spike',
        severity: 'warning',
        dedupeKey: `client_logs:${key}`,
        summary: `${appKind} 新版本 ${current.version} 的已上报会话受影响比例超过上一版本三倍（两版本各至少 20 次会话）`,
      });
  }
  async attach(transaction: Tx, userId: string, ticketId: string, events: ClientRuntimeEvent[]) {
    if (!events.length) return;
    const tx = asDbTx(transaction);
    if ((await this.identity.getAccountStatus(userId, tx)) !== 'active') return;
    const safe = events.slice(-20).map(safeEvent);
    await tx.query(
      `INSERT INTO client_logs.ticket_events(ticket_id,user_id,events,created_at) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(ticket_id) DO NOTHING`,
      [ticketId, userId, JSON.stringify(safe), this.clock.now()],
    );
  }
  async list(input: unknown) {
    const q = parseContract(ClientLogListQuery, input);
    const values: unknown[] = [];
    const conditions: string[] = [];
    const add = (col: string, value: unknown, op = '=') => {
      values.push(value);
      conditions.push(`${col}${op}$${values.length}`);
    };
    if (q.appKind) add('g.app_kind', q.appKind);
    if (q.kind) add('g.kind', q.kind);
    if (q.status) add('g.status', q.status);
    if (q.version) {
      values.push(q.version);
      conditions.push(
        `EXISTS(SELECT 1 FROM client_logs.events e WHERE e.fingerprint=g.fingerprint AND e.version=$${values.length})`,
      );
    }
    if (q.since) add('g.last_seen_at', q.since, '>=');
    if (q.until) add('g.first_seen_at', q.until, '<=');
    if (q.cursor) {
      const parts = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
      const at = parts[0] ?? '',
        fp = parts[1] ?? '';
      if (
        parts.length !== 2 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ||
        !Number.isFinite(new Date(at).getTime()) ||
        !/^[a-f0-9]{64}$/.test(fp)
      )
        throw new AppError('bad_request', '分页参数无效');
      values.push(at, fp);
      conditions.push(
        `(g.last_seen_at,g.fingerprint)<($${values.length - 1}::timestamptz,$${values.length}::text)`,
      );
    }
    values.push(q.limit + 1);
    const rows = await this.db.query<GroupRow>(
      `SELECT g.*,(SELECT count(*) FROM client_logs.group_users u WHERE u.fingerprint=g.fingerprint) affected_users FROM client_logs.issue_groups g ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY last_seen_at DESC,fingerprint DESC LIMIT $${values.length}`,
      values,
    );
    const start = dayOf(this.clock.now()) + 'T00:00:00+08:00';
    const today = await this.db.query<{ n: string }>(
      'SELECT count(*) n FROM client_logs.issue_groups WHERE first_seen_at>=$1::timestamptz',
      [start],
    );
    const versions = await this.db.query<{
      version: string;
      sessions: string;
      affected_sessions: string;
    }>(
      `SELECT s.version,count(*) sessions,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM client_logs.events e WHERE e.owner_key=s.owner_key AND e.session_id=s.session_id)) affected_sessions FROM client_logs.sessions s WHERE seen_at>=$1::timestamptz GROUP BY s.version ORDER BY max(seen_at) DESC LIMIT 10`,
      [start],
    );
    return {
      items: rows.rows.slice(0, q.limit).map(group),
      nextCursor:
        rows.rows.length > q.limit
          ? Buffer.from(
              `${rows.rows[q.limit - 1]!.last_seen_at.toISOString()}|${rows.rows[q.limit - 1]!.fingerprint}`,
            ).toString('base64url')
          : null,
      todayIssues: Number(today.rows[0]?.n ?? 0),
      versions: versions.rows.map((v) => ({
        version: v.version,
        sessions: Number(v.sessions),
        affectedSessions: Number(v.affected_sessions),
      })),
    };
  }
  private async issue(fp: string) {
    const rows = await this.db.query<GroupRow>(
      `SELECT g.*,(SELECT count(*) FROM client_logs.group_users u WHERE u.fingerprint=g.fingerprint) affected_users FROM client_logs.issue_groups g WHERE fingerprint=$1`,
      [fp],
    );
    if (!rows.rows[0]) throw new AppError('not_found', '问题不存在');
    return group(rows.rows[0]);
  }
  async detail(fp: string) {
    const issue = await this.issue(fp);
    const samples = await this.db.query<EventRow>(
      'SELECT * FROM client_logs.events WHERE fingerprint=$1 ORDER BY received_at DESC LIMIT 20',
      [fp],
    );
    const days = await this.db.query<{ day: string; count: string }>(
      `SELECT day::text,count FROM client_logs.issue_days WHERE fingerprint=$1 AND day>=$2::date ORDER BY day`,
      [fp, new Date(this.clock.nowMs() - 30 * 86400000).toISOString().slice(0, 10)],
    );
    const users = await this.db.query<{ user_id: string; last_seen_at: Date }>(
      'SELECT user_id,last_seen_at FROM client_logs.group_users WHERE fingerprint=$1 ORDER BY last_seen_at DESC LIMIT 100',
      [fp],
    );
    const labels = await this.userLabels(users.rows.map((u) => u.user_id));
    return {
      issue,
      samples: samples.rows.map(sample),
      days: days.rows.map((d) => ({ day: d.day, count: Number(d.count) })),
      users: users.rows.map((u) => ({
        userId: u.user_id,
        nickname: labels[u.user_id]?.nickname ?? null,
        username: labels[u.user_id]?.username ?? null,
        lastSeenAt: u.last_seen_at.toISOString(),
      })),
    };
  }
  async update(adminId: string, fp: string, input: unknown) {
    const body = parseContract(A.update.body!, input);
    await this.issue(fp);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE client_logs.issue_groups SET status=$2,note=$3 WHERE fingerprint=$1', [
        fp,
        body.status,
        body.note,
      ]);
      await this.audit.record(
        {
          module: 'client_logs',
          actorType: 'admin',
          actorId: adminId,
          action: 'client_logs.issue_updated',
          targetType: 'client_issue',
          targetId: fp,
          details: { status: body.status },
        },
        tx,
      );
    });
    return this.issue(fp);
  }
  async user(userId: string) {
    const rows = await this.db.query<EventRow>(
      'SELECT * FROM client_logs.events WHERE user_id=$1 ORDER BY received_at DESC LIMIT 50',
      [userId],
    );
    return { items: rows.rows.map(sample) };
  }
  async ticket(ticketId: string) {
    const rows = await this.db.query<{ events: ClientRuntimeEvent[] }>(
      'SELECT events FROM client_logs.ticket_events WHERE ticket_id=$1',
      [ticketId],
    );
    return { items: rows.rows[0]?.events ?? [] };
  }
  private async purge(userId: string) {
    return this.db.transaction(async (tx) => {
      let n = 0;
      for (const table of TABLES) {
        const r = await tx.query(`DELETE FROM client_logs.${table} WHERE user_id=$1`, [userId]);
        n += r.rowCount ?? 0;
      }
      return n;
    });
  }
  private async count(userId: string) {
    let n = 0;
    for (const table of TABLES) {
      const r = await this.db.query<{ n: string }>(
        `SELECT count(*) n FROM client_logs.${table} WHERE user_id=$1`,
        [userId],
      );
      n += Number(r.rows[0]?.n ?? 0);
    }
    return n;
  }
  private async retention() {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    await this.db.transaction(async (tx) => {
      for (const [table, col] of [
        ['events', 'received_at'],
        ['sessions', 'seen_at'],
        ['ticket_events', 'created_at'],
      ])
        await tx.query(`DELETE FROM client_logs.${table} WHERE ${col}<$1`, [cutoff]);
      await tx.query('DELETE FROM client_logs.group_users WHERE last_seen_at<$1', [cutoff]);
      await tx.query('DELETE FROM client_logs.rate_windows WHERE expires_at<$1', [now]);
      await tx.query('DELETE FROM client_logs.issue_days WHERE day<$1::date', [
        cutoff.toISOString().slice(0, 10),
      ]);
      await tx.query('DELETE FROM client_logs.issue_groups WHERE last_seen_at<$1', [
        new Date(now.getTime() - 180 * 86400000),
      ]);
      await tx.query('DELETE FROM client_logs.release_versions WHERE last_seen_at<$1', [
        new Date(now.getTime() - 180 * 86400000),
      ]);
    });
  }
}
