import { Injectable, Inject } from '@nestjs/common';
import { Timestamp, type ProactiveMessagePort, type Tx } from '@weiban/contracts';
import { and, eq, count, lte } from 'drizzle-orm';
import {
  AppError,
  asDbTx,
  DATABASE,
  CLOCK,
  type Database,
  type Clock,
  type Db,
  newId,
} from '../../../platform/index.js';
import { proactiveSentLog, proactivePendingReply } from '../infra/db/schema.js';
import { ProactiveGuards, validateDate, validateId } from './guards.js';

const PER_CHARACTER_LIMIT = 3;
const TOTAL_LIMIT = 8;
const REASONS = new Set([
  'daily_event',
  'follow_up',
  'absence',
  'holiday',
  'anniversary',
  'public_feed',
  'safety_follow_up',
  'interactive_play',
]);

@Injectable()
export class ProactiveMessageService implements ProactiveMessagePort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ProactiveGuards) private readonly guards: ProactiveGuards,
  ) {}
  async canSendProactive(
    userId: string,
    characterId: string,
    localDate: string,
    perCharacterLimit = PER_CHARACTER_LIMIT,
    isHoliday = false,
  ): Promise<boolean> {
    validateDate(localDate);
    if (
      !Number.isInteger(perCharacterLimit) ||
      perCharacterLimit < 1 ||
      perCharacterLimit > PER_CHARACTER_LIMIT
    )
      throw new AppError('bad_request', '角色每日上限无效');
    return this.db.transaction(async (tx) => {
      await this.guards.lock(tx, userId);
      await this.guards.requireContact(userId, characterId, tx);
      return (
        (await this.dailyCount(tx.db, userId, localDate, characterId)) < perCharacterLimit &&
        (await this.dailyCount(tx.db, userId, localDate)) < TOTAL_LIMIT &&
        (isHoliday || !(await this.pending(tx.db, userId, characterId)))
      );
    });
  }
  async recordSent(
    userId: string,
    characterId: string,
    localDate: string,
    idempotencyKey: string,
    reason: string,
    transaction: Tx,
    isHoliday = false,
  ): Promise<number> {
    validateDate(localDate);
    if (
      !idempotencyKey.trim() ||
      idempotencyKey.length > 200 ||
      !REASONS.has(reason) ||
      (isHoliday && reason !== 'holiday' && reason !== 'anniversary')
    )
      throw new AppError('bad_request', '主动消息键或理由无效');
    const tx = asDbTx(transaction);
    await this.guards.lock(tx, userId);
    await this.guards.requireContact(userId, characterId, tx);
    const [existing] = await tx.db
      .select()
      .from(proactiveSentLog)
      .where(
        and(
          eq(proactiveSentLog.userId, userId),
          eq(proactiveSentLog.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (
        existing.characterId !== characterId ||
        existing.localDate !== localDate ||
        existing.reason !== reason
      )
        throw new AppError('conflict', '幂等键已用于另一条主动消息');
      return this.dailyCount(tx.db, userId, localDate, characterId);
    }
    const n = await this.dailyCount(tx.db, userId, localDate, characterId);
    if (
      n >= PER_CHARACTER_LIMIT ||
      (await this.dailyCount(tx.db, userId, localDate)) >= TOTAL_LIMIT ||
      (!isHoliday && (await this.pending(tx.db, userId, characterId)))
    )
      throw new AppError('conflict', '主动消息超限或尚未回复');
    const id = newId();
    const now = this.clock.now();
    await tx.db
      .insert(proactiveSentLog)
      .values({ id, userId, characterId, localDate, reason, idempotencyKey, sentAt: now });
    // 节日例外不覆盖原有普通消息的待回复状态。
    if (!isHoliday)
      await tx.db
        .insert(proactivePendingReply)
        .values({ userId, characterId, sentLogId: id, isHoliday: false, createdAt: now })
        .onConflictDoNothing();
    return n + 1;
  }
  async getDailyCount(userId: string, characterId: string, localDate: string): Promise<number> {
    validateId(userId);
    validateId(characterId);
    validateDate(localDate);
    return this.dailyCount(this.db.db, userId, localDate, characterId);
  }
  async getDailyTotalCount(userId: string, localDate: string): Promise<number> {
    validateId(userId);
    validateDate(localDate);
    return this.dailyCount(this.db.db, userId, localDate);
  }
  async hasPendingProactive(userId: string, characterId: string): Promise<boolean> {
    validateId(userId);
    validateId(characterId);
    return this.pending(this.db.db, userId, characterId);
  }
  async markReplied(
    userId: string,
    characterId: string,
    transaction?: Tx,
    repliedAt?: string,
  ): Promise<void> {
    validateId(characterId);
    if (repliedAt && !Timestamp.safeParse(repliedAt).success)
      throw new AppError('bad_request', '回复时间无效');
    const run = async (tx: ReturnType<typeof asDbTx>) => {
      await this.guards.lock(tx, userId);
      await tx.db
        .delete(proactivePendingReply)
        .where(
          and(
            eq(proactivePendingReply.userId, userId),
            eq(proactivePendingReply.characterId, characterId),
            lte(
              proactivePendingReply.createdAt,
              repliedAt ? new Date(repliedAt) : this.clock.now(),
            ),
          ),
        );
    };
    if (transaction) await run(asDbTx(transaction));
    else await this.db.transaction(run);
  }
  private async dailyCount(
    db: Db,
    userId: string,
    localDate: string,
    characterId?: string,
  ): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(proactiveSentLog)
      .where(
        and(
          eq(proactiveSentLog.userId, userId),
          eq(proactiveSentLog.localDate, localDate),
          characterId ? eq(proactiveSentLog.characterId, characterId) : undefined,
        ),
      );
    return Number(row?.n ?? 0);
  }
  private async pending(db: Db, userId: string, characterId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: proactivePendingReply.sentLogId })
      .from(proactivePendingReply)
      .where(
        and(
          eq(proactivePendingReply.userId, userId),
          eq(proactivePendingReply.characterId, characterId),
          eq(proactivePendingReply.isHoliday, false),
        ),
      );
    return !!row;
  }
}
