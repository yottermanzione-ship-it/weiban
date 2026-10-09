import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const contactsSchema = pgSchema('contacts');
export const contacts = contactsSchema.table(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    status: text('status').notNull(),
    requestId: uuid('request_id').notNull(),
    acceptanceMode: text('acceptance_mode').notNull(),
    acceptAfter: timestamp('accept_after', { withTimezone: true }).notNull(),
    remark: text('remark'),
    customAvatarMediaId: uuid('custom_avatar_media_id'),
    addressAs: text('address_as'),
    knownSince: date('known_since', { mode: 'string' }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull(),
    conversationId: uuid('conversation_id'),
    relationshipType: text('relationship_type').notNull(),
    greetingCiphertext: bytes('greeting_ciphertext'),
    referrerCharacterId: uuid('referrer_character_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contact_user_character_idx').on(t.userId, t.characterId),
    index('contact_user_status_idx').on(t.userId, t.status),
    index('contact_purge_idx').on(t.purgeAfter),
    check('contact_status', sql`${t.status} IN ('pending','active','deleted')`),
    check(
      'contact_acceptance_mode',
      sql`${t.acceptanceMode} IN ('new','restored','fresh_after_delete')`,
    ),
    check(
      'contact_deletion_state',
      sql`(${t.status} = 'deleted' AND ${t.deletedAt} IS NOT NULL AND ${t.purgeAfter} IS NOT NULL) OR (${t.status} <> 'deleted' AND ${t.deletedAt} IS NULL AND ${t.purgeAfter} IS NULL)`,
    ),
  ],
);

/** 名片推荐记录（CHR-04、P-27，迁移 0033）：所有角色合计每 7 天最多主动推荐 1 次。 */
export const cardRecommendations = contactsSchema.table(
  'card_recommendations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    recommenderCharacterId: uuid('recommender_character_id').notNull(),
    messageId: uuid('message_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('card_recommendations_message_idx').on(t.userId, t.messageId),
    index('card_recommendations_user_idx').on(t.userId, t.createdAt),
  ],
);

/** 名片「不感兴趣」（P-27：该角色冷却 90 天）。 */
export const cardDismissals = contactsSchema.table(
  'card_dismissals',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);
