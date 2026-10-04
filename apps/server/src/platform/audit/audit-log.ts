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
}
