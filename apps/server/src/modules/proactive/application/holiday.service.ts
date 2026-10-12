import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  LocalDate,
  type HolidayEventPort,
  type UpcomingHoliday,
  type IdentityReadPort,
  type CreateHolidayRequest,
  type UpdateHolidayRequest,
} from '@weiban/contracts';
import { and, asc, eq, gt } from 'drizzle-orm';
import { isValidLunarMonthDay, lunarToSolar } from './lunar.js';
import {
  AppError,
  CLOCK,
  DATABASE,
  type Clock,
  type Database,
  newId,
} from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { holidays } from '../infra/db/schema.js';
import { validateDate, validateId } from './guards.js';

@Injectable()
export class HolidayService implements HolidayEventPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
  ) {}
  async getUpcomingForUser(userId: string, daysAhead: number): Promise<UpcomingHoliday[]> {
    validateId(userId);
    const profile = await this.identity.getProfile(userId);
    if (!profile) throw new AppError('not_found', '用户不存在');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: profile.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(this.clock.now());
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    return this.getUpcoming(part('year') + '-' + part('month') + '-' + part('day'), daysAhead);
  }
  async getUpcoming(fromDate: string, daysAhead: number): Promise<UpcomingHoliday[]> {
    validateDate(fromDate);
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 366)
      throw new AppError('bad_request', '节日查询天数应为 1–366');
    const rows = await this.db.db.select().from(holidays).where(eq(holidays.enabled, true));
    const result: UpcomingHoliday[] = [];
    const year = Number(fromDate.slice(0, 4));
    for (const row of rows) {
      const dates = occurrences(row, year);
      for (const date of dates) {
        // 2 月 29 日在非闰年跳过，不滚动到 3 月。
        if (!LocalDate.safeParse(date).success) continue;
        const diff = Math.round(
          (Date.parse(date + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000,
        );
        if (diff >= 0 && diff < daysAhead)
          result.push({
            holidayId: row.id,
            name: row.name,
            date,
            daysAhead: diff,
            romantic: row.romantic,
            category: row.category === 'traditional' ? 'traditional' : 'common',
            sendCard: row.sendCard,
            cardTemplateId: row.cardTemplateId,
            characterCategories: row.characterCategories,
          });
      }
    }
    return result.sort(
      (a, b) => a.daysAhead - b.daysAhead || a.holidayId.localeCompare(b.holidayId),
    );
  }
  async list(opts: {
    enabled?: boolean;
    category?: string;
    romantic?: boolean;
    cursor?: string;
    limit: number;
  }) {
    if (opts.cursor && !Id.safeParse(opts.cursor).success)
      throw new AppError('bad_request', '分页游标无效');
    const rows = await this.db.db
      .select()
      .from(holidays)
      .where(
        and(
          opts.enabled !== undefined ? eq(holidays.enabled, opts.enabled) : undefined,
          opts.category !== undefined ? eq(holidays.category, opts.category) : undefined,
          opts.romantic !== undefined ? eq(holidays.romantic, opts.romantic) : undefined,
          opts.cursor ? gt(holidays.id, opts.cursor) : undefined,
        ),
      )
      .orderBy(asc(holidays.id))
      .limit(opts.limit + 1);
    const hasMore = rows.length > opts.limit;
    if (hasMore) rows.pop();
    const today = beijingToday(this.clock.now());
    return {
      items: rows.map((r) => toDto(r, today)),
      nextCursor: hasMore ? rows.at(-1)!.id : null,
    };
  }
  async create(input: CreateHolidayRequest) {
    validateDateValue(input.dateType, input.dateValue);
    const now = this.clock.now();
    const [row] = await this.db.db
      .insert(holidays)
      .values({
        id: newId(),
        name: input.name,
        dateType: input.dateType,
        dateValue: input.dateValue,
        romantic: input.romantic,
        category: input.category ?? 'common',
        sendCard: input.sendCard ?? true,
        cardTemplateId: input.cardTemplateId ?? null,
        characterCategories: [...new Set(input.characterCategories ?? [])],
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toDto(row!, beijingToday(now));
  }
  async update(holidayId: string, input: UpdateHolidayRequest) {
    validateId(holidayId);
    const [existing] = await this.db.db.select().from(holidays).where(eq(holidays.id, holidayId));
    if (!existing) throw new AppError('not_found', '节日不存在');
    if (input.dateType && input.dateType !== existing.dateType && !input.dateValue)
      throw new AppError('bad_request', '修改日期规则时必须同时填写日期');
    if (input.dateValue) validateDateValue(input.dateType ?? existing.dateType, input.dateValue);
    const { characterCategories, ...rest } = input;
    const [row] = await this.db.db
      .update(holidays)
      .set({
        ...rest,
        ...(characterCategories ? { characterCategories: [...new Set(characterCategories)] } : {}),
        updatedAt: this.clock.now(),
      })
      .where(eq(holidays.id, holidayId))
      .returning();
    if (!row) throw new AppError('not_found', '节日不存在');
    return toDto(row, beijingToday(this.clock.now()));
  }
  async remove(holidayId: string): Promise<void> {
    validateId(holidayId);
    const result = await this.db.db.delete(holidays).where(eq(holidays.id, holidayId));
    if (!result.rowCount) throw new AppError('not_found', '节日不存在');
  }
}
function validateDateValue(type: string, value: string): void {
  if (type === 'once') {
    validateDate(value);
    return;
  }
  if (type === 'lunar_annual') {
    if (!isValidLunarMonthDay(value))
      throw new AppError('bad_request', '农历节日应为有效农历 MM-DD');
    return;
  }
  if (
    type !== 'annual' ||
    !/^\d{2}-\d{2}$/.test(value) ||
    !LocalDate.safeParse('2000-' + value).success
  )
    throw new AppError('bad_request', '年度节日应为有效 MM-DD');
}
type HolidayRow = typeof holidays.$inferSelect;
/** 某公历年及次年里该节日对应的公历日期（农历按 ICU 换算；2 月 29 日等不存在的日期由调用方跳过）。 */
function occurrences(row: HolidayRow, year: number): string[] {
  if (row.dateType === 'once') return [row.dateValue];
  if (row.dateType === 'lunar_annual')
    return [lunarToSolar(year, row.dateValue), lunarToSolar(year + 1, row.dateValue)].filter(
      (d): d is string => d !== null,
    );
  return [year + '-' + row.dateValue, year + 1 + '-' + row.dateValue];
}
function beijingToday(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
function toDto(row: HolidayRow, today: string) {
  const upcomingDates = occurrences(row, Number(today.slice(0, 4)))
    .filter((d) => LocalDate.safeParse(d).success && d >= today)
    .slice(0, 2);
  return {
    holidayId: row.id,
    name: row.name,
    dateType: row.dateType as 'once' | 'annual' | 'lunar_annual',
    dateValue: row.dateValue,
    romantic: row.romantic,
    enabled: row.enabled,
    category: (row.category === 'traditional' ? 'traditional' : 'common') as
      'traditional' | 'common',
    sendCard: row.sendCard,
    cardTemplateId: row.cardTemplateId,
    characterCategories: row.characterCategories as Array<
      'celebrity' | 'historical' | 'private_person' | 'fictional' | 'original'
    >,
    upcomingDates,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
