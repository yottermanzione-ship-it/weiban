import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  index,
  pgSchema,
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
