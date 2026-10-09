import {
  customType,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });

export const healthSchema = pgSchema('health');

/**
 * period_entries: 每次经期（kind='cycle'）和每天的日记（kind='day_log'）。
 * payload 整行 AES-256-GCM 加密（用户 DEK），AAD = `health:{id}:{user_id}`。
 * 日期字段也在密文里，不在明文列（health-data.md 第 3 节）。
 */
export const periodEntries = healthSchema.table(
  'period_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: bytes('payload').notNull(),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [index('entries_user_idx').on(t.userId)],
);

/**
 * period_settings: 用户的默认周期长度和经期天数（P-37）。
 * payload 整行加密，AAD = `health:settings:{user_id}`。
 */
export const periodSettings = healthSchema.table('period_settings', {
  userId: uuid('user_id').primaryKey(),
  payload: bytes('payload').notNull(),
  updatedAt: time('updated_at').notNull(),
});

/**
 * grants: 授权关系（用户勾选哪个角色可以读取经期摘要）。
 * 授权关系本身不是健康数据，明文存储便于查询。
 */
export const grants = healthSchema.table(
  'grants',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    grantedAt: time('granted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index('grants_user_idx').on(t.userId),
  ],
);
