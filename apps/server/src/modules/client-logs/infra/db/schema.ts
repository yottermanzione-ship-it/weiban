/** Technical diagnostics only. Cross-module ownership goes through ports. */
import {
  bigint,
  boolean,
  date,
  integer,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ClientRuntimeEvent } from '@weiban/contracts';
const schema = pgSchema('client_logs');
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const issueGroups = schema.table(
  'issue_groups',
  {
    fingerprint: text('fingerprint').primaryKey(),
    kind: text('kind').notNull(),
    appKind: text('app_kind').notNull(),
    title: text('title').notNull(),
    firstSeenAt: time('first_seen_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
    totalCount: bigint('total_count', { mode: 'number' }).notNull().default(0),
    firstVersion: text('first_version').notNull(),
    lastVersion: text('last_version').notNull(),
    status: text('status').notNull().default('open'),
    note: text('note').notNull().default(''),
    alerted: boolean('alerted').notNull().default(false),
  },
  (t) => [index('client_issues_recent').on(t.lastSeenAt.desc())],
);
export const events = schema.table(
  'events',
  {
    id: uuid('id').primaryKey(),
    fingerprint: text('fingerprint')
      .notNull()
      .references(() => issueGroups.fingerprint, { onDelete: 'cascade' }),
    ownerKey: text('owner_key').notNull(),
    clientId: uuid('client_id').notNull(),
    userId: uuid('user_id'),
    sessionId: uuid('session_id').notNull(),
    version: text('version').notNull(),
    count: integer('count').notNull(),
    event: jsonb('event').$type<ClientRuntimeEvent>().notNull(),
    occurredAt: time('occurred_at').notNull(),
    receivedAt: time('received_at').notNull(),
  },
  (t) => [
    unique().on(t.ownerKey, t.clientId),
    index('client_events_user').on(t.userId, t.receivedAt.desc()),
    index('client_events_issue').on(t.fingerprint, t.receivedAt.desc()),
    index('client_events_session').on(t.ownerKey, t.sessionId),
    index('client_events_retention').on(t.receivedAt),
  ],
);
export const groupUsers = schema.table(
  'group_users',
  {
    fingerprint: text('fingerprint')
      .notNull()
      .references(() => issueGroups.fingerprint, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fingerprint, t.userId] }),
    index('client_group_users_recent').on(t.fingerprint, t.lastSeenAt.desc()),
  ],
);
export const issueDays = schema.table(
  'issue_days',
  {
    fingerprint: text('fingerprint')
      .notNull()
      .references(() => issueGroups.fingerprint, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    count: bigint('count', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.fingerprint, t.day] })],
);
export const sessions = schema.table(
  'sessions',
  {
    ownerKey: text('owner_key').notNull(),
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id'),
    appKind: text('app_kind').notNull(),
    version: text('version').notNull(),
    build: text('build').notNull(),
    seenAt: time('seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerKey, t.sessionId] }),
    index('client_sessions_version').on(t.appKind, t.version, t.seenAt),
    index('client_sessions_retention').on(t.seenAt),
  ],
);
export const releaseVersions = schema.table(
  'release_versions',
  {
    appKind: text('app_kind').notNull(),
    version: text('version').notNull(),
    firstSeenAt: time('first_seen_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.appKind, t.version] })],
);
export const rateWindows = schema.table(
  'rate_windows',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id'),
    expiresAt: time('expires_at').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [index('client_rate_retention').on(t.expiresAt)],
);
export const ticketEvents = schema.table(
  'ticket_events',
  {
    ticketId: uuid('ticket_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    events: jsonb('events').$type<ClientRuntimeEvent[]>().notNull(),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    index('client_ticket_events_user').on(t.userId),
    index('client_ticket_events_retention').on(t.createdAt),
  ],
);
