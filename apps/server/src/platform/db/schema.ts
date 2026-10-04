/**
 * 平台内核自己的表（PostgreSQL schema `platform`，overview.md 第 4 节）。
 * 业务模块不能直接读写这些表（R8），只能通过平台内核提供的服务：
 * - outbox / event_inbox：事件发件箱与幂等收件箱（events/）
 * - audit_log：审计日志（audit/）
 * - user_data_keys：被主密钥加密的数据密钥（crypto/）
 *
 * 改表结构：改这里 → `pnpm --filter @weiban/server db:generate` 生成迁移 → 手写对应的 .down.sql。
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const platformSchema = pgSchema('platform');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** 事件发件箱：与业务数据同一事务写入，由分发器至少投递一次（ADR-0004 第 2 节）。 */
export const outbox = platformSchema.table(
  'outbox',
  {
    /** 等于事件的 eventId。 */
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    producer: text('producer').notNull(),
    /** 完整的事件对象（契约 Events.DomainEvent），只含 ID 和必要事实，不含正文与密钥。 */
    event: jsonb('event').notNull(),
    occurredAt: tz('occurred_at').notNull(),
    createdAt: tz('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at').notNull(),
    /** 分发器领取后的租约到期时间；进程崩溃时租约过期，别的分发器可以重新领取。 */
    lockedUntil: tz('locked_until'),
    lastError: text('last_error'),
    dispatchedAt: tz('dispatched_at'),
    /** 超过最大重试次数后放弃投递的时间；需要人工处理后清空此字段重投。 */
    deadAt: tz('dead_at'),
  },
  (t) => [
    index('outbox_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.dispatchedAt} is null and ${t.deadAt} is null`),
  ],
);

/** 幂等收件箱：记录「某订阅者已处理某事件」，重复投递直接跳过。 */
export const eventInbox = platformSchema.table(
  'event_inbox',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: tz('processed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.eventId] })],
);

/** 审计日志：管理操作、硬性边界判定、上游密钥登记等（security-and-privacy.md 第 3.2 节）。 */
export const auditLog = platformSchema.table(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    occurredAt: tz('occurred_at').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    /** user / admin / system */
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** 附加信息，写入前经过脱敏；不得放密钥、正文。 */
    details: jsonb('details').notNull().default({}),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_log_occurred_at_idx').on(t.occurredAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

/**
 * 数据密钥（DEK）：只存被主密钥（KEK）加密后的密文。主密钥本身永远不进数据库。
 * owner = 'platform'（平台数据密钥，用于上游密钥）或用户 ID（该用户的导入原文）。
 */
export const userDataKeys = platformSchema.table('user_data_keys', {
  owner: text('owner').primaryKey(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  kekVersion: integer('kek_version').notNull(),
  createdAt: tz('created_at').notNull(),
  rotatedAt: tz('rotated_at'),
});
