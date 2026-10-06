import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgSchema,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const realtimeSchema = pgSchema('realtime');
export const userUpdateCursors = realtimeSchema.table(
  'user_update_cursors',
  {
    userId: uuid('user_id').primaryKey(),
    lastUpdateSeq: bigint('last_update_seq', { mode: 'number' }).notNull().default(0),
    trimmedThrough: bigint('trimmed_through', { mode: 'number' }).notNull().default(0),
    lastUserActivityAt: timestamp('last_user_activity_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'cursor_range',
      sql`${t.trimmedThrough} >= 0 AND ${t.trimmedThrough} <= ${t.lastUpdateSeq} AND ${t.lastUpdateSeq} <= 9007199254740991`,
    ),
  ],
);
export const userUpdates = realtimeSchema.table(
  'user_updates',
  {
    userId: uuid('user_id').notNull(),
    updateSeq: bigint('update_seq', { mode: 'number' }).notNull(),
    encryptedPayload: bytes('encrypted_payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.updateSeq] }),
    index('updates_retention_idx').on(t.occurredAt),
    check('update_seq_range', sql`${t.updateSeq} > 0 AND ${t.updateSeq} <= 9007199254740991`),
  ],
);

export const devicePresence = realtimeSchema.table(
  'device_presence',
  {
    sessionId: uuid('session_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    conversationId: uuid('conversation_id'),
    foreground: boolean('foreground').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('presence_user_idx').on(t.userId)],
);
