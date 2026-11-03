/**
 * 数据库连接与事务工具。
 *
 * - `database.db`：Drizzle 查询对象（不在事务里时用）。
 * - `database.transaction(async (tx) => { ... })`：开一个事务。`tx.db` 是绑定在这个事务上的 Drizzle 对象，
 *   `tx.query()` 执行原生 SQL（给 pg-boss 等需要原生连接的地方用）。函数正常返回则提交，抛错则回滚。
 * - 把 tx 原样传给其他模块的端口（契约里的 Tx 类型），多个模块的写入就落在同一个事务里
 *   （例如：消息 + 每用户更新 + 发件箱事件）。
 * - `tx.afterCommit(fn)`：登记「提交成功后再做」的事（例如推送 WebSocket、唤醒事件分发器）；回滚则不执行。
 *
 * 事务规则（T-20261104c 生产事故）：拿着 tx 时，被调用的端口一律传 tx，不能另开 `database.transaction`
 * 或用 `database.db` 去锁 / 改这个 tx 已经锁过、改过的行——外层等内层返回、内层等外层提交，
 * 数据库看不出这种「应用层死锁」（外层连接只是 idle in transaction）。
 * 兜底：连接池每条连接都带会话参数 idle_in_transaction_session_timeout（30 秒）和 lock_timeout（10 秒），
 * 卡住的事务最多 30 秒被数据库断开、等锁最多 10 秒报错，只影响这一个请求，不会拖垮整个连接池。
 * 事务连接被数据库断开时只让这次事务失败（记日志、丢弃这条连接），进程照常服务。
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

/** 事务两条语句之间空闲超过这么久，数据库断开这条连接（会话参数 idle_in_transaction_session_timeout）。 */
export const DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
/** 等行锁 / 咨询锁超过这么久报错 55P03（会话参数 lock_timeout）。 */
export const DB_LOCK_TIMEOUT_MS = 10_000;

export interface DatabaseOptions {
  url: string;
  poolMax?: number;
  /** 连接失败或出错时的回调（写日志用）。 */
  onError?: (error: Error) => void;
  /** 默认 DB_IDLE_IN_TRANSACTION_TIMEOUT_MS；传 0 = 不设置，沿用数据库 / 角色的默认值（测试用）。 */
  idleInTransactionTimeoutMs?: number;
  /** 默认 DB_LOCK_TIMEOUT_MS；传 0 = 不设置，沿用数据库 / 角色的默认值。 */
  lockTimeoutMs?: number;
}

export class Database {
  readonly pool: pg.Pool;
  readonly db: Db;
  private readonly onError: ((error: Error) => void) | undefined;

  constructor(options: DatabaseOptions) {
    this.onError = options.onError;
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolMax ?? 10,
      connectionTimeoutMillis: 5_000,
      application_name: 'weiban-server',
      // 连接建立时作为启动参数发给数据库，每条新连接都生效（单位毫秒；pg 不发送 0）
      idle_in_transaction_session_timeout:
        options.idleInTransactionTimeoutMs ?? DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      lock_timeout: options.lockTimeoutMs ?? DB_LOCK_TIMEOUT_MS,
    });
    // 空闲连接被数据库断开时 pg 会发 error 事件；不监听会让进程崩溃
    this.pool.on('error', (error) => this.onError?.(error));
    this.db = drizzle({ client: this.pool });
  }

  /** 在事务里执行 fn。fn 抛错则回滚并原样抛出。 */
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    // 借出去的连接不再挂连接池的 error 监听：事务进行中连接被数据库断开（管理员终止、
    // idle_in_transaction 超时、网络断开）时 pg 会在这条连接上发 error 事件，没人监听就是未捕获异常、
    // 整个进程退出（2026-11-04 事故）。这里接住：记日志，这次事务后续语句自然失败，归还时丢弃这条连接。
    let broken: Error | undefined;
    const onClientError = (error: Error) => {
      if (!broken) this.onError?.(error);
      broken ??= error;
    };
    client.on('error', onClientError);
    const release = (error?: Error) => {
      client.removeListener('error', onClientError);
      // 传入错误 = 连接状态不明，从连接池移除并关闭，不交给下一个请求
      client.release(error ?? broken);
    };
    const tx = new PgTx(client);
    let result: T;
    try {
      await client.query('BEGIN');
      result = await fn(tx);
      await client.query('COMMIT');
    } catch (error) {
      const rollbackError = await client.query('ROLLBACK').then(
        () => undefined,
        (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
      );
      release(rollbackError);
      throw error;
    }
    release();
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
