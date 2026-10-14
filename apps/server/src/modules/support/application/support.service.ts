/**
 * 3.8：帮助与反馈、投诉（总对照表 Q9；契约 SupportEndpoints / SupportAdminEndpoints）。
 *
 * 状态：open（待处理）→ 管理员回复 replied（可同时标记解决）/ 直接标记 resolved；用户补充说明 → 回到 open；
 * 管理员可把 resolved 重新打开为 open。
 * 管理员每次回复 / 标记解决：置 user_unseen、发 data.changed(support)，事务提交后推送一条 system 通知
 * （deepLink /support/tickets/{id}）；推送失败只记日志。
 * 防刷：同一用户 24 小时内最多 20 条（rate_limited）；每条最多 20 次往来。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, type SQL } from 'drizzle-orm';
import {
  CreateSupportTicket,
  SupportTicketKind,
  SupportTicketStatus,
  type AdminSupportTicket,
  type IdentityDirectoryPort,
  type MediaReadPort,
  type MediaSystemPort,
  type PushPort,
  type SupportTicket,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { MEDIA_READ_PORT, MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { PUSH_PORT } from '../../push/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { tickets, type TicketReplyJson, type TicketRow } from '../infra/db/schema.js';

const DAILY_LIMIT = 20;
const MAX_REPLIES = 40;

const REASON_TEXT: Record<string, string> = {
  inappropriate: '内容低俗、不适',
  harassment: '辱骂、骚扰',
  infringement: '侵权',
  real_person: '冒充身边真人',
  minor: '涉及未成年人不当内容',
  fraud: '诈骗、引流',
  other: '其他',
};

const ListMineQuery = z.object({
  kind: SupportTicketKind.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const AdminListQuery = z.object({
  kind: SupportTicketKind.optional(),
  status: SupportTicketStatus.optional(),
  userId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ReplyBody = z.object({ text: z.string().trim().min(1).max(2000) });
const AdminReplyBody = ReplyBody.extend({ resolve: z.boolean().default(false) });

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 0) throw new AppError('bad_request', '分页游标不正确');
  return n;
}
const encodeOffset = (n: number) => Buffer.from(String(n), 'utf8').toString('base64url');

@Injectable()
export class SupportService {
  private readonly logger = new Logger('SupportService');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
    @Optional() @Inject(PUSH_PORT) private readonly push?: PushPort,
    @Optional() @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory?: IdentityDirectoryPort,
  ) {}

  // ---------- 用户端 ----------

  async create(userId: string, input: unknown): Promise<SupportTicket> {
    const body = parseContract(CreateSupportTicket, input);
    const existing = await this.byClientId(userId, body.clientRequestId);
    if (existing) return this.toDto(existing);
    let text = body.text;
    if (body.kind === 'feedback') {
      if (!body.category) throw new AppError('bad_request', '请选择反馈类型');
      if (!text) throw new AppError('bad_request', '请写下你遇到的问题或建议');
    } else {
      if (!body.target) throw new AppError('bad_request', '缺少投诉对象');
      if (!body.reason) throw new AppError('bad_request', '请选择投诉原因');
      if (!text) text = REASON_TEXT[body.reason] ?? '其他';
    }
    const imageIds = [...new Set(body.imageIds ?? [])];
    for (const id of imageIds)
      if (!(await this.media.canUse(userId, id, ['support_image'])))
        throw new AppError('bad_request', '截图无效，请重新上传');
    const now = this.clock.now();
    const row = await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('support:ticket:' || $1, 0))", [
        userId,
      ]);
      const again = await this.byClientId(userId, body.clientRequestId, tx);
      if (again) return again;
      const [recent] = await tx.db
        .select({ n: count() })
        .from(tickets)
        .where(
          and(
            eq(tickets.userId, userId),
            gte(tickets.createdAt, new Date(now.getTime() - 24 * 3600_000)),
          ),
        );
      if ((recent?.n ?? 0) >= DAILY_LIMIT)
        throw new AppError('rate_limited', '今天提交得有点多了，明天再来吧');
      const [created] = await tx.db
        .insert(tickets)
        .values({
          id: newId(),
          userId,
          clientRequestId: body.clientRequestId,
          kind: body.kind,
          category: body.kind === 'feedback' ? body.category! : null,
          targetType: body.kind === 'complaint' ? body.target!.type : null,
          targetId: body.kind === 'complaint' ? body.target!.id : null,
          reason: body.kind === 'complaint' ? body.reason! : null,
          text,
          mediaIds: imageIds,
          conversationId: body.conversationId ?? null,
          characterId:
            body.characterId ??
            (body.kind === 'complaint' && body.target!.type === 'character'
              ? body.target!.id
              : null),
          status: 'open',
          replies: [],
          userUnseen: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.changed(tx, userId, created!.id);
      return created!;
    });
    return this.toDto(row);
  }

  async listMine(userId: string, input: unknown) {
    const q = parseContract(ListMineQuery, input);
    const offset = decodeOffset(q.cursor);
    const conds: SQL[] = [eq(tickets.userId, userId)];
    if (q.kind) conds.push(eq(tickets.kind, q.kind));
    const rows = await this.db.db
      .select()
      .from(tickets)
      .where(and(...conds))
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(q.limit + 1)
      .offset(offset);
    const page = rows.slice(0, q.limit);
    const [unseen] = await this.db.db
      .select({ n: count() })
      .from(tickets)
      .where(and(eq(tickets.userId, userId), eq(tickets.userUnseen, true)));
    return {
      items: await Promise.all(page.map((r) => this.toDto(r))),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
      unseenCount: unseen?.n ?? 0,
    };
  }

  async get(userId: string, ticketId: string): Promise<SupportTicket> {
    const row = await this.own(userId, ticketId);
    if (row.userUnseen) {
      await this.db.transaction(async (tx) => {
        await tx.db.update(tickets).set({ userUnseen: false }).where(eq(tickets.id, row.id));
        await this.changed(tx, userId, row.id);
      });
      row.userUnseen = false;
    }
    return this.toDto(row);
  }

  async addReply(userId: string, ticketId: string, input: unknown): Promise<SupportTicket> {
    const { text } = parseContract(ReplyBody, input);
    await this.own(userId, ticketId);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, ticketId);
      if (current.status === 'resolved')
        throw new AppError('conflict', '这条已处理完毕，有新问题请重新提交');
      if (current.replies.length >= MAX_REPLIES)
        throw new AppError('conflict', '往来次数已达上限，请重新提交一条');
      const [next] = await tx.db
        .update(tickets)
        .set({
          status: 'open',
          replies: [...current.replies, this.reply('user', text, null)],
          updatedAt: this.clock.now(),
        })
        .where(eq(tickets.id, current.id))
        .returning();
      await this.changed(tx, userId, current.id);
      return next!;
    });
    return this.toDto(row);
  }

  async markAllSeen(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const done = await tx.db
        .update(tickets)
        .set({ userUnseen: false })
        .where(and(eq(tickets.userId, userId), eq(tickets.userUnseen, true)))
        .returning({ id: tickets.id });
      if (done.length) await this.changed(tx, userId, null);
    });
  }

  // ---------- 管理端 ----------

  async adminList(input: unknown) {
    const q = parseContract(AdminListQuery, input);
    const offset = decodeOffset(q.cursor);
    const conds: SQL[] = [];
    if (q.kind) conds.push(eq(tickets.kind, q.kind));
    if (q.status) conds.push(eq(tickets.status, q.status));
    if (q.userId) conds.push(eq(tickets.userId, q.userId));
    if (q.targetId) conds.push(eq(tickets.targetId, q.targetId));
    const order =
      q.status === 'open'
        ? [asc(tickets.createdAt), asc(tickets.id)]
        : [desc(tickets.createdAt), desc(tickets.id)];
    const rows = await this.db.db
      .select()
      .from(tickets)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const page = rows.slice(0, q.limit);
    const [open] = await this.db.db
      .select({ n: count() })
      .from(tickets)
      .where(eq(tickets.status, 'open'));
    const names = await this.usernames(page.map((r) => r.userId));
    return {
      items: await Promise.all(page.map((r) => this.toAdminDto(r, names))),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
      openCount: open?.n ?? 0,
    };
  }

  async adminGet(ticketId: string): Promise<AdminSupportTicket> {
    const row = await this.find(ticketId);
    return this.toAdminDto(row, await this.usernames([row.userId]));
  }

  async adminReply(adminId: string, ticketId: string, input: unknown) {
    const { text, resolve } = parseContract(AdminReplyBody, input);
    return this.adminChange(adminId, ticketId, 'reply', true, async (tx, current) => {
      if (current.replies.length >= MAX_REPLIES) throw new AppError('conflict', '往来次数已达上限');
      const now = this.clock.now();
      const [next] = await tx.db
        .update(tickets)
        .set({
          status: resolve ? 'resolved' : 'replied',
          replies: [...current.replies, this.reply('admin', text, adminId)],
          userUnseen: true,
          handledBy: adminId,
          updatedAt: now,
          resolvedAt: resolve ? now : null,
        })
        .where(eq(tickets.id, current.id))
        .returning();
      return next!;
    });
  }

  async adminResolve(adminId: string, ticketId: string) {
    return this.adminChange(adminId, ticketId, 'resolve', true, async (tx, current) => {
      if (current.status === 'resolved') return current;
      const now = this.clock.now();
      const [next] = await tx.db
        .update(tickets)
        .set({
          status: 'resolved',
          userUnseen: true,
          handledBy: adminId,
          updatedAt: now,
          resolvedAt: now,
        })
        .where(eq(tickets.id, current.id))
        .returning();
      return next!;
    });
  }

  async adminReopen(adminId: string, ticketId: string) {
    return this.adminChange(adminId, ticketId, 'reopen', false, async (tx, current) => {
      if (current.status !== 'resolved') return current;
      const [next] = await tx.db
        .update(tickets)
        .set({ status: 'open', handledBy: adminId, updatedAt: this.clock.now(), resolvedAt: null })
        .where(eq(tickets.id, current.id))
        .returning();
      return next!;
    });
  }

  // ---------- 注销 ----------

  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.db
        .delete(tickets)
        .where(eq(tickets.userId, userId))
        .returning({ media: tickets.mediaIds });
      for (const r of rows)
        for (const m of r.media)
          await this.media.deleteObject(m, tx as unknown as Tx).catch(() => undefined);
      return rows.length;
    });
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(tickets)
      .where(eq(tickets.userId, userId));
    return r?.n ?? 0;
  }

  // ---------- 内部 ----------

  private reply(from: 'admin' | 'user', text: string, by: string | null): TicketReplyJson {
    return { replyId: newId(), from, text, at: this.clock.now().toISOString(), by };
  }

  private async adminChange(
    adminId: string,
    ticketId: string,
    action: string,
    notifyUser: boolean,
    run: (tx: DbTx, current: TicketRow) => Promise<TicketRow>,
  ): Promise<AdminSupportTicket> {
    let notify: TicketRow | null = null;
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, ticketId);
      const next = await run(tx, current);
      if (next !== current) {
        if (notifyUser) notify = next;
        await this.changed(tx, next.userId, next.id);
        await this.audit.record(
          {
            module: 'support',
            action: `support.ticket_${action}`,
            actorType: 'admin',
            actorId: adminId,
            targetType: 'support_ticket',
            targetId: ticketId,
            details: { kind: next.kind, status: next.status },
          },
          tx,
        );
      }
      return next;
    });
    if (notify) await this.pushStatus(notify);
    return this.toAdminDto(row, await this.usernames([row.userId]));
  }

  private async byClientId(userId: string, clientRequestId: string, tx?: DbTx) {
    const [row] = await (tx ?? this.db).db
      .select()
      .from(tickets)
      .where(and(eq(tickets.userId, userId), eq(tickets.clientRequestId, clientRequestId)));
    return row ?? null;
  }

  private async find(ticketId: string): Promise<TicketRow> {
    const [row] = await this.db.db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!row) throw new AppError('not_found', '记录不存在');
    return row;
  }

  private async own(userId: string, ticketId: string): Promise<TicketRow> {
    const row = await this.find(ticketId);
    if (row.userId !== userId) throw new AppError('not_found', '记录不存在');
    return row;
  }

  private async lock(tx: DbTx, ticketId: string): Promise<TicketRow> {
    const [row] = await tx.db.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
    if (!row) throw new AppError('not_found', '记录不存在');
    return row;
  }

  private async changed(tx: DbTx, userId: string, ticketId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section: 'support', characterId: null, itemId: ticketId },
    });
  }

  private async pushStatus(row: TicketRow): Promise<void> {
    if (!this.push) return;
    const what = row.kind === 'complaint' ? '投诉' : '反馈';
    const last = [...row.replies].reverse().find((r) => r.from === 'admin');
    const body =
      row.status === 'resolved' && !last
        ? `你的${what}已处理完毕`
        : `官方回复了你的${what}：${last?.text ?? ''}`;
    try {
      await this.push.send({
        userId: row.userId,
        kind: 'system',
        title: '帮助与反馈',
        body: body.length > 100 ? `${body.slice(0, 99)}…` : body,
        deepLink: `/support/tickets/${row.id}`,
        conversationId: null,
        dedupeKey: `support:${row.id}:${row.status}:${row.replies.length}`,
        dedupeWindowHours: 1,
        respectsDoNotDisturb: true,
      });
    } catch (e) {
      this.logger.warn(`工单 ${row.id} 推送失败：${String(e)}`);
    }
  }

  private async usernames(userIds: string[]): Promise<Record<string, string>> {
    const ids = [...new Set(userIds)];
    if (!ids.length || !this.directory) return {};
    try {
      return await this.directory.getUsernames(ids);
    } catch {
      return {};
    }
  }

  private async images(row: TicketRow) {
    return Promise.all(
      row.mediaIds.map(async (mediaId) => {
        try {
          return { mediaId, url: (await this.mediaRead.getMedia(row.userId, mediaId)).url };
        } catch {
          return { mediaId, url: null };
        }
      }),
    );
  }

  private async toDto(row: TicketRow): Promise<SupportTicket> {
    return {
      ticketId: row.id,
      kind: row.kind,
      category: (row.category as SupportTicket['category']) ?? null,
      target:
        row.targetType && row.targetId
          ? { type: row.targetType as 'character' | 'plaza_work', id: row.targetId }
          : null,
      reason: (row.reason as SupportTicket['reason']) ?? null,
      text: row.text,
      images: await this.images(row),
      conversationId: row.conversationId,
      characterId: row.characterId,
      status: row.status,
      replies: row.replies.map((r) => ({
        replyId: r.replyId,
        from: r.from,
        text: r.text,
        createdAt: r.at,
      })),
      unseen: row.userUnseen,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  private async toAdminDto(
    row: TicketRow,
    names: Record<string, string>,
  ): Promise<AdminSupportTicket> {
    return {
      ...(await this.toDto(row)),
      userId: row.userId,
      username: names[row.userId] ?? null,
      handledBy: row.handledBy,
    };
  }
}
