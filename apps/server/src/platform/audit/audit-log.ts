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

/** 读出的一条审计（details 是写入时脱敏后的内容）。 */
export interface AuditRecord {
  id: string;
  occurredAt: Date;
  action: string;
  actorId: string | null;
  details: Record<string, unknown>;
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
   * 5.6（T-20261104e）：按对象读最近的审计记录（后台页面显示「谁、何时、改了什么、原因」用）。
   * 只读本平台写入的审计；模块不要自己去查 platform.audit_log。
   */
  async list(filter: {
    module: string;
    targetType: string;
    targetId: string;
    /** 只要动作以此开头的记录（例如 'search.'）。 */
    actionPrefix?: string;
    limit?: number;
  }): Promise<AuditRecord[]> {
    const { rows } = await this.database.query<{
      id: string;
      occurred_at: Date;
      action: string;
      actor_id: string | null;
      details: Record<string, unknown> | null;
    }>(
      `SELECT id, occurred_at, action, actor_id, details
         FROM platform.audit_log
        WHERE module = $1 AND target_type = $2 AND target_id = $3
          AND ($5::text IS NULL OR starts_with(action, $5::text))
        ORDER BY occurred_at DESC, id DESC
        LIMIT $4`,
      [
        filter.module,
        filter.targetType,
        filter.targetId,
        Math.min(filter.limit ?? 50, 200),
        filter.actionPrefix ?? null,
      ],
    );
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      actorId: row.actor_id,
      details: row.details ?? {},
    }));
  }

  /**
   * 注销完成时调用（ACC-06 / ADM-10「审计只记用户 ID 的哈希」）：把审计记录里该用户的明文 ID
   * （对象、details 中出现的）替换为哈希；操作人列是 uuid 类型，置空并把哈希写进 details.actorHash。
   * 旧改名审计的账号名一并移除，包括此前已替换成哈希的记录。返回改动的行数。可重复调用。
   */
  async anonymizeUser(userId: string, userHash: string, tx?: DbTx): Promise<number> {
    const result = await (tx ?? this.database).query(
      `UPDATE platform.audit_log
          SET actor_id = CASE WHEN actor_id::text = $1::text THEN NULL ELSE actor_id END,
              target_type = CASE WHEN target_id = $1::text THEN 'user_hash' ELSE target_type END,
              target_id = CASE WHEN target_id = $1::text THEN $2::text ELSE target_id END,
              details = ((CASE WHEN strpos(details::text, $1::text) > 0
                              THEN replace(details::text, $1::text, $2::text)::jsonb ELSE details END)
                        - CASE WHEN module = 'identity' AND action = 'alias.updated'
                               THEN ARRAY['previous', 'username'] ELSE ARRAY[]::text[] END)
                        || CASE WHEN actor_id::text = $1::text THEN jsonb_build_object('actorHash', $2::text)
                                ELSE '{}'::jsonb END
        WHERE actor_id::text = $1::text OR target_id = $1::text OR strpos(details::text, $1::text) > 0
           OR (module = 'identity' AND action = 'alias.updated'
               AND (target_id = $2::text OR details->>'actorHash' = $2::text)
               AND details ?| ARRAY['previous', 'username'])`,
      [userId, userHash],
    );
    return result.rowCount ?? 0;
  }

  /** 核验用：明文 ID 或已匿名化改名审计里仍残留账号名的行数，注销后必须为 0。 */
  async countPlainUser(userId: string, userHash?: string): Promise<number> {
    const { rows } = await this.database.query<{ n: string }>(
      `SELECT count(*) AS n FROM platform.audit_log
        WHERE actor_id::text = $1::text OR target_id = $1::text OR strpos(details::text, $1::text) > 0
           OR (module = 'identity' AND action = 'alias.updated'
               AND (target_id = $2::text OR details->>'actorHash' = $2::text)
               AND details ?| ARRAY['previous', 'username'])`,
      [userId, userHash ?? null],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
