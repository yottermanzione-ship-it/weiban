/**
 * 邀请码（ADM-01 第 6 条）：管理员生成一次性邀请码，可设有效期。
 * 生成请求支持 Idempotency-Key 请求头：同一管理员带同一个 key 重复请求，返回同一个码（engineering-standards.md 第 4 节第 3 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { Invite as InviteSchema } from '@weiban/contracts';
import { desc, eq } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { formatInviteCode, generateInviteCode, normalizeInviteCode } from '../domain/rules.js';
import { invites } from '../infra/db/schema.js';

export type Invite = z.infer<typeof InviteSchema>;
type InviteRow = typeof invites.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function toInvite(row: InviteRow): Invite {
  return {
    code: formatInviteCode(row.code),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class InviteService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  /**
   * 生成邀请码。createdBy 为管理员用户 ID（命令行生成时为 null）。
   * idempotencyKey 可选；格式不对返回 400。
   */
  async create(
    expiresInDays: number | null,
    createdBy: string | null,
    idempotencyKey?: string,
  ): Promise<Invite> {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new AppError('bad_request', 'Idempotency-Key 必须是 8–128 位字母、数字、- 或 _');
    }
    const scopedKey = idempotencyKey ? `${createdBy ?? 'cli'}:${idempotencyKey}` : null;
    return this.database.transaction(async (tx) => {
      if (scopedKey) {
        const [existing] = await tx.db
          .select()
          .from(invites)
          .where(eq(invites.idempotencyKey, scopedKey));
        if (existing) return toInvite(existing);
      }
      const now = this.clock.now();
      const code = normalizeInviteCode(generateInviteCode());
      const [row] = await tx.db
        .insert(invites)
        .values({
          code,
          createdAt: now,
          createdBy,
          expiresAt:
            expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY_MS),
          idempotencyKey: scopedKey,
        })
        // 同一个 key 的两个请求同时到达：后到的什么也不插，再读一次已有的
        .onConflictDoNothing({ target: invites.idempotencyKey })
        .returning();
      if (!row) {
        const [existing] = await tx.db
          .select()
          .from(invites)
          .where(eq(invites.idempotencyKey, scopedKey as string));
        return toInvite(existing as InviteRow);
      }
      await this.audit.record(
        {
          module: 'identity',
          action: 'invite.created',
          actorType: createdBy ? 'admin' : 'system',
          actorId: createdBy,
          targetType: 'invite',
          // 不记邀请码本身：审计日志能被更多人看到，码在使用前等同于一次性口令
          details: { expiresInDays },
        },
        tx,
      );
      return toInvite(row);
    });
  }

  async list(): Promise<Invite[]> {
    const rows = await this.database.db.select().from(invites).orderBy(desc(invites.createdAt));
    return rows.map(toInvite);
  }
}
