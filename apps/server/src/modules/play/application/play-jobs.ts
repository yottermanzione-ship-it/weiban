/**
 * play 的到点任务机制（pg-boss，ADR-0003 第 6 项）。两层保证：
 * 1. 精确到点：业务写入时用 `at()` 在同一事务里投递延迟任务（例：专注 endsAt、回信 deliverAt、提醒 nextFireAt）；
 * 2. 兜底扫描：PlayLifecycle 每分钟调用各玩法的 `sweepDue(now)`，补上任务丢失、停机期间错过的到点。
 * 处理函数必须幂等（任务至少执行一次；以表里的状态为准，状态已推进就跳过）。
 * 任务数据只放 ID（不放正文）。队列名统一 `play.<动作>`。
 */
import { Inject, Injectable } from '@nestjs/common';
import { JOB_QUEUE, type DbTx, type JobQueue } from '../../../platform/index.js';

export const PLAY_DUE_SWEEP_JOB = 'play.due_sweep';

@Injectable()
export class PlayJobs {
  constructor(@Inject(JOB_QUEUE) private readonly jobs: JobQueue) {}

  /** 登记处理函数（在各玩法服务的 onModuleInit 里调用）。 */
  async register<T extends object>(
    name: string,
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    await this.jobs.work<T>(name, (job) => handler(job.data));
  }

  /** 在 when 时刻执行；同一 singletonKey 排队中只保留一个。传 tx 时与业务写入同一事务。 */
  async at<T extends object>(
    name: string,
    data: T,
    when: Date,
    options: { tx?: DbTx; singletonKey?: string } = {},
  ): Promise<void> {
    await this.jobs.send(name, data, {
      startAfter: when,
      ...(options.tx ? { tx: options.tx } : {}),
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      retryLimit: 5,
      retryDelaySeconds: 30,
      retryBackoff: true,
    });
  }

  async cron(name: string, expression: string): Promise<void> {
    await this.jobs.schedule(name, expression);
  }
}
