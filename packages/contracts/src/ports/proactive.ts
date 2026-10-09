import type { Tx } from './common.js';
import type { CreateDailyEventRequest, DailyEvent } from '../http/proactive.js';

export interface UpcomingHoliday {
  holidayId: string;
  name: string;
  date: string;
  daysAhead: number;
  romantic: boolean;
}

/** 提供方 proactive；本地日期由调用方按用户 IANA 时区计算。 */
export interface ProactiveMessagePort {
  /** 预检；实际发送必须经过 recordSent 的事务闸门。上限 P03=3/P04=8。 */
  canSendProactive(
    userId: string,
    characterId: string,
    localDate: string,
    perCharacterLimit?: number,
    isHoliday?: boolean,
  ): Promise<boolean>;
  /** 与消息写入共用 Tx。重复键只计一次；超限/待回复/无效关系抛错，调用方回滚消息。 */
  recordSent(
    userId: string,
    characterId: string,
    localDate: string,
    idempotencyKey: string,
    reason: string,
    tx: Tx,
    isHoliday?: boolean,
  ): Promise<number>;
  getDailyCount(userId: string, characterId: string, localDate: string): Promise<number>;
  getDailyTotalCount(userId: string, localDate: string): Promise<number>;
  hasPendingProactive(userId: string, characterId: string): Promise<boolean>;
  markReplied(userId: string, characterId: string, tx?: Tx, repliedAt?: string): Promise<void>;
}

export interface HolidayEventPort {
  /** 包含起始日，最多 366 天；起始日为调用方已计算的用户当地日期。 */
  getUpcoming(fromDate: string, daysAhead: number): Promise<UpcomingHoliday[]>;
  /** 由 identity 资料取 IANA 时区，调用方无需传当地日期。 */
  getUpcomingForUser(userId: string, daysAhead: number): Promise<UpcomingHoliday[]>;
}

/** 日报发布记录；eventId 必须复用来源事件 ID，重投不可生成新 ID。 */
export interface DailyEventPort {
  createBatch(events: CreateDailyEventRequest[], tx?: Tx): Promise<number>;
  listByCharacter(
    userId: string,
    characterId: string,
    opts: { from?: string; to?: string; limit: number; cursor?: string },
  ): Promise<{ items: DailyEvent[]; nextCursor: string | null }>;
}
