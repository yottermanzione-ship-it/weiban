/**
 * 慢信（PLAY-05，T-093）。
 *
 * 状态机：来信 draft → sent；回信 in_transit（reply_state：pending_body 等生成 → body_ready 等送达）→ delivered → 已读（read_at）。
 * - 寄信：私聊写信件卡片（发送者为用户）；同时建一封 in_transit 回信，按 P-42（6～24 小时随机）、用户活跃时段
 *   （P-06 学到的小时，缺省 P-05 09:00–23:00）、每个角色每个当地日期最多送达 1 封（多的顺延，replyDelayed = true）
 *   算好 deliver_at；发 play.letter_sent（ai-runtime 在 deliver_at 前约 10 分钟生成回信）。
 * - 回信正文经 PlayAgentPort.deliverLetterReply 到达：已到 deliver_at 立即送达；没到就存好，到点由任务送达。
 *   余额不足 / 模型故障时正文迟迟不到，信保持「在路上」不丢；正文补到后（已过点）立即送达。
 * - 送达：私聊写信件卡片（发送者为角色）→ delivered → 推送「XX 给你寄来了一封信」（push 按信件卡片消息发 kind = letter）
 *   → 第一次收到该角色回信发瞬间卡（PLAY_CARD_ISSUER）→ play.letter_delivered → data.changed(letters)。
 * - 送达前接口只给「信件在路上」：body = null。信箱红点 = 已送达未读的信数，读信后消失。
 * - 角色进入回收期：在路上的回信不再送达（删除）；彻底删除时该角色的信全部删除。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  Id,
  LetterEndpoints,
  PLAY_LIMITS,
  type Letter,
  type PortResult,
  type Tx,
} from '@weiban/contracts';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import {
  AppError,
  DATABASE,
  ENVELOPE_CRYPTO,
  LOGGER,
  OUTBOX,
  P05_DEFAULT_ACTIVE_WINDOW,
  newId,
  parseContract,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import { letters } from '../infra/db/schema.js';
import {
  PLAY_ACTIVE_HOURS,
  PLAY_CARD_ISSUER,
  type PlayActiveHours,
  type PlayCardIssuer,
} from '../tokens.js';
import { PlayContext, isUniqueViolation, localDateIn } from './context.js';
import type { PlayFeature } from './play-feature.js';
import { PlayJobs } from './play-jobs.js';

type LetterRow = typeof letters.$inferSelect;
type SendBody = z.infer<NonNullable<typeof LetterEndpoints.sendLetter.body>>;
type DraftBody = z.infer<NonNullable<typeof LetterEndpoints.saveDraft.body>>;
type Box = 'received' | 'sent' | 'drafts';

export const LETTER_DELIVER_JOB = 'play.letter_deliver';
const PAGE = 30;
const HOUR = 3_600_000;
const SLOT_MINUTES = 15;
/** 送达前多久的回信算「待生成」（ai-runtime 约提前 10 分钟取）。 */
const PENDING_LOOKAHEAD_MS = 15 * 60_000;
const aad = (id: string) => `play:letter:${id}`;

function hourIn(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .find((p) => p.type === 'hour')?.value;
  return Number(h ?? 0) % 24;
}

function defaultHours(): Set<number> {
  const start = Number(P05_DEFAULT_ACTIVE_WINDOW.start.slice(0, 2));
  const end = Number(P05_DEFAULT_ACTIVE_WINDOW.end.slice(0, 2));
  const hours = new Set<number>();
  for (let h = start; h !== end; h = (h + 1) % 24) hours.add(h);
  return hours;
}

function encodeCursor(row: LetterRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(at ?? '');
  if (!id || Number.isNaN(date.getTime()) || !Id.safeParse(id).success)
    throw new AppError('bad_request', '分页游标不正确');
  return { at: date, id };
}

@Injectable()
export class LettersService implements PlayFeature, OnModuleInit {
  readonly featureName = 'letters';

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(PlayContext) private readonly ctx: PlayContext,
    @Inject(PlayJobs) private readonly jobs: PlayJobs,
    @Optional() @Inject(PLAY_CARD_ISSUER) private readonly cards?: PlayCardIssuer,
    @Optional() @Inject(PLAY_ACTIVE_HOURS) private readonly activeHours?: PlayActiveHours,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.register<{ letterId: string }>(LETTER_DELIVER_JOB, ({ letterId }) =>
      this.deliverIfDue(letterId),
    );
  }

  // ---------- 用户接口 ----------

  async listLetters(
    userId: string,
    query: { box: Box; characterId?: string; cursor?: string },
  ): Promise<{ items: Letter[]; nextCursor: string | null }> {
    const after = decodeCursor(query.cursor);
    const boxFilter =
      query.box === 'received'
        ? and(
            eq(letters.direction, 'from_character'),
            inArray(letters.status, ['in_transit', 'delivered']),
          )
        : query.box === 'sent'
          ? and(eq(letters.direction, 'to_character'), eq(letters.status, 'sent'))
          : eq(letters.status, 'draft');
    const rows = await this.db.db
      .select()
      .from(letters)
      .where(
        and(
          eq(letters.userId, userId),
          boxFilter,
          query.characterId ? eq(letters.characterId, query.characterId) : undefined,
          after
            ? or(
                lt(letters.createdAt, after.at),
                and(eq(letters.createdAt, after.at), lt(letters.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(letters.createdAt), desc(letters.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const items: Letter[] = [];
    for (const row of page) items.push(await this.toDto(row));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > PAGE && last ? encodeCursor(last) : null };
  }

  async getLetter(userId: string, letterId: string): Promise<Letter> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx.db
        .select()
        .from(letters)
        .where(and(eq(letters.id, letterId), eq(letters.userId, userId)))
        .for('update');
      if (!current) throw new AppError('not_found', '信不存在');
      if (
        current.direction === 'from_character' &&
        current.status === 'delivered' &&
        !current.readAt
      ) {
        const now = this.ctx.clock.now();
        await tx.db
          .update(letters)
          .set({ readAt: now, updatedAt: now })
          .where(eq(letters.id, letterId));
        await this.ctx.dataChanged(tx, userId, 'letters', current.characterId, letterId);
        return { ...current, readAt: now, updatedAt: now };
      }
      return current;
    });
    return this.toDto(row);
  }

  async saveDraft(userId: string, characterId: string, raw: unknown): Promise<Letter> {
    const body: DraftBody = parseContract(LetterEndpoints.saveDraft.body!, raw);
    await this.ctx.requireActiveContact(userId, characterId);
    const row = await this.db.transaction(async (tx) => {
      const now = this.ctx.clock.now();
      const [draft] = await tx.db
        .select()
        .from(letters)
        .where(
          and(
            eq(letters.userId, userId),
            eq(letters.characterId, characterId),
            eq(letters.status, 'draft'),
          ),
        )
        .for('update');
      const id = draft?.id ?? newId();
      const sealed = await this.crypto.seal(userId, aad(id), body.body, tx);
      if (draft) {
        await tx.db
          .update(letters)
          .set({ bodyCiphertext: sealed, updatedAt: now })
          .where(eq(letters.id, id));
      } else {
        await tx.db.insert(letters).values({
          id,
          userId,
          characterId,
          direction: 'to_character',
          status: 'draft',
          bodyCiphertext: sealed,
          createdAt: now,
          updatedAt: now,
        });
      }
      const [saved] = await tx.db.select().from(letters).where(eq(letters.id, id));
      return saved!;
    });
    return this.toDto(row);
  }

  async sendLetter(
    userId: string,
    raw: unknown,
  ): Promise<{
    letter: Letter;
    replyDelayed: boolean;
    replyDelayReason: 'already_replied_today' | 'outside_active_window' | null;
  }> {
    const body: SendBody = parseContract(LetterEndpoints.sendLetter.body!, raw);
    const retry = await this.findByKey(userId, body.characterId, body.clientRequestId);
    if (retry) return this.sentResult(retry);
    await this.ctx.requireActiveContact(userId, body.characterId);
    const timeZone = await this.ctx.timeZone(userId);
    try {
      const row = await this.db.transaction(async (tx) => {
        // 同一用户同一角色的寄信串行化（每天 1 封的判断不被并发绕过）。
        await tx.db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`play:letter:${userId}:${body.characterId}`}))`,
        );
        const now = this.ctx.clock.now();
        const id = newId();
        await tx.db.insert(letters).values({
          id,
          userId,
          characterId: body.characterId,
          direction: 'to_character',
          status: 'sent',
          bodyCiphertext: await this.crypto.seal(userId, aad(id), body.body, tx),
          sentAt: now,
          idempotencyKey: body.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });
        // 寄出后这个角色的草稿清掉。
        await tx.db
          .delete(letters)
          .where(
            and(
              eq(letters.userId, userId),
              eq(letters.characterId, body.characterId),
              eq(letters.status, 'draft'),
            ),
          );
        const message = await this.ctx.postToDirectChat(tx, {
          userId,
          characterId: body.characterId,
          sender: 'user',
          content: { type: 'letter', letterId: id, direction: 'to_character', body: body.body },
          idempotencyKey: body.clientRequestId,
        });
        await tx.db.update(letters).set({ messageId: message.messageId }).where(eq(letters.id, id));

        // 回信：定好送达时间，先在路上。
        const plan = await this.planDelivery(tx, userId, body.characterId, timeZone, now);
        const replyId = newId();
        await tx.db.insert(letters).values({
          id: replyId,
          userId,
          characterId: body.characterId,
          direction: 'from_character',
          status: 'in_transit',
          replyState: 'pending_body',
          inReplyToLetterId: id,
          deliverAt: plan.deliverAt,
          deliverLocalDate: plan.localDate,
          createdAt: now,
          updatedAt: now,
        });
        await this.jobs.at(LETTER_DELIVER_JOB, { letterId: replyId }, plan.deliverAt, {
          tx,
          singletonKey: `letter:${replyId}`,
        });
        await this.outbox.publish(tx, 'play.letter_sent', 'play', {
          userId,
          characterId: body.characterId,
          letterId: id,
          deliverAt: plan.deliverAt.toISOString(),
        });
        await this.ctx.postPlayNotice(tx, {
          userId,
          characterId: body.characterId,
          code: 'letter_sent',
          params: {
            letterId: id,
            characterName: await this.ctx.characterName(userId, body.characterId, tx),
            expectedAt: plan.deliverAt.toISOString(),
          },
          idempotencyKey: `play:letter_sent:${id}`,
        });
        await this.ctx.dataChanged(tx, userId, 'letters', body.characterId, id);
        const [saved] = await tx.db.select().from(letters).where(eq(letters.id, id));
        return saved!;
      });
      return this.sentResult(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findByKey(userId, body.characterId, body.clientRequestId);
        if (again) return this.sentResult(again);
      }
      throw error;
    }
  }

  async getBadge(userId: string): Promise<{ unreadCount: number }> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(letters)
      .where(
        and(
          eq(letters.userId, userId),
          eq(letters.direction, 'from_character'),
          eq(letters.status, 'delivered'),
          isNull(letters.readAt),
        ),
      );
    return { unreadCount: Number(r?.n ?? 0) };
  }

  // ---------- 给 ai-runtime（PlayReadPort / PlayAgentPort） ----------

  /** 待生成的回信：送达前 15 分钟内或已过点（余额恢复后补生成）还没有正文的。 */
  async listPendingReplies(userId: string) {
    const horizon = new Date(this.ctx.clock.nowMs() + PENDING_LOOKAHEAD_MS);
    const rows = await this.db.db
      .select()
      .from(letters)
      .where(
        and(
          eq(letters.userId, userId),
          eq(letters.status, 'in_transit'),
          eq(letters.replyState, 'pending_body'),
          lte(letters.deliverAt, horizon),
        ),
      )
      .orderBy(letters.deliverAt)
      .limit(20);
    return rows.map((r) => ({
      letterId: r.id,
      characterId: r.characterId,
      inReplyToLetterId: r.inReplyToLetterId,
      deliverAt: (r.deliverAt ?? r.createdAt).toISOString(),
    }));
  }

  async getBody(letterId: string): Promise<string | null> {
    const [row] = await this.db.db.select().from(letters).where(eq(letters.id, letterId));
    if (!row?.bodyCiphertext) return null;
    return this.open(row);
  }

  /**
   * 回信正文到达。已到 deliver_at：立即送达并返回私聊消息 ID；还没到：存好正文，到点由任务送达，
   * 此时返回的 messageId 是回信的 letterId 占位（真正的消息 ID 送达后见 Letter.messageId）。
   */
  async deliverReply(input: {
    letterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ messageId: string }, 'not_found' | 'contact_inactive'>> {
    const text = input.body.trim().slice(0, 4000);
    if (!text) return { ok: false, error: 'not_found', message: '回信正文为空' };
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(letters)
        .where(and(eq(letters.id, input.letterId), eq(letters.direction, 'from_character')))
        .for('update');
      if (!row) return { ok: false, error: 'not_found', message: '回信不存在' };
      if (row.status === 'delivered')
        return { ok: true, value: { messageId: row.messageId ?? row.id } };
      if (
        !(await this.ctx.contacts.getActiveContact(
          row.userId,
          row.characterId,
          tx as unknown as Tx,
        ))
      )
        return { ok: false, error: 'contact_inactive', message: '角色不在通讯录中' };
      const sealed = await this.crypto.seal(row.userId, aad(row.id), text, tx);
      await tx.db
        .update(letters)
        .set({ bodyCiphertext: sealed, replyState: 'body_ready', updatedAt: this.ctx.clock.now() })
        .where(eq(letters.id, row.id));
      if (row.deliverAt && row.deliverAt.getTime() > this.ctx.clock.nowMs())
        return { ok: true, value: { messageId: row.id } };
      const messageId = await this.deliver(tx, { ...row, replyState: 'body_ready' }, text);
      return { ok: true, value: { messageId } };
    });
  }

  /** 角色主动寄信（纪念日，PLAY-05 第 7 条）：直接送达（时机与额度由 ai-runtime 决定）。 */
  async sendCharacterLetter(input: {
    userId: string;
    characterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ letterId: string }, 'contact_inactive'>> {
    const text = input.body.trim().slice(0, 4000);
    const existing = await this.findByKey(input.userId, input.characterId, input.idempotencyKey);
    if (existing) return { ok: true, value: { letterId: existing.id } };
    if (!text || !(await this.ctx.contacts.getActiveContact(input.userId, input.characterId)))
      return { ok: false, error: 'contact_inactive', message: '角色不在通讯录中' };
    const timeZone = await this.ctx.timeZone(input.userId);
    try {
      return await this.db.transaction(async (tx) => {
        const now = this.ctx.clock.now();
        const id = newId();
        await tx.db.insert(letters).values({
          id,
          userId: input.userId,
          characterId: input.characterId,
          direction: 'from_character',
          status: 'in_transit',
          replyState: 'body_ready',
          bodyCiphertext: await this.crypto.seal(input.userId, aad(id), text, tx),
          deliverAt: now,
          deliverLocalDate: localDateIn(now, timeZone),
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        });
        const [row] = await tx.db.select().from(letters).where(eq(letters.id, id));
        await this.deliver(tx, row!, text);
        return { ok: true as const, value: { letterId: id } };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findByKey(input.userId, input.characterId, input.idempotencyKey);
        if (again) return { ok: true, value: { letterId: again.id } };
      }
      throw error;
    }
  }

  // ---------- PlayFeature ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    return (await tx.db.delete(letters).where(eq(letters.userId, userId))).rowCount ?? 0;
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(letters)
      .where(eq(letters.userId, userId));
    return Number(r?.n ?? 0);
  }

  /** 删除角色：在路上的回信不再送达。 */
  async onContactRemoved(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(letters)
      .where(
        and(
          eq(letters.userId, userId),
          eq(letters.characterId, characterId),
          eq(letters.status, 'in_transit'),
        ),
      );
    await this.ctx.dataChanged(tx, userId, 'letters', characterId, null);
  }

  async onContactPurged(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(letters)
      .where(and(eq(letters.userId, userId), eq(letters.characterId, characterId)));
    await this.ctx.dataChanged(tx, userId, 'letters', characterId, null);
  }

  /** 兜底：正文已到、已过点还没送达的回信。 */
  async sweepDue(now: Date): Promise<void> {
    const rows = await this.db.db
      .select({ id: letters.id })
      .from(letters)
      .where(
        and(
          eq(letters.status, 'in_transit'),
          eq(letters.replyState, 'body_ready'),
          isNotNull(letters.deliverAt),
          lte(letters.deliverAt, now),
        ),
      )
      .limit(100);
    for (const r of rows) {
      try {
        await this.deliverIfDue(r.id);
      } catch (err) {
        this.logger.error({ err, letterId: r.id }, '回信送达失败，下一分钟重试');
      }
    }
  }

  // ---------- 内部 ----------

  private async deliverIfDue(letterId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(letters)
        .where(eq(letters.id, letterId))
        .for('update');
      if (
        !row ||
        row.status !== 'in_transit' ||
        row.replyState !== 'body_ready' ||
        !row.bodyCiphertext
      )
        return; // 正文还没到：保持在路上，正文到达时（已过点）立即送达。
      if (row.deliverAt && row.deliverAt.getTime() > this.ctx.clock.nowMs()) return;
      if (
        !(await this.ctx.contacts.getActiveContact(
          row.userId,
          row.characterId,
          tx as unknown as Tx,
        ))
      )
        return;
      await this.deliver(tx, row, await this.open(row));
    });
  }

  /** 送达（调用方已锁行、确认角色在通讯录）。返回私聊消息 ID。 */
  private async deliver(tx: DbTx, row: LetterRow, body: string): Promise<string> {
    const now = this.ctx.clock.now();
    const message = await this.ctx.postToDirectChat(tx, {
      userId: row.userId,
      characterId: row.characterId,
      sender: 'character',
      content: { type: 'letter', letterId: row.id, direction: 'from_character', body },
      idempotencyKey: `letter:${row.id}`,
    });
    const isReply = row.inReplyToLetterId !== null;
    let firstReply = false;
    if (isReply) {
      const [prev] = await tx.db
        .select({ n: count() })
        .from(letters)
        .where(
          and(
            eq(letters.userId, row.userId),
            eq(letters.characterId, row.characterId),
            eq(letters.direction, 'from_character'),
            eq(letters.status, 'delivered'),
            isNotNull(letters.inReplyToLetterId),
          ),
        );
      firstReply = Number(prev?.n ?? 0) === 0;
    }
    await tx.db
      .update(letters)
      .set({
        status: 'delivered',
        replyState: null,
        deliveredAt: now,
        messageId: message.messageId,
        updatedAt: now,
      })
      .where(eq(letters.id, row.id));
    if (firstReply && this.cards) {
      // 第一次收到该角色回信：瞬间卡（每角色一张）。
      await this.cards.issueCard(tx as unknown as Tx, {
        userId: row.userId,
        characterId: row.characterId,
        kind: 'play',
        title: '第一封回信',
        line: body.replace(/\s+/g, ' ').slice(0, 60),
        faceMediaId: null,
        templateId: null,
        sourceMessageIds: [],
        idempotencyKey: `letter_first:${row.characterId}`,
      });
    }
    await this.outbox.publish(tx, 'play.letter_delivered', 'play', {
      userId: row.userId,
      characterId: row.characterId,
      letterId: row.id,
      firstReplyFromCharacter: firstReply,
    });
    await this.ctx.dataChanged(tx, row.userId, 'letters', row.characterId, row.id);
    return message.messageId;
  }

  /**
   * 回信送达时间（P-42）：现在起 6～24 小时内、落在活跃小时里、该角色当天还没有回信的时刻中随机取一个；
   * 都不行时往后顺延到最近一个有空的当地日期（replyDelayed = true）。15 分钟一格。
   */
  private async planDelivery(
    tx: DbTx,
    userId: string,
    characterId: string,
    timeZone: string,
    now: Date,
  ): Promise<{ deliverAt: Date; localDate: string; delayed: boolean }> {
    const hours =
      (await this.activeHours?.getActiveHours(userId).catch(() => null)) ?? defaultHours();
    const busyRows = await tx.db
      .select({ d: letters.deliverLocalDate })
      .from(letters)
      .where(
        and(
          eq(letters.userId, userId),
          eq(letters.characterId, characterId),
          eq(letters.direction, 'from_character'),
          isNotNull(letters.inReplyToLetterId),
          inArray(letters.status, ['in_transit', 'delivered']),
          sql`${letters.deliverLocalDate} >= ${localDateIn(now, timeZone)}`,
        ),
      );
    const busy = new Set(busyRows.map((r) => r.d).filter((d): d is string => !!d));
    const step = SLOT_MINUTES * 60_000;
    const slotsBetween = (from: number, to: number) => {
      const out: Date[] = [];
      for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
        const at = new Date(t);
        if (hours.has(hourIn(at, timeZone)) && !busy.has(localDateIn(at, timeZone))) out.push(at);
      }
      return out;
    };
    const minMs = now.getTime() + PLAY_LIMITS.letterReplyDelayMinHours * HOUR;
    const maxMs = now.getTime() + PLAY_LIMITS.letterReplyDelayMaxHours * HOUR;
    const inWindow = slotsBetween(minMs, maxMs);
    if (inWindow.length) {
      const at = inWindow[randomInt(inWindow.length)]!;
      return { deliverAt: at, localDate: localDateIn(at, timeZone), delayed: false };
    }
    // 顺延：找 24 小时之后第一个有空的当地日期，在当天活跃时段内随机取。
    for (let day = 0; day < 60; day++) {
      const from = maxMs + day * 24 * HOUR;
      const candidates = slotsBetween(from, from + 24 * HOUR);
      if (!candidates.length) continue;
      const firstDate = localDateIn(candidates[0]!, timeZone);
      const sameDay = candidates.filter((c) => localDateIn(c, timeZone) === firstDate);
      const at = sameDay[randomInt(sameDay.length)]!;
      return { deliverAt: at, localDate: firstDate, delayed: true };
    }
    const at = new Date(maxMs);
    return { deliverAt: at, localDate: localDateIn(at, timeZone), delayed: true };
  }

  private async sentResult(row: LetterRow): Promise<{
    letter: Letter;
    replyDelayed: boolean;
    replyDelayReason: 'already_replied_today' | 'outside_active_window' | null;
  }> {
    const [reply] = await this.db.db
      .select()
      .from(letters)
      .where(and(eq(letters.inReplyToLetterId, row.id), eq(letters.userId, row.userId)));
    const delayed =
      !!reply?.deliverAt &&
      !!row.sentAt &&
      reply.deliverAt.getTime() - row.sentAt.getTime() >
        PLAY_LIMITS.letterReplyDelayMaxHours * HOUR;
    // 3.1（积压 ㊲）：顺延原因——P-42 窗口内已有这个角色的其他回信 = 每天 1 封的限制；否则是活跃时段外。
    let replyDelayReason: 'already_replied_today' | 'outside_active_window' | null = null;
    if (delayed && reply && row.sentAt) {
      const from = new Date(row.sentAt.getTime() + PLAY_LIMITS.letterReplyDelayMinHours * HOUR);
      const to = new Date(row.sentAt.getTime() + PLAY_LIMITS.letterReplyDelayMaxHours * HOUR);
      const [other] = await this.db.db
        .select({ id: letters.id })
        .from(letters)
        .where(
          and(
            eq(letters.userId, row.userId),
            eq(letters.characterId, row.characterId),
            eq(letters.direction, 'from_character'),
            isNotNull(letters.inReplyToLetterId),
            sql`${letters.id} <> ${reply.id}`,
            sql`${letters.deliverAt} >= ${from}`,
            sql`${letters.deliverAt} <= ${to}`,
          ),
        )
        .limit(1);
      replyDelayReason = other ? 'already_replied_today' : 'outside_active_window';
    }
    return {
      letter: await this.toDto(row, reply ?? null),
      replyDelayed: delayed,
      replyDelayReason,
    };
  }

  private async findByKey(
    userId: string,
    characterId: string,
    key: string,
  ): Promise<LetterRow | null> {
    const [row] = await this.db.db
      .select()
      .from(letters)
      .where(
        and(
          eq(letters.userId, userId),
          eq(letters.characterId, characterId),
          eq(letters.idempotencyKey, key),
        ),
      );
    return row ?? null;
  }

  private async open(row: LetterRow): Promise<string> {
    return (await this.crypto.open(row.userId, aad(row.id), row.bodyCiphertext!)).toString('utf8');
  }

  /** 送达前（in_transit）不给正文；寄出的信带上回信的预计送达日期。 */
  private async toDto(row: LetterRow, reply?: LetterRow | null): Promise<Letter> {
    const hidden = row.status === 'in_transit';
    let expected: string | null = null;
    if (row.direction === 'from_character' && row.status === 'in_transit')
      expected = row.deliverLocalDate;
    else if (row.direction === 'to_character' && row.status === 'sent') {
      const r =
        reply !== undefined
          ? reply
          : ((
              await this.db.db
                .select()
                .from(letters)
                .where(and(eq(letters.inReplyToLetterId, row.id), eq(letters.userId, row.userId)))
            )[0] ?? null);
      expected = r && r.status === 'in_transit' ? r.deliverLocalDate : null;
    }
    return {
      letterId: row.id,
      characterId: row.characterId,
      direction: row.direction as 'to_character' | 'from_character',
      status: row.status as Letter['status'],
      body: hidden || !row.bodyCiphertext ? null : await this.open(row),
      inReplyToLetterId: row.inReplyToLetterId,
      expectedDeliveryDate: expected,
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      messageId: row.messageId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
