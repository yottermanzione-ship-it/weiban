/**
 * growth 的事件订阅、纪念日扫描与删除清单（T-076）。
 * - 成就只看「是否发生、发生了几次」，从各模块事件判定，不读聊天正文（GRW-06 第 7 条）。
 * - 纪念卡：每小时扫描一次 growth 自己的通讯录索引，按用户时区判断「认识第 N 天」是否为系统纪念日（GRW-04 第 2 条）；
 *   服务停机错过的节点在 7 天内补发。自定义纪念日当天发 growth.anniversary_reached（kind = custom，不发卡）。
 * - 节日卡：节日当天用户在私聊里给角色发消息时发（GRW-05 第 1 条），节日清单来自 proactive（经装配入口注入）。
 * - 瞬间卡（系统）：第一次通话、被角色拉进群、角色在朋友圈回复你，每个角色各一张。
 * - 「首次完成某互动」+5（P-25）：第一次通话 / 群聊 / 领养 / 每日一问 / 完成心愿 / 寄信 / 专注 / 设提醒。
 * - 经期日记不产生任何卡片、成就、熟悉度（PLAY-01 第 9 条）：health 模块的事件一律不订阅。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AchievementKey, HolidayEventPort, UpcomingHoliday } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  OUTBOX,
  USER_DATA_REGISTRY,
  type Clock,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
  type Logger,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import {
  addDays,
  customAnniversaryHits,
  daysKnownOn,
  isSystemAnniversaryDay,
} from '../domain/familiarity-rules.js';
import { anniversaries, contactIndex, notices } from '../infra/db/schema.js';
import { GROWTH_HOLIDAY_SOURCE } from '../tokens.js';
import { AchievementService } from './achievements.service.js';
import { CARD_LINES, CardsService, anniversaryTitle } from './cards.service.js';
import { GrowthContext } from './context.js';
import { GrowthService, systemAnniversaryId, type FirstInteractionKind } from './growth.service.js';
import { PetsService } from './pets.service.js';

export const GROWTH_ANNIVERSARY_SWEEP_JOB = 'growth.anniversary_sweep';
export const GROWTH_PET_STAGE_SWEEP_JOB = 'growth.pet_stage_sweep';
/** 停机错过的系统纪念日最多往回补几天。 */
const CATCH_UP_DAYS = 7;
const DAY_ACHIEVEMENTS: Array<[number, AchievementKey]> = [
  [7, 'days_7'],
  [100, 'days_100'],
  [365, 'days_365'],
];

@Injectable()
export class GrowthEvents implements OnModuleInit {
  private holidayCache = new Map<string, { at: number; items: UpcomingHoliday[] }>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(GrowthService) private readonly growth: GrowthService,
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(AchievementService) private readonly achievements: AchievementService,
    @Inject(GrowthContext) private readonly ctx: GrowthContext,
    @Inject(PetsService) private readonly pets: PetsService,
    @Optional() @Inject(GROWTH_HOLIDAY_SOURCE) private readonly holidays?: HolidayEventPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // 删除清单（卡片、成就、熟悉度、纪念日、宠物都在这一份里；模块只能登记一次）。
    this.registry.register({
      module: 'growth',
      purgeUser: (userId) => this.purgeUser(userId),
      countUserData: (userId) => this.countUserData(userId),
    });
    this.subscribe();
    await this.jobs.work(GROWTH_ANNIVERSARY_SWEEP_JOB, () => this.sweep());
    await this.jobs.schedule(GROWTH_ANNIVERSARY_SWEEP_JOB, '5 * * * *');
    // T-077：宠物成长阶段按领养天数推进（读取时也会推进）。
    await this.jobs.work(GROWTH_PET_STAGE_SWEEP_JOB, () => this.pets.sweepStages());
    await this.jobs.schedule(GROWTH_PET_STAGE_SWEEP_JOB, '9 * * * *');
  }

  private subscribe(): void {
    const bus = this.bus;

    // ---------- contacts ----------
    bus.subscribe({
      consumer: 'growth.on_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async (event, tx) => {
        const { userId, characterId, referrerCharacterId } = event.payload;
        const contact = await this.ctx.contacts.getActiveContact(userId, characterId, tx);
        if (contact) await this.upsertIndex(tx, userId, characterId, contact.knownSince);
        await this.achievements.unlock(tx, userId, 'first_contact', characterId);
        if (referrerCharacterId)
          await this.achievements.unlock(tx, userId, 'introduced', characterId);
        const active = await this.ctx.contacts.listActiveContacts(userId);
        await this.achievements.observe(tx, userId, 'active_contacts', active.length, characterId);
      },
    });
    bus.subscribe({
      consumer: 'growth.on_contact_removed',
      eventType: 'contacts.contact_removed',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        await tx.db
          .update(contactIndex)
          .set({ active: false, updatedAt: this.clock.now() })
          .where(and(eq(contactIndex.userId, userId), eq(contactIndex.characterId, characterId)));
      },
    });
    bus.subscribe({
      consumer: 'growth.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        // 彻底删除：卡片、熟悉度、纪念日随之删除；成就不收回（GRW-06 第 5 条）。
        const { userId, characterId } = event.payload;
        await tx.db
          .delete(contactIndex)
          .where(and(eq(contactIndex.userId, userId), eq(contactIndex.characterId, characterId)));
        await this.cards.purgeCharacter(tx, userId, characterId);
        await this.growth.purgeCharacter(tx, userId, characterId);
        await this.pets.purgeCharacter(tx, userId, characterId);
        await this.ctx.dataChanged(tx, userId, 'pets', characterId, null);
        await this.ctx.dataChanged(tx, userId, 'cards', characterId, null);
      },
    });

    // ---------- chat ----------
    bus.subscribe({
      consumer: 'growth.on_message_created',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.senderKind === 'user' && p.senderRefId) {
          const userId = p.senderRefId;
          await this.unlockOnce(tx, userId, 'first_message');
          if (p.contentType === 'nudge') await this.unlockOnce(tx, userId, 'first_nudge');
          if (p.contentType === 'image') await this.unlockOnce(tx, userId, 'first_image_sent');
          if (p.contentType === 'voice') await this.unlockOnce(tx, userId, 'first_voice_sent');
          if (p.conversationType === 'direct' && p.contentType !== 'system')
            await this.onUserDirectMessage(tx, userId, p.conversationId);
          return;
        }
        if (
          p.senderKind === 'character' &&
          p.contentType === 'voice' &&
          p.conversationType === 'direct'
        )
          for (const userId of p.userRecipientIds)
            await this.unlockOnce(tx, userId, 'first_voice_received', p.senderRefId);
      },
    });
    bus.subscribe({
      consumer: 'growth.on_group_members_changed',
      eventType: 'chat.group_members_changed',
      handle: async (event, tx) => {
        const p = event.payload;
        if (!p.addedCharacterIds.length) return;
        if (p.cause === 'created' && !p.byCharacterId)
          await this.achievements.unlock(tx, p.ownerUserId, 'first_group');
        if (p.cause === 'created')
          for (const characterId of p.addedCharacterIds)
            await this.growth.awardFirstInteraction(tx, p.ownerUserId, characterId, 'group_chat');
        if (p.byCharacterId && (p.cause === 'created' || p.cause === 'character'))
          await this.pulledIntoGroup(tx, p.ownerUserId, p.byCharacterId);
      },
    });

    // ---------- ai-runtime 里程碑 ----------
    bus.subscribe({
      consumer: 'growth.on_ai_milestone',
      eventType: 'ai_runtime.milestone',
      handle: async (event, tx) => {
        const { userId, characterId, kind } = event.payload;
        switch (kind) {
          case 'proactive_message_sent':
            return this.unlockOnce(tx, userId, 'first_proactive', characterId);
          case 'memory_auto_created':
            return this.unlockOnce(tx, userId, 'first_memory', characterId);
          case 'voice_message_sent':
            return this.unlockOnce(tx, userId, 'first_voice_received', characterId);
          case 'group_invited_user':
            return this.pulledIntoGroup(tx, userId, characterId);
          case 'moments_replied_user':
            return this.systemMomentCard(
              tx,
              userId,
              characterId,
              'moments_reply',
              '朋友圈里的回复',
              CARD_LINES.momentsReply,
            );
          default:
            return;
        }
      },
    });

    // ---------- calls ----------
    bus.subscribe({
      consumer: 'growth.on_call_answered',
      eventType: 'calls.call_answered',
      handle: async (event, tx) => {
        const { userId, characterId, direction } = event.payload;
        await this.achievements.unlock(tx, userId, 'first_call', characterId);
        if (direction === 'incoming')
          await this.achievements.unlock(tx, userId, 'first_incoming_call', characterId);
        await this.systemMomentCard(
          tx,
          userId,
          characterId,
          'first_call',
          '第一次通话',
          CARD_LINES.firstCall,
        );
        await this.growth.awardFirstInteraction(tx, userId, characterId, 'call');
      },
    });

    // ---------- moments ----------
    bus.subscribe({
      consumer: 'growth.on_moments_post_created',
      eventType: 'moments.post_created',
      handle: async (event, tx) => {
        if (event.payload.authorKind === 'user')
          await this.achievements.unlock(tx, event.payload.ownerUserId, 'first_moment');
      },
    });
    bus.subscribe({
      consumer: 'growth.on_moments_comment_created',
      eventType: 'moments.comment_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.authorKind === 'user' && p.postAuthorKind === 'character')
          await this.achievements.unlock(
            tx,
            p.ownerUserId,
            'first_moment_comment',
            p.postAuthorCharacterId,
          );
      },
    });
    bus.subscribe({
      consumer: 'growth.on_moments_post_liked',
      eventType: 'moments.post_liked',
      handle: async (event, tx) => {
        const p = event.payload;
        if (
          p.postAuthorKind === 'user' &&
          p.likerKind === 'character' &&
          p.characterLikeCount >= 10
        )
          await this.achievements.unlock(tx, p.ownerUserId, 'popular');
      },
    });

    // ---------- library ----------
    bus.subscribe({
      consumer: 'growth.on_favorite_added',
      eventType: 'library.favorite_added',
      handle: async (event, tx) => {
        const p = event.payload;
        await this.achievements.unlock(tx, p.userId, 'first_favorite');
        await this.achievements.bump(tx, p.userId, 'favorites_total', p.favoriteIds.length);
        await this.achievements.observe(tx, p.userId, 'favorites_total', p.totalFavorites);
      },
    });
    bus.subscribe({
      consumer: 'growth.on_share_image_generated',
      eventType: 'library.share_image_generated',
      handle: async (event, tx) => {
        await this.achievements.unlock(tx, event.payload.userId, 'first_share_image');
      },
    });

    // ---------- 宠物（T-077） ----------
    bus.subscribe({
      consumer: 'growth.on_pet_names_chosen',
      eventType: 'chat.message_action_chosen',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.cardKind !== 'pet_names' || p.ref?.kind !== 'pet_naming_request') return;
        await this.pets.onNameChosen(tx, p.userId, p.ref.id, p.actionId);
      },
    });
    bus.subscribe({
      consumer: 'growth.on_pet_adopted',
      eventType: 'growth.pet_adopted',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        await this.achievements.unlock(tx, userId, 'first_pet', characterId);
        await this.growth.awardFirstInteraction(tx, userId, characterId, 'pet_adopt');
      },
    });
    bus.subscribe({
      consumer: 'growth.on_pet_stage_changed',
      eventType: 'growth.pet_stage_changed',
      handle: async (event, tx) => {
        const { userId, characterId, stage } = event.payload;
        if (stage === 'adult')
          await this.achievements.unlock(tx, userId, 'pet_grown_up', characterId);
      },
    });

    // ---------- 玩法（T-091～T-095 发出） ----------
    const playFirst = (
      consumer: string,
      eventType:
        | 'play.wishlist_item_completed'
        | 'play.daily_answer_submitted'
        | 'play.letter_sent'
        | 'play.letter_delivered'
        | 'play.focus_ended'
        | 'play.reminder_saved',
      achievement: AchievementKey | null,
      first: FirstInteractionKind | null,
    ) =>
      bus.subscribe({
        consumer,
        eventType,
        handle: async (event, tx) => {
          const { userId, characterId } = event.payload as { userId: string; characterId: string };
          if (achievement) await this.achievements.unlock(tx, userId, achievement, characterId);
          if (first) await this.growth.awardFirstInteraction(tx, userId, characterId, first);
        },
      });
    playFirst(
      'growth.on_wishlist_completed',
      'play.wishlist_item_completed',
      'first_wish_done',
      'wish_done',
    );
    playFirst(
      'growth.on_daily_answer',
      'play.daily_answer_submitted',
      'first_daily_question',
      'daily_question',
    );
    playFirst('growth.on_letter_sent', 'play.letter_sent', null, 'letter');
    playFirst('growth.on_letter_delivered', 'play.letter_delivered', 'first_letter_reply', null);
    playFirst('growth.on_focus_ended', 'play.focus_ended', 'first_focus', 'focus');
    playFirst('growth.on_reminder_saved', 'play.reminder_saved', null, 'reminder');
  }

  // ---------- 处理细节 ----------

  private async unlockOnce(
    tx: DbTx,
    userId: string,
    key: AchievementKey,
    characterId: string | null = null,
  ): Promise<void> {
    if (await this.achievements.has(userId, key, tx)) return;
    await this.achievements.unlock(tx, userId, key, characterId);
  }

  private async upsertIndex(
    tx: DbTx,
    userId: string,
    characterId: string,
    knownSince: string,
  ): Promise<void> {
    await tx.db
      .insert(contactIndex)
      .values({ userId, characterId, knownSince, active: true, updatedAt: this.clock.now() })
      .onConflictDoUpdate({
        target: [contactIndex.userId, contactIndex.characterId],
        set: { knownSince, active: true, updatedAt: this.clock.now() },
      });
  }

  /** 用户在私聊里发消息：补齐索引、纪念日当天聊天 +10（P-25）、节日卡。 */
  private async onUserDirectMessage(
    tx: DbTx,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const contacts = await this.ctx.contacts.listActiveContacts(userId);
    const contact = contacts.find((c) => c.conversationId === conversationId);
    if (!contact) return;
    const [indexed] = await tx.db
      .select({ c: contactIndex.characterId })
      .from(contactIndex)
      .where(
        and(eq(contactIndex.userId, userId), eq(contactIndex.characterId, contact.characterId)),
      );
    if (!indexed) await this.upsertIndex(tx, userId, contact.characterId, contact.knownSince);

    const today = await this.ctx.localToday(userId, tx);
    if (isSystemAnniversaryDay(daysKnownOn(contact.knownSince, today)))
      await this.growth.awardPoints(
        tx,
        userId,
        contact.characterId,
        'anniversary_chat',
        `anniversary_chat:${userId}:${contact.characterId}:${today}`,
        this.clock.now(),
      );

    const holidays = (await this.holidaysOn(today)).filter((h) => h.sendCard !== false);
    if (!holidays.length) return;
    const { category } = await this.ctx.classify(contact.characterId, tx);
    for (const h of holidays) {
      const scope = h.characterCategories ?? [];
      if (scope.length && !scope.includes(category)) continue;
      const key = `holiday:${h.holidayId}:${today}`;
      if (await this.cards.hasCard(tx, userId, contact.characterId, key)) continue;
      await this.cards.issue(tx, {
        userId,
        characterId: contact.characterId,
        kind: 'holiday',
        title: h.name.slice(0, 30),
        line: CARD_LINES.holiday(h.name),
        faceMediaId: null,
        templateId: h.cardTemplateId ?? null,
        sourceMessageIds: [],
        idempotencyKey: key,
        noticeParams: { holidayName: h.name.slice(0, 30) },
        obtainedOn: today,
      });
    }
  }

  /** 某个当地日期的节日（5 分钟内存缓存，避免每条消息都查节日表）。 */
  private async holidaysOn(localDate: string): Promise<UpcomingHoliday[]> {
    if (!this.holidays) return [];
    const hit = this.holidayCache.get(localDate);
    const now = this.clock.now().getTime();
    if (hit && now - hit.at < 5 * 60_000) return hit.items;
    const items = (await this.holidays.getUpcoming(localDate, 1).catch(() => [])).filter(
      (h) => h.daysAhead === 0,
    );
    if (this.holidayCache.size > 16) this.holidayCache.clear();
    this.holidayCache.set(localDate, { at: now, items });
    return items;
  }

  private async pulledIntoGroup(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await this.achievements.unlock(tx, userId, 'pulled_into_group', characterId);
    await this.systemMomentCard(
      tx,
      userId,
      characterId,
      'pulled_into_group',
      '被拉进群',
      CARD_LINES.pulledIntoGroup,
    );
  }

  /** 系统瞬间卡：每个角色每种一张（不受名场面每周 1 张限制）。 */
  private async systemMomentCard(
    tx: DbTx,
    userId: string,
    characterId: string,
    sub: string,
    title: string,
    line: string,
  ): Promise<void> {
    const contact = await this.ctx.contacts.getActiveContact(userId, characterId, tx);
    if (!contact) return;
    await this.cards.issue(tx, {
      userId,
      characterId,
      kind: 'moment',
      title,
      line,
      faceMediaId: null,
      templateId: null,
      sourceMessageIds: [],
      idempotencyKey: `moment:${sub}`,
      noticeParams: { momentKind: sub },
    });
  }

  // ---------- 纪念日扫描 ----------

  async sweep(): Promise<void> {
    const rows = await this.db.db.select().from(contactIndex).where(eq(contactIndex.active, true));
    const tzByUser = new Map<string, string | null>();
    for (const row of rows) {
      if (!tzByUser.has(row.userId)) tzByUser.set(row.userId, await this.ctx.timeZone(row.userId));
      const tz = tzByUser.get(row.userId);
      if (!tz) continue;
      const today = this.ctx.todayIn(tz);
      if (row.lastCheckedOn === today) continue;
      try {
        await this.db.transaction((tx) =>
          this.checkContactDay(
            tx,
            row.userId,
            row.characterId,
            row.knownSince,
            row.lastCheckedOn,
            today,
          ),
        );
      } catch (error) {
        this.logger.error(
          { err: error, userId: row.userId, characterId: row.characterId },
          'growth 纪念日扫描失败，下个小时重试',
        );
      }
    }
  }

  private async checkContactDay(
    tx: DbTx,
    userId: string,
    characterId: string,
    knownSince: string,
    lastCheckedOn: string | null,
    today: string,
  ): Promise<void> {
    const contact = await this.ctx.contacts.getActiveContact(userId, characterId, tx);
    if (!contact) {
      await tx.db
        .update(contactIndex)
        .set({ active: false, updatedAt: this.clock.now() })
        .where(and(eq(contactIndex.userId, userId), eq(contactIndex.characterId, characterId)));
      return;
    }
    if (contact.knownSince !== knownSince) knownSince = contact.knownSince;

    // 从上次检查的次日（最多往回 7 天）到今天，逐日检查系统纪念日。
    const first =
      lastCheckedOn && lastCheckedOn >= addDays(today, -CATCH_UP_DAYS)
        ? addDays(lastCheckedOn, 1)
        : today;
    for (let day = first; day <= today; day = addDays(day, 1)) {
      const days = daysKnownOn(knownSince, day);
      if (days < 1 || !isSystemAnniversaryDay(days)) continue;
      await this.cards.issue(tx, {
        userId,
        characterId,
        kind: 'anniversary',
        title: anniversaryTitle(days),
        line: CARD_LINES.anniversary(days),
        faceMediaId: null,
        templateId: null,
        sourceMessageIds: [],
        idempotencyKey: `anniversary:${days}`,
        noticeParams: { daysKnown: days },
        obtainedOn: day,
      });
      if (day === today)
        await this.outbox.publish(tx, 'growth.anniversary_reached', 'growth', {
          userId,
          characterId,
          anniversaryId: systemAnniversaryId(characterId, days),
          kind: 'system',
          daysKnown: days,
          date: today,
        });
    }

    const daysToday = daysKnownOn(knownSince, today);
    for (const [threshold, key] of DAY_ACHIEVEMENTS)
      if (daysToday >= threshold) await this.achievements.unlock(tx, userId, key, characterId);

    // 自定义纪念日：当天发事件（ai-runtime 发纪念消息），不发卡（纪念卡只对应认识天数，GRW-05）。
    const customs = await tx.db
      .select()
      .from(anniversaries)
      .where(and(eq(anniversaries.userId, userId), eq(anniversaries.characterId, characterId)));
    for (const a of customs) {
      if (!customAnniversaryHits(a.date, a.repeatYearly, today)) continue;
      const inserted = await tx.db
        .insert(notices)
        .values({ userId, noticeKey: `anniversary:${a.id}:${today}`, createdAt: this.clock.now() })
        .onConflictDoNothing()
        .returning({ k: notices.noticeKey });
      if (!inserted.length) continue;
      await this.outbox.publish(tx, 'growth.anniversary_reached', 'growth', {
        userId,
        characterId,
        anniversaryId: a.id,
        kind: 'custom',
        daysKnown: Math.max(1, daysToday),
        date: today,
      });
    }

    await tx.db
      .update(contactIndex)
      .set({ knownSince, lastCheckedOn: today, updatedAt: this.clock.now() })
      .where(and(eq(contactIndex.userId, userId), eq(contactIndex.characterId, characterId)));
  }

  // ---------- 删除清单 ----------

  private async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      let n = 0;
      n += await this.cards.purgeUser(tx, userId);
      n += await this.achievements.purgeUser(tx, userId);
      n += await this.growth.purgeUser(tx, userId);
      n += await this.pets.purgeUser(tx, userId);
      for (const table of [contactIndex, notices] as const) {
        const r = await tx.db.delete(table).where(eq(table.userId, userId));
        n += r.rowCount ?? 0;
      }
      return n;
    });
  }

  private async countUserData(userId: string): Promise<number> {
    let n =
      (await this.cards.countUserData(userId)) +
      (await this.achievements.countUserData(userId)) +
      (await this.growth.countUserData(userId)) +
      (await this.pets.countUserData(userId));
    for (const table of [contactIndex, notices] as const) {
      const [r] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.userId, userId));
      n += r?.n ?? 0;
    }
    return n;
  }
}
