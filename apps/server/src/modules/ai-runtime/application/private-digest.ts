import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type DbTx } from '../../../platform/index.js';
import { privateDigests } from '../infra/db/schema.js';

/** 旧队列兼容名保留；私密来源不能再被改写成日常范围。 */
export const PRIVATE_DIGEST_JOB = 'ai.private_digest';
@Injectable()
export class PrivateDigestService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 切出模式不再自动生成付费“日常概括”；旧调用方无需更改契约。 */
  async enqueue(
    _tx: DbTx,
    _input: { userId: string; characterId: string; conversationId: string; eventKey: string },
  ): Promise<void> {}

  /** 只取消旧的未完成任务；已存条目保留，读取时按来源映射视为私密。 */
  async reconcile(): Promise<void> {
    await this.db.db
      .update(privateDigests)
      .set({ status: 'skipped', lastError: 'private_scope_no_downgrade' })
      .where(inArray(privateDigests.status, ['pending', 'failed']));
  }
  async run(digestId: string): Promise<void> {
    await this.db.db
      .update(privateDigests)
      .set({ status: 'skipped', lastError: 'private_scope_no_downgrade' })
      .where(
        and(eq(privateDigests.id, digestId), inArray(privateDigests.status, ['pending', 'failed'])),
      );
  }
}
