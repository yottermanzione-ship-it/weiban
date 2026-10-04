/**
 * 幂等收件箱（platform.event_inbox）：保证「同一个处理者对同一个 ID 只成功处理一次」。
 *
 * 事件分发器用它包住每个订阅者；pg-boss 任务等其他「至少一次」的场景也可以直接用：
 *
 *   const result = await inbox.processOnce('ai.generate_reply', job.id, async (tx) => { ... });
 *   // result = 'processed' 或 'duplicate'
 *
 * 收件箱记录和 fn 里的数据库写入在同一个事务里：fn 抛错则一起回滚，下次还能再处理。
 */
import type { Clock } from '../clock/clock.js';
import type { Database, DbTx } from '../db/database.js';

export const EVENT_INBOX = Symbol('weiban.platform.event-inbox');

export type InboxResult = 'processed' | 'duplicate';

export class EventInbox {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async processOnce(
    consumer: string,
    id: string,
    fn: (tx: DbTx) => Promise<void>,
  ): Promise<InboxResult> {
    return this.database.transaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO platform.event_inbox (consumer, event_id, processed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (consumer, event_id) DO NOTHING
         RETURNING event_id`,
        [consumer, id, this.clock.now()],
      );
      if (inserted.rowCount === 0) return 'duplicate';
      await fn(tx);
      return 'processed';
    });
  }

  /** 是否已处理过（测试与排查用）。 */
  async hasProcessed(consumer: string, id: string): Promise<boolean> {
    const { rowCount } = await this.database.query(
      'SELECT 1 FROM platform.event_inbox WHERE consumer = $1 AND event_id = $2',
      [consumer, id],
    );
    return (rowCount ?? 0) > 0;
  }
}
