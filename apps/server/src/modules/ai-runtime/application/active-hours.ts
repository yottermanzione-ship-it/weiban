/**
 * T-096（T-093 交接遗留）：给 play 提供用户活跃时段（P-06 学到的活跃小时，用户时区 0～23）。
 * 数据来自 T-053 的 user_chat_activity；学习规则与主动消息调度器一致（learnActiveHours）。
 * 数据不足返回 null，play 用 P-05 默认 09:00–23:00。
 * 只依赖数据库、时钟与 identity，避免与 PlayModule 形成提供者循环（play → 本服务 → play）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt } from 'drizzle-orm';
import type { IdentityReadPort } from '@weiban/contracts';
import { CLOCK, DATABASE, type Clock, type Database } from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import type { PlayActiveHours } from '../../play/index.js';
import { userChatActivity } from '../infra/db/schema.js';
import { learnActiveHours, localParts, P06_LEARNING } from './proactive-scheduler.js';

@Injectable()
export class ActiveHoursService implements PlayActiveHours {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
  ) {}

  async getActiveHours(userId: string): Promise<Set<number> | null> {
    const profile = await this.identity.getProfile(userId).catch(() => null);
    const today = localParts(this.clock.now(), profile?.timeZone ?? 'Asia/Shanghai').date;
    const since = new Date(`${today}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - P06_LEARNING.lookbackDays);
    const rows = await this.db.db
      .select({ localDate: userChatActivity.localDate, hour: userChatActivity.hour })
      .from(userChatActivity)
      .where(
        and(
          eq(userChatActivity.userId, userId),
          gte(userChatActivity.localDate, since.toISOString().slice(0, 10)),
          lt(userChatActivity.localDate, today),
        ),
      );
    return learnActiveHours(rows);
  }
}
