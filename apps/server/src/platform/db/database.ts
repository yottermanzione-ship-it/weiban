/**
 * 数据库连接与事务工具。
 *
 * - `database.db`：Drizzle 查询对象（不在事务里时用）。
 * - `database.transaction(async (tx) => { ... })`：开一个事务。`tx.db` 是绑定在这个事务上的 Drizzle 对象，
 *   `tx.query()` 执行原生 SQL（给 pg-boss 等需要原生连接的地方用）。函数正常返回则提交，抛错则回滚。
 * - 把 tx 原样传给其他模块的端口（契约里的 Tx 类型），多个模块的写入就落在同一个事务里
 *   （例如：消息 + 每用户更新 + 发件箱事件）。
 * - `tx.afterCommit(fn)`：登记「提交成功后再做」的事（例如推送 WebSocket、唤醒事件分发器）；回滚则不执行。
 */
import type { Tx } from '@weiban/contracts';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export const DATABASE = Symbol('weiban.platform.database');

export type Db = NodePgDatabase<Record<string, never>>;

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

/** 平台事务句柄。结构上满足契约的 Tx（不透明品牌类型），可以直接传给端口。 */
export interface DbTx extends Tx {
  readonly db: Db;
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  afterCommit(fn: () => void | Promise<void>): void;
}

class PgTx implements DbTx {
  readonly __brand = 'weiban.tx' as const;
  readonly db: Db;
  readonly hooks: Array<() => void | Promise<void>> = [];

  constructor(private readonly client: pg.PoolClient) {
    this.db = drizzle({ client });
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const result = await this.client.query(text, values);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }

  afterCommit(fn: () => void | Promise<void>): void {
    this.hooks.push(fn);
  }
}

/** 端口收到契约的 Tx 时，用它转回平台事务句柄。传入的不是平台创建的事务会直接报错。 */
export function asDbTx(tx: Tx): DbTx {
  if (!(tx instanceof PgTx)) {
    throw new Error('传入的 Tx 不是平台内核 database.transaction() 创建的事务');
  }
  return tx;
}

export interface DatabaseOptions {
  url: string;
  poolMax?: number;
  /** 连接失败或出错时的回调（写日志用）。 */
  onError?: (error: Error) => void;
}

export class Database {
  readonly pool: pg.Pool;
  readonly db: Db;

  constructor(options: DatabaseOptions) {
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolMax ?? 10,
      connectionTimeoutMillis: 5_000,
      application_name: 'weiban-server',
    });
    // 空闲连接被数据库断开时 pg 会发 error 事件；不监听会让进程崩溃
    this.pool.on('error', (error) => options.onError?.(error));
    this.db = drizzle({ client: this.pool });
  }

  /** 在事务里执行 fn。fn 抛错则回滚并原样抛出。 */
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgTx(client);
    let result: T;
    try {
      await client.query('BEGIN');
      result = await fn(tx);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw error;
    }
    client.release();
    for (const hook of tx.hooks) {
      // 提交后的动作失败不影响已提交的事务；调用方自己负责记录错误
      await Promise.resolve()
        .then(hook)
        .catch(() => undefined);
    }
    return result;
  }

  /** 原生 SQL（不在事务里）。 */
  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const result = await this.pool.query(text, values);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }

  /** 健康检查：能否在限定时间内执行 SELECT 1。 */
  async ping(timeoutMs = 2_000): Promise<{ ok: boolean; error?: string }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`超过 ${timeoutMs} 毫秒无响应`)), timeoutMs);
        }),
      ]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
