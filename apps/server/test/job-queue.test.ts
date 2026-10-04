/**
 * pg-boss 封装：与业务写入同一事务投递（回滚则任务不存在）、延迟按平台时钟计算、队列名校验。
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
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

  it('队列名必须是「模块.动作」', async () => {
    await expect(jobs.send('BadName', {})).rejects.toThrow(/队列名/);
  });
});
