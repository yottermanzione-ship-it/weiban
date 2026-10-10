/**
 * TA 的提醒（PLAY-07，T-095）。
 *
 * - 每用户最多 P-44（10）条（422 limit_reached）；内容 ≤20 字；时间 HH:mm（用户时区）；重复：不重复 / 每天 / 工作日（周一～五）/ 自选星期几；
 *   由通讯录中一个角色提醒；「归类为健康」「免打扰时段也提醒」两个开关（默认关，由客户端传）；每条可单独开关、编辑、删除。
 * - 保存（新建、改内容）发 play.reminder_saved{textChanged}：ai-runtime 生成 5 种说法，经 PlayAgentPort.setReminderPhrasings 回写
 *   （花费算「聊天」）；改内容时旧说法作废，回到模板说法直到新说法到达。余额不足 / 模型故障：先用模板说法，恢复后 T-096 补生成。
 * - 到点（1 分钟精度：精确任务 play.reminder_fire + 每分钟兜底扫描）：不调用模型、不受余额和后台预算影响、不占 P-03 / P-04；
 *   遵守免打扰（勾选「免打扰时段也提醒」的除外）；角色以自己身份在私聊发普通文字消息，轮流使用说法，「{称呼}」替换为专属称呼或昵称；
 *   「健康」类消息带 labels ['health']（推送不显示内容、不能进分享图）。错过超过 30 分钟（如停机）的这次不补发。
 * - 删除角色：该角色的提醒暂停；30 天内恢复时恢复；彻底删除时一并删除。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, lte, sql } from 'drizzle-orm';
import {
  PLAY_LIMITS,
  ReminderEndpoints,
  ReminderRepeat,
  type PortResult,
  type Reminder,
  type Tx,
} from '@weiban/contracts';
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
import { reminders } from '../infra/db/schema.js';
import type { PlayReminderPhrasings } from '../tokens.js';
import { PlayContext, isUniqueViolation, localDateIn } from './context.js';
import type { PlayFeature } from './play-feature.js';
import { PlayJobs } from './play-jobs.js';

type ReminderRow = typeof reminders.$inferSelect;
type Repeat = z.infer<typeof ReminderRepeat>;
type CreateBody = z.infer<NonNullable<typeof ReminderEndpoints.createReminder.body>>;
type UpdateBody = z.infer<NonNullable<typeof ReminderEndpoints.updateReminder.body>>;
type DoNotDisturb = { enabled: boolean; start: string; end: string };

export const REMINDER_FIRE_JOB = 'play.reminder_fire';
const LIMIT = PLAY_LIMITS.remindersPerUser;
const STALE_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const PHRASING_MAX = 40;
const TEMPLATES = [
  '{称呼}，该{内容}啦～',
  '到点啦，记得{内容}哦',
  '{称呼}，别忘了{内容}',
  '提醒一下：{内容}',
];
const textAad = (id: string) => `play:reminder:${id}:text`;
const phrasingsAad = (id: string) => `play:reminder:${id}:phrasings`;

/** 某时刻在时区里的「墙上时间」毫秒数（把本地年月日时分当作 UTC）。 */
function wallMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
}

/** 用户时区里的「某日 HH:mm」对应的绝对时刻。 */
export function zonedInstant(localDate: string, time: string, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const offset = wallMs(new Date(guess), timeZone) - Math.floor(guess / 60_000) * 60_000;
    guess = target - offset;
  }
  return new Date(guess);
}

function isoWeekday(localDate: string): number {
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(localDate: string, n: number): string {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 下一次到点（严格晚于 after）；没有了（已过的单次）为 null。 */
export function nextFire(repeat: Repeat, time: string, timeZone: string, after: Date): Date | null {
  const today = localDateIn(after, timeZone);
  for (let d = 0; d <= 370; d++) {
    const date = addDays(today, d);
    const wd = isoWeekday(date);
    const matches =
      repeat.kind === 'once'
        ? date === repeat.date
        : repeat.kind === 'daily'
          ? true
          : repeat.kind === 'workdays'
            ? wd <= 5
            : repeat.weekdays.includes(wd);
    if (!matches) continue;
    const at = zonedInstant(date, time, timeZone);
    if (at.getTime() > after.getTime()) return at;
    if (repeat.kind === 'once') return null;
  }
  return null;
}

function inDoNotDisturb(at: Date, timeZone: string, dnd: DoNotDisturb): boolean {
  if (!dnd.enabled) return false;
  const wall = new Date(wallMs(at, timeZone)).toISOString().slice(11, 16);
  if (dnd.start === dnd.end) return true;
  return dnd.start < dnd.end
    ? wall >= dnd.start && wall < dnd.end
    : wall >= dnd.start || wall < dnd.end;
}

@Injectable()
export class RemindersService implements PlayFeature, PlayReminderPhrasings, OnModuleInit {
  readonly featureName = 'reminders';

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(PlayContext) private readonly ctx: PlayContext,
    @Inject(PlayJobs) private readonly jobs: PlayJobs,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.register<{ reminderId: string }>(REMINDER_FIRE_JOB, async ({ reminderId }) => {
      await this.fire(reminderId);
    });
  }

  // ---------- 用户接口 ----------

  async list(userId: string): Promise<{ items: Reminder[]; limit: number }> {
    const rows = await this.db.db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId))
      .orderBy(asc(reminders.createdAt), asc(reminders.id));
    const items: Reminder[] = [];
    for (const row of rows) items.push(await this.toDto(row));
    return { items, limit: LIMIT };
  }

  async create(userId: string, raw: unknown): Promise<Reminder> {
    const body: CreateBody = parseContract(ReminderEndpoints.createReminder.body!, raw);
    const retry = await this.findByRequest(userId, body.clientRequestId);
    if (retry) return this.toDto(retry);
    await this.ctx.requireActiveContact(userId, body.characterId);
    const timeZone = await this.ctx.timeZone(userId);
    try {
      const row = await this.db.transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const [r] = await tx.db
          .select({ n: count() })
          .from(reminders)
          .where(eq(reminders.userId, userId));
        if (Number(r?.n ?? 0) >= LIMIT)
          throw new AppError('limit_reached', `最多设置 ${LIMIT} 条提醒`, {
            details: { limit: LIMIT },
          });
        const id = newId();
        const now = this.ctx.clock.now();
        const next = body.enabled ? nextFire(body.repeat, body.time, timeZone, now) : null;
        await tx.db.insert(reminders).values({
          id,
          userId,
          characterId: body.characterId,
          textCiphertext: await this.crypto.seal(userId, textAad(id), body.text, tx),
          time: body.time,
          repeat: JSON.stringify(body.repeat),
          health: body.health,
          bypassDoNotDisturb: body.bypassDoNotDisturb,
          enabled: body.enabled,
          phrasingsCiphertext: null,
          phrasingsReady: false,
          phrasingCursor: 0,
          nextFireAt: next,
          lastFiredAt: null,
          pausedByContactRemoval: false,
          clientRequestId: body.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });
        await this.scheduleFire(tx, id, next);
        await this.outbox.publish(tx, 'play.reminder_saved', 'play', {
          userId,
          characterId: body.characterId,
          reminderId: id,
          textChanged: true,
        });
        await this.ctx.dataChanged(tx, userId, 'reminders', body.characterId, id);
        const [saved] = await tx.db.select().from(reminders).where(eq(reminders.id, id));
        return saved!;
      });
      return this.toDto(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findByRequest(userId, body.clientRequestId);
        if (again) return this.toDto(again);
      }
      throw error;
    }
  }

  async update(userId: string, reminderId: string, raw: unknown): Promise<Reminder> {
    const body: UpdateBody = parseContract(ReminderEndpoints.updateReminder.body!, raw);
    const timeZone = await this.ctx.timeZone(userId);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.loadOwned(tx, userId, reminderId);
      const now = this.ctx.clock.now();
      const oldText = await this.openText(current);
      const textChanged = body.text !== undefined && body.text !== oldText;
      const time = body.time ?? current.time;
      const repeat: Repeat = body.repeat ?? (JSON.parse(current.repeat) as Repeat);
      const enabled = body.enabled ?? current.enabled;
      const next =
        enabled && !current.pausedByContactRemoval ? nextFire(repeat, time, timeZone, now) : null;
      await tx.db
        .update(reminders)
        .set({
          ...(textChanged
            ? {
                textCiphertext: await this.crypto.seal(userId, textAad(reminderId), body.text!, tx),
                // 改了内容：旧说法作废，先用模板说法，等新说法回写。
                phrasingsCiphertext: null,
                phrasingsReady: false,
                phrasingCursor: 0,
              }
            : {}),
          time,
          repeat: JSON.stringify(repeat),
          ...(body.health !== undefined ? { health: body.health } : {}),
          ...(body.bypassDoNotDisturb !== undefined
            ? { bypassDoNotDisturb: body.bypassDoNotDisturb }
            : {}),
          enabled,
          nextFireAt: next,
          updatedAt: now,
        })
        .where(eq(reminders.id, reminderId));
      await this.scheduleFire(tx, reminderId, next);
      await this.outbox.publish(tx, 'play.reminder_saved', 'play', {
        userId,
        characterId: current.characterId,
        reminderId,
        textChanged,
      });
      await this.ctx.dataChanged(tx, userId, 'reminders', current.characterId, reminderId);
      const [saved] = await tx.db.select().from(reminders).where(eq(reminders.id, reminderId));
      return saved!;
    });
    return this.toDto(row);
  }

  async remove(userId: string, reminderId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.loadOwned(tx, userId, reminderId);
      await tx.db.delete(reminders).where(eq(reminders.id, reminderId));
      await this.ctx.dataChanged(tx, userId, 'reminders', current.characterId, reminderId);
    });
  }

  // ---------- 给 ai-runtime ----------

  async getReminder(reminderId: string): Promise<Reminder | null> {
    const [row] = await this.db.db.select().from(reminders).where(eq(reminders.id, reminderId));
    return row ? this.toDto(row) : null;
  }

  async setPhrasings(input: {
    reminderId: string;
    phrasings: string[];
  }): Promise<PortResult<void, 'not_found'>> {
    const phrasings = input.phrasings
      .map((p) => p.trim().slice(0, PHRASING_MAX))
      .filter((p) => p.length > 0)
      .slice(0, 10);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(reminders)
        .where(eq(reminders.id, input.reminderId))
        .for('update');
      if (!row) return { ok: false, error: 'not_found', message: '提醒不存在' };
      if (!phrasings.length) return { ok: true, value: undefined };
      await tx.db
        .update(reminders)
        .set({
          phrasingsCiphertext: await this.crypto.seal(
            row.userId,
            phrasingsAad(row.id),
            JSON.stringify(phrasings),
            tx,
          ),
          phrasingsReady: true,
          phrasingCursor: 0,
          updatedAt: this.ctx.clock.now(),
        })
        .where(eq(reminders.id, row.id));
      await this.ctx.dataChanged(tx, row.userId, 'reminders', row.characterId, row.id);
      return { ok: true, value: undefined };
    });
  }

  async listRemindersNeedingPhrasings(userId: string) {
    const rows = await this.db.db
      .select({ reminderId: reminders.id, characterId: reminders.characterId })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.phrasingsReady, false)));
    return rows;
  }

  // ---------- PlayFeature ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    return (await tx.db.delete(reminders).where(eq(reminders.userId, userId))).rowCount ?? 0;
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(reminders)
      .where(eq(reminders.userId, userId));
    return Number(r?.n ?? 0);
  }

  async onContactRemoved(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .update(reminders)
      .set({ pausedByContactRemoval: true, nextFireAt: null, updatedAt: this.ctx.clock.now() })
      .where(and(eq(reminders.userId, userId), eq(reminders.characterId, characterId)));
    await this.ctx.dataChanged(tx, userId, 'reminders', characterId, null);
  }

  async onContactRestored(tx: DbTx, userId: string, characterId: string): Promise<void> {
    const rows = await tx.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.characterId, characterId),
          eq(reminders.pausedByContactRemoval, true),
        ),
      );
    if (!rows.length) return;
    const timeZone = await this.ctx.timeZone(userId, tx);
    const now = this.ctx.clock.now();
    for (const row of rows) {
      const next = row.enabled
        ? nextFire(JSON.parse(row.repeat) as Repeat, row.time, timeZone, now)
        : null;
      await tx.db
        .update(reminders)
        .set({ pausedByContactRemoval: false, nextFireAt: next, updatedAt: now })
        .where(eq(reminders.id, row.id));
      await this.scheduleFire(tx, row.id, next);
    }
    await this.ctx.dataChanged(tx, userId, 'reminders', characterId, null);
  }

  async onContactPurged(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.characterId, characterId)));
    await this.ctx.dataChanged(tx, userId, 'reminders', characterId, null);
  }

  async sweepDue(now: Date): Promise<void> {
    const rows = await this.db.db
      .select({ id: reminders.id })
      .from(reminders)
      .where(
        and(
          eq(reminders.enabled, true),
          eq(reminders.pausedByContactRemoval, false),
          lte(reminders.nextFireAt, now),
        ),
      )
      .limit(500);
    for (const r of rows) {
      try {
        await this.fire(r.id);
      } catch (err) {
        this.logger.error({ err, reminderId: r.id }, '提醒到点处理失败，下一分钟重试');
      }
    }
  }

  // ---------- 到点 ----------

  /** 处理一次到点（幂等：以 next_fire_at 为准，处理后推进到下一次）。 */
  private async fire(reminderId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId))
        .for('update');
      if (!row || !row.enabled || row.pausedByContactRemoval || !row.nextFireAt) return;
      const now = this.ctx.clock.now();
      const due = row.nextFireAt;
      if (due.getTime() > now.getTime()) return;
      const timeZone = await this.ctx.timeZone(row.userId, tx);
      const stale = now.getTime() - due.getTime() > STALE_MS;
      let cursor = row.phrasingCursor;
      if (!stale && (await this.shouldDeliver(tx, row, timeZone, now))) {
        const { text, nextCursor } = await this.compose(tx, row);
        cursor = nextCursor;
        try {
          await this.ctx.postToDirectChat(tx, {
            userId: row.userId,
            characterId: row.characterId,
            sender: 'character',
            content: { type: 'text', text },
            idempotencyKey: `reminder:${row.id}:${due.toISOString()}`,
            ...(row.health ? { labels: ['health'] } : {}),
          });
        } catch (err) {
          // 私聊不可用（角色刚被删除等）：跳过这一次，照常推进。
          this.logger.warn({ err, reminderId: row.id }, '提醒发送失败，跳过本次');
        }
      }
      const next = nextFire(JSON.parse(row.repeat) as Repeat, row.time, timeZone, due);
      await tx.db
        .update(reminders)
        .set({
          nextFireAt: next,
          lastFiredAt: due,
          phrasingCursor: cursor,
          updatedAt: now,
        })
        .where(eq(reminders.id, row.id));
      await this.scheduleFire(tx, row.id, next);
      await this.ctx.dataChanged(tx, row.userId, 'reminders', row.characterId, row.id);
    });
  }

  private async shouldDeliver(
    tx: DbTx,
    row: ReminderRow,
    timeZone: string,
    now: Date,
  ): Promise<boolean> {
    if (
      !(await this.ctx.contacts.getActiveContact(row.userId, row.characterId, tx as unknown as Tx))
    )
      return false;
    if (row.bypassDoNotDisturb) return true;
    const settings = await this.ctx.notificationSettings(row.userId, tx);
    return !(settings && inDoNotDisturb(now, timeZone, settings.doNotDisturb));
  }

  /** 轮流取一条说法（没有就用模板），替换 {称呼} / {内容}。 */
  private async compose(tx: DbTx, row: ReminderRow): Promise<{ text: string; nextCursor: number }> {
    const content = await this.openText(row);
    let pool = TEMPLATES;
    if (row.phrasingsReady && row.phrasingsCiphertext) {
      try {
        const parsed = JSON.parse(
          (
            await this.crypto.open(row.userId, phrasingsAad(row.id), row.phrasingsCiphertext)
          ).toString('utf8'),
        ) as unknown;
        if (Array.isArray(parsed) && parsed.length)
          pool = parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
      } catch (err) {
        this.logger.warn({ err, reminderId: row.id }, '提醒说法解密失败，改用模板');
      }
    }
    if (!pool.length) pool = TEMPLATES;
    const index = row.phrasingCursor % pool.length;
    const contact = await this.ctx.contacts.getActiveContact(
      row.userId,
      row.characterId,
      tx as unknown as Tx,
    );
    const addressAs = contact?.addressAs || (await this.ctx.nickname(row.userId, tx)) || '你';
    const text = pool[index]!.replaceAll('{称呼}', addressAs).replaceAll('{内容}', content);
    return { text: text.slice(0, 500), nextCursor: (index + 1) % pool.length };
  }

  private async scheduleFire(tx: DbTx, reminderId: string, at: Date | null): Promise<void> {
    if (!at) return;
    await this.jobs.at(REMINDER_FIRE_JOB, { reminderId }, at, {
      tx,
      singletonKey: `reminder:${reminderId}:${at.toISOString()}`,
    });
  }

  private async lockUser(tx: DbTx, userId: string): Promise<void> {
    await tx.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`play:reminders:${userId}`}))`);
  }

  private async findByRequest(userId: string, requestId: string): Promise<ReminderRow | null> {
    const [row] = await this.db.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.clientRequestId, requestId)));
    return row ?? null;
  }

  private async loadOwned(tx: DbTx, userId: string, reminderId: string): Promise<ReminderRow> {
    const [row] = await tx.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
      .for('update');
    if (!row) throw new AppError('not_found', '提醒不存在');
    return row;
  }

  private async openText(row: ReminderRow): Promise<string> {
    return (await this.crypto.open(row.userId, textAad(row.id), row.textCiphertext)).toString(
      'utf8',
    );
  }

  private async toDto(row: ReminderRow): Promise<Reminder> {
    return {
      reminderId: row.id,
      characterId: row.characterId,
      text: await this.openText(row),
      time: row.time,
      repeat: ReminderRepeat.parse(JSON.parse(row.repeat)),
      health: row.health,
      bypassDoNotDisturb: row.bypassDoNotDisturb,
      enabled: row.enabled,
      phrasingsReady: row.phrasingsReady,
      nextFireAt:
        row.enabled && !row.pausedByContactRemoval ? (row.nextFireAt?.toISOString() ?? null) : null,
      pausedByContactRemoval: row.pausedByContactRemoval,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
