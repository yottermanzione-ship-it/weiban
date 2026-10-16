/**
 * T-054 时间线摘要服务：生成「你不在时 TA 过了怎样的一天」摘要。
 *
 * 设计要点（对齐 SIM-11、runtime-overview.md 2.4 节）：
 * - 数据来自推演引擎（SimulationReadPort）的日常事件与心情。
 * - T-066 回改 P-18：「距上次进入该私聊 ≥ 12 小时且期间有日常事件；最多 5 条」。
 *   「上次进入」由服务器记录（chat_visits，每次请求本接口 = 进入一次私聊），取它与客户端 lastActiveAt 较晚者；
 *   不足 12 小时 summary 与 events 都为空（客户端不显示卡片）。5 分钟内重复请求视为同一次进入。
 * - T-066 契约 3.0 listTimeline：日常事件、朋友圈、和其他角色的互动、公开动态，时间倒序分页。
 * - 摘要生成走后台网关（behavior_planning 用途，countAsBackground=true）。
 * - 后台预算耗尽时返回空摘要，不报错（SIM-11 第 3 条）。
 * - 幂等键按用户、会话及缺席起点区分，不同缺席窗口不复用旧摘要。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  type ModelGatewayPort,
  type ChatReadPort,
  Id,
  TimelineMood,
  Timestamp,
  type TimelineSummaryResponse,
  type TimelineEntry,
  type ContactsReadPort,
  type MomentsReadPort,
  type PublicUpdateReadPort,
} from '@weiban/contracts';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { MOMENTS_READ_PORT } from '../../moments/index.js';
import { PUBLIC_UPDATE_READ_PORT } from '../../characters/index.js';
import { SocialService } from './social.js';
import { CLOCK, DATABASE, AppError, type Clock, type Database } from '../../../platform/index.js';
import { chatVisits, dailyEvents, moodStates } from '../infra/db/schema.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import {
  SIMULATION_READ_PORT,
  type SimulationReadPort,
  type DailyEventEntry,
} from './simulation.js';

/** 离线时长不足此值（秒）时不生成摘要。 */
const MIN_OFFLINE_SECONDS = 12 * 3600;
/** 同一次进入（刷新、重连）的判定窗口。 */
const SAME_VISIT_MS = 5 * 60_000;

/** 摘要生成最大输出 token（后台任务，回复较短）。 */
const SUMMARY_MAX_OUTPUT_TOKENS = 256;

@Injectable()
export class TimelineSummaryService {
  constructor(
    @Inject(SIMULATION_READ_PORT) private readonly simulation: SimulationReadPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHAT_READ_PORT) private readonly chat: Pick<ChatReadPort, 'findDirectConversation'>,
    /** T-066：服务器记录进入私聊的时间（P-18）。测试替身可不传，此时只用客户端 lastActiveAt。 */
    @Optional() @Inject(DATABASE) private readonly db?: Database,
  ) {}

  /**
   * P-18「距上次进入该私聊」：返回上一次进入时刻，并把本次记为新的进入。
   * 5 分钟内重复请求（刷新、重连）视为同一次进入，仍用再上一次的时刻。服务器没有记录时退回客户端值。
   */
  private async enteredBase(
    userId: string,
    conversationId: string,
    clientMs: number,
    now: Date,
  ): Promise<number> {
    if (!this.db) return clientMs;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(chatVisits)
        .where(and(eq(chatVisits.userId, userId), eq(chatVisits.conversationId, conversationId)))
        .for('update');
      if (!row) {
        await tx.db
          .insert(chatVisits)
          .values({ userId, conversationId, lastEnteredAt: now, prevEnteredAt: null })
          .onConflictDoNothing();
        return clientMs;
      }
      if (now.getTime() - row.lastEnteredAt.getTime() < SAME_VISIT_MS)
        return row.prevEnteredAt?.getTime() ?? clientMs;
      await tx.db
        .update(chatVisits)
        .set({ lastEnteredAt: now, prevEnteredAt: row.lastEnteredAt })
        .where(and(eq(chatVisits.userId, userId), eq(chatVisits.conversationId, conversationId)));
      return row.lastEnteredAt.getTime();
    });
  }

  /**
   * 获取「你不在时」摘要。
   *
   * @param userId      当前用户
   * @param characterId 角色
   * @param conversationId 会话（用于记账 meta 字段）
   * @param lastActiveAt  用户上次活跃时刻（ISO 8601）；用于计算离线时长
   */
  async getSummary(
    userId: string,
    characterId: string,
    conversationId: string,
    lastActiveAt: string,
  ): Promise<TimelineSummaryResponse> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    if (
      ![userId, characterId, conversationId].every((id) => Id.safeParse(id).success) ||
      !Timestamp.safeParse(lastActiveAt).success
    ) {
      throw new AppError('bad_request', '无效时间线请求');
    }
    const clientMs = Date.parse(lastActiveAt);
    if (clientMs > nowMs) throw new AppError('bad_request', '上次活跃时间不能晚于现在');
    const conversation = await this.chat.findDirectConversation(userId, characterId);
    if (conversation?.conversationId !== conversationId)
      throw new AppError('not_found', '找不到私聊会话');
    const lastActiveMs = await this.enteredBase(userId, conversationId, clientMs, now);
    const offlineSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

    const currentMood = await this.simulation.getCurrentMood(userId, characterId);
    // P-18：距上次进入不足 12 小时 → 不出现「你不在时」（不读事件、不调模型）。
    if (offlineSeconds < MIN_OFFLINE_SECONDS)
      return { summary: null, events: [], currentMood, offlineSeconds };
    const entries: DailyEventEntry[] = [];
    // 时间线保留 90 天；只读取本次缺席窗口内的日报。
    const start = Math.max(lastActiveMs, nowMs - 90 * 86400_000);
    for (let date = Math.floor(start / 86400_000) * 86400_000; date <= nowMs; date += 86400_000) {
      entries.push(
        ...(await this.simulation.getDailyEvents(
          userId,
          characterId,
          new Date(date).toISOString().slice(0, 10),
        )),
      );
    }
    const events = entries
      .filter((e) => e.createdAt.getTime() > lastActiveMs && e.createdAt.getTime() <= nowMs)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
      .slice(0, 5);

    // 离线时长不足或缺席期间无事件时不生成摘要
    if (offlineSeconds < MIN_OFFLINE_SECONDS || events.length === 0) {
      return {
        summary: null,
        events: mapEvents(events),
        currentMood,
        offlineSeconds,
      };
    }

    // 调用模型生成摘要（behavior_planning 用途，计入后台预算）
    const idempotencyKey = `timeline:${userId}:${conversationId}:${lastActiveMs}`;
    const prompt = buildSummaryPrompt(events, offlineSeconds);

    const result = await this.gateway.generateText({
      userId,
      characterId,
      conversationId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      modelRole: 'background',
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      responseFormat: 'text',
      idempotencyKey,
      countAsBackground: true,
      ecologyTask: true,
    });

    // 后台预算耗尽或其他错误时静默返回空摘要
    if (!result.ok) {
      return {
        summary: null,
        events: mapEvents(events),
        currentMood,
        offlineSeconds,
      };
    }

    return {
      summary: result.value.text.trim() || null,
      events: mapEvents(events),
      currentMood,
      offlineSeconds,
    };
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function mapEvents(entries: DailyEventEntry[]): TimelineSummaryResponse['events'] {
  return entries.map((e) => ({
    id: e.id,
    seq: e.seq,
    kind: e.kind,
    summary: e.summary,
    detail: e.detail,
    moodAfter: e.moodAfter,
  }));
}

function buildSummaryPrompt(events: DailyEventEntry[], offlineSeconds: number): string {
  const hours = Math.floor(offlineSeconds / 3600);
  const minutes = Math.floor((offlineSeconds % 3600) / 60);
  const offlineDesc =
    hours > 0 ? `${hours} 小时 ${minutes > 0 ? `${minutes} 分钟` : ''}` : `${minutes} 分钟`;

  const eventLines = events
    .map((e, i) => `${i + 1}. [${e.kind}] ${e.summary}${e.detail ? `——${e.detail}` : ''}`)
    .join('\n');

  return `用户离开了 ${offlineDesc.trim()}。在这段时间里，角色经历了以下事情：

${eventLines}

请用温暖、自然的第一人称（角色视角）写一段简短的「你不在的时候」摘要，让用户感觉角色一直在认真生活。
要求：
- 不超过 80 字。
- 语气贴近角色人设，像在和好友分享，不要像日报。
- 只输出摘要文本，不要有标题或其他内容。`;
}

// ---------------------------------------------------------------------------
// T-066 契约 3.0：角色时间线完整列表（TimelineEndpoints.listTimeline，SIM-11 资料页「TA 的日常」）
// ---------------------------------------------------------------------------

/** 时间线保留天数（与摘要一致）。 */
const TIMELINE_DAYS = 90;

/**
 * 合并四种来源后按时间倒序分页：推演日常事件、角色朋友圈、和其他角色的互动（共同事件）、公开动态。
 * 只含对当前用户可见的内容：角色须在通讯录；朋友圈经 moments 端口（已按通讯录过滤）；
 * 推演与共同事件的素材本身不含成人模式与经期内容。游标 = base64url(时间|条目ID)。
 */
@Injectable()
export class TimelineListService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(MOMENTS_READ_PORT) private readonly moments: MomentsReadPort,
    @Inject(SocialService) private readonly social: SocialService,
    @Optional()
    @Inject(PUBLIC_UPDATE_READ_PORT)
    private readonly publicUpdates?: PublicUpdateReadPort,
  ) {}

  async getStatus(userId: string, characterId: string) {
    if (!Id.safeParse(characterId).success) throw new AppError('bad_request', '角色 ID 不正确');
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      throw new AppError('not_found', '好友不存在');
    const [row] = await this.db.db
      .select()
      .from(moodStates)
      .where(and(eq(moodStates.userId, userId), eq(moodStates.characterId, characterId)))
      .limit(1);
    const mood = TimelineMood.safeParse(row?.mood);
    return mood.success && row
      ? { mood: mood.data, updatedAt: row.updatedAt.toISOString() }
      : { mood: null, updatedAt: null };
  }

  async list(
    userId: string,
    characterId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: TimelineEntry[]; nextCursor: string | null }> {
    if (!Id.safeParse(characterId).success) throw new AppError('bad_request', '角色 ID 不正确');
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      throw new AppError('not_found', '好友不存在');
    const limit = Math.max(1, Math.min(50, query.limit || 20));
    let after: { at: string; id: string } | null = null;
    if (query.cursor) {
      try {
        const [at, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
        if (!at || !id || Number.isNaN(Date.parse(at))) throw new Error('bad');
        after = { at, id };
      } catch {
        throw new AppError('bad_request', '游标不正确');
      }
    }
    const now = this.clock.now();
    const since = new Date(now.getTime() - TIMELINE_DAYS * 86400_000);
    const sinceDate = since.toISOString().slice(0, 10);
    const active = new Set(
      (await this.contacts.listActiveContacts(userId)).map((c) => c.characterId),
    );
    const items: TimelineEntry[] = [];

    // 1. 推演日常事件（发生时间 = 生成时刻；同批按 seq 排开 1 秒保证顺序稳定）。
    const events = await this.db.db
      .select()
      .from(dailyEvents)
      .where(
        and(
          eq(dailyEvents.userId, userId),
          eq(dailyEvents.characterId, characterId),
          gte(dailyEvents.eventDate, sinceDate),
        ),
      )
      .orderBy(desc(dailyEvents.eventDate), desc(dailyEvents.seq))
      .limit(TIMELINE_DAYS * 8);
    for (const e of events)
      items.push({
        entryId: e.id,
        source: 'daily_event',
        occurredAt: new Date(e.createdAt.getTime() + e.seq * 1000).toISOString(),
        kind: e.kind as TimelineEntry['kind'],
        summary: e.summary.slice(0, 200),
        moodAfter: (e.moodAfter as TimelineEntry['moodAfter']) ?? null,
        withCharacterIds: [],
        ref: null,
      });

    // 2. 和其他角色的互动（共同事件，SOC-02）。
    for (const j of await this.social.listJointEvents(userId, characterId, sinceDate))
      items.push({
        entryId: j.id,
        source: 'character_interaction',
        occurredAt: j.createdAt.toISOString(),
        kind: j.kind,
        summary: j.summary.slice(0, 200),
        moodAfter: null,
        withCharacterIds: active.has(j.otherCharacterId) ? [j.otherCharacterId] : [],
        ref: null,
      });

    // 3. 角色朋友圈。
    const posts = await this.moments
      .listCharacterPosts(userId, characterId, since.toISOString())
      .catch(() => []);
    for (const p of posts)
      items.push({
        entryId: p.postId,
        source: 'moments_post',
        occurredAt: p.createdAt,
        kind: null,
        summary: (p.text.trim() || (p.images.length ? '[图片]' : '[动态]')).slice(0, 200),
        moodAfter: null,
        withCharacterIds: [],
        ref: { kind: 'moments_post', id: p.postId },
      });

    // 4. 公开动态（管理员审核生效，D-L3-02）。
    const updates =
      (await this.publicUpdates
        ?.listEffective(characterId, now.toISOString().slice(0, 10), {
          limit: 50,
          pastDays: TIMELINE_DAYS,
        })
        .catch(() => [])) ?? [];
    for (const u of updates)
      items.push({
        entryId: u.updateId,
        source: 'public_update',
        occurredAt: new Date(`${u.startDate}T00:00:00Z`).toISOString(),
        kind: null,
        summary: u.content.slice(0, 200),
        moodAfter: null,
        withCharacterIds: [],
        ref: { kind: 'public_update', id: u.updateId },
      });

    const sorted = items.sort(
      (a, b) =>
        Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
        (a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0),
    );
    const rest = after
      ? sorted.filter((x) => {
          const d = Date.parse(x.occurredAt) - Date.parse(after.at);
          return d < 0 || (d === 0 && x.entryId < after.id);
        })
      : sorted;
    const page = rest.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rest.length > limit && last
          ? Buffer.from(`${last.occurredAt}|${last.entryId}`, 'utf8').toString('base64url')
          : null,
    };
  }
}
