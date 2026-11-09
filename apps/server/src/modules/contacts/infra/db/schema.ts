import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  index,
  integer,
  foreignKey,
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
    /** 「新的朋友」里删除了这条申请记录（0035）。 */
    newFriendHiddenAt: timestamp('new_friend_hidden_at', { withTimezone: true }),
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
    /** 「新的朋友」里删除了这条记录（0035）。 */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
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

/** 「新的朋友」红点游标（0035）。 */
export const newFriendState = contactsSchema.table('new_friend_state', {
  userId: uuid('user_id').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
});

/** Full owner snapshot; tag names are encrypted, command receipts contain no restorable body. */
export const organization = contactsSchema.table(
  'organization',
  {
    userId: uuid('user_id').primaryKey(),
    revision: integer('revision').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('organization_revision_check', sql`${t.revision} BETWEEN 0 AND 2147483647`)],
);
export const organizationStars = contactsSchema.table(
  'organization_stars',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => organization.userId, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    contactEpoch: uuid('contact_epoch').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index('organization_stars_contact_idx').on(t.contactId),
  ],
);
export const organizationTags = contactsSchema.table(
  'organization_tags',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => organization.userId, { onDelete: 'cascade' }),
    tagId: uuid('tag_id').notNull(),
    nameCiphertext: bytes('name_ciphertext').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tagId] }),
    uniqueIndex('organization_tags_user_id_sort_order_key').on(t.userId, t.sortOrder),
    check('organization_tags_sort_order_check', sql`${t.sortOrder} BETWEEN 0 AND 99`),
  ],
);
export const organizationTagMembers = contactsSchema.table(
  'organization_tag_members',
  {
    userId: uuid('user_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    characterId: uuid('character_id').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    contactEpoch: uuid('contact_epoch').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tagId, t.characterId] }),
    foreignKey({
      columns: [t.userId, t.tagId],
      foreignColumns: [organizationTags.userId, organizationTags.tagId],
    }).onDelete('cascade'),
    index('organization_members_contact_idx').on(t.contactId),
  ],
);
export const organizationCommands = contactsSchema.table(
  'organization_commands',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => organization.userId, { onDelete: 'cascade' }),
    commandId: uuid('command_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    appliedRevision: integer('applied_revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.commandId] }),
    check('organization_commands_request_digest_check', sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
    check('organization_commands_applied_revision_check', sql`${t.appliedRevision}>0`),
  ],
);
export const organizationImportReceipts = contactsSchema.table(
  'organization_import_receipts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => organization.userId, { onDelete: 'cascade' }),
    sourceDigest: text('source_digest').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    appliedRevision: integer('applied_revision').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.sourceDigest] }),
    check(
      'organization_import_receipts_source_digest_check',
      sql`${t.sourceDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'organization_import_receipts_payload_digest_check',
      sql`${t.payloadDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check('organization_import_receipts_applied_revision_check', sql`${t.appliedRevision}>0`),
  ],
);
