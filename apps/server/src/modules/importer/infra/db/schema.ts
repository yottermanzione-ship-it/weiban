/**
 * importer 模块的表（T-079，迁移 0055）：导入任务、加密暂存的原文（security-and-privacy.md 5.3）。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });
export const importerSchema = pgSchema('importer');

export const importJobs = importerSchema.table(
  'import_jobs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    kind: text('kind').notNull(),
    targetCharacterId: uuid('target_character_id'),
    sourceKind: text('source_kind').notNull(),
    status: text('status').notNull(),
    /** [{ name, messageCount }]（发言人名字不算原文正文，但仍只给本人看）。 */
    speakers: jsonb('speakers')
      .$type<Array<{ name: string; messageCount: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    selectedSpeaker: text('selected_speaker'),
    charCount: integer('char_count').notNull().default(0),
    truncated: boolean('truncated').notNull().default(false),
    screenshotCount: integer('screenshot_count').notNull().default(0),
    estimatedMicros: bigint('estimated_micros', { mode: 'number' }),
    progress: integer('progress').notNull().default(0),
    keepRaw: boolean('keep_raw').notNull().default(false),
    rawDeletedAt: time('raw_deleted_at'),
    failure: text('failure'),
    /** 分析结果（ImportResult JSON），按用户数据密钥加密（AAD importer:result:{jobId}）；用户保存的修改覆盖此列。 */
    resultCiphertext: bytes('result_ciphertext'),
    /** 0073（契约 3.1，积压 ㉕）：分批导入——本批要合并进的目标任务、实际已合并进的任务（同用户，应用层校验）。 */
    mergeIntoJobId: uuid('merge_into_job_id'),
    mergedIntoJobId: uuid('merged_into_job_id'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('import_jobs_client_idx').on(t.userId, t.clientRequestId),
    index('import_jobs_user_idx').on(t.userId, t.createdAt),
  ],
);

/**
 * 原文暂存：part = text（上传 / 粘贴的原始文字，按块加密）、lines（识别出的对话 JSON，加密）、
 * screenshot（截图，media_id 指向 media 的 import_screenshot，无密文）。
 */
export const importRaw = importerSchema.table(
  'import_raw',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    part: text('part').notNull(),
    seq: integer('seq').notNull().default(0),
    mediaId: uuid('media_id'),
    ciphertext: bytes('ciphertext'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    index('import_raw_job_idx').on(t.jobId, t.part, t.seq),
    index('import_raw_created_idx').on(t.createdAt),
  ],
);
