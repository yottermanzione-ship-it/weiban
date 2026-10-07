/**
 * pg-boss 任务队列封装（ADR-0003 第 6 项）：延迟执行、定时、重试都存在 PostgreSQL（pgboss schema），重启不丢。
 *
 *   // 1. 启动时登记处理函数（只在 worker / all 角色的进程里真正开始消费）
 *   await jobs.work('ai.generate_reply', async (job) => { ... });
 *   // 2. 投递任务；传入 tx 时与业务写入同一事务（事务回滚则任务不存在）
 *   await jobs.send('ai.generate_reply', { conversationId }, { tx, delayMs: 3000 });
 *   // 3. 定时任务（cron，T-023）：只在消费任务的进程登记；多个进程登记同一个名字只保留一份
 *   await jobs.schedule('billing.expire_holds', '* * * * *');
 *
 * 规则：
 * - 队列名「模块.动作」（engineering-standards.md 第 2 节），例如 `ai.generate_reply`；第一次使用时自动创建。
 * - 任务至少执行一次：处理函数要幂等，必要时用 EventInbox.processOnce(队列名, job.id, ...) 去重。
 * - 延迟时间用平台时钟计算（startAfter = clock.now() + delayMs）。
 * - 任务数据只放 ID，不放正文和密钥（任务数据会持久化）。
 */
import { PgBoss, type Db as IDatabase, type SendOptions } from 'pg-boss';
import type { Clock } from '../clock/clock.js';
import type { DbTx } from '../db/database.js';
import { runWithLogContext } from '../logging/log-context.js';
import type { Logger } from '../logging/logger.js';

export const JOB_QUEUE = Symbol('weiban.platform.job-queue');

const QUEUE_NAME = /^[a-z][a-z0-9_-]*\.[a-z0-9_]+$/;

export interface JobSendOptions {
  /** 与业务写入同一事务。 */
  tx?: DbTx;
  /** 多少毫秒后执行（按平台时钟计算）。与 startAfter 二选一。 */
  delayMs?: number;
  startAfter?: Date;
  /** 同一个 key 在排队中只保留一个（防重复投递）。 */
  singletonKey?: string;
  /** 失败重试次数（默认 pg-boss 的 2 次）。 */
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
}

export interface JobContext<T> {
  id: string;
  name: string;
  data: T;
}

export type JobHandler<T> = (job: JobContext<T>) => Promise<void>;

/** 少量对时延敏感的队列可单独提高轮询频率/并发；默认行为保持不变。 */
export interface JobWorkerOptions {
  pollingIntervalSeconds?: number;
  localConcurrency?: number;
}

export interface JobQueueOptions {
  databaseUrl: string;
  clock: Clock;
  logger: Logger;
  /** 是否在本进程消费任务（APP_ROLE = worker / all）。为 false 时 work() 只登记不消费。 */
  consume: boolean;
  schema?: string;
}

export class JobQueue {
  private bossInstance: PgBoss;
  private started = false;
  private readonly knownQueues = new Set<string>();
  private readonly pendingWorkers: Array<{
    name: string;
    handler: JobHandler<unknown>;
    options: JobWorkerOptions;
  }> = [];
  private readonly pendingSchedules: Array<{ name: string; cron: string; tz: string }> = [];

  constructor(private readonly options: JobQueueOptions) {
    this.bossInstance = this.createBoss();
  }

  /** 模块启动对账只能在队列连接就绪后投递；实际消费仍由APP_ROLE决定。 */
  get isReady(): boolean {
    return this.started;
  }

  /** 底层 pg-boss 实例（测试与排查用；业务代码用本类的方法）。 */
  get boss(): PgBoss {
    return this.bossInstance;
  }

  private createBoss(): PgBoss {
    const boss = new PgBoss({
      connectionString: this.options.databaseUrl,
      schema: this.options.schema ?? 'pgboss',
      application_name: 'weiban-jobs',
      max: 4,
      // 只投递不消费的进程（APP_ROLE = web）不做维护和定时调度
      supervise: this.options.consume,
      schedule: this.options.consume,
    });
    boss.on('error', (error) => this.options.logger.error({ err: error }, 'pg-boss 出错'));
    return boss;
  }

  /** 启动；失败（例如数据库暂时连不上）时抛错，可以再次调用重试。 */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.bossInstance.start();
    } catch (error) {
      await this.bossInstance.stop({ graceful: false }).catch(() => undefined);
      this.bossInstance = this.createBoss();
      throw error;
    }
    this.started = true;
    for (const { name, handler, options } of this.pendingWorkers.splice(0)) {
      await this.startWorker(name, handler, options);
    }
    for (const { name, cron, tz } of this.pendingSchedules.splice(0)) {
      await this.startSchedule(name, cron, tz);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** 投递一个任务，返回任务 ID（singletonKey 去重命中时返回 null）。 */
  async send<T extends object>(
    name: string,
    data: T,
    options: JobSendOptions = {},
  ): Promise<string | null> {
    await this.ensureQueue(name);
    const sendOptions: SendOptions = {};
    const startAfter =
      options.startAfter ??
      (options.delayMs !== undefined
        ? new Date(this.options.clock.nowMs() + options.delayMs)
        : undefined);
    if (startAfter) sendOptions.startAfter = startAfter;
    if (options.singletonKey) sendOptions.singletonKey = options.singletonKey;
    if (options.retryLimit !== undefined) sendOptions.retryLimit = options.retryLimit;
    if (options.retryDelaySeconds !== undefined) sendOptions.retryDelay = options.retryDelaySeconds;
    if (options.retryBackoff !== undefined) sendOptions.retryBackoff = options.retryBackoff;
    if (options.tx) sendOptions.db = txAdapter(options.tx);
    return this.boss.send(name, data, sendOptions);
  }

  /** 登记处理函数。每次处理一个任务；抛错则按重试策略重试。 */
  async work<T>(
    name: string,
    handler: JobHandler<T>,
    options: JobWorkerOptions = {},
  ): Promise<void> {
    assertQueueName(name);
    if (
      options.pollingIntervalSeconds !== undefined &&
      (!Number.isFinite(options.pollingIntervalSeconds) ||
        options.pollingIntervalSeconds < 0.5 ||
        options.pollingIntervalSeconds > 60)
    )
      throw new Error('任务轮询间隔须为0.5～60秒');
    if (
      options.localConcurrency !== undefined &&
      (!Number.isInteger(options.localConcurrency) ||
        options.localConcurrency < 1 ||
        options.localConcurrency > 16)
    )
      throw new Error('任务本机并发须为1～16');
    if (!this.options.consume) return;
    if (!this.started) {
      this.pendingWorkers.push({
        name,
        handler: handler as JobHandler<unknown>,
        options: { ...options },
      });
      return;
    }
    await this.startWorker(name, handler as JobHandler<unknown>, options);
  }

  /**
   * 登记定时任务（cron 表达式，按 tz 时区解释，默认北京时间）。到点由 pg-boss 投递一个同名任务，
   * 处理函数仍用 work() 登记。只在消费任务的进程（APP_ROLE = worker / all）生效。
   * 注意：触发时刻由 pg-boss 按真实时间计算，不受平台时钟（TestClock）影响；处理函数里取「现在」仍用平台时钟。
   */
  async schedule(name: string, cron: string, options: { tz?: string } = {}): Promise<void> {
    assertQueueName(name);
    if (!this.options.consume) return;
    const tz = options.tz ?? 'Asia/Shanghai';
    if (!this.started) {
      this.pendingSchedules.push({ name, cron, tz });
      return;
    }
    await this.startSchedule(name, cron, tz);
  }

  private async startSchedule(name: string, cron: string, tz: string): Promise<void> {
    await this.ensureQueue(name);
    await this.boss.schedule(name, cron, null, { tz });
  }

  /** 按 ID 查任务（测试与排查用）。 */
  async findJob(name: string, id: string): Promise<{ id: string; state: string } | null> {
    await this.ensureQueue(name);
    const jobs = await this.boss.findJobs(name, { id });
    const job = jobs[0];
    return job ? { id: job.id, state: job.state } : null;
  }

  private async startWorker(
    name: string,
    handler: JobHandler<unknown>,
    options: JobWorkerOptions,
  ): Promise<void> {
    await this.ensureQueue(name);
    await this.boss.work(name, { batchSize: 1, ...options }, async (jobs) => {
      for (const job of jobs) {
        await runWithLogContext({ jobId: job.id }, () =>
          handler({ id: job.id, name: job.name, data: job.data }),
        );
      }
    });
  }

  private async ensureQueue(name: string): Promise<void> {
    assertQueueName(name);
    if (this.knownQueues.has(name)) return;
    if (!this.started) throw new Error('任务队列尚未启动（JobQueue.start）');
    const existing = await this.boss.getQueue(name);
    if (!existing) {
      try {
        await this.boss.createQueue(name);
      } catch (error) {
        // 另一个进程可能同时创建了同名队列
        if (!(await this.boss.getQueue(name))) throw error;
      }
    }
    this.knownQueues.add(name);
  }
}

function assertQueueName(name: string): void {
  if (!QUEUE_NAME.test(name)) {
    throw new Error(`队列名 ${name} 不合法，应为「模块.动作」，例如 ai.generate_reply`);
  }
}

/** 让 pg-boss 在我们的事务连接上执行 SQL。 */
function txAdapter(tx: DbTx): IDatabase {
  return {
    executeSql: async (text, values) => {
      const result = await tx.query(text, values);
      return { rows: result.rows };
    },
  };
}
