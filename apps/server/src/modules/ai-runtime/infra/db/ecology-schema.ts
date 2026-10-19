/**
 * 角色生态 v1 的表（迁移 0109–0111，手写 SQL）。单独成文件，避免与 schema.ts 的并行改动冲突；
 * 只用于查询，不参与 drizzle-kit 生成。说明见 docs/ai/ecology-v1.md。
 */
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ai = pgSchema('ai_runtime');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const ecologySettings = ai.table('ecology_settings', {
  userId: uuid('user_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  activityLevel: text('activity_level').notNull().default('often'),
  disabledActions: text('disabled_actions').array().notNull().default([]),
  introSeen: boolean('intro_seen').notNull().default(false),
  pausedReason: text('paused_reason'),
  pausedAt: tz('paused_at'),
  updatedAt: tz('updated_at').notNull(),
});

export const ecologyCharacterSettings = ai.table(
  'ecology_character_settings',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

export const ecologyRuns = ai.table(
  'ecology_runs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    origin: text('origin').notNull(),
    runKey: text('run_key').notNull(),
    localDate: text('local_date').notNull(),
    status: text('status').notNull(),
    actionKey: text('action_key'),
    actionSummary: text('action_summary'),
    outcome: text('outcome'),
    modelKey: text('model_key'),
    chargedMicros: bigint('charged_micros', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    murmurCiphertext: bytea('murmur_ciphertext'),
    scheduledAt: tz('scheduled_at').notNull(),
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [
    unique('ecology_runs_key').on(t.userId, t.characterId, t.runKey),
    index('ecology_runs_pair_idx').on(t.userId, t.characterId, t.createdAt),
    index('ecology_runs_created_idx').on(t.createdAt),
  ],
);

export const ecologyProfiles = ai.table(
  'ecology_profiles',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    statusText: text('status_text'),
    statusUpdatedAt: tz('status_updated_at'),
    signature: text('signature'),
    signatureUpdatedAt: tz('signature_updated_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

export const ecologyConfigTable = ai.table('ecology_config', {
  id: text('id').primaryKey(),
  config: jsonb('config').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: tz('updated_at').notNull(),
});

export const publicMomentDrafts = ai.table(
  'public_moment_drafts',
  {
    characterId: uuid('character_id').notNull(),
    localDate: text('local_date').notNull(),
    status: text('status').notNull(),
    text: text('text'),
    sourceKind: text('source_kind'),
    sourceId: text('source_id'),
    chargedMicros: bigint('charged_micros', { mode: 'number' }).notNull().default(0),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.localDate] })],
);
