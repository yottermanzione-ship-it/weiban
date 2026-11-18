/**
 * 节日/纪念日管理服务（SIM-09 第 1 条）。
 * 提供 HolidayEventPort 实现：把 annual（MM-DD）展开为当年具体日期，支持跨年。
 */
import { Injectable } from '@nestjs/common';
import type { HolidayEventPort, UpcomingHoliday } from '@weiban/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { AppError, CLOCK, DATABASE, type Clock, type Database, newId } from '../../../platform/index.js';
import { holidays } from '../infra/db/schema.js';
import type { CreateHolidayRequest, UpdateHolidayRequest } from '@weiban/contracts';
import { Inject } from '@nestjs/common';

@Injectable()
export class HolidayService implements HolidayEventPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getUpcoming(fromDate: string, daysAhead: number): Promise<UpcomingHoliday[]> {
    const rows = await this.db.select().from(holidays).where(eq(holidays.enabled, true));
    const result: UpcomingHoliday[] = [];

    for (const row of rows) {
      const expanded = expandHolidayDate(row.dateType, row.dateValue, fromDate, daysAhead);
      if (expanded) {
        result.push({
          holidayId: row.id,
          name: row.name,
          date: expanded.date,
          daysAhead: expanded.daysAhead,
          romantic: row.romantic,
        });
      }
    }

    return result.sort((a, b) => a.daysAhead - b.daysAhead);
  }

  async list(opts: { enabled?: boolean; cursor?: string; limit: number }) {
    const where = opts.enabled !== undefined ? eq(holidays.enabled, opts.enabled) : undefined;
    const rows = await this.db
      .select()
      .from(holidays)
      .where(where)
      .orderBy(asc(holidays.createdAt))
      .limit(opts.limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > opts.limit) {
      rows.pop();
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }
    return { items: rows.map(toHolidayDto), nextCursor };
  }

  async create(input: CreateHolidayRequest) {
    validateDateValue(input.dateType, input.dateValue);
    const now = this.clock.now();
    const id = newId();
    const [row] = await this.db
      .insert(holidays)
      .values({
        id,
        name: input.name,
        dateType: input.dateType,
        dateValue: input.dateValue,
        romantic: input.romantic ?? false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toHolidayDto(row!);
  }

  async update(holidayId: string, input: UpdateHolidayRequest) {
    if (input.dateValue) {
      // We need dateType to validate — read the existing row first
      const [existing] = await this.db.select().from(holidays).where(eq(holidays.id, holidayId));
      if (!existing) throw new AppError('not_found', '节日不存在');
      validateDateValue(existing.dateType, input.dateValue);
    }
    const now = this.clock.now();
    const [row] = await this.db
      .update(holidays)
      .set({ ...input, updatedAt: now })
      .where(eq(holidays.id, holidayId))
      .returning();
    if (!row) throw new AppError('not_found', '节日不存在');
    return toHolidayDto(row);
  }

  async remove(holidayId: string) {
    const result = await this.db.delete(holidays).where(eq(holidays.id, holidayId));
    if ((result.rowCount ?? 0) === 0) throw new AppError('not_found', '节日不存在');
  }
}

// ---------- 工具函数 ----------

function toHolidayDto(row: typeof holidays.$inferSelect) {
  return {
    holidayId: row.id,
    name: row.name,
    dateType: row.dateType as 'once' | 'annual',
    dateValue: row.dateValue,
    romantic: row.romantic,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateDateValue(dateType: string, dateValue: string) {
  if (dateType === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new AppError('bad_request', 'once 类型节日日期格式必须为 YYYY-MM-DD');
  }
  if (dateType === 'annual' && !/^\d{2}-\d{2}$/.test(dateValue)) {
    throw new AppError('bad_request', 'annual 类型节日日期格式必须为 MM-DD');
  }
}

/**
 * 把节日展开为从 fromDate 起 daysAhead 天内的具体日期。
 * annual 节日要处理跨年：12 月底的 fromDate 加上 daysAhead 可能到达次年 1 月。
 */
function expandHolidayDate(
  dateType: string,
  dateValue: string,
  fromDate: string,
  daysAhead: number,
): { date: string; daysAhead: number } | null {
  const from = parseLocalDate(fromDate);
  const toDate = addDaysToDate(from, daysAhead - 1);

  if (dateType === 'once') {
    const target = parseLocalDate(dateValue);
    const diff = dateDiff(from, target);
    if (diff >= 0 && diff < daysAhead) return { date: dateValue, daysAhead: diff };
    return null;
  }

  // annual: MM-DD — check this year and next year
  const [mm, dd] = dateValue.split('-').map(Number) as [number, number];
  for (const year of [from.y, from.y + 1]) {
    const candidate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const target = parseLocalDate(candidate);
    const diff = dateDiff(from, target);
    if (diff >= 0 && diff < daysAhead) return { date: candidate, daysAhead: diff };
  }
  return null;
}

function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

function addDaysToDate(date: { y: number; m: number; d: number }, days: number) {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function dateDiff(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  const msA = Date.UTC(a.y, a.m - 1, a.d);
  const msB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((msB - msA) / 86_400_000);
}
