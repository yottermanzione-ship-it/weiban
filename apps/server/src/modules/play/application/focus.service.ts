/**
 * 陪你专注（PLAY-06，T-094）。
 *
 * - 开始：5～120 分钟（契约校验），可选「做什么」（≤30 字）；同一时间只能一次（409 focus_in_progress，部分唯一索引兜底）；
 *   clientRequestId 幂等。以服务器时间计时，ends_at = 开始 + 时长；同一事务投递到点任务 play.focus_end。
 *   发 play.focus_started：ai-runtime 让 TA 发一句加油，并让所有角色安静到结束（读 PlayReadPort.getActiveFocus）。
 * - 结束：时间到由任务 / 每分钟兜底扫描自动结束（completed）；用户提前结束（ended_early，幂等）。都发 play.focus_ended，
 *   growth 记首次互动 +5 与成就 34 号（提前结束也算）。没有失败状态，不保存累计时长、不做排行。
 * - 「用户正在专注」：PlayReadPort.getActiveFocus / GET /play/focus（ends_at 已过的视为已结束）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, eq, gt, lte } from 'drizzle-orm';
import { FocusEndpoints, type FocusSession } from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  DATABASE,
  ENVELOPE_CRYPTO,
  LOGGER,
  OUTBOX,
  newId,
  parseContract,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import { focusSessions } from '../infra/db/schema.js';
import { PlayContext, isUniqueViolation } from './context.js';
import type { PlayFeature } from './play-feature.js';
import { PlayJobs } from './play-jobs.js';

type FocusRow = typeof focusSessions.$inferSelect;
type StartBody = z.infer<NonNullable<typeof FocusEndpoints.start.body>>;

export const FOCUS_END_JOB = 'play.focus_end';
const aad = (id: string) => `play:focus:${id}`;

@Injectable()
export class FocusService implements PlayFeature, OnModuleInit {
  readonly featureName = 'focus';

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(PlayContext) private readonly ctx: PlayContext,
    @Inject(PlayJobs) private readonly jobs: PlayJobs,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.register<{ focusId: string }>(FOCUS_END_JOB, async ({ focusId }) => {
      await this.finish(focusId, 'auto');
    });
  }

  // ---------- 用户接口 ----------

  async getActive(userId: string): Promise<{ session: FocusSession | null }> {
    return { session: await this.getActiveFocus(userId) };
  }

  async start(userId: string, raw: unknown): Promise<FocusSession> {
    const body: StartBody = parseContract(FocusEndpoints.start.body!, raw);
    const retry = await this.findByRequest(userId, body.clientRequestId);
    if (retry) return this.toDto(retry);
    await this.ctx.requireActiveContact(userId, body.characterId);
    // 已过点但还没被任务结束的旧专注，先结束掉，避免挡住新的。
    await this.finishOverdue(userId);
    const note = body.note?.trim() || null;
    try {
      const row = await this.db.transaction(async (tx) => {
        const now = this.ctx.clock.now();
        const [active] = await tx.db
          .select({ id: focusSessions.id })
          .from(focusSessions)
          .where(and(eq(focusSessions.userId, userId), eq(focusSessions.result, 'in_progress')));
        if (active) throw new AppError('focus_in_progress', '已经有一次专注在进行中');
        const id = newId();
        const endsAt = new Date(now.getTime() + body.minutes * 60_000);
        await tx.db.insert(focusSessions).values({
          id,
          userId,
          characterId: body.characterId,
          plannedMinutes: body.minutes,
          noteCiphertext: note ? await this.crypto.seal(userId, aad(id), note, tx) : null,
          startedAt: now,
          endsAt,
          endedAt: null,
          result: 'in_progress',
          clientRequestId: body.clientRequestId,
          updatedAt: now,
        });
        await this.jobs.at(FOCUS_END_JOB, { focusId: id }, endsAt, {
          tx,
          singletonKey: `focus:${id}`,
        });
        await this.outbox.publish(tx, 'play.focus_started', 'play', {
          userId,
          characterId: body.characterId,
          focusId: id,
          endsAt: endsAt.toISOString(),
        });
        await this.ctx.postPlayNotice(tx, {
          userId,
          characterId: body.characterId,
          code: 'focus_started',
          params: {
            sessionId: id,
            minutes: body.minutes,
            characterName: await this.ctx.characterName(userId, body.characterId, tx),
          },
          idempotencyKey: `play:focus_started:${id}`,
        });
        await this.ctx.dataChanged(tx, userId, 'focus', body.characterId, id);
        const [saved] = await tx.db.select().from(focusSessions).where(eq(focusSessions.id, id));
        return saved!;
      });
      return this.toDto(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findByRequest(userId, body.clientRequestId);
        if (again) return this.toDto(again);
        throw new AppError('focus_in_progress', '已经有一次专注在进行中');
      }
      throw error;
    }
  }

  /** 提前结束（幂等）。已过 ends_at 时记为 completed。 */
  async end(userId: string, focusId: string): Promise<FocusSession> {
    const [owned] = await this.db.db
      .select({ id: focusSessions.id })
      .from(focusSessions)
      .where(and(eq(focusSessions.id, focusId), eq(focusSessions.userId, userId)));
    if (!owned) throw new AppError('not_found', '专注不存在');
    const row = await this.finish(focusId, 'user');
    return this.toDto(row!);
  }

  // ---------- 给 ai-runtime（PlayReadPort.getActiveFocus） ----------

  async getActiveFocus(userId: string): Promise<FocusSession | null> {
    const [row] = await this.db.db
      .select()
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          eq(focusSessions.result, 'in_progress'),
          gt(focusSessions.endsAt, this.ctx.clock.now()),
        ),
      );
    return row ? this.toDto(row) : null;
  }

  // ---------- PlayFeature ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    return (
      (await tx.db.delete(focusSessions).where(eq(focusSessions.userId, userId))).rowCount ?? 0
    );
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(focusSessions)
      .where(eq(focusSessions.userId, userId));
    return Number(r?.n ?? 0);
  }

  /** 陪伴的角色被删除：进行中的专注照常计时结束（不打断用户）；彻底删除时删除记录。 */
  async onContactPurged(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.characterId, characterId)));
    await this.ctx.dataChanged(tx, userId, 'focus', characterId, null);
  }

  async sweepDue(now: Date): Promise<void> {
    const rows = await this.db.db
      .select({ id: focusSessions.id })
      .from(focusSessions)
      .where(and(eq(focusSessions.result, 'in_progress'), lte(focusSessions.endsAt, now)))
      .limit(200);
    for (const r of rows) {
      try {
        await this.finish(r.id, 'auto');
      } catch (err) {
        this.logger.error({ err, focusId: r.id }, '专注到点结束失败，下一分钟重试');
      }
    }
  }

  // ---------- 内部 ----------

  private async finishOverdue(userId: string): Promise<void> {
    const rows = await this.db.db
      .select({ id: focusSessions.id })
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          eq(focusSessions.result, 'in_progress'),
          lte(focusSessions.endsAt, this.ctx.clock.now()),
        ),
      );
    for (const r of rows) await this.finish(r.id, 'auto');
  }

  /** 结束一次专注（幂等）。auto：只在已到点时结束；user：提前结束或到点后记为完成。 */
  private async finish(focusId: string, by: 'auto' | 'user'): Promise<FocusRow | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(focusSessions)
        .where(eq(focusSessions.id, focusId))
        .for('update');
      if (!row) return null;
      if (row.result !== 'in_progress') return row;
      const now = this.ctx.clock.now();
      const due = row.endsAt.getTime() <= now.getTime();
      if (by === 'auto' && !due) return row;
      const result = due ? 'completed' : 'ended_early';
      const endedAt = due ? row.endsAt : now;
      await tx.db
        .update(focusSessions)
        .set({ result, endedAt, updatedAt: now })
        .where(eq(focusSessions.id, focusId));
      await this.outbox.publish(tx, 'play.focus_ended', 'play', {
        userId: row.userId,
        characterId: row.characterId,
        focusId,
        result,
        minutes: Math.max(0, Math.floor((endedAt.getTime() - row.startedAt.getTime()) / 60_000)),
      });
      await this.ctx.dataChanged(tx, row.userId, 'focus', row.characterId, focusId);
      return { ...row, result, endedAt, updatedAt: now };
    });
  }

  private async findByRequest(userId: string, requestId: string): Promise<FocusRow | null> {
    const [row] = await this.db.db
      .select()
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.clientRequestId, requestId)));
    return row ?? null;
  }

  private async toDto(row: FocusRow): Promise<FocusSession> {
    return {
      focusId: row.id,
      characterId: row.characterId,
      plannedMinutes: row.plannedMinutes,
      note: row.noteCiphertext
        ? (await this.crypto.open(row.userId, aad(row.id), row.noteCiphertext)).toString('utf8')
        : null,
      startedAt: row.startedAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      result: row.result as FocusSession['result'],
    };
  }
}
