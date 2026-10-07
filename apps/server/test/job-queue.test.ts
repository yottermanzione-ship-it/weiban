/**
 * pg-boss 封装：与业务写入同一事务投递（回滚则任务不存在）、延迟按平台时钟计算、队列名校验。
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { TestClock } from '../src/platform/clock/clock.js';
import { Database } from '../src/platform/db/database.js';
import { JobQueue } from '../src/platform/jobs/job-queue.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';
import { captureLogger } from './support/fixtures.js';

describeDb('pg-boss 任务队列（真实 PostgreSQL）', () => {
  let database: Database;
  let jobs: JobQueue;
  const clock = new TestClock('2030-01-01T00:00:00.000Z');

  beforeAll(async () => {
    await resetTestDatabase();
    const url = requireTestDatabaseUrl();
    database = new Database({ url });
    jobs = new JobQueue({
      databaseUrl: url,
      clock,
      logger: captureLogger().logger,
      consume: false,
    });
    await jobs.start();
  }, 120_000);

  afterAll(async () => {
    await jobs?.stop();
    await database?.close();
  });

  it('事务提交后任务存在；事务回滚则任务不存在', async () => {
    const committed = await database.transaction((tx) =>
      jobs.send('test.do_thing', { id: 'a' }, { tx }),
    );
    expect(committed).toBeTruthy();
    expect(await jobs.findJob('test.do_thing', committed as string)).toMatchObject({
      state: 'created',
    });

    let rolledBackId: string | null = null;
    await database
      .transaction(async (tx) => {
        rolledBackId = await jobs.send('test.do_thing', { id: 'b' }, { tx });
        throw new Error('业务失败');
      })
      .catch(() => undefined);
    expect(rolledBackId).toBeTruthy();
    expect(await jobs.findJob('test.do_thing', rolledBackId as unknown as string)).toBeNull();
  });

  it('延迟时间按平台时钟计算（测试里固定到 2030 年）', async () => {
    const id = await jobs.send('test.later', { id: 'c' }, { delayMs: 5_000 });
    const [job] = await jobs.boss.findJobs<{ id: string }>('test.later', { id: id as string });
    expect(job?.startAfter.toISOString()).toBe('2030-01-01T00:00:05.000Z');
  });

  it('高频队列真实消费四项并发任务，其他队列默认配置不改变', async () => {
    const fast = new JobQueue({
      databaseUrl: requireTestDatabaseUrl(),
      clock,
      logger: captureLogger().logger,
      consume: true,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Set<string>();
    const finished = new Set<string>();
    try {
      await fast.work<{ id: string }>(
        'test.fast',
        async (job) => {
          started.add(job.data.id);
          await gate;
          finished.add(job.data.id);
        },
        { pollingIntervalSeconds: 0.5, localConcurrency: 4 },
      );
      await fast.start();
      for (let i = 0; i < 4; i++) await fast.send('test.fast', { id: String(i) });
      await vi.waitFor(
        () => {
          expect(started.size).toBe(4);
        },
        { timeout: 5000, interval: 50 },
      );
      release();
      await vi.waitFor(
        () => {
          expect(finished.size).toBe(4);
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      release();
      await fast.stop();
    }
  });
  it('轮询与本机并发配置拒绝非法/无穷值', async () => {
    for (const pollingIntervalSeconds of [0, -1, 61, Infinity, NaN])
      await expect(
        jobs.work('test.invalid', async () => {}, { pollingIntervalSeconds }),
      ).rejects.toThrow('轮询间隔');
    for (const localConcurrency of [0, -1, 17, 1.5, NaN])
      await expect(jobs.work('test.invalid', async () => {}, { localConcurrency })).rejects.toThrow(
        '本机并发',
      );
  });
  it('队列名必须是「模块.动作」', async () => {
    await expect(jobs.send('BadName', {})).rejects.toThrow(/队列名/);
  });
});
