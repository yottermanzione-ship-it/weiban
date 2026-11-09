import { boolean, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { billingSchema } from './schema.js';
import type { MembershipPlan, ScanPurchase } from '@weiban/contracts';
const tz = (name: string) => timestamp(name, { withTimezone: true });
export interface PurchaseSnapshot {
  plan: MembershipPlan | null;
  firstPurchase: boolean;
  /** 旧待付款订单缺省 legacy，不能误占迁移后的首次权益。 */
  firstPurchaseCampaign?: string;
}
export const scanDevices = billingSchema.table('scan_devices', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  pairHash: text('pair_hash'),
  pairExpiresAt: tz('pair_expires_at').notNull(),
  publicKey: text('public_key'),
  active: boolean('active').notNull(),
  lastSeenAt: tz('last_seen_at'),
  listenerConnected: boolean('listener_connected').notNull(),
  queued: integer('queued').notNull(),
  createdAt: tz('created_at').notNull(),
});
export const scanOrders = billingSchema.table('scan_orders', {
  id: uuid('id').primaryKey(),
  clientOrderId: uuid('client_order_id').notNull(),
  userId: uuid('user_id'),
  channel: text('channel').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  amountFen: integer('amount_fen').notNull(),
  baseFen: integer('base_fen').notNull(),
  points: integer('points').notNull(),
  purchase: jsonb('purchase').$type<ScanPurchase>().notNull(),
  snapshot: jsonb('snapshot').$type<PurchaseSnapshot>().notNull(),
  qr: text('qr').notNull(),
  status: text('status').notNull(),
  createdAt: tz('created_at').notNull(),
  expiresAt: tz('expires_at').notNull(),
  paidAt: tz('paid_at'),
  ledgerEntryId: uuid('ledger_entry_id'),
  membershipOrderId: uuid('membership_order_id'),
});
export const scanReceipts = billingSchema.table('scan_receipts', {
  id: uuid('id').primaryKey(),
  deviceId: uuid('device_id'),
  eventId: text('event_id').notNull(),
  channel: text('channel').notNull(),
  amountFen: integer('amount_fen').notNull(),
  observedAt: tz('observed_at').notNull(),
  postedAt: tz('posted_at').notNull(),
  receivedAt: tz('received_at').notNull(),
  status: text('status').notNull(),
  reason: text('reason').notNull(),
  orderId: uuid('order_id'),
});
