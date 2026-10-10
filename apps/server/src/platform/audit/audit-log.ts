/**
 * 审计日志（platform.audit_log）：管理操作、上游密钥登记 / 更换 / 删除、硬性边界判定等。
 *
 *   await audit.record({ module: 'model_access', action: 'upstream.created', actorType: 'admin',
 *                        actorId, targetType: 'upstream', targetId: upstreamId }, tx);
 *
 * details 写入前自动脱敏；但仍然不要放密钥、正文（源头不写）。
 */
import type { Clock } from '../clock/clock.js';
import type { Database, DbTx } from '../db/database.js';
import { newId } from '../db/ids.js';
import { currentLogContext } from '../logging/log-context.js';
import { sanitize } from '../logging/sanitize.js';

export const AUDIT_LOG = Symbol('weiban.platform.audit-log');

export interface AuditEntry {
  module: string;
  action: string;
  actorType: 'user' | 'admin' | 'system';
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

export class AuditLog {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry, tx?: DbTx): Promise<string> {
    const id = newId();
    await (tx ?? this.database).query(
      `INSERT INTO platform.audit_log
         (id, occurred_at, module, action, actor_type, actor_id, target_type, target_id, details, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        this.clock.now(),
        entry.module,
        entry.action,
        entry.actorType,
        entry.actorId ?? null,
        entry.targetType ?? null,
        entry.targetId ?? null,
        JSON.stringify(sanitize(entry.details ?? {})),
        currentLogContext().requestId ?? null,
      ],
    );
    return id;
  }

  /**
   * 注销完成时调用（ACC-06 / ADM-10「审计只记用户 ID 的哈希」）：把审计记录里该用户的明文 ID
   * （对象、details 中出现的）替换为哈希；操作人列是 uuid 类型，置空并把哈希写进 details.actorHash。返回改动的行数。可重复调用。
   */
  async anonymizeUser(userId: string, userHash: string, tx?: DbTx): Promise<number> {
    const result = await (tx ?? this.database).query(
      `UPDATE platform.audit_log
          SET actor_id = CASE WHEN actor_id::text = $1::text THEN NULL ELSE actor_id END,
              target_type = CASE WHEN target_id = $1::text THEN 'user_hash' ELSE target_type END,
              target_id = CASE WHEN target_id = $1::text THEN $2::text ELSE target_id END,
              details = (CASE WHEN strpos(details::text, $1::text) > 0
                              THEN replace(details::text, $1::text, $2::text)::jsonb ELSE details END)
                        || CASE WHEN actor_id::text = $1::text THEN jsonb_build_object('actorHash', $2::text)
                                ELSE '{}'::jsonb END
        WHERE actor_id::text = $1::text OR target_id = $1::text OR strpos(details::text, $1::text) > 0`,
      [userId, userHash],
    );
    return result.rowCount ?? 0;
  }

  /** 核验用：审计记录中仍含该用户明文 ID 的行数（注销完成后必须为 0）。 */
  async countPlainUser(userId: string): Promise<number> {
    const { rows } = await this.database.query<{ n: string }>(
      `SELECT count(*) AS n FROM platform.audit_log
        WHERE actor_id::text = $1::text OR target_id = $1::text OR strpos(details::text, $1::text) > 0`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
