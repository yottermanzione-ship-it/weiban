import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AdminAlertFacts } from '@weiban/contracts';
export const pushSchema = pgSchema('push');
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });

/** 凭证只有摘要和用户DEK密文。跨账号重绑同一凭证时必须重加密。 */
export const pushDevices = pushSchema.table(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    credentialHash: text('credential_hash').notNull(),
    credentialCiphertext: bytes('credential_ciphertext').notNull(),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    unique('push_credential_idx').on(t.credentialHash),
    index('push_device_session_idx').on(t.userId, t.sessionId),
    check('push_device_kind', sql`${t.kind} IN ('webpush','android')`),
  ],
);

/** 每次逻辑提醒独立记录；锁用户后查去重窗口，事件键永久幂等，正文DEK加密。 */
export const pushRequests = pushSchema.table(
  'requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id'),
    kind: text('kind').notNull(),
    respectsDoNotDisturb: boolean('respects_do_not_disturb').notNull().default(false),
    modelContext: jsonb('model_context').$type<{
      modelKey: string;
      previousDefaultFor: ('chat' | 'background' | 'vision')[];
    }>(),
    dedupeKey: text('dedupe_key').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    payloadCiphertext: bytes('payload_ciphertext'),
    createdAt: time('created_at').notNull(),
    expiresAt: time('expires_at').notNull(),
  },
  (t) => [
    unique('push_event_user_idx').on(t.userId, t.eventId),
    index('push_request_dedupe_idx').on(t.userId, t.dedupeKey, t.createdAt),
    index('push_request_expiry_idx').on(t.expiresAt),
  ],
);

/** 每设备的持久投递与时延日志；不存供应商回包/错误正文，成功/取消清密文。 */
export const pushDeliveries = pushSchema.table(
  'deliveries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    requestId: uuid('request_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    collapseKey: text('collapse_key').notNull(),
    payloadCiphertext: bytes('payload_ciphertext'),
    count: integer('count').notNull().default(1),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    dueAt: time('due_at').notNull(),
    leaseUntil: time('lease_until'),
    createdAt: time('created_at').notNull(),
    acceptedAt: time('accepted_at'),
    providerMessageId: text('provider_message_id'),
    reason: text('reason'),
  },
  (t) => [
    unique('push_request_device_idx').on(t.requestId, t.deviceId),
    index('push_delivery_due_idx').on(t.status, t.dueAt),
    index('push_delivery_collapse_idx').on(t.deviceId, t.collapseKey, t.createdAt),
    check(
      'push_delivery_status',
      sql`${t.status} IN ('queued','sending','delivered','cancelled','failed')`,
    ),
    check('push_delivery_counters', sql`${t.count}>0 AND ${t.attempts}>=0 AND ${t.attempts}<=4`),
  ],
);

/** 固定平台事实，不含消息/用户名/密钥；同一问题开放期间只累加。 */
export const adminAlerts = pushSchema.table(
  'admin_alerts',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    summary: text('summary').notNull(),
    refs: jsonb('refs').$type<AdminAlertFacts['refs']>(),
    occurrences: integer('occurrences').notNull().default(1),
    firstRaisedAt: time('first_raised_at').notNull(),
    lastRaisedAt: time('last_raised_at').notNull(),
    acknowledgedAt: time('acknowledged_at'),
    acknowledgedByUserId: uuid('acknowledged_by_user_id'),
  },
  (t) => [
    uniqueIndex('push_open_alert_idx')
      .on(t.dedupeKey)
      .where(sql`${t.acknowledgedAt} IS NULL`),
    index('push_alert_recent_idx').on(t.lastRaisedAt, t.id),
    check('push_alert_occurrences', sql`${t.occurrences}>0`),
  ],
);
