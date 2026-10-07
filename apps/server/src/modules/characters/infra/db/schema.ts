import {
  pgSchema,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  customType,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
export const charactersSchema = pgSchema('characters');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const categories = charactersSchema.table('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  order: integer('sort_order').notNull(),
});
export const characters = charactersSchema.table(
  'characters',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    name: text('name').notNull(),
    searchText: text('search_text').notNull(),
    categoryId: text('category_id'),
    basis: text('basis').notNull(),
    realPersonKind: text('real_person_kind'),
    ageSetting: text('age_setting').notNull(),
    childAppearance: boolean('child_appearance').notNull(),
    childFeaturesDetected: boolean('child_features_detected').notNull(),
    publishedChildFeaturesDetected: boolean('published_child_features_detected')
      .notNull()
      .default(true),
    everPrivatePerson: boolean('ever_private_person').notNull().default(false),
    draftCiphertext: bytea('draft_ciphertext').notNull(),
    publishedCiphertext: bytea('published_ciphertext'),
    publishedRevision: integer('published_revision'),
    revision: integer('revision').notNull().default(1),
    personaVersion: integer('persona_version').notNull().default(1),
    checks: jsonb('checks')
      .$type<{
        revision: number;
        requiredFieldsComplete: boolean;
        personaStabilityPassed: boolean;
        hardBoundaryCasesPassed: boolean;
        hasFallbackGreeting: boolean;
        checked: boolean;
        error?: string;
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('characters_owner_idx').on(t.ownerId),
    index('characters_plaza_idx').on(t.status, t.categoryId),
  ],
);
export const personaVersions = charactersSchema.table(
  'persona_versions',
  {
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.version] })],
);
