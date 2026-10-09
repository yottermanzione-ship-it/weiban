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
    /** 试聊会话（CHR-07 第 6 条），nullable；试聊不建立正式联系人关系。 */
    trialConversationId: uuid('trial_conversation_id'),
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
    /** 修改摘要（会展示给用户，CHR-10）；ADM-06 第 1 条。 */
    summary: text('summary'),
    /** 修改人（管理员用户 ID）。 */
    modifiedBy: uuid('modified_by'),
    /** 该版本发布时的人设稳定检查结果（ADM-06 第 1 条）。 */
    stabilityPassed: boolean('stability_passed').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.version] })],
);

/**
 * 情景模式定义（ADM-05 第 8 条，MODE-04）。
 * 内置模式（is_builtin=true）不能删除，只能修改 preset_prompt 和 enabled。
 * applies_to: 'all' | 'non_minor' | 'adult_eligible'
 */
export const scenarioModes = charactersSchema.table('scenario_modes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  presetPrompt: text('preset_prompt'),
  appliesTo: text('applies_to').notNull().default('all'),
  hasRomanceContent: boolean('has_romance_content').notNull().default(false),
  hasAdultContent: boolean('has_adult_content').notNull().default(false),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * 公开动态（D-L3-02，SIM-03、ADM-03）。迁移 0025_public_updates。
 * 只有 status = 'effective' 且 effective_date 已到的行会经 PublicUpdateReadPort 给 AI 运行时。
 * 日期列用 text（YYYY-MM-DD），与契约 LocalDate 一致，避免时区换算。
 */
export const publicUpdates = charactersSchema.table(
  'public_updates',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    effectiveDate: text('effective_date').notNull(),
    sourceUrl: text('source_url').notNull(),
    /** 规范化后的来源链接，用于候选去重。 */
    sourceKey: text('source_key').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    reviewNote: text('review_note'),
    createdBy: uuid('created_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('public_updates_status_idx').on(t.status, t.createdAt),
    index('public_updates_character_idx').on(t.characterId, t.status, t.startDate),
    index('public_updates_source_key_idx').on(t.characterId, t.sourceKey),
  ],
);

/** 公开动态自动候选设置（单行，id = 'default'）。 */
export const publicUpdateSettings = charactersSchema.table('public_update_settings', {
  id: text('id').primaryKey(),
  autoSearchEnabled: boolean('auto_search_enabled').notNull(),
  lastAutoRunAt: timestamp('last_auto_run_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});
