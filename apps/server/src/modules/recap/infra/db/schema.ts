/**
 * 年度回忆存储（10-25 会员 v6）。表在迁移 0141_recap_year_recaps.sql 里创建。
 *
 * 只存加密后的整份载荷（统计 + 文案，按用户 DEK 信封加密）与三列明文元信息：
 * 哪一年、什么时候生成、什么时候被本人确认看过。没有明文正文、没有角色名。
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgSchema,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const recapSchema = pgSchema('recap');

export const yearRecaps = recapSchema.table(
  'year_recaps',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** 统计年度（2026 = 2026-01-01 00:00 至 2026-12-31 22:00 北京时间）。 */
    year: integer('year').notNull(),
    /** 整份载荷（JSON）按该用户 DEK 加密；只有本人能解开。 */
    payloadCiphertext: bytes('payload_ciphertext').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    /** 推送送达（尝试）时间；投递失败不影响行本身。 */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** 本人确认看过的时间；null = 待自动展示。 */
    seenAt: timestamp('seen_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    unique('year_recaps_owner_year_idx').on(t.userId, t.year),
    index('year_recaps_pending_idx').on(t.userId, t.generatedAt),
    check('year_recaps_year_range', sql`${t.year} BETWEEN 2026 AND 9999`),
    check('year_recaps_version', sql`${t.version} >= 1`),
  ],
);
