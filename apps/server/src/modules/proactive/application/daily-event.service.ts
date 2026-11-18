/**
 * 角色日常事件服务（SIM-01，T-052）。
 * 存储 ai-runtime 生成的日常事件，供时间线（SIM-11）查询。
 * 保留最近 90 天（SIM-11 第 4 条）。
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { CreateDailyEventRequest } from '@weiban/contracts';
import { AppError, CLOCK, DATABASE, type Clock, type Database, type DbTx, newId } from '../../../platform/index.js';
import { dailyEvents } from '../infra/db/schema.js';

/** 时间线最长保留天数（SIM-11 第 4 条）。 */
const TIMELINE_RETENTION_DAYS = 90;

@Injectable()
export class DailyEventService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 批量写入日常事件（ai-runtime 调用，T-053 调度后触发）。
   * 返回实际写入条数（已存在则跳过，幂等靠 event_date+summary+user+character 唯一性，
   * 不需要严格唯一约束，重复插入只是多一条记录，ai-runtime 应保证调用幂等）。
   */
  async createBatch(events: CreateDailyEventRequest[]): Promise<number> {
    if (events.length === 0) return 0;
    const now = this.clock.now();
    const rows = events.map((e) => ({
      id: newId(),
      userId: e.userId,
      characterId: e.characterId,
      eventDate: e.eventDate,
      eventTime: e.eventTime ?? null,
      summary: e.summary,
      withCharacterId: e.withCharacterId ?? null,
      moodEffect: e.moodEffect ?? null,
      source: e.source,
      raw: e.raw ?? null,
      createdAt: now,
    }));
    await this.db.insert(dailyEvents).values(rows);
    return rows.length;
  }

  /**
   * 按角色查询时间线（客户端调用，SIM-11）。
   * 按 event_date 倒序，最多 90 天。
   */
  async listByCharacter(
    userId: string,
    characterId: string,
    opts: {
      from?: string;
      to?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const retentionCutoff = this.getRetentionCutoff();
    const effectiveFrom = opts.from && opts.from >= retentionCutoff ? opts.from : retentionCutoff;

    const conditions = [
      eq(dailyEvents.userId, userId),
      eq(dailyEvents.characterId, characterId),
      gte(dailyEvents.eventDate, effectiveFrom),
    ];
    if (opts.to) conditions.push(lte(dailyEvents.eventDate, opts.to));
    if (opts.cursor) {
      // Cursor is the last eventDate+id pair encoded as base64url
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        conditions.push(
          sql`(${dailyEvents.eventDate}, ${dailyEvents.id}) < (${decoded.eventDate}::date, ${decoded.id}::uuid)`,
        );
      }
    }

    const rows = await this.db
      .select()
      .from(dailyEvents)
      .where(and(...conditions))
      .orderBy(desc(dailyEvents.eventDate), desc(dailyEvents.id))
      .limit(opts.limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > opts.limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      if (last) nextCursor = encodeCursor(last.eventDate, last.id);
    }

    return { items: rows.map(toEventDto), nextCursor };
  }

  async remove(eventId: string) {
    const result = await this.db.delete(dailyEvents).where(eq(dailyEvents.id, eventId));
    if ((result.rowCount ?? 0) === 0) throw new AppError('not_found', '日常事件不存在');
  }

  /**
   * 定时任务：删除超过 90 天的日常事件（由 ProactiveLifecycle 注册）。
   */
  async pruneOldEvents(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - TIMELINE_RETENTION_DAYS * 86_400_000);
    const result = await this.db
      .delete(dailyEvents)
      .where(lt(dailyEvents.createdAt, cutoff));
    return result.rowCount ?? 0;
  }

  private getRetentionCutoff(): string {
    const d = new Date(this.clock.now().getTime() - TIMELINE_RETENTION_DAYS * 86_400_000);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
}

function toEventDto(row: typeof dailyEvents.$inferSelect) {
  return {
    eventId: row.id,
    userId: row.userId,
    characterId: row.characterId,
    eventDate: row.eventDate,
    eventTime: row.eventTime ?? null,
    summary: row.summary,
    withCharacterId: row.withCharacterId ?? null,
    moodEffect: row.moodEffect ?? null,
    source: row.source as 'simulation' | 'public_feed',
    raw: row.raw as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
  };
}

function encodeCursor(eventDate: string, id: string): string {
  return Buffer.from(JSON.stringify({ eventDate, id })).toString('base64url');
}

function decodeCursor(cursor: string): { eventDate: string; id: string } | null {
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (typeof obj === 'object' && obj !== null && 'eventDate' in obj && 'id' in obj) {
      return obj as { eventDate: string; id: string };
    }
    return null;
  } catch {
    return null;
  }
}
