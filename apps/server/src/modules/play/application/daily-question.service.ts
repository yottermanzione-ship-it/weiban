/**
 * 每日一问（PLAY-03，T-091）。
 *
 * - 选题（代码，不调用模型）：按「用户 + 当地日期」确定当天的起点题；对所选角色不合适时顺延到同日备选题
 *   （health-and-play.md 5.1）。非恋人跳过 romance；儿童角色只用 child_safe；真人角色跳过 work；下架的题不出现。
 *   优先选用户没答过的题，全答过时再从全部合适题里选。换角色时题目可能随之变化。
 * - 每个用户每个当地日期只能答一次（唯一索引），答完整页只读；回答 1～200 字，不能修改。
 * - 提交前看不到、也不提前生成 TA 的答案；提交后：写回答、在私聊以用户身份写「每日一问」卡片消息、
 *   发 play.daily_answer_submitted（ai-runtime 生成 TA 的答案并接话；growth 记首次互动 +5 与成就 32 号）。
 * - TA 的答案经 PlayAgentPort.setDailyCharacterAnswer 回写（ready）；余额不足由 T-096 标 waiting_balance，恢复后补。
 * - 漏答不补、不提醒、不计连续天数；历史只列答过的。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  AdminDailyQuestion,
  DailyQuestionAdminEndpoints,
  DailyQuestionEndpoints,
  DailyQuestionTag,
  Id,
  type DailyAnswerHistoryItem,
  type DailyQuestionToday,
  type PortResult,
} from '@weiban/contracts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  DATABASE,
  ENVELOPE_CRYPTO,
  OUTBOX,
  newId,
  parseContract,
  type AuditLog,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Outbox,
} from '../../../platform/index.js';
import { dailyAnswers, dailyPrefs, dailyQuestions } from '../infra/db/schema.js';
import type { PlayDailyAnswerStatus } from '../tokens.js';
import { PlayContext, type CharacterTraits } from './context.js';
import type { PlayFeature } from './play-feature.js';

type QuestionRow = typeof dailyQuestions.$inferSelect;
type AnswerRow = typeof dailyAnswers.$inferSelect;
type Tag = z.infer<typeof DailyQuestionTag>;
type AnswerBody = z.infer<NonNullable<typeof DailyQuestionEndpoints.answer.body>>;
type AdminCreate = z.infer<NonNullable<typeof DailyQuestionAdminEndpoints.create.body>>;
type AdminUpdate = z.infer<NonNullable<typeof DailyQuestionAdminEndpoints.update.body>>;
type HistoryItem = z.infer<typeof DailyAnswerHistoryItem>;

const HISTORY_PAGE = 30;
const ADMIN_PAGE = 50;
const userAad = (id: string) => `play:daily_answer:${id}:user`;
const characterAad = (id: string) => `play:daily_answer:${id}:character`;

/** PLAY-03 第 3 条：题目对这个角色是否合适。 */
export function questionFits(tags: readonly string[], traits: CharacterTraits): boolean {
  if (traits.child && !tags.includes('child_safe')) return false;
  if (!traits.lover && tags.includes('romance')) return false;
  if (traits.realPerson && tags.includes('work')) return false;
  return true;
}

/** 按「用户 + 日期」确定的起点（同一天对同一用户稳定）。 */
function dayOffset(userId: string, date: string, size: number): number {
  const digest = createHash('sha256').update(`${userId}|${date}`).digest();
  return digest.readUInt32BE(0) % size;
}

function encodeCursor(a: string, b: string): string {
  return Buffer.from(`${a}|${b}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string | undefined): { a: string; b: string } | null {
  if (!cursor) return null;
  const [a, b] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!a || !b || !Id.safeParse(b).success) throw new AppError('bad_request', '分页游标不正确');
  return { a, b };
}

function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class DailyQuestionService implements PlayFeature, PlayDailyAnswerStatus {
  readonly featureName = 'daily_question';

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(PlayContext) private readonly ctx: PlayContext,
  ) {}

  // ---------- 用户接口 ----------

  async getToday(userId: string, requestedCharacterId?: string): Promise<DailyQuestionToday> {
    const date = await this.ctx.localToday(userId);
    const answered = await this.findAnswer(this.db, userId, date);
    if (answered) return this.toToday(answered);
    const characterId = await this.resolveCharacter(userId, requestedCharacterId);
    const question = await this.pickQuestion(userId, characterId, date);
    return {
      date,
      characterId,
      questionId: question.id,
      question: question.text,
      answer: null,
    };
  }

  async answer(userId: string, raw: unknown): Promise<DailyQuestionToday> {
    const body: AnswerBody = parseContract(DailyQuestionEndpoints.answer.body!, raw);
    // 幂等：同一 clientRequestId 重试返回原结果。
    const [retry] = await this.db.db
      .select()
      .from(dailyAnswers)
      .where(
        and(
          eq(dailyAnswers.userId, userId),
          eq(dailyAnswers.clientRequestId, body.clientRequestId),
        ),
      );
    if (retry) return this.toToday(retry);

    const date = await this.ctx.localToday(userId);
    await this.ctx.requireActiveContact(userId, body.characterId);
    const [question] = await this.db.db
      .select()
      .from(dailyQuestions)
      .where(and(eq(dailyQuestions.id, body.questionId), eq(dailyQuestions.listed, true)));
    if (!question) throw new AppError('not_found', '这道题已下架，请刷新后再答');
    const traits = await this.ctx.traits(userId, body.characterId);
    if (!questionFits(question.tags, traits))
      throw new AppError('bad_request', '这道题不适合和这个角色一起答，请刷新');

    const id = newId();
    const now = this.ctx.clock.now();
    try {
      const row = await this.db.transaction(async (tx) => {
        const existing = await this.findAnswer(tx, userId, date);
        if (existing) throw new AppError('already_answered', '今天已经答过了');
        const sealed = await this.crypto.seal(userId, userAad(id), body.answer, tx);
        await tx.db.insert(dailyAnswers).values({
          id,
          userId,
          characterId: body.characterId,
          localDate: date,
          questionId: question.id,
          questionText: question.text,
          userAnswerCiphertext: sealed,
          characterAnswerCiphertext: null,
          characterAnswerStatus: 'pending',
          messageId: null,
          clientRequestId: body.clientRequestId,
          answeredAt: now,
          updatedAt: now,
        });
        // 私聊里的「每日一问」卡片消息（发送者为用户，PLAY-03 第 6 条）；按普通聊天内容进入记忆。
        const message = await this.ctx.postToDirectChat(tx, {
          userId,
          characterId: body.characterId,
          sender: 'user',
          content: {
            type: 'daily_question',
            answerId: id,
            questionId: question.id,
            date,
            question: question.text,
            answer: body.answer,
          },
          idempotencyKey: body.clientRequestId,
        });
        await tx.db
          .update(dailyAnswers)
          .set({ messageId: message.messageId })
          .where(eq(dailyAnswers.id, id));
        await tx.db
          .insert(dailyPrefs)
          .values({ userId, lastCharacterId: body.characterId, updatedAt: now })
          .onConflictDoUpdate({
            target: dailyPrefs.userId,
            set: { lastCharacterId: body.characterId, updatedAt: now },
          });
        await this.outbox.publish(tx, 'play.daily_answer_submitted', 'play', {
          userId,
          characterId: body.characterId,
          answerId: id,
          questionId: question.id,
          messageId: message.messageId,
        });
        await this.ctx.dataChanged(tx, userId, 'daily_question', body.characterId, id);
        const [saved] = await tx.db.select().from(dailyAnswers).where(eq(dailyAnswers.id, id));
        return saved!;
      });
      return this.toToday(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [again] = await this.db.db
          .select()
          .from(dailyAnswers)
          .where(
            and(
              eq(dailyAnswers.userId, userId),
              eq(dailyAnswers.clientRequestId, body.clientRequestId),
            ),
          );
        if (again) return this.toToday(again);
        throw new AppError('already_answered', '今天已经答过了');
      }
      throw error;
    }
  }

  async listHistory(
    userId: string,
    cursor?: string,
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    const after = decodeCursor(cursor);
    const rows = await this.db.db
      .select()
      .from(dailyAnswers)
      .where(
        and(
          eq(dailyAnswers.userId, userId),
          after
            ? or(
                lt(dailyAnswers.localDate, after.a),
                and(eq(dailyAnswers.localDate, after.a), lt(dailyAnswers.id, after.b)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(dailyAnswers.localDate), desc(dailyAnswers.id))
      .limit(HISTORY_PAGE + 1);
    const page = rows.slice(0, HISTORY_PAGE);
    const items: HistoryItem[] = [];
    for (const row of page) {
      const { userAnswer, characterAnswer } = await this.openAnswers(row);
      items.push({
        answerId: row.id,
        date: row.localDate,
        characterId: row.characterId,
        question: row.questionText,
        userAnswer,
        characterAnswer: row.characterAnswerStatus === 'ready' ? characterAnswer : null,
      });
    }
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > HISTORY_PAGE && last ? encodeCursor(last.localDate, last.id) : null,
    };
  }

  // ---------- 管理端（ADM-04 第 5 条） ----------

  async adminList(query: {
    cursor?: string;
    tag?: Tag;
  }): Promise<{ items: z.infer<typeof AdminDailyQuestion>[]; nextCursor: string | null }> {
    const after = decodeCursor(query.cursor);
    const rows = await this.db.db
      .select()
      .from(dailyQuestions)
      .where(
        and(
          query.tag ? sql`${query.tag} = ANY(${dailyQuestions.tags})` : undefined,
          after
            ? or(
                lt(dailyQuestions.createdAt, new Date(after.a)),
                and(
                  eq(dailyQuestions.createdAt, new Date(after.a)),
                  lt(dailyQuestions.id, after.b),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(dailyQuestions.createdAt), desc(dailyQuestions.id))
      .limit(ADMIN_PAGE + 1);
    const page = rows.slice(0, ADMIN_PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.toAdmin(r)),
      nextCursor:
        rows.length > ADMIN_PAGE && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }

  async adminCreate(adminId: string, raw: unknown) {
    const body: AdminCreate = parseContract(DailyQuestionAdminEndpoints.create.body!, raw);
    const id = newId();
    const now = this.ctx.clock.now();
    return this.db.transaction(async (tx) => {
      await tx.db.insert(dailyQuestions).values({
        id,
        text: body.text.trim(),
        tags: [...new Set(body.tags)],
        listed: body.listed,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(
        {
          module: 'play',
          action: 'daily_question.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'daily_question',
          targetId: id,
          details: { tags: body.tags, listed: body.listed },
        },
        tx,
      );
      const [row] = await tx.db.select().from(dailyQuestions).where(eq(dailyQuestions.id, id));
      return this.toAdmin(row!);
    });
  }

  async adminUpdate(adminId: string, questionId: string, raw: unknown) {
    const body: AdminUpdate = parseContract(DailyQuestionAdminEndpoints.update.body!, raw);
    return this.db.transaction(async (tx) => {
      const [current] = await tx.db
        .select()
        .from(dailyQuestions)
        .where(eq(dailyQuestions.id, questionId))
        .for('update');
      if (!current) throw new AppError('not_found', '题目不存在');
      await tx.db
        .update(dailyQuestions)
        .set({
          ...(body.text !== undefined ? { text: body.text.trim() } : {}),
          ...(body.tags !== undefined ? { tags: [...new Set(body.tags)] } : {}),
          ...(body.listed !== undefined ? { listed: body.listed } : {}),
          updatedAt: this.ctx.clock.now(),
        })
        .where(eq(dailyQuestions.id, questionId));
      await this.audit.record(
        {
          module: 'play',
          action: 'daily_question.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'daily_question',
          targetId: questionId,
          details: { fields: Object.keys(body), listed: body.listed ?? current.listed },
        },
        tx,
      );
      const [row] = await tx.db
        .select()
        .from(dailyQuestions)
        .where(eq(dailyQuestions.id, questionId));
      return this.toAdmin(row!);
    });
  }

  // ---------- 给 ai-runtime（PlayAgentPort / PLAY_DAILY_ANSWER_STATUS） ----------

  async setCharacterAnswer(input: {
    answerId: string;
    answer: string;
  }): Promise<PortResult<void, 'not_found'>> {
    const text = input.answer.trim().slice(0, 500);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(dailyAnswers)
        .where(eq(dailyAnswers.id, input.answerId))
        .for('update');
      if (!row) return { ok: false, error: 'not_found', message: '回答不存在' };
      // 已揭晓后不再改（重复回写幂等）。
      if (row.characterAnswerStatus === 'ready') return { ok: true, value: undefined };
      const sealed = await this.crypto.seal(row.userId, characterAad(row.id), text, tx);
      await tx.db
        .update(dailyAnswers)
        .set({
          characterAnswerCiphertext: sealed,
          characterAnswerStatus: 'ready',
          updatedAt: this.ctx.clock.now(),
        })
        .where(eq(dailyAnswers.id, row.id));
      await this.ctx.dataChanged(tx, row.userId, 'daily_question', row.characterId, row.id);
      return { ok: true, value: undefined };
    });
  }

  async markDailyAnswerWaitingBalance(answerId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .update(dailyAnswers)
        .set({ characterAnswerStatus: 'waiting_balance', updatedAt: this.ctx.clock.now() })
        .where(
          and(eq(dailyAnswers.id, answerId), eq(dailyAnswers.characterAnswerStatus, 'pending')),
        )
        .returning();
      if (row)
        await this.ctx.dataChanged(tx, row.userId, 'daily_question', row.characterId, row.id);
    });
  }

  async listDailyAnswersWaitingBalance(userId: string) {
    const rows = await this.db.db
      .select()
      .from(dailyAnswers)
      .where(
        and(
          eq(dailyAnswers.userId, userId),
          inArray(dailyAnswers.characterAnswerStatus, ['waiting_balance', 'pending']),
        ),
      )
      .orderBy(asc(dailyAnswers.answeredAt))
      .limit(50);
    const out = [];
    for (const row of rows) {
      const { userAnswer } = await this.openAnswers(row);
      out.push({
        answerId: row.id,
        characterId: row.characterId,
        questionId: row.questionId,
        question: row.questionText,
        userAnswer,
        messageId: row.messageId,
      });
    }
    return out;
  }

  async getDailyAnswerForGeneration(answerId: string) {
    const [row] = await this.db.db.select().from(dailyAnswers).where(eq(dailyAnswers.id, answerId));
    if (!row) return null;
    const { userAnswer } = await this.openAnswers(row);
    return {
      userId: row.userId,
      characterId: row.characterId,
      question: row.questionText,
      userAnswer,
      status: row.characterAnswerStatus as 'pending' | 'ready' | 'waiting_balance',
    };
  }

  // ---------- PlayFeature（删除清单、角色删除） ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    let n = 0;
    n += (await tx.db.delete(dailyAnswers).where(eq(dailyAnswers.userId, userId))).rowCount ?? 0;
    n += (await tx.db.delete(dailyPrefs).where(eq(dailyPrefs.userId, userId))).rowCount ?? 0;
    return n;
  }

  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dailyAnswers)
      .where(eq(dailyAnswers.userId, userId));
    const [p] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dailyPrefs)
      .where(eq(dailyPrefs.userId, userId));
    return (a?.n ?? 0) + (p?.n ?? 0);
  }

  /** 彻底删除角色：和 TA 一起答过的题随角色数据删除（私聊消息由 chat 随会话清除）。 */
  async onContactPurged(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(dailyAnswers)
      .where(and(eq(dailyAnswers.userId, userId), eq(dailyAnswers.characterId, characterId)));
    await tx.db
      .delete(dailyPrefs)
      .where(and(eq(dailyPrefs.userId, userId), eq(dailyPrefs.lastCharacterId, characterId)));
    await this.ctx.dataChanged(tx, userId, 'daily_question', characterId, null);
  }

  // ---------- 内部 ----------

  private async findAnswer(
    tx: { db: DbTx['db'] },
    userId: string,
    date: string,
  ): Promise<AnswerRow | null> {
    const [row] = await tx.db
      .select()
      .from(dailyAnswers)
      .where(and(eq(dailyAnswers.userId, userId), eq(dailyAnswers.localDate, date)));
    return row ?? null;
  }

  /** 不传角色时用上次选的（仍在通讯录）；否则用通讯录里第一个。 */
  private async resolveCharacter(userId: string, requested?: string): Promise<string> {
    if (requested) {
      await this.ctx.requireActiveContact(userId, requested);
      return requested;
    }
    const [pref] = await this.db.db.select().from(dailyPrefs).where(eq(dailyPrefs.userId, userId));
    if (pref && (await this.ctx.contacts.getActiveContact(userId, pref.lastCharacterId)))
      return pref.lastCharacterId;
    const contacts = await this.ctx.contacts.listActiveContacts(userId);
    const first = contacts.find((c) => c.status === 'active') ?? contacts[0];
    if (!first) throw new AppError('character_not_available', '先添加一个角色再来答题吧');
    return first.characterId;
  }

  private async pickQuestion(
    userId: string,
    characterId: string,
    date: string,
  ): Promise<QuestionRow> {
    const listed = await this.db.db
      .select()
      .from(dailyQuestions)
      .where(eq(dailyQuestions.listed, true))
      .orderBy(asc(dailyQuestions.createdAt), asc(dailyQuestions.id));
    if (listed.length === 0) throw new AppError('not_found', '今天还没有题目');
    const traits = await this.ctx.traits(userId, characterId);
    const answeredIds = new Set(
      (
        await this.db.db
          .select({ questionId: dailyAnswers.questionId })
          .from(dailyAnswers)
          .where(eq(dailyAnswers.userId, userId))
      ).map((r) => r.questionId),
    );
    // 起点题 + 同日备选题（按固定顺序向后轮转），先找没答过的合适题，再退回到任何合适题。
    const start = dayOffset(userId, date, listed.length);
    const rotated = [...listed.slice(start), ...listed.slice(0, start)];
    const fits = rotated.filter((q) => questionFits(q.tags, traits));
    const pick = fits.find((q) => !answeredIds.has(q.id)) ?? fits[0];
    if (!pick) throw new AppError('not_found', '暂时没有适合和这个角色一起答的题');
    return pick;
  }

  private async openAnswers(
    row: AnswerRow,
  ): Promise<{ userAnswer: string; characterAnswer: string | null }> {
    const userAnswer = (
      await this.crypto.open(row.userId, userAad(row.id), row.userAnswerCiphertext)
    ).toString('utf8');
    const characterAnswer = row.characterAnswerCiphertext
      ? (
          await this.crypto.open(row.userId, characterAad(row.id), row.characterAnswerCiphertext)
        ).toString('utf8')
      : null;
    return { userAnswer, characterAnswer };
  }

  private async toToday(row: AnswerRow): Promise<DailyQuestionToday> {
    const { userAnswer, characterAnswer } = await this.openAnswers(row);
    const status = row.characterAnswerStatus as 'pending' | 'ready' | 'waiting_balance';
    return {
      date: row.localDate,
      characterId: row.characterId,
      questionId: row.questionId,
      question: row.questionText,
      answer: {
        answerId: row.id,
        userAnswer,
        characterAnswer: status === 'ready' ? characterAnswer : null,
        characterAnswerStatus: status,
        answeredAt: row.answeredAt.toISOString(),
      },
    };
  }

  private toAdmin(row: QuestionRow): z.infer<typeof AdminDailyQuestion> {
    return {
      questionId: row.id,
      text: row.text,
      tags: row.tags.filter((t): t is Tag => DailyQuestionTag.safeParse(t).success),
      listed: row.listed,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
