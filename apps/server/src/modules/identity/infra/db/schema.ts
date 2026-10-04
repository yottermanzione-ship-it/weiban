/**
 * identity 模块的表（PostgreSQL schema `identity`，overview.md 第 4 节）。
 * 表说明见 docs/backend/identity.md 第 3 节。只有 identity 模块能读写；别的模块用 IdentityReadPort。
 *
 * 改表结构：改这里 → `pnpm --filter @weiban/server db:generate` 生成迁移 → 手写对应的 .down.sql。
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const identitySchema = pgSchema('identity');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** 账号。用户名不区分大小写唯一。 */
export const users = identitySchema.table(
  'users',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    /** argon2id 哈希（PHC 字符串，含盐和参数）。 */
    passwordHash: text('password_hash').notNull(),
    /** user / admin */
    role: text('role').notNull(),
    /** active / deleting（注销中：已下线、不能登录，等各模块删除完毕后整行删除） */
    status: text('status').notNull(),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
    /** 最近一次使用任一会话的时间（IdentityReadPort.getLastActiveAt，P-17）。 */
    lastActiveAt: tz('last_active_at'),
    deletionRequestedAt: tz('deletion_requested_at'),
  },
  (t) => [
    uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
    check('users_role_check', sql`${t.role} in ('user', 'admin')`),
    check('users_status_check', sql`${t.status} in ('active', 'deleting')`),
  ],
);

/** 设备会话：令牌只存 SHA-256 哈希。退出 / 踢下线 / 过期即删除整行。 */
export const sessions = identitySchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** app / admin */
    kind: text('kind').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    /** 契约 DeviceInfo：平台、设备名、App 版本、时区。 */
    device: jsonb('device').notNull(),
    createdAt: tz('created_at').notNull(),
    lastActiveAt: tz('last_active_at').notNull(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_kind_check', sql`${t.kind} in ('app', 'admin')`),
  ],
);

/** 我的资料（ACC-02），每个用户一行，注册时写入默认值。 */
export const profiles = identitySchema.table('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  avatarMediaId: uuid('avatar_media_id'),
  birthday: date('birthday', { mode: 'string' }),
  gender: text('gender').notNull(),
  city: text('city'),
  about: text('about'),
  timeZone: text('time_zone').notNull(),
  updatedAt: tz('updated_at').notNull(),
});

/** 全局通知与免打扰（ACC-03），每个用户一行。 */
export const notificationSettings = identitySchema.table('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  proactiveMessagesEnabled: boolean('proactive_messages_enabled').notNull(),
  proactiveCallsEnabled: boolean('proactive_calls_enabled').notNull(),
  pushSoundEnabled: boolean('push_sound_enabled').notNull(),
  pushShowContent: boolean('push_show_content').notNull(),
  dndEnabled: boolean('dnd_enabled').notNull(),
  /** HH:mm（用户当地时间） */
  dndStart: text('dnd_start').notNull(),
  dndEnd: text('dnd_end').notNull(),
  allowCharacterGroupInvites: boolean('allow_character_group_invites').notNull(),
  updatedAt: tz('updated_at').notNull(),
});

/** 界面偏好（SVC-01 第 7 条：主题，所有设备同步），每个用户一行。 */
export const preferences = identitySchema.table('preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').notNull(),
  updatedAt: tz('updated_at').notNull(),
});

/** 邀请码（一次性，可设有效期）。code 存归一化后的值（大写、无连字符）。 */
export const invites = identitySchema.table(
  'invites',
  {
    code: text('code').primaryKey(),
    createdAt: tz('created_at').notNull(),
    /** 生成者（管理员用户 ID）；命令行生成时为空。管理员账号删除后置空。 */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: tz('expires_at'),
    usedAt: tz('used_at'),
    /** 用这个码注册的账号；账号注销删除后置空（used_at 仍保留，码依然算已用）。 */
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    /** 生成请求的 Idempotency-Key（同一个 key 重复请求返回同一个码）。 */
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    uniqueIndex('invites_idempotency_key_key').on(t.idempotencyKey),
    index('invites_created_at_idx').on(t.createdAt),
  ],
);

/** 登录失败计数与锁定。key = sha256('username:<小写用户名>' 或 'ip:<IP>')，库里不存 IP 原文。 */
export const loginThrottle = identitySchema.table('login_throttle', {
  key: bytea('key').primaryKey(),
  failures: integer('failures').notNull(),
  lastFailedAt: tz('last_failed_at').notNull(),
  lockedUntil: tz('locked_until'),
});

/** 注销进度：每个模块回报 platform.user_data_purged 后记一行；全部回报后删除账号（行随账号级联删除）。 */
export const deletionProgress = identitySchema.table(
  'deletion_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    deletedRows: integer('deleted_rows').notNull(),
    reportedAt: tz('reported_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.module] })],
);
