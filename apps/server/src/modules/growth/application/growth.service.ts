import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  FamiliarityInfo,
  AddFamiliarityPointsRequest,
  AddFamiliarityPointsResponse,
  DaysKnownInfo,
  Anniversary,
  AddAnniversaryRequest,
  UpdateAnniversaryRequest,
  Id,
  type ContactsReadPort,
  type FamiliarityEventType,
  type IdentityMembershipReadPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  P25_FAMILIARITY,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { familiarity, familiarityEvents, anniversaries } from '../infra/db/schema.js';
import {
  LEVEL_NAMES,
  levelFromPoints,
  pointsInLevel,
  pointsToNextLevel,
  computeNextOccurrence,
  daysKnownOn,
  addDays,
  stableUuid,
  systemAnniversaryDaysUpTo,
} from '../domain/familiarity-rules.js';
import { AchievementService } from './achievements.service.js';
import { CARD_LINES, CardsService, anniversaryTitle, familiarityTitle } from './cards.service.js';
import { GrowthContext } from './context.js';

const MAX_CUSTOM_ANNIVERSARIES = 10;

/** 契约事件类型 → P-25 分值（之前按驼峰键取值永远取不到，T-076 修正）。 */
const P25_POINTS: Record<FamiliarityEventType, number> = {
  active_chat_day: P25_FAMILIARITY.points.activeChatDay,
  reply_to_proactive: P25_FAMILIARITY.points.replyToProactive,
  moments_interaction: P25_FAMILIARITY.points.momentsInteraction,
  anniversary_chat: P25_FAMILIARITY.points.anniversaryChat,
  first_time_interaction: P25_FAMILIARITY.points.firstTimeInteraction,
};

/**
 * 「首次完成某互动」（P-25 +5，每角色每种只计一次；每角色每天 20 点上限照旧）。
 * 来源：GRW-03 第 2 条（第一次通话、第一次群聊）与 PLAY 联动表（领养、每日一问、心愿、寄信、专注、提醒）。
 */
export type FirstInteractionKind =
  | 'call'
  | 'group_chat'
  | 'pet_adopt'
  | 'daily_question'
  | 'wish_done'
  | 'letter'
  | 'focus'
  | 'reminder';

/** 系统纪念日 ID：不存库，按角色和天数生成稳定的 UUID。 */
export function systemAnniversaryId(characterId: string, days: number): string {
  return stableUuid(`growth:anniversary:${characterId}:${days}`);
}

@Injectable()
export class GrowthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(AchievementService) private readonly achievements: AchievementService,
    @Inject(GrowthContext) private readonly ctx: GrowthContext,
    @Optional()
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership?: IdentityMembershipReadPort,
  ) {}

  private async requireActiveContact(userId: string, characterId: string) {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) throw new AppError('not_found', '联系人不存在或尚未激活');
    return contact;
  }

  private familiarityDto(row: typeof familiarity.$inferSelect): FamiliarityInfo {
    return FamiliarityInfo.parse({
      characterId: row.characterId,
      level: row.level,
      pointsInLevel: pointsInLevel(row.totalPoints, row.level),
      pointsToNextLevel: pointsToNextLevel(row.level),
      totalPoints: row.totalPoints,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private zeroFamiliarity(characterId: string): FamiliarityInfo {
    return FamiliarityInfo.parse({
      characterId,
      level: 1,
      pointsInLevel: 0,
      pointsToNextLevel: pointsToNextLevel(1),
      totalPoints: 0,
      updatedAt: this.clock.now().toISOString(),
    });
  }

  // ---------- GrowthReadPort（由 growth.module 适配：getDaysKnown → getDaysKnownCount） ----------

  async getFamiliarityLevel(userId: string, characterId: string): Promise<number | null> {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) return null;
    const [row] = await this.db.db
      .select({ level: familiarity.level })
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
    return row?.level ?? 1;
  }

  async getDaysKnownCount(userId: string, characterId: string): Promise<number | null> {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) return null;
    return Math.max(1, daysKnownOn(contact.knownSince, await this.ctx.localToday(userId)));
  }

  // ---------- 熟悉度 ----------

  async getFamiliarity(userId: string, characterId: string): Promise<FamiliarityInfo> {
    parseContract(Id, characterId);
    await this.requireActiveContact(userId, characterId);
    const [row] = await this.db.db
      .select()
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
    return row ? this.familiarityDto(row) : this.zeroFamiliarity(characterId);
  }

  /** 「我 → 服务 → 熟悉度」：所有角色，按等级从高到低（GRW-03 第 7 条）。 */
  async listFamiliarity(userId: string): Promise<{ items: FamiliarityInfo[] }> {
    const contacts = await this.contacts.listActiveContacts(userId);
    const rows = await this.db.db.select().from(familiarity).where(eq(familiarity.userId, userId));
    const byChar = new Map(rows.map((r) => [r.characterId, r]));
    const items = contacts.map((c) => {
      const row = byChar.get(c.characterId);
      return row ? this.familiarityDto(row) : this.zeroFamiliarity(c.characterId);
    });
    items.sort((a, b) => b.totalPoints - a.totalPoints);
    return { items };
  }

  async addPoints(
    userId: string,
    characterId: string,
    input: unknown,
  ): Promise<AddFamiliarityPointsResponse> {
    parseContract(Id, characterId);
    const body = parseContract(AddFamiliarityPointsRequest, input);
    await this.requireActiveContact(userId, characterId);
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : this.clock.now();
    return this.db.transaction((tx) =>
      this.awardPoints(tx, userId, characterId, body.eventType, body.idempotencyKey, occurredAt),
    );
  }

  /** 首次完成某互动 +5（同一用户、角色、种类只计一次）。 */
  async awardFirstInteraction(
    tx: DbTx,
    userId: string,
    characterId: string,
    kind: FirstInteractionKind,
  ): Promise<void> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx);
    if (!contact) return;
    await this.awardPoints(
      tx,
      userId,
      characterId,
      'first_time_interaction',
      `first:${kind}:${userId}:${characterId}`,
      this.clock.now(),
    );
  }

  /**
   * 加分核心（幂等、每日上限）。升级时：发 growth.familiarity_leveled_up、每跨一级发一张熟悉度卡、
   * 私聊系统提示 familiarity_level_up、成就第 27、28 号、data.changed(familiarity)。
   */
  async awardPoints(
    tx: DbTx,
    userId: string,
    characterId: string,
    eventType: FamiliarityEventType,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<AddFamiliarityPointsResponse> {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('growth:familiarity:' || $1 || ':' || $2, 0))",
      [userId, characterId],
    );
    const localDateStr = await this.ctx.localToday(userId, tx);

    const [existing] = await tx.db
      .select({ id: familiarityEvents.id })
      .from(familiarityEvents)
      .where(eq(familiarityEvents.idempotencyKey, idempotencyKey));
    const [cur] = await tx.db
      .select()
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)))
      .for('update');
    if (existing)
      return AddFamiliarityPointsResponse.parse({
        familiarity: cur ? this.familiarityDto(cur) : this.zeroFamiliarity(characterId),
        pointsAdded: 0,
        leveledUp: false,
      });

    const basePoints = P25_POINTS[eventType] ?? 0;
    if (basePoints <= 0) throw new AppError('bad_request', '不支持的熟悉度事件类型');
    // 会员 v5：PRO+ 好感度轻微加成（加分与每日上限同比例，见 P25_FAMILIARITY.proPlusBonusRate）
    const rate = (await this.membership?.isProPlus(userId, tx))
      ? P25_FAMILIARITY.proPlusBonusRate
      : 1;
    const rawPoints = Math.ceil(basePoints * rate);
    const dailyCap = Math.ceil(P25_FAMILIARITY.maxPointsPerCharacterPerDay * rate);

    const isSameDay = cur?.dailyPointsDate === localDateStr;
    const todayUsed = isSameDay ? cur.dailyPoints : 0;
    const remaining = Math.max(0, dailyCap - todayUsed);
    const pointsAdded = Math.min(rawPoints, remaining);

    // 流水同时用于幂等：上限已满时也记一笔（实际加 0）。
    await tx.db.insert(familiarityEvents).values({
      id: newId(),
      userId,
      characterId,
      eventType,
      points: pointsAdded > 0 ? pointsAdded : rawPoints,
      idempotencyKey,
      occurredAt,
    });

    if (pointsAdded <= 0)
      return AddFamiliarityPointsResponse.parse({
        familiarity: cur ? this.familiarityDto(cur) : this.zeroFamiliarity(characterId),
        pointsAdded: 0,
        leveledUp: false,
      });

    const newTotal = (cur?.totalPoints ?? 0) + pointsAdded;
    const oldLevel = cur?.level ?? 1;
    const newLevel = Math.max(oldLevel, levelFromPoints(newTotal));
    const [saved] = await tx.db
      .insert(familiarity)
      .values({
        id: cur?.id ?? newId(),
        userId,
        characterId,
        totalPoints: newTotal,
        level: newLevel,
        dailyPoints: todayUsed + pointsAdded,
        dailyPointsDate: localDateStr,
        updatedAt: occurredAt,
      })
      .onConflictDoUpdate({
        target: [familiarity.userId, familiarity.characterId],
        set: {
          totalPoints: sql`excluded.total_points`,
          level: sql`excluded.level`,
          dailyPoints: sql`excluded.daily_points`,
          dailyPointsDate: sql`excluded.daily_points_date`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning();

    const leveledUp = newLevel > oldLevel;
    if (leveledUp) await this.onLevelUp(tx, userId, characterId, oldLevel, newLevel);
    await this.ctx.dataChanged(tx, userId, 'familiarity', characterId, null);

    return AddFamiliarityPointsResponse.parse({
      familiarity: this.familiarityDto(saved!),
      pointsAdded,
      leveledUp,
    });
  }

  private async onLevelUp(
    tx: DbTx,
    userId: string,
    characterId: string,
    oldLevel: number,
    newLevel: number,
  ): Promise<void> {
    const name = await this.ctx.characterName(userId, characterId, tx);
    await this.ctx.postSystem(
      tx,
      userId,
      characterId,
      'familiarity_level_up',
      { characterId, characterName: name, level: newLevel, levelName: LEVEL_NAMES[newLevel] ?? '' },
      `familiarity_level_up:${userId}:${characterId}:${newLevel}`,
    );
    for (let level = oldLevel + 1; level <= newLevel; level += 1) {
      await this.cards.issue(tx, {
        userId,
        characterId,
        kind: 'familiarity',
        title: familiarityTitle(level),
        line: CARD_LINES.familiarity(level),
        faceMediaId: null,
        templateId: null,
        sourceMessageIds: [],
        idempotencyKey: `familiarity:${level}`,
        noticeParams: { level, levelName: LEVEL_NAMES[level] ?? '' },
      });
    }
    await this.outbox.publish(tx, 'growth.familiarity_leveled_up', 'growth', {
      userId,
      characterId,
      level: newLevel,
    });
    if (newLevel >= 3) await this.achievements.unlock(tx, userId, 'familiarity_l3', characterId);
    if (newLevel >= 5) await this.achievements.unlock(tx, userId, 'familiarity_l5', characterId);
  }

  // ---------- 认识天数与纪念日 ----------

  private customDto(row: typeof anniversaries.$inferSelect, today: string): Anniversary {
    return Anniversary.parse({
      id: row.id,
      kind: 'custom',
      label: row.label,
      date: row.date,
      nextOccurrence: computeNextOccurrence(row.date, today, 'custom', row.repeatYearly),
      repeatYearly: row.repeatYearly,
    });
  }

  async getDaysKnown(userId: string, characterId: string): Promise<DaysKnownInfo> {
    parseContract(Id, characterId);
    const contact = await this.requireActiveContact(userId, characterId);
    const today = await this.ctx.localToday(userId);
    const knownSince = contact.knownSince;
    const daysKnown = Math.max(1, daysKnownOn(knownSince, today));

    const customRows = await this.db.db
      .select()
      .from(anniversaries)
      .where(and(eq(anniversaries.userId, userId), eq(anniversaries.characterId, characterId)))
      .orderBy(anniversaries.date);

    // 系统节点：已过的全部 + 未来一年内的（GRW-04 第 2 条）。
    const sysAnniversaries: Anniversary[] = systemAnniversaryDaysUpTo(
      Math.max(daysKnown + 365, 400),
    ).map((days) => {
      const date = addDays(knownSince, days - 1);
      return Anniversary.parse({
        id: systemAnniversaryId(characterId, days),
        kind: 'system',
        label: anniversaryTitle(days),
        date,
        nextOccurrence: date >= today ? date : null,
        repeatYearly: false,
      });
    });
    const customAnniversaries = customRows.map((r) => this.customDto(r, today));
    const all = [...sysAnniversaries, ...customAnniversaries].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const nextAnniversary =
      all
        .filter((a) => a.nextOccurrence && a.nextOccurrence >= today)
        .sort((a, b) => (a.nextOccurrence ?? '').localeCompare(b.nextOccurrence ?? ''))[0] ?? null;

    return DaysKnownInfo.parse({
      characterId,
      daysKnown,
      knownSince,
      nextAnniversary,
      anniversaries: all,
      isRomantic: contact.relationship === '恋人',
    });
  }

  async addAnniversary(userId: string, characterId: string, input: unknown): Promise<Anniversary> {
    parseContract(Id, characterId);
    const body = parseContract(AddAnniversaryRequest, input);
    await this.requireActiveContact(userId, characterId);
    const today = await this.ctx.localToday(userId);
    return this.db.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('growth:anniv:' || $1 || ':' || $2, 0))",
        [userId, characterId],
      );
      const [countRow] = await tx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(anniversaries)
        .where(and(eq(anniversaries.userId, userId), eq(anniversaries.characterId, characterId)));
      if ((countRow?.n ?? 0) >= MAX_CUSTOM_ANNIVERSARIES)
        throw new AppError(
          'bad_request',
          `每个角色最多添加 ${MAX_CUSTOM_ANNIVERSARIES} 个自定义纪念日`,
        );
      const now = this.clock.now();
      const [row] = await tx.db
        .insert(anniversaries)
        .values({
          id: newId(),
          userId,
          characterId,
          label: body.label,
          date: body.date,
          repeatYearly: body.repeatYearly ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.ctx.dataChanged(tx, userId, 'anniversaries', characterId, row!.id);
      return this.customDto(row!, today);
    });
  }

  async updateAnniversary(
    userId: string,
    characterId: string,
    anniversaryId: string,
    input: unknown,
  ): Promise<Anniversary> {
    parseContract(Id, characterId);
    parseContract(Id, anniversaryId);
    const body = parseContract(UpdateAnniversaryRequest, input);
    await this.requireActiveContact(userId, characterId);
    const today = await this.ctx.localToday(userId);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .update(anniversaries)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.date !== undefined ? { date: body.date } : {}),
          ...(body.repeatYearly !== undefined ? { repeatYearly: body.repeatYearly } : {}),
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(anniversaries.id, anniversaryId),
            eq(anniversaries.userId, userId),
            eq(anniversaries.characterId, characterId),
          ),
        )
        .returning();
      if (!row) throw new AppError('not_found', '纪念日不存在（系统纪念日不可编辑）');
      await this.ctx.dataChanged(tx, userId, 'anniversaries', characterId, row.id);
      return this.customDto(row, today);
    });
  }

  async removeAnniversary(
    userId: string,
    characterId: string,
    anniversaryId: string,
  ): Promise<void> {
    parseContract(Id, characterId);
    parseContract(Id, anniversaryId);
    await this.requireActiveContact(userId, characterId);
    await this.db.transaction(async (tx) => {
      const deleted = await tx.db
        .delete(anniversaries)
        .where(
          and(
            eq(anniversaries.id, anniversaryId),
            eq(anniversaries.userId, userId),
            eq(anniversaries.characterId, characterId),
          ),
        )
        .returning({ id: anniversaries.id });
      if (!deleted.length) throw new AppError('bad_request', '系统纪念日不可删除，或纪念日不存在');
      await this.ctx.dataChanged(tx, userId, 'anniversaries', characterId, anniversaryId);
    });
  }

  // ---------- 删除清单 ----------

  async purgeCharacter(tx: DbTx, userId: string, characterId: string): Promise<number> {
    let n = 0;
    for (const table of [familiarity, familiarityEvents, anniversaries] as const) {
      const r = await tx.db
        .delete(table)
        .where(and(eq(table.userId, userId), eq(table.characterId, characterId)));
      n += r.rowCount ?? 0;
    }
    return n;
  }

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    let n = 0;
    for (const table of [familiarity, familiarityEvents, anniversaries] as const) {
      const r = await tx.db.delete(table).where(eq(table.userId, userId));
      n += r.rowCount ?? 0;
    }
    return n;
  }

  async countUserData(userId: string): Promise<number> {
    let n = 0;
    for (const table of [familiarity, familiarityEvents, anniversaries] as const) {
      const [r] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.userId, userId));
      n += r?.n ?? 0;
    }
    return n;
  }
}
