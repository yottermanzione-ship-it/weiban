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
  FAMILIARITY_FREE_CEILING_LEVEL,
  FAMILIARITY_STAGE_NAMES,
  type BillingPaidHistoryPort,
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
import { BILLING_PAID_HISTORY_PORT } from '../../billing/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { familiarity, familiarityEvents, anniversaries } from '../infra/db/schema.js';
import {
  LEVEL_NAMES,
  MAX_STAGE,
  detectRelationshipIntent,
  effectiveStage,
  pointsInLevel,
  pointsToNextLevel,
  computeNextOccurrence,
  daysKnownOn,
  addDays,
  evaluateUserMessage,
  scaledPoints,
  stableUuid,
  systemAnniversaryDaysUpTo,
} from '../domain/familiarity-rules.js';
import { AchievementService } from './achievements.service.js';
import { CARD_LINES, CardsService, anniversaryTitle, familiarityTitle } from './cards.service.js';
import { GrowthContext } from './context.js';
import { FamiliarityStageSettingsService } from './stage-settings.js';

const MAX_CUSTOM_ANNIVERSARIES = 10;

/** 3.25：阶段上限（权益卡死 / 未成年设定角色）。 */
interface StageCeiling {
  level: number;
  reason: 'membership' | 'minor' | null;
}
interface StageView {
  thresholds: number[];
  ceiling: StageCeiling;
}

/** 3.25：ai-runtime 组装提示词用的关系阶段。 */
export interface RelationshipStage {
  level: number;
  stageName: string;
  romancePaused: boolean;
  preferredTitle: string | null;
  capReason: 'membership' | 'minor' | null;
}

/**
 * 服务器内部的熟悉度事件类型：契约里的类型（客户端可经 HTTP 上报）+ 只由服务器产生的 user_message
 * （16 号 §11 按消息加分，由 chat.message_created 触发；不进契约，客户端不能自己上报）。
 */
export type GrowthFamiliarityEventType = FamiliarityEventType | 'user_message';

/** 事件类型 → P-25 分值（之前按驼峰键取值永远取不到，T-076 修正）。 */
const P25_POINTS: Record<GrowthFamiliarityEventType, number> = {
  user_message: P25_FAMILIARITY.points.userMessage,
  active_chat_day: P25_FAMILIARITY.points.activeChatDay,
  reply_to_proactive: P25_FAMILIARITY.points.replyToProactive,
  moments_interaction: P25_FAMILIARITY.points.momentsInteraction,
  anniversary_chat: P25_FAMILIARITY.points.anniversaryChat,
  first_time_interaction: P25_FAMILIARITY.points.firstTimeInteraction,
};

/**
 * 「首次完成某互动」（P-25 +5，每角色每种只计一次；同受每角色每日上限约束）。
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
    @Inject(FamiliarityStageSettingsService)
    private readonly stages: FamiliarityStageSettingsService,
    @Optional()
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership?: IdentityMembershipReadPort,
    @Optional()
    @Inject(BILLING_PAID_HISTORY_PORT)
    private readonly paid?: BillingPaidHistoryPort,
  ) {}

  // ---------- 3.25 阶段上限（G1-6 / G1-7） ----------

  /** 付过费（充值过或开通过 PRO+）或当前是 PRO+ → 好感度不设上限。 */
  private async entitled(userId: string, tx?: DbTx): Promise<boolean> {
    if (await this.membership?.isProPlus(userId, tx)) return true;
    return Boolean(await this.paid?.hasPaidBefore(userId, tx));
  }

  /**
   * 阶段上限：未成年设定角色最高「亲密好友」（不进入暧昧及以上，不解除）；从未充值且非会员的账号最高「亲密好友」
   * （充值或开会员后解除）。entitled 可由调用方预先算好（列表页一次算一个用户）。
   */
  private async ceiling(
    userId: string,
    characterId: string,
    tx?: DbTx,
    entitled?: boolean,
  ): Promise<StageCeiling> {
    if (await this.ctx.isMinorCharacter(characterId, tx))
      return { level: FAMILIARITY_FREE_CEILING_LEVEL, reason: 'minor' };
    if (entitled ?? (await this.entitled(userId, tx))) return { level: MAX_STAGE, reason: null };
    return { level: FAMILIARITY_FREE_CEILING_LEVEL, reason: 'membership' };
  }

  private async stageView(
    userId: string,
    characterId: string,
    tx?: DbTx,
    entitled?: boolean,
  ): Promise<StageView> {
    return {
      thresholds: await this.stages.thresholds(),
      ceiling: await this.ceiling(userId, characterId, tx, entitled),
    };
  }

  /** 3.25：给 ai-runtime 组装提示词（阶段语气、暂停亲密表达、称呼）。没有好友关系时按第一阶段。 */
  async relationshipStage(userId: string, characterId: string): Promise<RelationshipStage> {
    const [row] = await this.db.db
      .select()
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
    const view = await this.stageView(userId, characterId);
    const level = effectiveStage(
      row?.level ?? 1,
      row?.totalPoints ?? 0,
      view.thresholds,
      view.ceiling.level,
    );
    return {
      level,
      stageName: FAMILIARITY_STAGE_NAMES[level - 1] ?? FAMILIARITY_STAGE_NAMES[0],
      romancePaused: row?.romancePaused ?? false,
      preferredTitle: row?.preferredTitle ?? null,
      capReason: view.ceiling.reason && level >= view.ceiling.level ? view.ceiling.reason : null,
    };
  }

  private async requireActiveContact(userId: string, characterId: string) {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) throw new AppError('not_found', '联系人不存在或尚未激活');
    return contact;
  }

  private familiarityDto(row: typeof familiarity.$inferSelect, view: StageView): FamiliarityInfo {
    const level = effectiveStage(row.level, row.totalPoints, view.thresholds, view.ceiling.level);
    return FamiliarityInfo.parse({
      characterId: row.characterId,
      level,
      pointsInLevel: pointsInLevel(row.totalPoints, level, view.thresholds),
      pointsToNextLevel: pointsToNextLevel(level, row.totalPoints, view.thresholds),
      totalPoints: row.totalPoints,
      updatedAt: row.updatedAt.toISOString(),
      stageName: FAMILIARITY_STAGE_NAMES[level - 1],
      capReason: view.ceiling.reason && level >= view.ceiling.level ? view.ceiling.reason : null,
      romancePaused: row.romancePaused,
    });
  }

  private zeroFamiliarity(characterId: string, view: StageView): FamiliarityInfo {
    return FamiliarityInfo.parse({
      characterId,
      level: 1,
      pointsInLevel: 0,
      pointsToNextLevel: pointsToNextLevel(1, 0, view.thresholds),
      totalPoints: 0,
      updatedAt: this.clock.now().toISOString(),
      stageName: FAMILIARITY_STAGE_NAMES[0],
      capReason: null,
      romancePaused: false,
    });
  }

  // ---------- GrowthReadPort（由 growth.module 适配：getDaysKnown → getDaysKnownCount） ----------

  async getFamiliarityLevel(userId: string, characterId: string): Promise<number | null> {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) return null;
    return (await this.relationshipStage(userId, characterId)).level;
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
    const view = await this.stageView(userId, characterId);
    return row ? this.familiarityDto(row, view) : this.zeroFamiliarity(characterId, view);
  }

  /** 「我 → 服务 → 熟悉度」：所有角色，按等级从高到低（GRW-03 第 7 条）。 */
  async listFamiliarity(userId: string): Promise<{ items: FamiliarityInfo[] }> {
    const contacts = await this.contacts.listActiveContacts(userId);
    const rows = await this.db.db.select().from(familiarity).where(eq(familiarity.userId, userId));
    const byChar = new Map(rows.map((r) => [r.characterId, r]));
    const entitled = await this.entitled(userId);
    const items = await Promise.all(
      contacts.map(async (c) => {
        const row = byChar.get(c.characterId);
        const view = await this.stageView(userId, c.characterId, undefined, entitled);
        return row ? this.familiarityDto(row, view) : this.zeroFamiliarity(c.characterId, view);
      }),
    );
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
   * 按消息加分（16 号 §11）：用户发给该角色的一条消息（私聊，或群里 @ 到它）。调用方保证消息确由该用户发出、
   * 目标角色正确；这里负责「有效消息」判定与幂等（键用消息 ID + 角色 ID，群里 @ 多个角色各计一次）。
   * - 去掉空白后至少 minChars 个字；
   * - 与该用户对该角色上一条消息（不论是否计分）内容不完全相同（去空白后比较指纹，不存正文）；
   * - 距上一条计分消息至少 minIntervalMs（按消息发送时刻；乱序到达时取差的绝对值）。
   * 返回本次实际加的点数（无效、已计过或当天已满为 0）。
   */
  async awardUserMessage(
    tx: DbTx,
    userId: string,
    characterId: string,
    messageId: string,
    text: string,
    sentAt: Date,
  ): Promise<number> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx);
    if (!contact) return 0;
    await this.lockFamiliarity(tx, userId, characterId);
    const idempotencyKey = `user_message:${messageId}:${characterId}`;
    const [existing] = await tx.db
      .select({ id: familiarityEvents.id })
      .from(familiarityEvents)
      .where(eq(familiarityEvents.idempotencyKey, idempotencyKey));
    if (existing) return 0;

    const where = and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId));
    const [cur] = await tx.db
      .select({
        lastMessageHash: familiarity.lastMessageHash,
        lastMessageScoredAt: familiarity.lastMessageScoredAt,
      })
      .from(familiarity)
      .where(where)
      .for('update');
    const { hash, valid } = evaluateUserMessage({
      text,
      sentAt,
      lastMessageHash: cur?.lastMessageHash ?? null,
      lastMessageScoredAt: cur?.lastMessageScoredAt ?? null,
    });
    // 3.25（旧版「暂停亲密表达」）：用户明确要求暂停 / 恢复恋爱暧昧表达、或说了希望的称呼，不论是否计分都记下。
    const intent = detectRelationshipIntent(text);
    const romance = {
      ...(intent.romancePaused === null ? {} : { romancePaused: intent.romancePaused }),
      ...(intent.title ? { preferredTitle: intent.title } : {}),
    };

    // 先记下指纹（和计分时刻）：上一条消息不论是否计分都参与「完全相同」比较。
    const scoredAt = valid ? sentAt : (cur?.lastMessageScoredAt ?? null);
    if (cur) {
      await tx.db
        .update(familiarity)
        .set({ lastMessageHash: hash, lastMessageScoredAt: scoredAt, ...romance })
        .where(where);
    } else {
      await tx.db.insert(familiarity).values({
        id: newId(),
        userId,
        characterId,
        totalPoints: 0,
        level: 1,
        dailyPoints: 0,
        dailyPointsDate: await this.ctx.localToday(userId, tx),
        updatedAt: this.clock.now(),
        lastMessageHash: hash,
        lastMessageScoredAt: scoredAt,
        ...romance,
      });
    }
    if (Object.keys(romance).length)
      await this.ctx.dataChanged(tx, userId, 'familiarity', characterId, null);
    if (!valid) return 0;
    const res = await this.awardPoints(
      tx,
      userId,
      characterId,
      'user_message',
      idempotencyKey,
      sentAt,
    );
    return res.pointsAdded;
  }

  private async lockFamiliarity(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('growth:familiarity:' || $1 || ':' || $2, 0))",
      [userId, characterId],
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
    eventType: GrowthFamiliarityEventType,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<AddFamiliarityPointsResponse> {
    await this.lockFamiliarity(tx, userId, characterId);
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
    const view = await this.stageView(userId, characterId, tx);
    if (existing)
      return AddFamiliarityPointsResponse.parse({
        familiarity: cur ? this.familiarityDto(cur, view) : this.zeroFamiliarity(characterId, view),
        pointsAdded: 0,
        leveledUp: false,
      });

    const basePoints = P25_POINTS[eventType] ?? 0;
    if (basePoints <= 0) throw new AppError('bad_request', '不支持的熟悉度事件类型');
    // 会员 v5（16 号 §11）：PRO+ 每次加分与每日上限都 ×2（见 P25_FAMILIARITY.proPlusBonusRate）
    const { points: rawPoints, dailyCap } = scaledPoints(
      basePoints,
      Boolean(await this.membership?.isProPlus(userId, tx)),
    );

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
        familiarity: cur ? this.familiarityDto(cur, view) : this.zeroFamiliarity(characterId, view),
        pointsAdded: 0,
        leveledUp: false,
      });

    const newTotal = (cur?.totalPoints ?? 0) + pointsAdded;
    const oldLevel = cur?.level ?? 1;
    // 3.25：六阶段阈值（后台可调）+ 上限（未付费且非会员 / 未成年设定角色最高「亲密好友」）；点数照常累计。
    const newLevel = effectiveStage(oldLevel, newTotal, view.thresholds, view.ceiling.level);
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
      familiarity: this.familiarityDto(saved!, view),
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
      // 3.27（H1）：关系类型选择已删除，「恋人」只看好感度阶段（恋人阶段起且没有暂停亲密表达）。
      isRomantic: await this.relationshipStage(userId, characterId)
        .then((s) => s.level >= 5 && !s.romancePaused)
        .catch(() => false),
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
