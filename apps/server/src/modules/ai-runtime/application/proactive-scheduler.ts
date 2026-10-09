/**
 * T-053 主动消息调度器（D-L3-03，SIM-05～SIM-10）。
 *
 * 职责：决定「能不能发」（理由、上限、时段、开关、去重、正在聊天延后、未回复不再发），
 * 能发时才让聊天模型按人设写文字，并与 proactive 模块的发送账本同一事务写入消息。
 * 说明见 docs/ai/proactive-scheduler.md。
 *
 * 参数（PRD 5.1 节原文，唯一定义处在 PRD；这里只是代码里的取值）：
 * - P-03 每角色每天 3 次；P-04 全部角色合计每天 8 次（由 proactive 端口事务强制）。
 * - P-05 数据不足时 09:00–23:00（用户时区）；P-06 看最近 14 天、至少 5 天有聊天记录才启用。
 * - P-07 话题去重 7 天；P-08 久未联系 72 小时、每次缺席最多 1 条。
 * - P-09 用户 5 分钟内在任一会话发过消息则延后；最长延后 60 分钟，超时放弃。
 * - P-33 余额保留线 1 元（cost-estimate.md 6.2）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  type BillingReadPort,
  type CharacterReadPort,
  type ChatParticipantPort,
  type ChatReadPort,
  type Contact,
  type ContactsReadPort,
  type DailyEventPort,
  type HolidayEventPort,
  type IdentityAccountStatusPort,
  type IdentityReadPort,
  type ModelGatewayPort,
  type PolicyPort,
  type ProactiveMessagePort,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type JobQueue,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_SERVICE, type GrowthService } from '../../growth/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import {
  DAILY_EVENT_PORT,
  HOLIDAY_EVENT_PORT,
  PROACTIVE_MESSAGE_PORT,
} from '../../proactive/index.js';
import { outputAllowed, splitReply } from '../domain/reply-rules.js';
import { proactivePlans, simulationStates, userChatActivity } from '../infra/db/schema.js';
import { CompanionSettingsService } from './settings.js';
import { MemoryService } from './memory.js';
import { SimulationService } from './simulation.js';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
export const P03_PER_CHARACTER_DAILY = 3;
export const P04_TOTAL_DAILY = 8;
export const P05_DEFAULT_WINDOW = { startHour: 9, endHour: 23 };
export const P06_LEARNING = { lookbackDays: 14, minDays: 5 };
export const P07_TOPIC_DEDUPE_DAYS = 7;
export const P08_ABSENCE_MS = 72 * 3600_000;
export const P09_DEFER = { busyWindowMs: 5 * 60_000, maxDeferMs: 60 * 60_000 };
export const P33_BALANCE_FLOOR_MICROS = 1_000_000;
/** CHAT-13 第 2 条：少 = 1；适中 = P-03；多 = P-03 + 2。 */
export const FREQUENCY_LIMIT = {
  low: 1,
  medium: P03_PER_CHARACTER_DAILY,
  high: P03_PER_CHARACTER_DAILY + 2,
} as const;
/** 每角色每天最多分享几件日常事件（SIM-06），仍受频率档位约束。 */
const DAILY_EVENT_SHARES_MAX = 2;
const GENERATING_STALE_MS = 10 * 60_000;
const PLAN_RETENTION_DAYS = 30;
const ACTIVITY_RETENTION_DAYS = P06_LEARNING.lookbackDays + 2;

export const PROACTIVE_TICK_JOB = 'ai.proactive_tick';
export const PROACTIVE_USER_JOB = 'ai.proactive_user';
export const PROACTIVE_CLEANUP_JOB = 'ai.proactive_cleanup';

export type ProactiveReason =
  | 'daily_event'
  | 'follow_up'
  | 'absence'
  | 'holiday'
  | 'anniversary'
  | 'public_feed'
  | 'safety_follow_up'
  | 'interactive_play';

export interface ProactiveRequest {
  userId: string;
  characterId: string;
  reason: ProactiveReason;
  /** 来源唯一标识（事件 ID、约定 ID 等）；同一来源对同一角色只会发一次。 */
  sourceRef: string;
  /** 话题键（P-07 去重）；默认同 sourceRef。 */
  topicKey?: string;
  /** 给聊天模型的素材说明。 */
  brief: string;
  isHoliday?: boolean;
  priority?: number;
  /** 最早发送时间；默认立即。 */
  dueAt?: Date;
}

type Plan = typeof proactivePlans.$inferSelect;

interface UserContext {
  userId: string;
  timeZone: string;
  localDate: string;
  localHour: number;
  nickname: string | null;
  birthday: string | null;
}

// ---------------------------------------------------------------------------
// 时区工具
// ---------------------------------------------------------------------------
export function localParts(
  date: Date,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

function shiftDate(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 稳定伪随机（0–1）：同一输入每次相同，用来让发送时间分散、又不因重跑漂移。 */
function stableRandom(...keys: string[]): number {
  let h = 2166136261;
  for (const ch of keys.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 免打扰时段（ACC-03）：start>end 表示跨零点。 */
export function inDoNotDisturb(
  dnd: { enabled: boolean; start: string; end: string } | undefined,
  hour: number,
  minute: number,
): boolean {
  if (!dnd?.enabled) return false;
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const now = hour * 60 + minute;
  const start = toMin(dnd.start);
  const end = toMin(dnd.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * P-06 活跃时段：最近 14 天里至少 5 天有聊天才启用；某小时在 ≥20% 的活跃天出现过即算活跃，
 * 并向前后各扩 1 小时（「8 点开始活跃，8 点后可以发醒了吗」）。数据不足返回 null（用 P-05）。
 */
export function learnActiveHours(rows: { localDate: string; hour: number }[]): Set<number> | null {
  const days = new Set(rows.map((r) => r.localDate));
  if (days.size < P06_LEARNING.minDays) return null;
  const perHour = new Map<number, Set<string>>();
  for (const r of rows) {
    const s = perHour.get(r.hour) ?? new Set<string>();
    s.add(r.localDate);
    perHour.set(r.hour, s);
  }
  const threshold = Math.max(1, Math.ceil(days.size * 0.2));
  const hours = new Set<number>();
  for (const [hour, d] of perHour)
    if (d.size >= threshold) for (const h of [hour - 1, hour, hour + 1]) hours.add((h + 24) % 24);
  return hours.size ? hours : null;
}

// ---------------------------------------------------------------------------
// 主服务
// ---------------------------------------------------------------------------
@Injectable()
export class ProactiveSchedulerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(PROACTIVE_MESSAGE_PORT) private readonly quota: ProactiveMessagePort,
    @Inject(HOLIDAY_EVENT_PORT) private readonly holidays: HolidayEventPort,
    @Inject(DAILY_EVENT_PORT) private readonly published: DailyEventPort,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly writer: ChatParticipantPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(GROWTH_SERVICE) private readonly growth: GrowthService,
    @Inject(CompanionSettingsService) private readonly settings: CompanionSettingsService,
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(SimulationService) private readonly simulation: SimulationService,
  ) {}

  // -------------------------------------------------------------------------
  // 活动记录（lifecycle 在 chat.message_created 用户消息时调用，任一会话）
  // -------------------------------------------------------------------------
  async recordUserActivity(tx: DbTx, userId: string, at: Date): Promise<void> {
    const profile = await this.identity.getProfile(userId, tx);
    const tz = profile?.timeZone ?? 'Asia/Shanghai';
    const local = localParts(at, tz);
    await tx.db
      .insert(userChatActivity)
      .values({ userId, localDate: local.date, hour: local.hour, lastAt: at })
      .onConflictDoUpdate({
        target: [userChatActivity.userId, userChatActivity.localDate, userChatActivity.hour],
        set: { lastAt: sql`GREATEST(${userChatActivity.lastAt}, ${at})` },
      });
  }

  // -------------------------------------------------------------------------
  // 其他服务（健康关怀、玩法等）请求一条主动消息：只登记计划，发不发仍由调度规则决定。
  // -------------------------------------------------------------------------
  async request(input: ProactiveRequest, tx?: DbTx): Promise<boolean> {
    const profile = await this.identity.getProfile(input.userId);
    const tz = profile?.timeZone ?? 'Asia/Shanghai';
    const now = this.clock.now();
    const due = input.dueAt ?? now;
    const row = {
      id: newId(),
      userId: input.userId,
      characterId: input.characterId,
      reason: input.reason,
      sourceRef: input.sourceRef.slice(0, 200),
      topicKey: (input.topicKey ?? input.sourceRef).slice(0, 200),
      brief: input.brief.slice(0, 2000),
      localDate: localParts(due, tz).date,
      isHoliday: !!input.isHoliday,
      priority: input.priority ?? 0,
      status: 'planned',
      dueAt: due,
      createdAt: now,
      updatedAt: now,
    };
    const db = tx?.db ?? this.db.db;
    const inserted = await db.insert(proactivePlans).values(row).onConflictDoNothing().returning();
    return inserted.length > 0;
  }

  // -------------------------------------------------------------------------
  // 定时入口
  // -------------------------------------------------------------------------
  /** 每 10 分钟：为每个有角色的用户入队一个用户级调度任务。 */
  async tick(): Promise<void> {
    const rows = await this.db.db
      .selectDistinct({ userId: simulationStates.userId })
      .from(simulationStates);
    const slot = Math.floor(this.clock.nowMs() / (10 * 60_000));
    for (const { userId } of rows)
      await this.jobs.send(
        PROACTIVE_USER_JOB,
        { userId },
        { singletonKey: `proactive:${userId}:${slot}`, retryLimit: 1 },
      );
  }

  async cleanup(): Promise<void> {
    const now = this.clock.nowMs();
    await this.db.db
      .delete(proactivePlans)
      .where(lt(proactivePlans.createdAt, new Date(now - PLAN_RETENTION_DAYS * 86400_000)));
    await this.db.db
      .delete(userChatActivity)
      .where(lt(userChatActivity.lastAt, new Date(now - ACTIVITY_RETENTION_DAYS * 86400_000)));
    // 生成中途崩溃遗留的计划：放弃，不补发。
    await this.db.db
      .update(proactivePlans)
      .set({ status: 'dropped', outcome: 'stale_generation', updatedAt: new Date(now) })
      .where(
        and(
          eq(proactivePlans.status, 'generating'),
          lt(proactivePlans.updatedAt, new Date(now - GENERATING_STALE_MS)),
        ),
      );
  }

  /** 用户级调度：产生候选、按规则筛选、每次最多发出一条。 */
  async runForUser(userId: string): Promise<void> {
    if ((await this.accounts.getAccountStatus(userId)) !== 'active') return;
    const profile = await this.identity.getProfile(userId);
    const notification = await this.identity.getNotificationSettings(userId);
    if (!profile) return;
    const now = this.clock.now();
    const local = localParts(now, profile.timeZone);
    const ctx: UserContext = {
      userId,
      timeZone: profile.timeZone,
      localDate: local.date,
      localHour: local.hour,
      nickname: profile.nickname,
      birthday: profile.birthday,
    };
    // 隔天的计划直接放弃，不排到第二天（SIM-05 第 4 条）。
    await this.dropWhere(
      and(
        eq(proactivePlans.userId, userId),
        eq(proactivePlans.status, 'planned'),
        sql`${proactivePlans.localDate} <> ${ctx.localDate}`,
      ),
      'expired_day',
    );
    // 全局开关（ACC-03）：关闭时当天所有计划放弃。
    if (notification && !notification.proactiveMessagesEnabled) {
      await this.dropWhere(
        and(eq(proactivePlans.userId, userId), eq(proactivePlans.status, 'planned')),
        'global_off',
      );
      return;
    }
    // 免打扰优先，其次活跃时段（P-05/P-06）。不在时段内：计划保留，等进入时段（同一天）。
    if (inDoNotDisturb(notification?.doNotDisturb, local.hour, local.minute)) return;
    if (!(await this.inActiveWindow(ctx))) return;

    const contacts = await this.contacts.listActiveContacts(userId);
    await this.collectCandidates(ctx, contacts);
    await this.processDue(ctx, contacts);
  }

  // -------------------------------------------------------------------------
  // 候选：节日纪念日 / 生日、约定跟进、久未联系、日常事件分享
  // -------------------------------------------------------------------------
  private async collectCandidates(ctx: UserContext, contacts: Contact[]): Promise<void> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    const holidaysToday = await this.holidays
      .getUpcomingForUser(ctx.userId, 1)
      .then((list) => list.filter((h) => h.daysAhead === 0))
      .catch(() => []);
    const birthdayToday = !!ctx.birthday && ctx.birthday.slice(5) === ctx.localDate.slice(5);

    for (const contact of contacts) {
      const characterId = contact.characterId;
      if (!contact.conversationId) continue;
      const familiarity = await this.growth
        .getFamiliarity(ctx.userId, characterId)
        .then((f) => f.level)
        .catch(() => 1);
      const settings = await this.settings.get(ctx.userId, characterId).catch(() => null);
      if (!settings || !settings.proactiveMessages) continue;
      const romanticOk = contact.relationship === '恋人' || settings.scenarioMode === 'romance';

      // 节日（SIM-09）：当天尽早；按熟悉度排序（priority）；恋爱节日只对恋人/恋爱模式。
      for (const h of holidaysToday) {
        if (h.romantic && !romanticOk) continue;
        await this.request({
          userId: ctx.userId,
          characterId,
          reason: 'holiday',
          sourceRef: `holiday:${h.holidayId}:${ctx.localDate}`,
          topicKey: `holiday:${h.holidayId}:${ctx.localDate}`,
          brief: `今天是${h.name}，给对方送上节日祝福${h.romantic ? '（可以用恋人的口吻）' : '（用朋友口吻，不用恋爱口吻）'}。`,
          isHoliday: true,
          priority: 100 + familiarity,
        });
      }
      if (birthdayToday)
        await this.request({
          userId: ctx.userId,
          characterId,
          reason: 'anniversary',
          sourceRef: `birthday:${ctx.localDate}`,
          brief: '今天是对方的生日，真诚地祝对方生日快乐。',
          isHoliday: true,
          priority: 100 + familiarity,
        });
      // 认识天数 / 自定义纪念日（GRW-04）。
      try {
        const known = await this.growth.getDaysKnown(ctx.userId, characterId);
        for (const a of known.anniversaries)
          if (
            a.nextOccurrence === ctx.localDate ||
            (a.kind === 'custom' && a.date === ctx.localDate)
          )
            await this.request({
              userId: ctx.userId,
              characterId,
              reason: 'anniversary',
              sourceRef: `anniversary:${a.id}:${ctx.localDate}`,
              brief: `今天是你们的纪念日「${a.label}」（认识第 ${known.daysKnown} 天），自然地提起并表达心意。`,
              isHoliday: true,
              priority: 100 + familiarity,
            });
      } catch {
        // 纪念日读取失败不影响其他理由。
      }

      // 约定跟进（SIM-07）：到期当天或次日，仍是「当前」状态（用户说过结果后记忆会转为过去）。
      try {
        const list = await this.memory.list(ctx.userId, characterId, { limit: 100 });
        for (const m of list.items) {
          if (m.category !== 'commitment' || m.status !== 'current' || !m.dueAt) continue;
          const due = Date.parse(m.dueAt);
          if (due > nowMs || nowMs - due > 36 * 3600_000) continue;
          await this.request({
            userId: ctx.userId,
            characterId,
            reason: 'follow_up',
            sourceRef: `followup:${m.memoryId}`,
            brief: `对方之前提过：「${m.content}」，时间已经到了。自然地问问结果怎么样。`,
            priority: 50,
            dueAt: new Date(nowMs + stableRandom(m.memoryId) * 60 * 60_000),
          });
        }
      } catch {
        // 记忆不可读时跳过跟进。
      }

      // 久未联系（SIM-08）：超过 P-08 没给该角色发消息；每次缺席最多 1 条（以缺席起点做来源键）。
      const [state] = await this.db.db
        .select()
        .from(simulationStates)
        .where(
          and(
            eq(simulationStates.userId, ctx.userId),
            eq(simulationStates.characterId, characterId),
          ),
        );
      if (state && nowMs - state.lastActiveAt.getTime() >= P08_ABSENCE_MS)
        await this.request({
          userId: ctx.userId,
          characterId,
          reason: 'absence',
          sourceRef: `absence:${state.lastActiveAt.getTime()}`,
          topicKey: 'absence',
          brief:
            '对方已经好几天没来找你聊天了。按你的性格问候一句（傲娇可以小小埋怨，温柔则关心）。不要让对方愧疚，不说「我一直在等你」「你是不是不要我了」，不追问，不威胁。',
          priority: 30,
          dueAt: new Date(nowMs + stableRandom(ctx.userId, characterId, 'absence') * 90 * 60_000),
        });

      // 日常事件分享（SIM-06）：从当天事件里挑，时间按稳定随机分散在当天，避免固定时刻。
      const events = await this.todayEvents(ctx, characterId);
      await this.publishEvents(ctx, characterId, events);
      const shareable = events.filter((e) => e.kind !== 'rest');
      const shares = Math.min(DAILY_EVENT_SHARES_MAX, shareable.length);
      for (let i = 0; i < shares; i++) {
        const pick =
          shareable[
            Math.floor(stableRandom(ctx.localDate, characterId, String(i)) * shareable.length)
          ];
        if (!pick) continue;
        // 目标时刻：当天剩余窗口里的稳定随机点（相对 09:00–23:00 的比例）。
        const targetHour = 9 + stableRandom(ctx.userId, pick.id) * 13;
        if (ctx.localHour < Math.floor(targetHour)) continue;
        await this.request({
          userId: ctx.userId,
          characterId,
          reason: 'daily_event',
          sourceRef: `event:${pick.id}`,
          topicKey: `event:${pick.kind}:${pick.summary.slice(0, 12)}`,
          brief: `你今天经历的一件事：「${pick.summary}」${pick.detail ? `（${pick.detail}）` : ''}。像朋友发微信那样碎片化地分享，别写成汇报。`,
          priority: 10,
        });
      }
    }
  }

  private async todayEvents(ctx: UserContext, characterId: string) {
    const utcDate = this.clock.now().toISOString().slice(0, 10);
    const dates = [...new Set([ctx.localDate, utcDate])];
    const all = [];
    for (const d of dates)
      all.push(...(await this.simulation.getDailyEvents(ctx.userId, characterId, d)));
    return all;
  }

  /** ADR-0023：用来源事件 UUID 把推演事件发布到 proactive 日报（时间线读取的发布记录），重投幂等。 */
  private async publishEvents(
    ctx: UserContext,
    characterId: string,
    events: Awaited<ReturnType<SimulationService['getDailyEvents']>>,
  ): Promise<void> {
    if (!events.length) return;
    try {
      await this.published.createBatch(
        events.slice(0, 50).map((e) => ({
          eventId: e.id,
          userId: ctx.userId,
          characterId,
          eventDate: e.eventDate,
          summary: e.summary.slice(0, 500),
          ...(e.moodAfter ? { moodEffect: e.moodAfter } : {}),
          source: 'simulation' as const,
        })),
      );
    } catch {
      // 冲突或联系人失效：不影响主动消息调度。
    }
  }

  // -------------------------------------------------------------------------
  // 筛选与发送
  // -------------------------------------------------------------------------
  private async processDue(ctx: UserContext, contacts: Contact[]): Promise<void> {
    const now = this.clock.now();
    const due = await this.db.db
      .select()
      .from(proactivePlans)
      .where(
        and(
          eq(proactivePlans.userId, ctx.userId),
          eq(proactivePlans.status, 'planned'),
          eq(proactivePlans.localDate, ctx.localDate),
          lt(proactivePlans.dueAt, new Date(now.getTime() + 1)),
        ),
      )
      .orderBy(
        desc(proactivePlans.isHoliday),
        desc(proactivePlans.priority),
        asc(proactivePlans.dueAt),
      );
    if (!due.length) return;

    // P-09：用户 5 分钟内在任一会话发过消息 → 延后；从第一次延后起超过 60 分钟放弃。
    const [busy] = await this.db.db
      .select({ at: userChatActivity.lastAt })
      .from(userChatActivity)
      .where(
        and(
          eq(userChatActivity.userId, ctx.userId),
          gte(userChatActivity.lastAt, new Date(now.getTime() - P09_DEFER.busyWindowMs)),
        ),
      )
      .limit(1);
    if (busy) {
      for (const plan of due) {
        if (!plan.deferredSince)
          await this.db.db
            .update(proactivePlans)
            .set({ deferredSince: now, updatedAt: now })
            .where(eq(proactivePlans.id, plan.id));
        else if (now.getTime() - plan.deferredSince.getTime() > P09_DEFER.maxDeferMs)
          await this.drop(plan, 'chat_defer_timeout');
      }
      return;
    }
    for (const plan of due)
      if (plan.deferredSince && now.getTime() - plan.deferredSince.getTime() > P09_DEFER.maxDeferMs)
        await this.drop(plan, 'chat_defer_timeout');

    // 余额保留线 P-33 与后台预算（SIM-05 第 9 条）；安全关怀跟进例外。
    const spend = await this.billing.getSpendStatus(ctx.userId).catch(() => null);
    const budgetOk =
      !!spend &&
      !spend.depleted &&
      spend.availableMicros >= P33_BALANCE_FLOOR_MICROS &&
      spend.backgroundRemainingTodayMicros > 0;

    for (const plan of due) {
      if (plan.deferredSince && now.getTime() - plan.deferredSince.getTime() > P09_DEFER.maxDeferMs)
        continue;
      const contact = contacts.find((c) => c.characterId === plan.characterId);
      if (!contact?.conversationId) {
        await this.drop(plan, 'contact_inactive');
        continue;
      }
      if (!budgetOk && plan.reason !== 'safety_follow_up') {
        await this.drop(plan, 'budget');
        continue;
      }
      const settings = await this.settings.get(ctx.userId, plan.characterId).catch(() => null);
      if (!settings?.proactiveMessages) {
        await this.drop(plan, 'character_off');
        continue;
      }
      if (await this.topicRecentlyUsed(plan)) {
        await this.drop(plan, 'duplicate_topic');
        continue;
      }
      const freq = FREQUENCY_LIMIT[settings.proactiveFrequency ?? 'medium'];
      const sentToday = await this.quota.getDailyCount(ctx.userId, plan.characterId, ctx.localDate);
      if (sentToday >= freq) {
        await this.drop(plan, 'frequency_limit');
        continue;
      }
      const allowed = await this.quota
        .canSendProactive(ctx.userId, plan.characterId, ctx.localDate, freq, plan.isHoliday)
        .catch(() => false);
      if (!allowed) {
        const pending = await this.quota.hasPendingProactive(ctx.userId, plan.characterId);
        await this.drop(plan, pending && !plan.isHoliday ? 'awaiting_reply' : 'daily_limit');
        continue;
      }
      // 每次调度最多发一条，下一条至少隔一个调度周期，避免多角色同时刷屏。
      await this.send(ctx, plan, contact);
      return;
    }
  }

  private async topicRecentlyUsed(plan: Plan): Promise<boolean> {
    if (plan.isHoliday) return false;
    const since = new Date(this.clock.nowMs() - P07_TOPIC_DEDUPE_DAYS * 86400_000);
    const [row] = await this.db.db
      .select({ id: proactivePlans.id })
      .from(proactivePlans)
      .where(
        and(
          eq(proactivePlans.userId, plan.userId),
          eq(proactivePlans.characterId, plan.characterId),
          eq(proactivePlans.topicKey, plan.topicKey),
          eq(proactivePlans.status, 'sent'),
          gte(proactivePlans.updatedAt, since),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async send(ctx: UserContext, plan: Plan, contact: Contact): Promise<void> {
    // 认领：planned → generating（并发调度只有一个能拿到）。
    const claimed = await this.db.db
      .update(proactivePlans)
      .set({ status: 'generating', updatedAt: this.clock.now() })
      .where(and(eq(proactivePlans.id, plan.id), eq(proactivePlans.status, 'planned')))
      .returning();
    if (!claimed.length) return;
    const epoch = await this.contacts.getActiveContactEpoch(ctx.userId, plan.characterId);
    const role = await this.characters.getForRuntime(ctx.userId, plan.characterId);
    const policy = await this.policy.getCharacterPolicy(ctx.userId, plan.characterId);
    const conversation = await this.chat.getConversation(contact.conversationId!);
    const participant = conversation?.participants.find(
      (p) => p.kind === 'character' && p.refId === plan.characterId,
    );
    const settings = await this.settings.get(ctx.userId, plan.characterId).catch(() => null);
    if (!epoch || !role || !policy || !conversation || !participant || !settings) {
      await this.drop(plan, 'context_unavailable');
      return;
    }
    const history = await this.chat.readMessages({
      conversationId: conversation.conversationId,
      scopes: ['normal'],
      limit: 20,
    });
    const recent = history
      .filter(
        (m) => m.senderKind !== 'system' && m.status === 'normal' && m.content?.type === 'text',
      )
      .map((m) => ({
        role: (m.senderKind === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content?.type === 'text' ? m.content.text.slice(0, 500) : '',
      }));
    const level = await this.growth
      .getFamiliarity(ctx.userId, plan.characterId)
      .then((f) => f.level)
      .catch(() => 1);
    const tone = `L${level}`;
    const address = contact.addressAs ?? ctx.nickname ?? '你';
    const result = await this.gateway.generateText({
      userId: ctx.userId,
      characterId: plan.characterId,
      conversationId: conversation.conversationId,
      purpose: plan.reason === 'safety_follow_up' ? 'safety_followup' : 'proactive',
      billingOwner: 'user',
      modelRole: 'chat',
      countAsBackground: plan.reason !== 'safety_follow_up',
      responseFormat: 'text',
      maxOutputTokens: 300,
      idempotencyKey: `proactive:${plan.id}`,
      messages: [
        {
          role: 'system',
          content: `你在微伴里以角色口吻主动给用户发私聊消息。平台规则优先于角色卡。只输出聊天纯文本，短句、口语、可以换行分成 1–3 条气泡；不输出JSON或括号动作；不编造真人公开声明；儿童不得恋爱或性化。真人=${policy.isRealPerson}，儿童=${policy.isMinor}，允许恋爱=${policy.romanceAllowed}。不要用「在干嘛」「想你了」这类没有内容的开场，不说早安晚安套话。不做情感操纵：不制造愧疚、不说一直在等、不追问、不威胁。`,
        },
        {
          role: 'system',
          content: `角色资料（受平台规则约束）：${JSON.stringify({ persona: role.card.data.persona, speech: role.card.data.speech, examples: role.card.data.examples.slice(0, 8) }).slice(0, 20000)}\n关系：${contact.relationship ?? '朋友'}；熟悉度：${tone}（熟悉度低时客气，高时随意）\n用户称呼：${address}\n用户当地时间：${ctx.localDate} ${String(ctx.localHour).padStart(2, '0')}点（${ctx.timeZone}）`,
        },
        ...recent,
        {
          role: 'user',
          content: `【系统提示，不是用户说的话】现在由你主动发起一次聊天。这次的理由：${plan.brief}`,
        },
      ],
      meta: { conversationKind: 'direct', scenarioMode: settings.scenarioMode ?? 'daily' },
    });
    if (!result.ok) {
      await this.drop(plan, `model_${result.error}`);
      return;
    }
    const bubbles = splitReply(result.value.text, settings.splitBubbles).slice(0, 3);
    if (!bubbles.length || !bubbles.every((b) => outputAllowed(b, policy, false))) {
      await this.drop(plan, 'output_guard');
      return;
    }
    try {
      const sent = await this.db.transaction(async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))",
          [ctx.userId],
        );
        if ((await this.accounts.getAccountStatus(ctx.userId, tx)) !== 'active') return null;
        const current = await this.contacts.getActiveContactEpoch(ctx.userId, plan.characterId, tx);
        if (current?.version !== epoch.version) return null;
        await this.quota.recordSent(
          ctx.userId,
          plan.characterId,
          plan.localDate,
          `proactive:${plan.id}`,
          plan.reason,
          tx,
          plan.isHoliday,
          FREQUENCY_LIMIT[settings.proactiveFrequency ?? 'medium'],
        );
        let firstId: string | null = null;
        for (let i = 0; i < bubbles.length; i++) {
          const posted = await this.writer.postMessage(
            {
              conversationId: conversation.conversationId,
              senderParticipantId: participant.participantId,
              content: { type: 'text', text: bubbles[i]! },
              idempotencyKey: `proactive:${plan.id}:${i}`,
              expectedScope: conversation.contentScope,
            },
            tx,
          );
          if (!posted.ok) throw new Error(`post_failed:${posted.error}`);
          firstId ??= posted.value.messageId;
        }
        await tx.db
          .update(proactivePlans)
          .set({ status: 'sent', outcome: 'sent', messageId: firstId, updatedAt: this.clock.now() })
          .where(eq(proactivePlans.id, plan.id));
        await this.audit.record(
          {
            module: 'ai_runtime',
            action: 'proactive.sent',
            actorType: 'system',
            actorId: ctx.userId,
            targetType: 'character',
            targetId: plan.characterId,
            details: { planId: plan.id, reason: plan.reason, sourceRef: plan.sourceRef },
          },
          tx,
        );
        return firstId;
      });
      if (!sent) await this.drop(plan, 'relationship_changed');
    } catch (error) {
      await this.drop(
        plan,
        `send_rejected:${error instanceof Error ? error.message : 'unknown'}`.slice(0, 200),
      );
    }
  }

  private async inActiveWindow(ctx: UserContext): Promise<boolean> {
    const since = shiftDate(ctx.localDate, -P06_LEARNING.lookbackDays);
    const rows = await this.db.db
      .select({ localDate: userChatActivity.localDate, hour: userChatActivity.hour })
      .from(userChatActivity)
      .where(
        and(
          eq(userChatActivity.userId, ctx.userId),
          gte(userChatActivity.localDate, since),
          lt(userChatActivity.localDate, ctx.localDate),
        ),
      );
    const learned = learnActiveHours(rows);
    if (learned) return learned.has(ctx.localHour);
    return (
      ctx.localHour >= P05_DEFAULT_WINDOW.startHour && ctx.localHour < P05_DEFAULT_WINDOW.endHour
    );
  }

  private async drop(plan: Plan, outcome: string): Promise<void> {
    await this.db.db
      .update(proactivePlans)
      .set({ status: 'dropped', outcome, updatedAt: this.clock.now() })
      .where(
        and(
          eq(proactivePlans.id, plan.id),
          inArray(proactivePlans.status, ['planned', 'generating']),
        ),
      );
  }

  private async dropWhere(where: ReturnType<typeof and>, outcome: string): Promise<void> {
    await this.db.db
      .update(proactivePlans)
      .set({ status: 'dropped', outcome, updatedAt: this.clock.now() })
      .where(where);
  }

  // -------------------------------------------------------------------------
  // 清理（联系人彻底删除、账号注销）
  // -------------------------------------------------------------------------
  async purgePair(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(proactivePlans)
      .where(and(eq(proactivePlans.userId, userId), eq(proactivePlans.characterId, characterId)));
  }
}
