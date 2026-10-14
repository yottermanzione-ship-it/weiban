/**
 * support 模块的表（3.8，迁移 0092，总对照表 Q9）：帮助与反馈、投诉工单。
 * 截图在 media（purpose = support_image，只有本人可读，管理员经详情取短期链接）。
 * 注销时整行物理删除（SupportService.purgeUser），截图一并删除。
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const supportSchema = pgSchema('support');

export type TicketStatusValue = 'open' | 'replied' | 'resolved';

export interface TicketReplyJson {
  replyId: string;
  from: 'admin' | 'user';
  text: string;
  at: string;
  /** 管理员回复时的管理员 ID（不返回给用户）。 */
  by: string | null;
}

export const tickets = supportSchema.table(
  'tickets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    /** feedback / complaint */
    kind: text('kind').$type<'feedback' | 'complaint'>().notNull(),
    category: text('category'),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    reason: text('reason'),
    text: text('text').notNull(),
    mediaIds: uuid('media_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    conversationId: uuid('conversation_id'),
    characterId: uuid('character_id'),
    status: text('status').$type<TicketStatusValue>().notNull().default('open'),
    replies: jsonb('replies')
      .$type<TicketReplyJson[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    userUnseen: boolean('user_unseen').notNull().default(false),
    handledBy: uuid('handled_by'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
    resolvedAt: time('resolved_at'),
  },
  (t) => [
    uniqueIndex('tickets_client_idx').on(t.userId, t.clientRequestId),
    index('tickets_user_idx').on(t.userId, t.createdAt),
    index('tickets_status_idx').on(t.status, t.createdAt),
    index('tickets_target_idx').on(t.targetId),
  ],
);

export type TicketRow = typeof tickets.$inferSelect;
