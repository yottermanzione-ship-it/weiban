import { Inject, Injectable } from '@nestjs/common';
import { Id, ModelPurpose, type ModelTaskOutcomePort, type Tx } from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  asDbTx,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';

type Receipt = Parameters<ModelTaskOutcomePort['record']>[0];
@Injectable()
export class TaskOutcomeService implements ModelTaskOutcomePort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  async record(input: Receipt, transaction?: Tx) {
    if (
      !Id.safeParse(input.taskKey).success ||
      !Id.safeParse(input.userId).success ||
      !ModelPurpose.safeParse(input.purpose).success ||
      (input.usageRecordId != null && !Id.safeParse(input.usageRecordId).success) ||
      (input.reason != null && !/^[a-z][a-z0-9_]{0,79}$/.test(input.reason)) ||
      (input.retryAt != null && !Number.isFinite(Date.parse(input.retryAt)))
    )
      throw new AppError('bad_request', '任务回执字段无效');
    const save = async (tx: DbTx) => {
      if (input.usageRecordId) {
        const linked = await tx.query(
          'SELECT 1 FROM model_access.usage_records WHERE id=$1 AND task_key=$2 AND user_id=$3 AND purpose=$4',
          [input.usageRecordId, input.taskKey, input.userId, input.purpose],
        );
        if (!linked.rows.length) throw new AppError('conflict', '任务和用量记录的归属不一致');
      } else {
        const conflict = await tx.query(
          'SELECT 1 FROM model_access.usage_records WHERE task_key=$1 AND (user_id<>$2 OR purpose<>$3) LIMIT 1',
          [input.taskKey, input.userId, input.purpose],
        );
        if (conflict.rows.length) throw new AppError('conflict', '任务归属不一致');
      }
      const now = this.clock.now();
      const result = await tx.query(
        `INSERT INTO model_access.task_outcomes AS old(task_key,user_id,purpose,state,reason,usage_record_id,retry_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,coalesce((SELECT min(created_at) FROM model_access.usage_records WHERE task_key=$1),$8),$8)
       ON CONFLICT(task_key) DO UPDATE SET state=excluded.state,reason=excluded.reason,usage_record_id=excluded.usage_record_id,retry_at=excluded.retry_at,updated_at=excluded.updated_at
       WHERE old.user_id=excluded.user_id AND old.purpose=excluded.purpose AND
         (old.state NOT IN ('delivered','displayed','saved') OR (old.state=excluded.state AND old.usage_record_id IS NULL AND excluded.usage_record_id IS NOT NULL))
         AND (old.state,old.reason,old.usage_record_id,old.retry_at) IS DISTINCT FROM (excluded.state,excluded.reason,excluded.usage_record_id,excluded.retry_at)
       RETURNING task_key`,
        [
          input.taskKey,
          input.userId,
          input.purpose,
          input.state,
          input.reason ?? null,
          input.usageRecordId ?? null,
          input.state === 'deferred' ? (input.retryAt ?? null) : null,
          now,
        ],
      );
      if (!result.rows.length) {
        const { rows } = await tx.query<{ owned: boolean }>(
          `SELECT (user_id=$2 AND purpose=$3) owned FROM model_access.task_outcomes WHERE task_key=$1`,
          [input.taskKey, input.userId, input.purpose],
        );
        if (!rows[0]?.owned) throw new AppError('conflict', '任务回执归属不一致');
      }
    };
    if (transaction) await save(asDbTx(transaction));
    else await this.db.transaction(save);
  }
}
