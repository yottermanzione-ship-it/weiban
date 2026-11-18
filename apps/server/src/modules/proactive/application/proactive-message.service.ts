/**
 * 主动消息计数与待回复状态服务（SIM-05 第 4、6 条）。
 * 实现 ProactiveMessagePort。
 */
import { Injectable, Inject } from '@nestjs/common';
import type { ProactiveMessagePort } from '@weiban/contracts';
import { and, eq, count, sql } from 'drizzle-orm';
import { DATABASE, CLOCK, type Database, type Clock, newId } from '../../../platform/index.js';
import { proactiveSentLog, proactivePendingReply } from '../infra/db/schema.js';

@Injectable()
export class ProactiveMessageService implements ProactiveMessagePort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canSendProactive(
    userId: string,
    characterId: string,
    localDate: string,
    perCharacterLimit: number,
  ): Promise<boolean> {
    const current = await this.getDailyCount(userId, characterId, localDate);
    return current < perCharacterLimit;
  }

  async recordSent(
    userId: string,
    characterId: string,
    localDate: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<number> {
    const now = this.clock.now();

    // Upsert via ON CONFLICT DO NOTHING — same key is a no-op.
    await this.db
      .insert(proactiveSentLog)
      .values({
        id: newId(),
        userId,
        characterId,
        localDate,
        reason,
        idempotencyKey,
        sentAt: now,
      })
      .onConflictDoNothing({ target: proactiveSentLog.idempotencyKey });

    // Mark pending reply for this character (non-holiday by default, caller overrides by marking holiday separately).
    await this.db
      .insert(proactivePendingReply)
      .values({
        userId,
        characterId,
        sentLogId: idempotencyKey, // reuse key as ref
        isHoliday: false,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [proactivePendingReply.userId, proactivePendingReply.characterId] });

    return this.getDailyCount(userId, characterId, localDate);
  }

  async getDailyCount(userId: string, characterId: string, localDate: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(proactiveSentLog)
      .where(
        and(
          eq(proactiveSentLog.userId, userId),
          eq(proactiveSentLog.characterId, characterId),
          eq(proactiveSentLog.localDate, localDate),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async getDailyTotalCount(userId: string, localDate: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(proactiveSentLog)
      .where(
        and(
          eq(proactiveSentLog.userId, userId),
          eq(proactiveSentLog.localDate, localDate),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async hasPendingProactive(userId: string, characterId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: proactivePendingReply.userId })
      .from(proactivePendingReply)
      .where(
        and(
          eq(proactivePendingReply.userId, userId),
          eq(proactivePendingReply.characterId, characterId),
          eq(proactivePendingReply.isHoliday, false),
        ),
      );
    return row !== undefined;
  }

  async markReplied(userId: string, characterId: string): Promise<void> {
    await this.db
      .delete(proactivePendingReply)
      .where(
        and(
          eq(proactivePendingReply.userId, userId),
          eq(proactivePendingReply.characterId, characterId),
        ),
      );
  }
}
