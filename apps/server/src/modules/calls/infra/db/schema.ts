import { pgSchema, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const callsSchema = pgSchema('calls');
/** 通话会话（迁移 0044）。state：ringing / connecting / active / ended。 */
export const callSessions = callsSchema.table(
  'call_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    direction: text('direction').notNull(),
    state: text('state').notNull(),
    outcome: text('outcome'),
    /** 幂等键：拨打用 clientRequestId，来电用 ai-runtime 的 idempotencyKey（加前缀 in:）。 */
    requestKey: text('request_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    durationSec: integer('duration_sec').notNull().default(0),
    /** 当前持有音频流的连接（实例内随机 ID）；断线后为 null。 */
    streamConnection: text('stream_connection'),
    /** 音频流断开的时刻（等待重连，CALL_LIMITS.reconnectGraceSec）。 */
    streamLostAt: timestamp('stream_lost_at', { withTimezone: true, mode: 'date' }),
    /** 通话中首次发现余额用完的时刻（30 秒内道别，MDL-10 第 5 条）。 */
    balanceLowAt: timestamp('balance_low_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('call_sessions_request_uq').on(t.userId, t.requestKey),
    uniqueIndex('call_sessions_one_open_uq')
      .on(t.userId)
      .where(sql`${t.state} <> 'ended'`),
    index('call_sessions_open_idx')
      .on(t.state)
      .where(sql`${t.state} <> 'ended'`),
  ],
);
