/**
 * T-20261104c 连接池兜底（真实 PostgreSQL）：
 * - 每条连接带 idle_in_transaction_session_timeout / lock_timeout，卡住的事务只影响这一个请求；
 * - 事务进行中连接被数据库断开（管理员终止、空闲事务超时）时只让这次事务失败，
 *   不变成未捕获异常（2026-11-04 事故里进程因此退出），连接池继续可用。
 *   （未捕获异常会被 Vitest 记为 Unhandled Error，整轮测试失败。）
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DB_LOCK_TIMEOUT_MS,
  Database,
} from '../src/platform/db/database.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase, withClient } from './support/db.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await sleep(20);
  }
}

describeDb('数据库连接池兜底（真实 PostgreSQL）', () => {
  let url: string;
  const opened: Database[] = [];
  const open = (options: Partial<ConstructorParameters<typeof Database>[0]> = {}) => {
    const db = new Database({ url, ...options });
    opened.push(db);
    return db;
  };

  beforeAll(async () => {
    await resetTestDatabase();
    url = requireTestDatabaseUrl();
  });

  afterAll(async () => {
    for (const db of opened) await db.close().catch(() => undefined);
  });

  it('连接池的连接带 idle_in_transaction_session_timeout = 30s、lock_timeout = 10s', async () => {
    expect(DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(30_000);
    expect(DB_LOCK_TIMEOUT_MS).toBe(10_000);
    const db = open();
    const plain = await db.query<{ idle: string; lock: string }>(
      `SELECT current_setting('idle_in_transaction_session_timeout') AS idle,
              current_setting('lock_timeout') AS lock`,
    );
    expect(plain.rows[0]).toEqual({ idle: '30s', lock: '10s' });
    // 事务连接同样生效（SHOW 是任务卡要求的检查方式）
    const inTx = await db.transaction(async (tx) => ({
      idle: (
        await tx.query<{ idle_in_transaction_session_timeout: string }>(
          'SHOW idle_in_transaction_session_timeout',
        )
      ).rows[0]!.idle_in_transaction_session_timeout,
      lock: (await tx.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]!.lock_timeout,
    }));
    expect(inTx).toEqual({ idle: '30s', lock: '10s' });
  });

  it('等锁超过 lock_timeout 时这次事务报 55P03 失败，不会一直排队', async () => {
    const db = open({ lockTimeoutMs: 300 });
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(20261104)');
      const started = Date.now();
      const error = await db
        .transaction((tx) => tx.query('SELECT pg_advisory_xact_lock(20261104)'))
        .then(
          () => null,
          (e: unknown) => e as { code?: string },
        );
      expect(error?.code).toBe('55P03');
      expect(Date.now() - started).toBeLessThan(5_000);
      await holder.query('ROLLBACK');
    });
    expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
  });

  it('事务空闲超时被数据库断开：只让这次事务失败、记日志，进程不退出，连接池继续服务', async () => {
    const errors: Error[] = [];
    const db = open({
      idleInTransactionTimeoutMs: 300,
      poolMax: 2,
      onError: (e) => errors.push(e),
    });
    const run = db.transaction(async (tx) => {
      await tx.query('SELECT 1');
      // 模拟外层事务在等别的东西（2026-11-04 事故里是在等另一条连接上的查询）
      await waitFor(() => errors.length > 0);
      await tx.query('SELECT 1');
    });
    await expect(run).rejects.toThrow();
    expect(errors[0]?.message).toMatch(/idle-in-transaction|terminat/i);
    // 被断开的连接已丢弃，新请求拿到的是新连接
    for (let i = 0; i < 3; i++)
      expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
    expect(await db.transaction(async (tx) => (await tx.query('SELECT 2 AS v')).rows[0])).toEqual({
      v: 2,
    });
  });

  it('管理员终止事务连接（pg_terminate_backend）：同上，不产生未捕获异常', async () => {
    const errors: Error[] = [];
    const db = open({ poolMax: 2, onError: (e) => errors.push(e) });
    const run = db.transaction(async (tx) => {
      const pid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await withClient((admin) => admin.query('SELECT pg_terminate_backend($1)', [pid]));
      await waitFor(() => errors.length > 0);
      await tx.query('SELECT 1');
    });
    await expect(run).rejects.toThrow();
    expect(errors[0]?.message).toMatch(/administrator command|terminat/i);
    expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1);
  });
});
