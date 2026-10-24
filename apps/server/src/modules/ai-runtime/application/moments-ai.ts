/**
 * T-066 L4 AI：朋友圈内容生成与互动（D-L4-06；SOC-07～SOC-09）。
 *
 * - 发圈：代码决定发不发（P-16 每角色每天最多 1 条、每周按卡片 social.moments.frequencyPerWeek，默认 2–4 条；
 *   P-33 余额保留线；后台预算），后台模型只负责按人设写文字。来源只能是日常事件 / 公开动态 / 节日 / 宠物（SOC-07 第 2 条）。
 * - 真人角色：生成提示 + 输出守卫拦官宣、评论社会事件、本人声明（SAFE-02、SOC-07 第 5 条）。
 * - 不含成人模式内容（素材里没有聊天记录）和经期内容（healthPrivate 拦截）。
 * - 互动：用户评论角色动态 → 该角色一定回复（P-29 两小时内）；角色互评只在有关系的角色之间，按亲疏抽签；
 *   用户动态 → 可见角色按熟悉度点赞评论（至少 1 个 L2 及以上的角色互动）。
 * 说明见 docs/ai/runtime-overview.md 7.6 节。
 */
import { stageLabel } from '../domain/relationship-stage.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { and, eq, gte } from 'drizzle-orm';
import {
  type BillingReadPort,
  type CharacterReadPort,
  type CharacterRelationReadPort,
  type ContactsReadPort,
  type HolidayEventPort,
  type IdentityAccountStatusPort,
  type IdentityReadPort,
  type ModelGatewayPort,
  type MomentsCharacterPort,
  type MomentsPost,
  type MomentsReadPort,
  type PetReadPort,
  type PolicyPort,
  type PublicUpdateReadPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  OUTBOX,
  newId,
  type Clock,
  type Database,
  type JobQueue,
  type Outbox,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHARACTER_RELATION_READ_PORT, PUBLIC_UPDATE_READ_PORT } from '../../characters/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_SERVICE, type GrowthService } from '../../growth/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { MOMENTS_CHARACTER_PORT, MOMENTS_READ_PORT } from '../../moments/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { HOLIDAY_EVENT_PORT } from '../../proactive/index.js';
import { healthPrivate } from '../domain/memory.js';
import { momentsTopicsText } from '../domain/character-prompt.js';
import { BrainContextService, brainMessages, brainTail } from './brain.js';
import { outputAllowed } from '../domain/reply-rules.js';
import { momentsPlans, simulationStates } from '../infra/db/schema.js';
import { localParts } from './proactive-scheduler.js';
import { CompanionSettingsService } from './settings.js';
import { SimulationService } from './simulation.js';
import { CharacterImageService } from './character-image.js';
import { PlannerService } from './planner.js';
import { EcologySettingsService } from './ecology-settings.js';
import { ImageCaptionStore, NO_CAPTIONS } from './image-captions.js';
import { ImagePublicSearch } from './image-public-search.js';
import { MomentSceneryService } from './moment-scenery.js';
import {
  CAPTION_MAX_IMAGES,
  captionInstruction,
  captionPhrase,
  filterPeople,
  splitCaptionTail,
  type ImageSlot,
} from '../domain/image-caption.js';
import { publicMomentDrafts } from '../infra/db/ecology-schema.js';
import type { ModelGatewayPlatformPort } from '@weiban/contracts';
import { MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';
import {
  CLOSENESS_WEIGHT,
  SocialService,
  backgroundAllowed,
  relationText,
  stableRandom,
} from './social.js';
import { characterView, roleMoments, rolePersonaSpeechText } from './character-view.js';

// ---------------------------------------------------------------------------
// 参数（PRD 5.1 节原文）
// ---------------------------------------------------------------------------
/** P-16：每角色每天最多 1 条；默认每周 2–4 条，按人设调整。 */
export const P16_MOMENTS = { perDay: 1, defaultPerWeek: [2, 4] as const };
/** P-29：角色回复用户评论、点赞或评论用户动态，最晚 2 小时内。 */
export const P29_MOMENTS_REPLY_MS = 2 * 3600_000;
/** 实际排程上限留 20 分钟余量（任务排队、模型重试）。 */
const REACT_LATEST_MS = P29_MOMENTS_REPLY_MS - 20 * 60_000;
/** 发圈时段（当地时间）。 */
const POST_HOURS = { from: 9, to: 22 };

/**
 * 宠物（PLAY-02 第 7 条）：PetReadPort 由 T-077 提供、晒宠物的内容由 T-082 接入。
 * 本卡只留可选令牌：组合根注入后，朋友圈来源可包含 pet。
 */
export const MOMENTS_PET_READ_PORT = Symbol('AI_MOMENTS_PET_READ_PORT');

export const MOMENTS_TICK_JOB = 'ai.moments_tick';
export const MOMENTS_USER_JOB = 'ai.moments_user';
export const MOMENTS_REACT_JOB = 'ai.moments_react';

export interface MomentsReactJob {
  userId: string;
  postId: string;
  characterId: string;
  /** like = 只点赞；comment = 评论（可同时点赞）；reply = 回复某条评论（必回）。 */
  action: 'like' | 'comment' | 'reply';
  like?: boolean;
  replyToCommentId?: string;
  /** 回复用户（P-29 必回）：不受当天后台预算限制，只看 P-33。 */
  mustReply?: boolean;
  /** v5 角色生态唤醒发起（仅记录用）。 */
  ecologyRunId?: string;
  /** H2：该角色正处于私密模式（生态发起）——这次生成改用私密模型，传私聊会话 ID（私密模型调用必须带会话）。 */
  privateConversationId?: string;
}

const MOMENTS_FORBIDDEN_REAL =
  /官宣|新剧|新歌|新专辑|定档|杀青|开机|合作|代言|官方|声明|宣布|回应|网传|热搜|新闻|政府|政策|战争|选举|疫情/u;

function fam(level: number): number {
  return [0, 0.15, 0.45, 0.65, 0.8, 0.9][Math.max(0, Math.min(5, level))] ?? 0.15;
}

@Injectable()
export class MomentsAiService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MOMENTS_READ_PORT) private readonly moments: MomentsReadPort,
    @Inject(MOMENTS_CHARACTER_PORT) private readonly writer: MomentsCharacterPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(CHARACTER_RELATION_READ_PORT) private readonly relations: CharacterRelationReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(GROWTH_SERVICE) private readonly growth: GrowthService,
    @Inject(HOLIDAY_EVENT_PORT) private readonly holidays: HolidayEventPort,
    @Inject(SimulationService) private readonly simulation: SimulationService,
    @Inject(CompanionSettingsService) private readonly settings: CompanionSettingsService,
    @Inject(BrainContextService) private readonly brain: BrainContextService,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(CharacterImageService) private readonly images: CharacterImageService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(EcologySettingsService) private readonly ecology: EcologySettingsService,
    @Optional()
    @Inject(MODEL_PLATFORM_GATEWAY_PORT)
    private readonly platform?: ModelGatewayPlatformPort,
    @Optional()
    @Inject(PUBLIC_UPDATE_READ_PORT)
    private readonly publicUpdates?: PublicUpdateReadPort,
    @Optional() @Inject(MOMENTS_PET_READ_PORT) private readonly pets?: PetReadPort,
    /** H3：图片描述存档（角色评论用户朋友圈时也看图）。 */
    @Optional() @Inject(ImageCaptionStore) private readonly captions?: ImageCaptionStore,
    @Optional() @Inject(ImagePublicSearch) private readonly imageSearch?: ImagePublicSearch,
    @Optional() @Inject(MomentSceneryService) private readonly scenery?: MomentSceneryService,
  ) {}

  // =========================================================================
  // 发圈调度
  // =========================================================================
  /** 每小时：按用户投递检查任务。 */
  async tick(): Promise<void> {
    const users = await this.db.db
      .selectDistinct({ userId: simulationStates.userId })
      .from(simulationStates);
    const hour = Math.floor(this.clock.nowMs() / 3600_000);
    for (const { userId } of users)
      await this.jobs.send(
        MOMENTS_USER_JOB,
        { userId },
        { singletonKey: `moments-user:${userId}:${hour}`, retryLimit: 1 },
      );
  }

  /**
   * v5（16 号 §4、17 号 §4.2）：
   * - 官方角色（预设）的公共朋友圈保留：每角色每天一份、所有用户共用、平台承担（postPublic）；
   * - 自定义角色没有公共朋友圈；私人朋友圈只由角色生态发（postForEcology），这里不再按规则排期扣用户积分。
   * - 共同事件（朋友圈和私聊都读它）只给开着生态的用户安排（扣用户积分）。
   */
  async runForUser(userId: string): Promise<void> {
    if ((await this.accounts.getAccountStatus(userId)) !== 'active') return;
    if (await this.ecology.isActive(userId))
      await this.social.coordinateDay(userId).catch(() => undefined);
    const contacts = await this.contacts.listActiveContacts(userId).catch(() => []);
    for (const c of contacts) await this.postPublic(userId, c.characterId).catch(() => undefined);
  }

  // =========================================================================
  // v5：官方角色公共朋友圈（平台承担，所有用户共用同一份文字）
  // =========================================================================
  private async postPublic(userId: string, characterId: string): Promise<void> {
    if (!this.platform) return;
    const [profile] = await this.characters.getProfiles(userId, [characterId]).catch(() => []);
    if (profile?.kind !== 'preset') return;
    const role = await this.characters.getForRuntime(userId, characterId);
    const policy = await this.policy.getCharacterPolicy(userId, characterId);
    if (!role || !policy) return;
    // 公共节奏按角色（不按用户）稳定抽：所有人看到同一天、同一时刻附近的同一条。
    const date = localParts(this.clock.now(), 'Asia/Shanghai').date;
    const perWeek = roleMoments(characterView(role)).frequencyPerWeek;
    const plan = this.schedule('public', characterId, date, perWeek);
    if (!plan.postToday) return;
    const userLocal = localParts(
      this.clock.now(),
      (await this.identity.getProfile(userId))?.timeZone ?? 'Asia/Shanghai',
    );
    if (userLocal.hour < plan.hour || userLocal.hour > POST_HOURS.to) return;
    const draft = await this.publicDraft(userId, characterId, date, role, policy);
    if (!draft) return;
    const since24 = new Date(this.clock.nowMs() - 20 * 3600_000).toISOString();
    if (
      (await this.moments.listCharacterPosts(userId, characterId, since24)).some(
        (p) => p.text === draft.text,
      )
    )
      return;
    await this.writer.createPost(null, {
      ownerUserId: userId,
      characterId,
      text: draft.text,
      imageMediaIds: [],
      link: null,
      sourceRef: { kind: draft.sourceKind, id: draft.sourceId },
      idempotencyKey: `public-post-${date}`,
    });
  }

  /** 当天的公共草稿：第一个用到的用户触发生成（平台付费），之后所有用户复用。 */
  private async publicDraft(
    userId: string,
    characterId: string,
    date: string,
    role: NonNullable<Awaited<ReturnType<CharacterReadPort['getForRuntime']>>>,
    policy: NonNullable<Awaited<ReturnType<PolicyPort['getCharacterPolicy']>>>,
  ): Promise<{
    text: string;
    sourceKind: 'daily_event' | 'public_update' | 'holiday';
    sourceId: string;
  } | null> {
    const moments = roleMoments(characterView(role));
    const find = async () =>
      (
        await this.db.db
          .select()
          .from(publicMomentDrafts)
          .where(
            and(
              eq(publicMomentDrafts.characterId, characterId),
              eq(publicMomentDrafts.localDate, date),
            ),
          )
      )[0];
    const ready = (row: Awaited<ReturnType<typeof find>>) =>
      row?.status === 'ready' && row.text && row.sourceKind && row.sourceId
        ? {
            text: row.text,
            sourceKind: row.sourceKind as 'daily_event' | 'public_update' | 'holiday',
            sourceId: row.sourceId,
          }
        : null;
    const existing = await find();
    if (existing) return ready(existing);
    const claimed = await this.db.db
      .insert(publicMomentDrafts)
      .values({ characterId, localDate: date, status: 'generating', createdAt: this.clock.now() })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) return ready(await find());
    // 素材只用角色层面的（不含任何用户的聊天、推演）：已审核公开动态 > 非恋爱节日 > 人设里的日常小感受。
    const holiday = await this.holidays
      .getUpcomingForUser(userId, 1)
      .then((l) => l.find((h) => h.daysAhead === 0 && !h.romantic))
      .catch(() => undefined);
    const update = (
      (await this.publicUpdates
        ?.listEffective(characterId, date, { limit: 3, pastDays: 2 })
        .catch(() => [])) ?? []
    ).find((u) => u.phase === 'recent');
    const source = update
      ? {
          kind: 'public_update' as const,
          id: update.updateId,
          brief: `已审核的公开动态：${update.content.slice(0, 300)}`,
        }
      : holiday
        ? {
            kind: 'holiday' as const,
            id: `${holiday.holidayId}:${holiday.date}`,
            brief: `今天是${holiday.name}`,
          }
        : {
            kind: 'daily_event' as const,
            id: `public:${characterId}:${date}`,
            brief: '符合你人设的一个日常小感受（天气、吃的、在做的事），不写具体的人和事件。',
          };
    const result = await this.platform!.generatePlatformText({
      userId,
      characterId,
      purpose: 'moments',
      modelRole: 'background',
      responseFormat: 'text',
      maxOutputTokens: 200,
      idempotencyKey: `ai:public-moment:${characterId}:${date}`,
      messages: [
        {
          role: 'system',
          content: `你以角色本人的身份发一条公开的微信朋友圈（所有用户都会看到同一条）。只输出正文纯文本，不超过80字，不加引号、不加标签。文风符合人设：${moments.tone}。${momentsTopicsText(moments.topics)}不提任何具体用户、不提私聊内容，不含恋爱暧昧或成人内容，不提健康隐私。${policy.isRealPerson ? '你是真人角色：不得官宣新作品或合作（除非素材就是已审核的公开动态），不评论真实社会事件或他人，不写像本人公开声明的话；只写生活化的小感受。' : ''}`,
        },
        {
          role: 'system',
          content: `角色资料：${rolePersonaSpeechText(characterView(role), 6000)}`,
        },
        { role: 'user', content: `素材：${source.brief}` },
      ],
    });
    const text = result.ok
      ? result.value.text
          .trim()
          .replace(/^["「『]|["」』]$/g, '')
          .slice(0, 500)
      : '';
    const ok =
      !!text &&
      !healthPrivate(text) &&
      outputAllowed(text, policy, false) &&
      !(
        policy.isRealPerson &&
        source.kind !== 'public_update' &&
        MOMENTS_FORBIDDEN_REAL.test(text)
      );
    await this.db.db
      .update(publicMomentDrafts)
      .set({
        status: ok ? 'ready' : 'dropped',
        text: ok ? text : null,
        sourceKind: source.kind,
        sourceId: source.id,
        chargedMicros: result.ok ? result.value.chargedMicros : 0,
      })
      .where(
        and(
          eq(publicMomentDrafts.characterId, characterId),
          eq(publicMomentDrafts.localDate, date),
        ),
      );
    return ok ? { text, sourceKind: source.kind, sourceId: source.id } : null;
  }

  // =========================================================================
  // v5：角色生态发私人朋友圈（扣用户积分；和你们的聊天、TA 的生活有关）
  // =========================================================================
  /** 最近一条仍有效的微博同步动态；没有绑定微博的角色返回 null。 */
  private async latestWeiboUpdate(
    characterId: string,
  ): Promise<{ updateId: string; content: string } | null> {
    if (!this.publicUpdates) return null;
    const today = new Date(this.clock.nowMs()).toISOString().slice(0, 10);
    const updates = await this.publicUpdates
      .listEffective(characterId, today, { limit: 5, pastDays: 30 })
      .catch(() => []);
    const found = updates.find(
      (u) => /weibo\.(com|cn)/i.test(u.sourceUrl) && u.content.trim().length >= 4,
    );
    return found ? { updateId: found.updateId, content: found.content } : null;
  }
  async postForEcology(input: {
    userId: string;
    characterId: string;
    runId: string;
    brief: string;
    /** H2：角色正处于私密模式——用私密模型生成（输入只有日常资料，输出仍按日常范围检查）。 */
    privateConversationId?: string;
  }): Promise<{ ok: true; chargedMicros: number; postId: string } | { ok: false; reason: string }> {
    const { userId, characterId } = input;
    const role = await this.characters.getForRuntime(userId, characterId);
    const policy = await this.policy.getCharacterPolicy(userId, characterId);
    if (!role || !policy) return { ok: false, reason: 'context_unavailable' };
    const moments = roleMoments(characterView(role));
    // 微博角色：优先原样转发它最近一条已同步的公开动态，不花钱重新生成文案。
    const weibo = await this.latestWeiboUpdate(characterId);
    if (weibo) {
      const forwarded = weibo.content.trim().slice(0, 500);
      const safe =
        forwarded.length >= 4 &&
        !healthPrivate(forwarded) &&
        outputAllowed(forwarded, policy, false) &&
        !(policy.isRealPerson && MOMENTS_FORBIDDEN_REAL.test(forwarded));
      if (safe) {
        const scenery = this.scenery
          ? await this.scenery.pick({ userId, seed: `weibo:${weibo.updateId}` }).catch(() => null)
          : null;
        const reposted = await this.writer.createPost(null, {
          ownerUserId: userId,
          characterId,
          text: forwarded,
          imageMediaIds: scenery ? [scenery.mediaId] : [],
          link: null,
          sourceRef: { kind: 'public_update', id: weibo.updateId },
          // 同一条微博对同一个用户只转一次。
          idempotencyKey: `eco-weibo:${userId}:${weibo.updateId}`,
        });
        // 已经转过就继续走正常生成，避免这次唤醒白跑。
        if (reposted.ok) return { ok: true, chargedMicros: 0, postId: reposted.value.postId };
      }
    }
    // A private post is normal-scope even while its owner uses the private model.
    const brain = await this.brain.build(userId, characterId, 'normal', input.brief, {
      excludeHealth: true,
    });
    if (!brain) return { ok: false, reason: 'context_unavailable' };
    const result = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'moments',
      billingOwner: 'user',
      ...(input.privateConversationId
        ? {
            modelRole: 'adult' as const,
            conversationId: input.privateConversationId,
            meta: { scenarioMode: 'adult' },
          }
        : { modelRole: 'background' as const }),
      countAsBackground: true,
      ecologyTask: true,
      responseFormat: 'text',
      maxOutputTokens: 200,
      idempotencyKey: `ai:eco-moment:${input.runId}`,
      meta: {
        stablePrefixChars: brain.prefix.length,
        promptTemplateVersion: 'brain-v1:private-moment',
        ...(input.privateConversationId ? { scenarioMode: 'adult' } : {}),
      },
      messages: [
        ...brainMessages(brain, input.privateConversationId ? 'adult' : 'background'),
        {
          role: 'system',
          content: `你以角色本人的身份发一条私人朋友圈（只有和你聊天的这位用户能看到）。只输出朋友圈正文纯文本，不超过100字，不加引号、不加标签。文风符合人设：${moments.tone}。${momentsTopicsText(moments.topics)}可以含蓄地和你们最近的聊天、你今天的生活有关，但不直接复述对方的隐私，不提月经、经期等健康隐私，不含成人内容。${policy.isRealPerson ? '你是真人角色：不官宣新作品或合作，不评论真实社会事件或他人，不写像本人公开声明的话。' : ''}${policy.isMinor || !policy.romanceAllowed ? '不涉及恋爱暧昧。' : ''}`,
        },
        ...brainTail(brain),
        { role: 'user', content: `这条朋友圈想写的：${input.brief.slice(0, 500)}` },
      ],
    });
    if (!result.ok) return { ok: false, reason: `model_${result.error}` };
    const text = result.value.text
      .trim()
      .replace(/^["「『]|["」』]$/g, '')
      .slice(0, 500);
    if (
      !text ||
      healthPrivate(text) ||
      !outputAllowed(text, policy, false) ||
      (policy.isRealPerson && MOMENTS_FORBIDDEN_REAL.test(text))
    )
      return { ok: false, reason: 'output_guard' };
    const scenery = this.scenery
      ? await this.scenery
          .pick({ userId, seed: `eco:${input.runId}:${text.slice(0, 80)}` })
          .catch(() => null)
      : null;
    const posted = await this.writer.createPost(null, {
      ownerUserId: userId,
      characterId,
      text,
      imageMediaIds: scenery ? [scenery.mediaId] : [],
      link: null,
      sourceRef: { kind: 'daily_event', id: `eco:${input.runId}` },
      idempotencyKey: `eco-post-${input.runId}`,
    });
    if (!posted.ok) return { ok: false, reason: `post_failed:${String(posted.error)}` };
    return { ok: true, chargedMicros: result.value.chargedMicros, postId: posted.value.postId };
  }

  /** v5：角色生态里的点赞 / 评论 / 回复（同 runReact，返回扣费）。 */
  async reactForEcology(
    job: MomentsReactJob,
  ): Promise<{ ok: true; chargedMicros: number } | { ok: false; reason: string }> {
    return this.react0(job);
  }

  /** 今天是否该发、几点发：按「用户 + 角色 + 周」稳定抽日子，不同角色节奏不同。 */
  private schedule(
    userId: string,
    characterId: string,
    date: string,
    perWeek: readonly [number, number],
  ): { postToday: boolean; hour: number } {
    const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400_000);
    const week = Math.floor((day + 3) / 7); // 周一为一周开始
    const dow = (day + 3) % 7;
    const [min, max] = [Math.min(perWeek[0], perWeek[1]), Math.max(perWeek[0], perWeek[1])];
    const n = Math.min(
      7,
      min + Math.floor(stableRandom(`${userId}:${characterId}:${week}:n`) * (max - min + 1)),
    );
    const order = [0, 1, 2, 3, 4, 5, 6].sort(
      (a, b) =>
        stableRandom(`${userId}:${characterId}:${week}:${a}`) -
        stableRandom(`${userId}:${characterId}:${week}:${b}`),
    );
    const span = POST_HOURS.to - POST_HOURS.from + 1;
    return {
      postToday: order.slice(0, n).includes(dow),
      hour: POST_HOURS.from + Math.floor(stableRandom(`${userId}:${characterId}:${date}:h`) * span),
    };
  }

  /** v5 起不再由定时任务调用（私人朋友圈改由角色生态发）；保留便于对照。 */
  async maybePost(userId: string, characterId: string): Promise<void> {
    const dailyLife = await this.settings
      .get(userId, characterId)
      .then((s) => s.dailyLife)
      .catch(() => true);
    if (!dailyLife) return; // 「TA 的日常」关闭：不推演，也不发圈
    const role = await this.characters.getForRuntime(userId, characterId);
    const policy = await this.policy.getCharacterPolicy(userId, characterId);
    if (!role || !policy) return;
    const view = characterView(role);
    const moments = roleMoments(view);
    const profile = await this.identity.getProfile(userId);
    const tz = profile?.timeZone ?? 'Asia/Shanghai';
    const now = this.clock.now();
    const local = localParts(now, tz);
    const perWeek = moments.frequencyPerWeek;
    const plan = this.schedule(userId, characterId, local.date, perWeek);
    if (
      !plan.postToday ||
      local.hour < Math.max(POST_HOURS.from, plan.hour - 2) ||
      local.hour > POST_HOURS.to
    )
      return;
    // T-090 moments_plan：规则版时刻附近挑一个发圈时段（或今天不发），每角色每天只问一次。
    const hours = [
      ...new Set([
        plan.hour,
        Math.max(POST_HOURS.from, plan.hour - 2),
        Math.min(POST_HOURS.to, plan.hour + 2),
      ]),
    ];
    const slot = await this.planner.decide({
      userId,
      characterId,
      decisionType: 'moments_plan',
      options: [...hours.map((h) => `post_at:${h}`), 'skip_today'],
      ruleChoice: `post_at:${plan.hour}`,
      ruleReason: '规则版发圈时刻',
      conservative: `post_at:${plan.hour}`,
      question:
        '角色今天什么时候发一条朋友圈最自然？post_at:N 表示用户当地 N 点之后；也可以今天不发（skip_today）。',
      features: { localHour: local.hour, candidateCount: hours.length },
      path: 'proactive',
      idempotencyKey: `moments:${characterId}:${local.date}`,
      decisionKey: `moments:${characterId}:${local.date}`,
    });
    if (slot.choice === 'skip_today') return;
    const postHour = Number(slot.choice.split(':')[1]);
    if (local.hour < (Number.isFinite(postHour) ? postHour : plan.hour)) return;
    // P-16 每天最多 1 条：账本唯一约束 + 朋友圈里今天已有就不发。
    const [today] = await this.db.db
      .select({ id: momentsPlans.id })
      .from(momentsPlans)
      .where(
        and(
          eq(momentsPlans.userId, userId),
          eq(momentsPlans.characterId, characterId),
          eq(momentsPlans.localDate, local.date),
        ),
      );
    if (today) return;
    const since24 = new Date(now.getTime() - 20 * 3600_000).toISOString();
    if ((await this.moments.listCharacterPosts(userId, characterId, since24)).length) return;
    // 每周上限（滚动 7 天）。
    const weekRows = await this.db.db
      .select({ id: momentsPlans.id })
      .from(momentsPlans)
      .where(
        and(
          eq(momentsPlans.userId, userId),
          eq(momentsPlans.characterId, characterId),
          eq(momentsPlans.status, 'posted'),
          gte(momentsPlans.createdAt, new Date(now.getTime() - 7 * 86400_000)),
        ),
      );
    if (weekRows.length >= Math.max(perWeek[0], perWeek[1])) return;

    const source = await this.pickSource(userId, characterId, local.date);
    if (!source) return;
    const planId = newId();
    const inserted = await this.db.db
      .insert(momentsPlans)
      .values({
        id: planId,
        userId,
        characterId,
        localDate: local.date,
        sourceKind: source.kind,
        sourceId: source.id,
        status: 'generating',
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: momentsPlans.id });
    if (!inserted.length) return;
    const drop = () =>
      this.db.db.update(momentsPlans).set({ status: 'dropped' }).where(eq(momentsPlans.id, planId));

    const result = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'moments',
      billingOwner: 'user',
      modelRole: 'background',
      countAsBackground: true,
      ecologyTask: true,
      responseFormat: 'text',
      maxOutputTokens: 200,
      idempotencyKey: `ai:moments-post:${userId}:${characterId}:${local.date}`,
      messages: [
        {
          role: 'system',
          content: `你以角色本人的身份发一条微信朋友圈。只输出朋友圈正文纯文本，不超过100字，不加引号、不加标签说明。文风符合人设：${moments.tone}。${momentsTopicsText(moments.topics)}只写下面给出的素材，不编造新的经历、新的公开活动或作品。不提用户在私聊里说的任何事，不含恋爱暧昧或成人内容，不提月经、经期等健康隐私。${policy.isRealPerson ? '你是真人角色：不得官宣新作品或合作（除非素材就是已审核的公开动态），不得评论真实社会事件或他人，不得写任何可能被当成本人公开声明的话；只写生活化的小感受。' : ''}${policy.isMinor ? '儿童角色：不涉及恋爱。' : ''}`,
        },
        {
          role: 'system',
          content: `角色资料：${
            view.card
              ? JSON.stringify({
                  name: role.profile.name,
                  fanName: role.profile.fanName,
                  persona: view.card.persona,
                  speech: view.card.speech,
                  fanNameUsage: view.card.profileExtra.fanNameUsage,
                }).slice(0, 8000)
              : rolePersonaSpeechText(view, 8000)
          }`,
        },
        { role: 'user', content: `今天要发的素材（${source.label}，事实）：${source.brief}` },
      ],
    });
    if (!result.ok) {
      await drop();
      return;
    }
    const text = result.value.text
      .trim()
      .replace(/^["「『]|["」』]$/g, '')
      .slice(0, 500);
    if (
      !text ||
      healthPrivate(text) ||
      !outputAllowed(text, policy, false) ||
      (policy.isRealPerson && source.kind !== 'public_update' && MOMENTS_FORBIDDEN_REAL.test(text))
    ) {
      await drop();
      return;
    }
    // T-072 MED-02：日常事件朋友圈约一半配图（真人角色只有 TA 视角、无人脸；失败或未开通时用素材库或不配）。
    let imageMediaIds = source.imageMediaIds ?? [];
    const withImage =
      !imageMediaIds.length && source.kind === 'daily_event'
        ? (
            await this.planner.decide({
              userId,
              characterId,
              decisionType: 'moments_plan',
              options: ['no_image', 'with_image'],
              ruleChoice: Math.random() < 0.5 ? 'with_image' : 'no_image',
              ruleReason: '规则版约一半配图',
              conservative: 'no_image',
              question: '这条日常朋友圈要不要配一张 TA 视角的图（with_image）？',
              features: { localHour: local.hour, reasonKind: source.kind },
              path: 'proactive',
              idempotencyKey: `moments-image:${characterId}:${local.date}`,
              decisionKey: `moments-image:${characterId}:${local.date}`,
            })
          ).choice === 'with_image'
        : false;
    if (withImage) {
      const image = await this.images
        .generate({
          userId,
          characterId,
          scene: source.brief,
          use: 'moments',
          idempotencyKey: `moments:${userId}:${characterId}:${local.date}`,
          countAsBackground: true,
          ecologyTask: true,
        })
        .catch(() => null);
      if (image) imageMediaIds = [image.mediaId];
    }
    const posted = await this.writer.createPost(null, {
      ownerUserId: userId,
      characterId,
      text,
      imageMediaIds,
      link: null,
      sourceRef: { kind: source.kind, id: source.id },
      idempotencyKey: `ai-post-${local.date}`,
    });
    if (!posted.ok) {
      await drop();
      return;
    }
    await this.db.db
      .update(momentsPlans)
      .set({ status: 'posted', postId: posted.value.postId })
      .where(eq(momentsPlans.id, planId));
    // 后续互评由 moments.post_created 事件触发（onPostCreated）。
  }

  /** 选素材：节日 > 近期公开动态 > 共同事件 > 今天的日常事件 > 宠物。 */
  private async pickSource(
    userId: string,
    characterId: string,
    date: string,
  ): Promise<{
    kind: 'daily_event' | 'public_update' | 'holiday' | 'pet';
    id: string;
    label: string;
    brief: string;
    imageMediaIds?: string[];
  } | null> {
    const holiday = await this.holidays
      .getUpcomingForUser(userId, 1)
      .then((l) => l.find((h) => h.daysAhead === 0))
      .catch(() => undefined);
    if (holiday && !holiday.romantic)
      return {
        kind: 'holiday',
        id: `${holiday.holidayId}:${holiday.date}`,
        label: '节日',
        brief: `今天是${holiday.name}`,
      };
    const used = new Set(
      (
        await this.db.db
          .select({ id: momentsPlans.sourceId })
          .from(momentsPlans)
          .where(and(eq(momentsPlans.userId, userId), eq(momentsPlans.characterId, characterId)))
      ).map((r) => r.id),
    );
    const updates =
      (await this.publicUpdates
        ?.listEffective(characterId, date, { limit: 5, pastDays: 3 })
        .catch(() => [])) ?? [];
    const fresh = updates.find((u) => u.phase === 'recent' && !used.has(u.updateId));
    if (fresh)
      return {
        kind: 'public_update',
        id: fresh.updateId,
        label: '已审核的公开动态',
        brief: fresh.content.slice(0, 300),
      };
    const joint = (await this.social.listJointEvents(userId, characterId, date)).find(
      (j) => !used.has(j.id),
    );
    if (joint)
      return {
        kind: 'daily_event',
        id: joint.id,
        label: '今天和朋友一起做的事',
        brief: `${joint.summary}${joint.detail ? `；${joint.detail}` : ''}`,
      };
    const events = (
      await this.simulation
        .getDailyEvents(userId, characterId, this.clock.now().toISOString().slice(0, 10))
        .catch(() => [])
    ).filter((e) => !used.has(e.id) && !healthPrivate(`${e.summary}${e.detail ?? ''}`));
    const best =
      events.find((e) => ['leisure', 'social', 'unexpected'].includes(e.kind)) ?? events[0];
    if (best)
      return {
        kind: 'daily_event',
        id: best.id,
        label: '今天的日常',
        brief: `${best.summary}${best.detail ? `；${best.detail.slice(0, 200)}` : ''}`,
      };
    const pet = (await this.pets?.listPetsForCharacter(userId, characterId).catch(() => []))?.find(
      (p) => p.status === 'active' && p.allowMomentsShare,
    );
    if (pet && !used.has(`${pet.petId}:${date}`))
      return {
        kind: 'pet',
        id: `${pet.petId}:${date}`,
        label: '宠物日常',
        // T-082 PLAY-02 第 7 条：只说宠物，不提用户；名字现取（改名后用新名字）。
        brief: `${pet.name}（${pet.speciesName}），已经养了${pet.daysAdopted}天。只写宠物本身的可爱日常，不提到用户、不说是和谁一起养的，不写宠物想念谁。`,
        imageMediaIds: [pet.presetImageMediaId],
      };
    return null;
  }

  // =========================================================================
  // 互动（SOC-08、SOC-09）
  // =========================================================================
  private delay(min: number, max: number): number {
    return Math.min(REACT_LATEST_MS, Math.floor(min + Math.random() * (max - min)));
  }

  private async react(job: MomentsReactJob, delayMs: number, key: string): Promise<void> {
    await this.jobs.send(MOMENTS_REACT_JOB, job, {
      delayMs,
      singletonKey: key,
      retryLimit: job.mustReply ? 5 : 1,
      retryBackoff: true,
    });
  }

  async onPostCreated(payload: {
    postId: string;
    ownerUserId: string;
    authorKind: 'user' | 'character';
    authorCharacterId: string | null;
    visibleCharacterIds: string[];
  }): Promise<void> {
    const userId = payload.ownerUserId;
    if (payload.authorKind === 'user') {
      // SOC-09 第 3 条：可见角色按熟悉度决定点赞、评论；至少 1 个 L2+ 角色互动。
      const ids = payload.visibleCharacterIds;
      const scored: { id: string; level: number }[] = [];
      for (const id of ids) {
        const level = await this.growth
          .getFamiliarity(userId, id)
          .then((f) => f.level)
          .catch(() => 1);
        scored.push({ id, level });
      }
      scored.sort((a, b) => b.level - a.level);
      let any = false;
      // v5：角色自己去点赞评论 = 生态动作「给你的朋友圈点赞、评论」（PRO+、开着生态、角色与动作开关都开）。
      const allowed: typeof scored = [];
      for (const s of scored)
        if (await this.ecology.isActive(userId, s.id, 'moment_interact')) allowed.push(s);
      scored.splice(0, scored.length, ...allowed);
      for (const s of scored) {
        const p = fam(s.level);
        const comment = Math.random() < p * 0.8;
        const like = Math.random() < Math.min(1, p + 0.2);
        if (!comment && !like) continue;
        any = true;
        await this.react(
          {
            userId,
            postId: payload.postId,
            characterId: s.id,
            action: comment ? 'comment' : 'like',
            like,
          },
          this.delay(2 * 60_000, 80 * 60_000),
          `moments-react:${payload.postId}:${s.id}`,
        );
      }
      const top = scored[0];
      if (!any && top && top.level >= 2)
        await this.react(
          { userId, postId: payload.postId, characterId: top.id, action: 'comment', like: true },
          this.delay(5 * 60_000, 60 * 60_000),
          `moments-react:${payload.postId}:${top.id}`,
        );
      return;
    }
    // 角色动态：只有与作者有关系、且在通讯录里的角色会互动（SOC-08 第 2、3 条）。
    if (!payload.authorCharacterId) return;
    const { added } = await this.social.relatedContacts(userId, payload.authorCharacterId);
    for (const a of added) {
      if (!(await this.ecology.isActive(userId, a.characterId, 'moment_peer'))) continue;
      const w = CLOSENESS_WEIGHT[a.relation.closeness] ?? 0.3;
      const comment = Math.random() < w * 0.5;
      const like = Math.random() < w * 0.8;
      if (!comment && !like) continue;
      await this.react(
        {
          userId,
          postId: payload.postId,
          characterId: a.characterId,
          action: comment ? 'comment' : 'like',
          like,
        },
        this.delay(10 * 60_000, 95 * 60_000),
        `moments-react:${payload.postId}:${a.characterId}`,
      );
    }
  }

  async onCommentCreated(payload: {
    postId: string;
    commentId: string;
    ownerUserId: string;
    postAuthorKind: 'user' | 'character';
    postAuthorCharacterId: string | null;
    authorKind: 'user' | 'character';
    authorCharacterId: string | null;
    replyToKind: 'user' | 'character' | null;
    replyToCharacterId: string | null;
  }): Promise<void> {
    const userId = payload.ownerUserId;
    if (payload.authorKind === 'user') {
      // SOC-08 第 1 条：用户评论角色动态 → 作者一定回复；用户回复某角色的评论 → 被回复的角色回复。
      const target =
        payload.replyToKind === 'character' && payload.replyToCharacterId
          ? payload.replyToCharacterId
          : payload.postAuthorKind === 'character'
            ? payload.postAuthorCharacterId
            : null;
      if (!target) return;
      await this.react(
        {
          userId,
          postId: payload.postId,
          characterId: target,
          action: 'reply',
          replyToCommentId: payload.commentId,
          mustReply: true,
        },
        this.delay(60_000, 30 * 60_000),
        `moments-reply:${payload.commentId}`,
      );
      return;
    }
    // 角色之间接梗：被回复的角色或动态作者按亲疏回一句（评论上限由 moments 控制，P-SOC-08 第 5 条）。
    const author = payload.authorCharacterId;
    if (!author) return;
    const target =
      payload.replyToKind === 'character' && payload.replyToCharacterId
        ? payload.replyToCharacterId
        : payload.postAuthorKind === 'character'
          ? payload.postAuthorCharacterId
          : null;
    if (!target || target === author) return;
    const relation = await this.relations.getRelation(userId, author, target).catch(() => null);
    if (!relation) return;
    if (!(await this.ecology.isActive(userId, target, 'moment_reply'))) return;
    if (Math.random() >= (CLOSENESS_WEIGHT[relation.closeness] ?? 0.3) * 0.5) return;
    await this.react(
      {
        userId,
        postId: payload.postId,
        characterId: target,
        action: 'reply',
        replyToCommentId: payload.commentId,
      },
      this.delay(5 * 60_000, 60 * 60_000),
      `moments-reply:${payload.commentId}`,
    );
  }

  async runReact(job: MomentsReactJob): Promise<void> {
    const r = await this.react0(job);
    // P-29 必回：生成失败抛错让任务重试（最多 5 次，仍在 2 小时内）。
    if (!r.ok && r.reason === 'generation_failed' && job.mustReply)
      throw new Error('moments reply generation failed');
  }

  private async react0(
    job: MomentsReactJob,
  ): Promise<{ ok: true; chargedMicros: number } | { ok: false; reason: string }> {
    const { userId, characterId } = job;
    if ((await this.accounts.getAccountStatus(userId)) !== 'active')
      return { ok: false, reason: 'account_inactive' };
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      return { ok: false, reason: 'contact_inactive' };
    if (
      !(await backgroundAllowed(this.billing, userId, {
        requireBackgroundBudget: !job.mustReply,
      }))
    )
      return { ok: false, reason: 'budget' };
    const post = await this.moments.getPostVisibleToCharacter(userId, job.postId, characterId);
    if (!post) return { ok: false, reason: 'post_not_visible' };
    if (job.replyToCommentId && !post.comments.some((c) => c.commentId === job.replyToCommentId))
      return { ok: false, reason: 'comment_gone' };
    if (job.like || job.action === 'like')
      await this.writer.like({
        ownerUserId: userId,
        postId: post.postId,
        characterId,
        idempotencyKey: `ai-like-${characterId}`,
      });
    if (job.action === 'like') return { ok: true, chargedMicros: 0 };
    const text = await this.generateComment(job, post);
    if (!text) return { ok: false, reason: 'generation_failed' };
    const result = await this.writer.comment({
      ownerUserId: userId,
      postId: post.postId,
      characterId,
      text: text.text,
      replyToCommentId: job.replyToCommentId ?? null,
      mentionsUser: text.mentionsUser,
      idempotencyKey: `ai-${job.action}-${job.replyToCommentId ?? 'post'}`,
    });
    if (!result.ok) return { ok: false, reason: 'comment_rejected' };
    if (job.mustReply)
      await this.db.transaction(async (tx) => {
        await this.outbox.publish(tx, 'ai_runtime.milestone', 'ai_runtime', {
          userId,
          characterId,
          kind: 'moments_replied_user',
          refId: post.postId,
        });
      });
    return { ok: true, chargedMicros: text.chargedMicros };
  }

  private async generateComment(
    job: MomentsReactJob,
    post: MomentsPost,
  ): Promise<{ text: string; mentionsUser: boolean; chargedMicros: number } | null> {
    const { userId, characterId } = job;
    const role = await this.characters.getForRuntime(userId, characterId);
    const policy = await this.policy.getCharacterPolicy(userId, characterId);
    const profile = await this.identity.getProfile(userId);
    if (!role || !policy) return null;
    const view = characterView(role);
    const moments = roleMoments(view);
    const ids = new Set<string>();
    if (post.author.kind === 'character') ids.add(post.author.refId);
    for (const c of post.comments) if (c.author.kind === 'character') ids.add(c.author.refId);
    const profiles = await this.characters.getProfiles(userId, [...ids]).catch(() => []);
    const userName = profile?.nickname ?? '用户';
    const nameOf = (a: { kind: 'user' | 'character'; refId: string }) =>
      a.kind === 'user'
        ? userName
        : a.refId === characterId
          ? '你'
          : (profiles.find((p) => p.characterId === a.refId)?.name ?? '朋友');
    // 关系（只给有关系的人调侃；无关系的人不装熟）。
    const relLines: string[] = [];
    for (const id of ids) {
      if (id === characterId) continue;
      const r = await this.relations.getRelation(userId, characterId, id).catch(() => null);
      const n = profiles.find((p) => p.characterId === id)?.name ?? '朋友';
      relLines.push(r ? `你和${n}：${relationText(r)}` : `你和${n}不熟，不要装熟`);
    }
    const level = await this.growth
      .getFamiliarity(userId, characterId)
      .then((f) => f.level)
      .catch(() => 1);
    const current = await this.moments.getPostVisibleToCharacter(userId, post.postId, characterId);
    if (
      !current ||
      (job.replyToCommentId && !current.comments.some((c) => c.commentId === job.replyToCommentId))
    )
      return null;
    if (
      current.text !== post.text ||
      JSON.stringify(current.comments) !== JSON.stringify(post.comments)
    )
      return null;
    post = current;
    const target = job.replyToCommentId
      ? post.comments.find((c) => c.commentId === job.replyToCommentId)
      : null;
    if (
      target?.author.kind === 'character' &&
      !(await this.moments.getPostVisibleToCharacter(userId, post.postId, target.author.refId))
    )
      return null;
    const thread = post.comments
      .slice(-12)
      .map(
        (c) =>
          `${nameOf(c.author)}${c.replyTo ? ` 回复 ${nameOf(c.replyTo)}` : ''}：${c.text.slice(0, 150)}`,
      )
      .join('\n');
    const replyTo = job.replyToCommentId
      ? post.comments.find((c) => c.commentId === job.replyToCommentId)
      : null;
    const task = replyTo
      ? `回复${nameOf(replyTo.author)}的这条评论：「${replyTo.text.slice(0, 200)}」`
      : `在这条动态下评论一句`;
    // H3（22 号 §7 第 2 条）：用户朋友圈的图——已有描述的直接写进去，没有的附给这次评论一起看（最多 4 张），
    // 评论顺带输出描述尾标存档（日常范围），以后再评论、私聊提起都用描述。按用户扣积分。
    const own = post.author.kind === 'user' && post.author.refId === userId;
    const captions =
      own && post.images.length
        ? ((await this.captions
            ?.load(
              userId,
              post.images.map((i) => i.mediaId),
              ['normal'],
            )
            .catch(() => null)) ?? NO_CAPTIONS)
        : NO_CAPTIONS;
    const slots: ImageSlot[] = [];
    const imageLines = own
      ? post.images.map((img, index) => {
          const seen = captions.get(img.mediaId);
          if (seen) return `图${index + 1}：${captionPhrase(seen)}`;
          if (!this.captions || slots.length >= CAPTION_MAX_IMAGES)
            return `图${index + 1}：（这次没附上，不要猜它的内容）`;
          const slot: ImageSlot = {
            n: slots.length + 1,
            mediaId: img.mediaId,
            ownerUserId: userId,
            messageId: null,
            sticker: false,
          };
          slots.push(slot);
          return `图${index + 1}〔图${slot.n}〕`;
        })
      : [];
    const imageNote = captionInstruction(slots, { allowed: [role.profile.name], scope: 'normal' })
      .replace('对方这轮发来', '这条动态附了')
      .replace('回复正文写完后', '评论正文写完后');
    const imagesText = own
      ? post.images.length
        ? `\n（附 ${post.images.length} 张图片）\n${imageLines.join('\n')}`
        : ''
      : post.images.length
        ? `\n（附 ${post.images.length} 张图片，你看不到图片内容，不要描述图片细节）`
        : '';
    const request: import('@weiban/contracts').GenerateTextInput = {
      userId,
      characterId,
      purpose: 'moments',
      billingOwner: 'user',
      // H2：生态发起且角色正处于私密模式 → 私密模型（输出仍按日常范围检查）。
      ...(job.privateConversationId
        ? {
            modelRole: 'adult' as const,
            conversationId: job.privateConversationId,
            meta: { scenarioMode: 'adult' },
          }
        : { modelRole: 'background' as const }),
      ...(job.mustReply ? {} : { countAsBackground: true, ecologyTask: true }),
      responseFormat: 'text',
      maxOutputTokens: 120 + slots.length * 200,
      idempotencyKey: `ai:moments-${job.action}:${post.postId}:${characterId}:${job.replyToCommentId ?? 'post'}`,
      messages: [
        {
          role: 'system',
          content: `你以角色身份在微信朋友圈下评论。只输出评论正文，不超过40字，不加名字前缀。评论要和动态内容相关；按你的风格（${moments.commentStyle}）；和亲密的朋友可以调侃接梗，和不熟的人客气。不提用户在私聊里说过的私事，不含恋爱暧昧（除非允许恋爱=${policy.romanceAllowed}）或成人内容，不提经期等健康隐私。${policy.isRealPerson ? '真人角色：不官宣、不评论真实社会事件和他人、不写像本人声明的话。' : ''}如果要叫用户，可以用「@${userName}」开头。`,
        },
        {
          role: 'system',
          content: `角色资料：${rolePersonaSpeechText(view, 6000)}\n${relLines.join('\n')}\n你和用户（${userName}）的好感度：${stageLabel(level)}`,
        },
        {
          role: 'user',
          content: `动态（${nameOf(post.author)} 发的）：${post.text.slice(0, 600) || '（图片动态）'}${imagesText}\n评论区：\n${thread || '（暂无）'}\n\n【任务】${task}${imageNote ? `\n${imageNote}` : ''}`,
          ...(slots.length
            ? { images: slots.map((s) => ({ mediaId: s.mediaId, ownerUserId: s.ownerUserId })) }
            : {}),
        },
      ],
    };
    let result = await this.gateway.generateText(request);
    if (this.imageSearch && !job.privateConversationId)
      result = await this.imageSearch.refine(
        request,
        result,
        (next) => this.gateway.generateText(next),
        async () => {
          const fresh = await this.moments.getPostVisibleToCharacter(
            userId,
            post.postId,
            characterId,
          );
          return (
            !!fresh &&
            fresh.text === post.text &&
            JSON.stringify(fresh.images) === JSON.stringify(post.images) &&
            JSON.stringify(fresh.comments) === JSON.stringify(post.comments)
          );
        },
        own && !!job.mustReply,
      );
    if (!result.ok) return null;
    const parts = splitCaptionTail(result.value.text, slots.length);
    for (const [index, slot] of slots.entries()) {
      let caption = parts.captions[index];
      if (!caption || !this.captions) continue;
      caption = filterPeople(caption, [role.profile.name]);
      if (!outputAllowed(captionPhrase(caption), policy, false))
        caption = { ...caption, description: '画面含不适合日常聊天的内容', textInImage: '' };
      await this.captions
        .save({
          userId,
          mediaId: slot.mediaId,
          scope: 'normal',
          messageId: null,
          conversationId: null,
          caption,
          modelKey: result.value.modelKey,
        })
        .catch(() => undefined);
    }
    let text = parts.reply
      .trim()
      .replace(new RegExp(`^${role.profile.name}[：:]\\s*`), '')
      .slice(0, 200);
    const mentionsUser = text.includes(`@${userName}`);
    if (mentionsUser) text = text.replace(`@${userName}`, '').trim() || text;
    if (
      !text ||
      healthPrivate(text) ||
      !outputAllowed(text, policy, false) ||
      (policy.isRealPerson && MOMENTS_FORBIDDEN_REAL.test(text))
    )
      return null;
    return { text, mentionsUser, chargedMicros: result.value.chargedMicros };
  }
}
