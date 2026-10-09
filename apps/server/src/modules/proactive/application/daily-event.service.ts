import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  Id,
  LocalDate,
  CreateDailyEventRequest,
  type DailyEventPort,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  asDbTx,
  CLOCK,
  DATABASE,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { dailyEvents } from '../infra/db/schema.js';
import { ProactiveGuards, validateDate } from './guards.js';
const Cursor = z.object({ userId: Id, characterId: Id, eventDate: LocalDate, id: Id }).strict();
const RETENTION_DAYS = 90;

@Injectable()
export class DailyEventService implements DailyEventPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ProactiveGuards) private readonly guards: ProactiveGuards,
  ) {}
  async createBatch(events: CreateDailyEventRequest[], transaction?: Tx): Promise<number> {
    if (events.length > 50) throw new AppError('bad_request', '日报批次最多 50 条');
    const run = async (tx: DbTx) => {
      // 批量跨用户写入按 UUID 排序加锁，避免相反顺序死锁。
      for (const userId of [...new Set(events.map((e) => e.userId))].sort())
        await this.guards.lock(tx, userId);
      let created = 0;
      for (const input of events) {
        const parsed = CreateDailyEventRequest.safeParse(input);
        if (!parsed.success) throw new AppError('bad_request', '日报内容无效');
        const e = parsed.data;
        await this.guards.requireContact(e.userId, e.characterId, tx);
        const cutoff = this.retentionCutoff();
        if (e.eventDate < cutoff) throw new AppError('bad_request', '日报已超过保留范围');
        const [existing] = await tx.db
          .select()
          .from(dailyEvents)
          .where(eq(dailyEvents.id, e.eventId));
        if (existing) {
          if (
            existing.userId !== e.userId ||
            existing.characterId !== e.characterId ||
            existing.eventDate !== e.eventDate ||
            existing.summary !== e.summary ||
            existing.source !== e.source ||
            existing.eventTime !== (e.eventTime ?? null) ||
            existing.moodEffect !== (e.moodEffect ?? null) ||
            existing.withCharacterId !== (e.withCharacterId ?? null)
          )
            throw new AppError('conflict', '事件 ID 已用于另一条日报');
          continue;
        }
        await tx.db.insert(dailyEvents).values({
          id: e.eventId,
          userId: e.userId,
          characterId: e.characterId,
          eventDate: e.eventDate,
          eventTime: e.eventTime ?? null,
          summary: e.summary,
          withCharacterId: e.withCharacterId ?? null,
          moodEffect: e.moodEffect ?? null,
          source: e.source,
          createdAt: this.clock.now(),
        });
        created++;
      }
      return created;
    };
    return transaction ? run(asDbTx(transaction)) : this.db.transaction(run);
  }
  async listByCharacter(
    userId: string,
    characterId: string,
    opts: { from?: string; to?: string; limit: number; cursor?: string },
  ) {
    await this.guards.requireContact(userId, characterId);
    if (opts.from) validateDate(opts.from);
    if (opts.to) validateDate(opts.to);
    if (opts.from && opts.to && opts.from > opts.to)
      throw new AppError('bad_request', '日期范围顺序无效');
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 100)
      throw new AppError('bad_request', '分页条数无效');
    const cutoff = this.retentionCutoff();
    const conditions = [
      eq(dailyEvents.userId, userId),
      eq(dailyEvents.characterId, characterId),
      gte(dailyEvents.eventDate, opts.from && opts.from > cutoff ? opts.from : cutoff),
    ];
    if (opts.to) conditions.push(lte(dailyEvents.eventDate, opts.to));
    if (opts.cursor) {
      let decoded: z.output<typeof Cursor>;
      try {
        decoded = Cursor.parse(JSON.parse(Buffer.from(opts.cursor, 'base64url').toString()));
      } catch {
        throw new AppError('bad_request', '分页游标无效');
      }
      if (decoded.userId !== userId || decoded.characterId !== characterId)
        throw new AppError('bad_request', '分页游标不属于本角色');
      conditions.push(
        sql`(${dailyEvents.eventDate}, ${dailyEvents.id}) < (${decoded.eventDate}::date, ${decoded.id}::uuid)`,
      );
    }
    const rows = await this.db.db
      .select()
      .from(dailyEvents)
      .where(and(...conditions))
      .orderBy(desc(dailyEvents.eventDate), desc(dailyEvents.id))
      .limit(opts.limit + 1);
    const hasMore = rows.length > opts.limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows.map(toDto),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ userId, characterId, eventDate: last.eventDate, id: last.id }),
            ).toString('base64url')
          : null,
    };
  }
  async remove(eventId: string): Promise<void> {
    if (!Id.safeParse(eventId).success) throw new AppError('bad_request', '事件 ID 无效');
    const result = await this.db.db.delete(dailyEvents).where(eq(dailyEvents.id, eventId));
    if (!result.rowCount) throw new AppError('not_found', '日报不存在');
  }
  async pruneOldEvents(): Promise<number> {
    const result = await this.db.db
      .delete(dailyEvents)
      .where(lt(dailyEvents.eventDate, this.retentionCutoff()));
    return result.rowCount ?? 0;
  }
  private retentionCutoff(): string {
    // 最早时区 UTC-12 仍在前一当地日：多保留一天，避免提前删除。
    return new Date(this.clock.now().getTime() - RETENTION_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);
  }
}
function toDto(row: typeof dailyEvents.$inferSelect) {
  return {
    eventId: row.id,
    userId: row.userId,
    characterId: row.characterId,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    summary: row.summary,
    withCharacterId: row.withCharacterId,
    moodEffect: row.moodEffect,
    source: row.source as 'simulation' | 'public_feed',
    createdAt: row.createdAt.toISOString(),
  };
}
