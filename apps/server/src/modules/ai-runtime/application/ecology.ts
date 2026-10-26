/**
 * 角色生态 v1：统一循环（docs/product/input/2026-10-18-gm-ecology-vision.md；17 号；说明见 docs/ai/ecology-v1.md）。
 *
 * 定时唤醒 → 组装统一快照（聊天、记忆、朋友圈及评论、日子、TA 今天的生活、关系阶段、当前时间、积分）
 * → 决策模型从「已开启且此刻合适的动作工具」里挑一个或不动 → 执行（复用现有模块）
 * → 同一次调用产出一两句第一人称碎碎念（加密存储，只有用户本人能看）。
 *
 * - 决策模型由后台配置；未配置时不运行，不回退用户聊天模型。
 * - 每次唤醒和动作都走网关的积分冻结 / 结算（ecologyTask = true，不透支）；积分不足静默暂停，
 *   下次打开 App 的一次提示由 billing 记录（16 号 §8）。
 * - 说到做到（17 号 §7）：碎碎念只在动作真的执行成功时保留，失败改成中性一句；用户在聊天里让角色做的动作
 *   （发朋友圈、拍一拍、改状态、改签名）不受生态开关限制，PRO+ + 积分够就执行。
 */
import { ROMANCE_TITLE_STAGE, stageLabel } from '../domain/relationship-stage.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import {
  Id,
  type CharacterReadPort,
  type ChatReadPort,
  type ContactsReadPort,
  type EcologyActionKey,
  type EcologyCharacterProfile,
  type EcologyMurmur,
  type EcologyRunRecord,
  type EcologyRunStatus,
  type HolidayEventPort,
  type IdentityMembershipReadPort,
  type IdentityReadPort,
  type ModelGatewayPort,
  type MomentsPost,
  type MomentsReadPort,
  type PolicyPort,
  type BillingReadPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_SERVICE, type GrowthService } from '../../growth/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { MOMENTS_READ_PORT } from '../../moments/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { HOLIDAY_EVENT_PORT } from '../../proactive/index.js';
import {
  ACTION_DEF,
  detectUserRequest,
  microsToPoints,
  parseGateDecision,
  wakeSlots,
} from '../domain/ecology.js';
import { healthPrivate } from '../domain/memory.js';
import { ecologyProfiles, ecologyRuns } from '../infra/db/ecology-schema.js';
import { simulationStates, userChatActivity } from '../infra/db/schema.js';
import { EcologySettingsService } from './ecology-settings.js';
import { GroupChatService } from './group-chat.js';
import { MediaAiService } from './media-ai.js';
import { MemoryService } from './memory.js';
import { BrainContextService, brainMessages } from './brain.js';
import { SharedEpisodesService } from './shared-episodes.js';
import { MomentsAiService } from './moments-ai.js';
import {
  PLAY_WISH_PROPOSE_SOURCE,
  ProactiveChargeError,
  ProactiveSchedulerService,
  localParts,
} from './proactive-scheduler.js';
import { SimulationService } from './simulation.js';
import { SocialService } from './social.js';
import { ImageCaptionStore, NO_CAPTIONS } from './image-captions.js';
import { captionForMemory, captionSnapshot } from '../domain/image-caption.js';
import { WeiboSyncService } from './weibo.js';
import { snapshotText } from './content-text.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { characterView, rolePersonaSpeechText } from './character-view.js';

export const ECOLOGY_TICK_JOB = 'ai.ecology_tick';
export const ECOLOGY_USER_JOB = 'ai.ecology_user';
export const ECOLOGY_REQUEST_JOB = 'ai.ecology_request';
export const ECOLOGY_CLEANUP_JOB = 'ai.ecology_cleanup';

/** 每个用户每次调度最多唤醒几个角色（其余下一个 10 分钟再说，避免多个角色同时冒出来）。 */
const MAX_WAKES_PER_TICK = 2;
/** 你发了还没回的主动消息达到这个数，就不再给聊天类工具（不纠缠，17 号 §7、PRD SIM-05）。 */
const UNANSWERED_LIMIT = 2;
/** 用户 5 分钟内在聊天：不插聊天类动作（同 P-09）。 */
const BUSY_MS = 5 * 60_000;
const ABSENCE_MS = 72 * 3600_000;
const RUN_RETENTION_DAYS = 90;
/** 用户在聊天里让角色做的动作：回复发出后再执行。 */
const REQUEST_DELAY_MS = 90_000;

const CHAT_ACTIONS: ReadonlySet<EcologyActionKey> = new Set([
  'message',
  'greeting',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'share_link',
  'care_anniversary',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  'play_wish',
]);

/** 3.29：每轮最多执行几个动作。候选全部交给 Gate 评估；这里只防一轮刷屏。 */
const MAX_ACTIONS_PER_WAKE = 2;

/**
 * 3.29：动作正文由用户自己的场景模型生成；这里只给生成器一句**程序侧**的任务说明。
 * Gate（Jev）不再提供 brief/target/text，避免它越权写正文。
 */
const ACTION_BRIEF: Partial<Record<EcologyActionKey, string>> = {
  message: '主动给对方发一条私聊消息，结合你们最近的聊天和今天的情况，说一件具体的小事。',
  greeting: '跟对方道早安或晚安，结合今天的具体情况，不要用套话。',
  voice: '用一两句口语的话给对方发一条语音消息。',
  sticker: '发一个表情包，配一句很短的话。',
  share_link: '分享一个合适的作品链接，配一句为什么想分享。',
  care_anniversary: '今天是特别的日子，发一条表达心意的消息。',
  care_absence: '对方很久没来聊天，问候一句，不制造愧疚、不追问。',
  care_late_night: '对方深夜还活跃，催对方早点睡。',
  care_follow_up: '跟进对方之前提过的事，问问结果怎么样。',
  play_wish: '提议和对方一起完成一个小心愿。',
  moment_reply: '回复这条朋友圈评论，语气自然、简短。',
  group_talk: '主动在群里起一个自然的话头，结合最近聊天。',
};

interface ActionResult {
  ok: boolean;
  chargedMicros: number;
  reason?: string;
}

interface Snapshot {
  prefix: string;
  text: string;
  /**
   * H2（总经理 10-21 C14）：该角色正处于私密模式（会话内容范围 adult 且有资格）。
   * 期间生态的模型调用一律走该用户的私密模型；不发语音、不去群里说话（私密模式只开放文字与图片、仅单角色）。
   * 快照仍只读日常范围，私密内容不进生态。
   */
  privateMode: boolean;
  conversationId: string;
  tools: EcologyActionKey[];
  targets: Map<string, { postId?: string; commentId?: string; conversationId?: string }>;
  hasFollowUps: boolean;
  /** 3.29：这条微博已有可消费的图片；photo 用它走既有聊天媒体路径，不生图。 */
  weiboPhoto: { mediaId: string; updateId: string } | null;
}

type RunRow = typeof ecologyRuns.$inferSelect;

export interface EcologyRequestJob {
  userId: string;
  characterId: string;
  action: EcologyActionKey;
  messageId: string;
  text: string;
}

@Injectable()
export class EcologyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(EcologySettingsService) private readonly settings: EcologySettingsService,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(GROWTH_SERVICE) private readonly growth: GrowthService,
    @Inject(HOLIDAY_EVENT_PORT) private readonly holidays: HolidayEventPort,
    @Inject(MOMENTS_READ_PORT) private readonly moments: MomentsReadPort,
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(BrainContextService) private readonly brain: BrainContextService,
    @Inject(SharedEpisodesService) private readonly episodes: SharedEpisodesService,
    @Inject(SimulationService) private readonly simulation: SimulationService,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(ProactiveSchedulerService) private readonly proactive: ProactiveSchedulerService,
    @Inject(MomentsAiService) private readonly momentsAi: MomentsAiService,
    @Inject(MediaAiService) private readonly mediaAi: MediaAiService,
    @Inject(GroupChatService) private readonly groups: GroupChatService,
    @Inject(WeiboSyncService) private readonly weibo: WeiboSyncService,
    /** H3：图片描述存档。 */
    @Optional() @Inject(ImageCaptionStore) private readonly captions?: ImageCaptionStore,
  ) {}

  // =========================================================================
  // 调度
  // =========================================================================
  /** 每 10 分钟：给开着生态的用户各入队一次。 */
  async tick(): Promise<void> {
    const slot = Math.floor(this.clock.nowMs() / (10 * 60_000));
    for (const userId of await this.settings.enabledUserIds())
      await this.jobs.send(
        ECOLOGY_USER_JOB,
        { userId },
        { singletonKey: `ecology:${userId}:${slot}`, retryLimit: 0 },
      );
  }

  async cleanup(): Promise<void> {
    const now = this.clock.nowMs();
    await this.db.db
      .delete(ecologyRuns)
      .where(lt(ecologyRuns.createdAt, new Date(now - RUN_RETENTION_DAYS * 86400_000)));
    // 执行中途崩溃遗留的：标记失败（不补跑）。
    await this.db.db
      .update(ecologyRuns)
      .set({ status: 'failed', outcome: 'stale', finishedAt: new Date(now) })
      .where(
        and(
          inArray(ecologyRuns.status, ['scheduled', 'running']),
          lt(ecologyRuns.createdAt, new Date(now - 30 * 60_000)),
        ),
      );
  }

  /** 用户级：每个参与的角色只看「最近一个已到点、还没跑过」的唤醒时刻；错过的更早时刻不补。 */
  async runForUser(userId: string): Promise<void> {
    if (!(await this.settings.isActive(userId))) return;
    const config = await this.settings.config();
    if (!config.decisionModelKey) return; // 未配置决策模型：不运行（后台有提示）。
    const row = await this.settings.row(userId);
    const level = (row?.activityLevel ?? 'often') as keyof typeof config.levels;
    const profile = await this.identity.getProfile(userId);
    if (!profile) return;
    const now = this.clock.now();
    const local = localParts(now, profile.timeZone);
    const minute = local.hour * 60 + local.minute;
    const contacts = await this.contacts.listActiveContacts(userId).catch(() => []);
    let woke = 0;
    for (const contact of contacts) {
      if (woke >= MAX_WAKES_PER_TICK) break;
      if (!contact.conversationId) continue;
      if (!(await this.settings.characterEnabled(userId, contact.characterId))) continue;
      const slots = wakeSlots(
        userId,
        contact.characterId,
        local.date,
        config.levels[level],
        config.wakeWindow,
      );
      let due = -1;
      for (let i = 0; i < slots.length; i++) if (slots[i]! <= minute) due = i;
      if (due < 0) continue;
      const run = await this.claim(
        userId,
        contact.characterId,
        `slot:${local.date}:${due}`,
        'ecology',
        local.date,
      );
      if (!run) continue;
      woke++;
      await this.executeWake(run).catch(async (error: unknown) => {
        await this.finish(run.id, {
          status: 'failed',
          outcome: `error:${error instanceof Error ? error.message : 'unknown'}`.slice(0, 200),
        });
      });
    }
  }

  private async claim(
    userId: string,
    characterId: string,
    runKey: string,
    origin: 'ecology' | 'user_request',
    localDate: string,
  ): Promise<RunRow | null> {
    const now = this.clock.now();
    const [row] = await this.db.db
      .insert(ecologyRuns)
      .values({
        id: newId(),
        userId,
        characterId,
        origin,
        runKey: runKey.slice(0, 200),
        localDate,
        status: 'running',
        scheduledAt: now,
        startedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  private async finish(
    runId: string,
    patch: {
      status: EcologyRunStatus;
      outcome?: string | null;
      actionKey?: EcologyActionKey | null;
      actionSummary?: string | null;
      modelKey?: string | null;
      chargedMicros?: number;
      murmur?: { userId: string; text: string } | null;
      latencyMs?: number;
    },
    tx?: DbTx,
  ): Promise<void> {
    const murmurCiphertext = patch.murmur
      ? await this.crypto.seal(
          patch.murmur.userId,
          `ai:ecology:murmur:${runId}`,
          patch.murmur.text,
          tx,
        )
      : undefined;
    await (tx?.db ?? this.db.db)
      .update(ecologyRuns)
      .set({
        status: patch.status,
        ...(patch.outcome !== undefined ? { outcome: patch.outcome?.slice(0, 200) ?? null } : {}),
        ...(patch.actionKey !== undefined ? { actionKey: patch.actionKey } : {}),
        ...(patch.actionSummary !== undefined ? { actionSummary: patch.actionSummary } : {}),
        ...(patch.modelKey !== undefined ? { modelKey: patch.modelKey } : {}),
        ...(patch.chargedMicros !== undefined ? { chargedMicros: patch.chargedMicros } : {}),
        ...(patch.latencyMs !== undefined ? { latencyMs: patch.latencyMs } : {}),
        ...(murmurCiphertext ? { murmurCiphertext } : {}),
        finishedAt: this.clock.now(),
      })
      .where(eq(ecologyRuns.id, runId));
  }

  // =========================================================================
  // 一次唤醒
  // =========================================================================
  /**
   * 3.29：一次唤醒只调一次 Gate（Jev），对**全部候选动作**逐项回答 yes/no；
   * 不生成正文 / 状态签名 / 碎碎念 / 长规划。执行最多 MAX_ACTIONS_PER_WAKE 个动作，
   * 真正内容由各动作对应的用户场景模型完成。
   */
  private async executeWake(run: RunRow): Promise<void> {
    const started = this.clock.nowMs();
    const { userId, characterId } = run;
    const config = await this.settings.config();
    if (!config.decisionModelKey)
      return this.finish(run.id, { status: 'skipped', outcome: 'model_not_configured' });
    const snapshot = await this.buildSnapshot(run);
    if (!snapshot)
      return this.finish(run.id, { status: 'skipped', outcome: 'context_unavailable' });
    if (!snapshot.tools.length) {
      return this.finish(run.id, {
        status: 'idle',
        outcome: 'no_action',
        actionKey: null,
        actionSummary: '看了看手机，没做什么',
        chargedMicros: 0,
        latencyMs: this.clock.nowMs() - started,
      });
    }
    const result = await this.gateway.generateText({
      userId,
      characterId,
      // Gate 永远是后台配置的 Jev（唯一决策模型）；不做用户 chat 兜底，也不带私密原文。
      purpose: 'behavior_planning',
      modelRole: 'background',
      modelKeyOverride: config.decisionModelKey,
      billingOwner: 'user',
      countAsBackground: true,
      ecologyTask: true,
      responseFormat: 'json',
      maxOutputTokens: config.decisionMaxOutputTokens,
      temperature: 0.2,
      idempotencyKey: `eco:${run.id}:gate`,
      meta: {
        promptTemplateVersion: 'ecology-v3-gate',
        stablePrefixChars: snapshot.prefix.length,
      },
      messages: [
        { role: 'system', content: snapshot.prefix },
        { role: 'system', content: DECISION_SYSTEM },
        { role: 'user', content: snapshot.text },
      ],
    });
    if (!result.ok) {
      if (result.error === 'insufficient_balance' || result.error === 'budget_exceeded') {
        if (result.error === 'insufficient_balance')
          await this.settings.pause(userId, 'insufficient_balance');
        return this.finish(run.id, { status: 'paused', outcome: result.error });
      }
      return this.finish(run.id, { status: 'failed', outcome: `model_${result.error}` });
    }
    let charged = result.value.chargedMicros;
    const gate = parseGateDecision(result.value.text);
    if (!gate)
      return this.finish(run.id, {
        status: 'failed',
        outcome: 'bad_output',
        modelKey: result.value.modelKey,
        chargedMicros: charged,
        latencyMs: this.clock.nowMs() - started,
      });
    const approved = snapshot.tools
      .filter((action) =>
        gate.decisions.some((decision) => decision.action === action && decision.do === true),
      )
      .slice(0, MAX_ACTIONS_PER_WAKE);
    if (!approved.length) {
      return this.finish(run.id, {
        status: 'idle',
        outcome: 'no_action',
        actionKey: null,
        actionSummary: '看了看手机，没做什么',
        modelKey: result.value.modelKey,
        chargedMicros: charged,
        // Gate 不再写碎碎念；这里不伪造第一人称内容。
        murmur: null,
        latencyMs: this.clock.nowMs() - started,
      });
    }
    const done: Array<{ action: EcologyActionKey; result: ActionResult }> = [];
    for (const action of approved) {
      const outcome = await this.perform(run, action, snapshot).catch(
        (error: unknown): ActionResult => ({
          ok: false,
          chargedMicros: error instanceof ProactiveChargeError ? error.chargedMicros : 0,
          reason: error instanceof Error ? error.message : 'error',
        }),
      );
      charged += outcome.chargedMicros;
      done.push({ action, result: outcome });
      if (!outcome.ok && /insufficient_balance/.test(outcome.reason ?? ''))
        await this.settings.pause(userId, 'insufficient_balance');
    }
    if (
      approved.length === 1 &&
      approved[0] === 'weibo_sync' &&
      done[0]?.result.reason === 'no_new_public_posts'
    )
      return this.finish(run.id, {
        status: 'idle',
        outcome: 'no_new_public_posts',
        actionKey: 'weibo_sync',
        actionSummary: '看了看微博，暂时没有新动态',
        modelKey: result.value.modelKey,
        chargedMicros: charged,
        murmur: null,
        latencyMs: this.clock.nowMs() - started,
      });
    const succeeded = done.filter((item) => item.result.ok);
    const summaries = done.map(({ action, result: r }) => {
      const def = ACTION_DEF.get(action)!;
      return r.ok ? def.summary : `${def.label}没做成`;
    });
    await this.finish(run.id, {
      status: succeeded.length ? 'done' : 'failed',
      outcome: succeeded.length
        ? 'sent'
        : `executor_failed:${done.map((item) => item.result.reason ?? 'unknown').join(',')}`.slice(
            0,
            200,
          ),
      // 多个动作时单条 actionKey 会误导；用 null，动作明细在 actionSummary。
      actionKey: approved.length === 1 ? approved[0] : null,
      actionSummary: summaries.join('；').slice(0, 500),
      modelKey: result.value.modelKey,
      chargedMicros: charged,
      murmur: null,
      latencyMs: this.clock.nowMs() - started,
    });
  }

  /** 执行一个动作（复用现有模块）。Gate 只决定做不做，内容参数由程序/用户场景模型决定。 */
  private async perform(
    run: RunRow,
    action: EcologyActionKey,
    snapshot: Snapshot,
  ): Promise<ActionResult> {
    const { userId, characterId } = run;
    // Gate 不写正文；这里只给用户场景模型一句程序侧说明，target 由程序从快照里选。
    const brief = (ACTION_BRIEF[action] ?? ACTION_DEF.get(action)?.tool ?? '').slice(0, 500);
    const targetWith = (field: 'postId' | 'commentId' | 'conversationId') =>
      [...snapshot.targets.values()].find((target) => target[field]);
    const viaChat = async (extra: 'voice' | 'sticker' | 'link' | null, greeting = false) => {
      const r = await this.proactive.sendEcology({
        userId,
        characterId,
        runId: run.id,
        brief,
        extras: { extra, greeting },
      });
      return r.ok
        ? { ok: true, chargedMicros: r.chargedMicros }
        : { ok: false, chargedMicros: r.chargedMicros ?? 0, reason: r.reason };
    };
    switch (action) {
      case 'weibo_sync':
        return this.weibo.run(userId, characterId);
      case 'message':
      case 'care_anniversary':
      case 'care_absence':
      case 'care_late_night':
      case 'care_follow_up':
        return viaChat(null);
      case 'greeting':
        return viaChat(null, true);
      case 'voice':
        return viaChat('voice');
      case 'photo': {
        // 3.29：只投递该条微博已审核的图片，走既有聊天媒体路径；不生图、不扣图片生成费。
        if (!snapshot.weiboPhoto) return { ok: false, chargedMicros: 0, reason: 'no_material' };
        const r = await this.proactive.sendEcology({
          userId,
          characterId,
          runId: run.id,
          brief,
          extras: { extra: 'photo', photoMediaId: snapshot.weiboPhoto.mediaId },
          dedupeKey: `weibo-photo:${snapshot.weiboPhoto.updateId}:${userId}`,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: r.chargedMicros ?? 0, reason: r.reason };
      }
      case 'sticker':
        return viaChat('sticker');
      case 'share_link':
        return viaChat('link');
      case 'nudge': {
        const r = await this.proactive.sendNudge(userId, characterId, run.id);
        return r.ok
          ? { ok: true, chargedMicros: 0 }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'play_wish': {
        const profile = await this.identity.getProfile(userId);
        const local = localParts(this.clock.now(), profile?.timeZone ?? 'Asia/Shanghai');
        const r = await this.proactive.sendEcology({
          userId,
          characterId,
          runId: run.id,
          brief,
          extras: { extra: null },
          sourceRef: `${PLAY_WISH_PROPOSE_SOURCE}${characterId}:${mondayOf(local.date)}`,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'moment_post': {
        const r = await this.momentsAi.postForEcology({ userId, characterId, runId: run.id });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'moment_interact':
      case 'moment_peer': {
        const post = targetWith('postId');
        if (!post?.postId) return { ok: false, chargedMicros: 0, reason: 'no_target' };
        // 点赞不生成文字、不调模型；评论留给用户场景模型，这里先按点赞执行。
        const r = await this.momentsAi.reactForEcology({
          userId,
          postId: post.postId,
          characterId,
          action: 'like',
          like: true,
          ecologyRunId: run.id,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'moment_reply': {
        const comment = targetWith('commentId');
        if (!comment?.postId || !comment.commentId)
          return { ok: false, chargedMicros: 0, reason: 'no_target' };
        const r = await this.momentsAi.reactForEcology({
          userId,
          postId: comment.postId,
          characterId,
          action: 'reply',
          replyToCommentId: comment.commentId,
          ecologyRunId: run.id,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'status':
      case 'signature': {
        // 3.29：状态/签名由用户自己的 chat 场景模型写，不用 Gate 输出的 text。
        const generated = await this.generateProfileText(userId, characterId, action);
        if (!generated) return { ok: false, chargedMicros: 0, reason: 'no_text' };
        await this.saveProfileText(userId, characterId, action, generated.text);
        return { ok: true, chargedMicros: generated.chargedMicros };
      }
      case 'group_talk': {
        const group = targetWith('conversationId');
        if (!group?.conversationId) return { ok: false, chargedMicros: 0, reason: 'no_target' };
        const r = await this.groups.startTopicForEcology({
          userId,
          characterId,
          conversationId: group.conversationId,
          topic: brief,
        });
        // 群里各条消息的费用记在消息上，这里拿不到合计。
        return r.ok
          ? { ok: true, chargedMicros: 0 }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      default:
        return { ok: false, chargedMicros: 0, reason: 'not_implemented' };
    }
  }

  /**
   * 3.29：用**用户自己的 chat 场景模型**写状态/签名；Gate（Jev）不再输出 text。
   * 返回 null = 用户没配 chat 模型 / 生成失败 / 内容不安全，不做任何替换模型。
   */
  private async generateProfileText(
    userId: string,
    characterId: string,
    action: 'status' | 'signature',
    hint?: string,
  ): Promise<{ text: string; chargedMicros: number } | null> {
    const role = await this.characters.getForRuntime(userId, characterId);
    if (!role) return null;
    const r = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'text',
      maxOutputTokens: 60,
      idempotencyKey: `eco:profile:${userId}:${characterId}:${action}:${this.clock.nowMs()}`,
      messages: [
        {
          role: 'system',
          content: `你是「${role.profile.name}」，人设：${
            role.card
              ? JSON.stringify(role.card.data.persona).slice(0, 1500)
              : rolePersonaSpeechText(characterView(role), 1500)
          }。只输出${action === 'status' ? '一个不超过 12 个字的状态（例「在听歌」）' : '一句不超过 30 个字的个性签名'}，不加引号。`,
        },
        ...(hint ? [{ role: 'user' as const, content: hint.slice(0, 200) }] : []),
      ],
    });
    if (!r.ok) return null;
    const text = r.value.text
      .trim()
      .replace(/^["「『]|["」』]$/g, '')
      .slice(0, action === 'status' ? 12 : 30);
    if (!text || healthPrivate(text)) return null;
    return { text, chargedMicros: r.value.chargedMicros };
  }

  private async saveProfileText(
    userId: string,
    characterId: string,
    action: 'status' | 'signature',
    text: string,
  ): Promise<void> {
    const now = this.clock.now();
    const set =
      action === 'status'
        ? { statusText: text, statusUpdatedAt: now }
        : { signature: text, signatureUpdatedAt: now };
    await this.db.db
      .insert(ecologyProfiles)
      .values({ userId, characterId, ...set })
      .onConflictDoUpdate({ target: [ecologyProfiles.userId, ecologyProfiles.characterId], set });
    await this.episodes.record(null, {
      userId,
      characterId,
      kind: 'profile_changed',
      sourceType: `profile-${action}`,
      sourceId: `${now.toISOString()}:${text}`,
      text: `我把${action === 'status' ? '状态' : '签名'}改成了「${text}」。`,
      scope: 'normal',
    });
  }

  // =========================================================================
  // 统一快照
  // =========================================================================
  private async buildSnapshot(run: RunRow): Promise<Snapshot | null> {
    const { userId, characterId } = run;
    const [profile, role, policy, contact] = await Promise.all([
      this.identity.getProfile(userId),
      this.characters.getForRuntime(userId, characterId),
      this.policy.getCharacterPolicy(userId, characterId),
      this.contacts.getActiveContact(userId, characterId),
    ]);
    if (!profile || !role || !policy || !contact?.conversationId) return null;
    const conversation = await this.chat.getConversation(contact.conversationId).catch(() => null);
    const privateMode = conversation?.contentScope === 'adult' && policy.adultModeEligible;
    // Decision inputs remain normal-scope, even when H2 routes them to the private model.
    const brain = await this.brain.build(userId, characterId, 'normal', '', {
      compact: true,
      excludeHealth: true,
    });
    if (!brain) return null;
    const prefix = brainMessages(brain, privateMode ? 'adult' : 'background')[0]!.content;
    const config = await this.settings.config();
    const userRow = await this.settings.row(userId);
    const disabled = new Set(userRow?.disabledActions ?? []);
    const now = this.clock.now();
    const nowMs = now.getTime();
    const local = localParts(now, profile.timeZone);
    const weekday = '日一二三四五六'[new Date(`${local.date}T12:00:00Z`).getUTCDay()];
    const level = await this.growth
      .getFamiliarity(userId, characterId)
      .then((f) => f.level)
      .catch(() => 1);
    const lines: string[] = [];
    const targets: Snapshot['targets'] = new Map();

    lines.push(
      `【现在】对方当地时间 ${local.date} 周${weekday} ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}（${profile.timeZone}）`,
    );
    lines.push(
      `【你们】好感度：${stageLabel(level)}（粉丝 → 朋友 → 亲密好友 → 暧昧 → 恋人 → 伴侣，越往后越亲密）；${policy.romanceAllowed && !policy.isMinor ? '' : '不涉及恋爱暧昧；'}对方称呼：${profile.nickname ?? '对方'}`,
    );

    // 聊天：最近 12 条；你发了还没回的条数；对方最近活跃。
    const history = await this.chat
      .readMessages({ conversationId: contact.conversationId, scopes: ['normal'], limit: 30 })
      .catch(() => []);
    const visible = history.filter((m) => m.senderKind !== 'system' && m.status === 'normal');
    let unanswered = 0;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i]!.senderKind === 'user') break;
      unanswered++;
    }
    const lastUser = [...visible].reverse().find((m) => m.senderKind === 'user');
    const sinceUserMs = lastUser ? nowMs - Date.parse(lastUser.createdAt) : Infinity;
    // H3：图片 / 用户自己的表情用描述存档（日常范围）。
    const chatCaptions =
      (await this.captions
        ?.forMessages(userId, visible.slice(-12), ['normal'])
        .catch(() => null)) ?? NO_CAPTIONS;
    const chatLines = visible.slice(-12).map((m) => {
      const who = m.senderKind === 'user' ? '对方' : '你';
      const body =
        m.content?.type === 'text'
          ? m.content.text.slice(0, 120)
          : m.content?.type === 'voice'
            ? `[语音]${m.content.transcript?.slice(0, 80) ?? ''}`
            : (m.content?.type === 'image' && chatCaptions.has(m.content.mediaId)) ||
                (m.content?.type === 'sticker' &&
                  !m.content.description &&
                  chatCaptions.has(m.content.mediaId))
              ? snapshotText(m.content, chatCaptions).slice(0, 160)
              : `[${m.content?.type ?? '消息'}]`;
      return `${who}（${ago(nowMs - Date.parse(m.createdAt))}）：${body}`;
    });
    lines.push(`【最近聊天】${chatLines.length ? `\n${chatLines.join('\n')}` : '还没怎么聊过'}`);
    lines.push(
      `对方上次找你：${lastUser ? ago(sinceUserMs) : '很久以前'}；你发了对方还没回的消息：${unanswered} 条`,
    );
    const [activity] = await this.db.db
      .select({ at: sql<Date>`max(${userChatActivity.lastAt})` })
      .from(userChatActivity)
      .where(eq(userChatActivity.userId, userId));
    const lastAppMs = activity?.at ? nowMs - new Date(activity.at).getTime() : Infinity;
    const [state] = await this.db.db
      .select({ at: simulationStates.lastActiveAt })
      .from(simulationStates)
      .where(
        and(eq(simulationStates.userId, userId), eq(simulationStates.characterId, characterId)),
      );
    const absenceMs = state ? nowMs - state.at.getTime() : 0;

    // 记忆（日常范围、不含健康隐私）。
    const memories = await this.memory
      .list(userId, characterId, { limit: 60 })
      .then((r) => r.items)
      .catch(() => []);
    const usable = memories.filter(
      (m) => m.scope === 'normal' && m.status === 'current' && !healthPrivate(m.content),
    );
    const followUps = usable.filter((m) => m.category === 'commitment');

    // 日子：节日、生日、纪念日。
    const special: string[] = [];
    const holidays = await this.holidays.getUpcomingForUser(userId, 1).catch(() => []);
    for (const h of holidays)
      // 3.27（H1）：恋爱节日只对好感度到「恋人」阶段的角色（不再看手选的关系类型）。
      if (h.daysAhead === 0 && (!h.romantic || level >= ROMANCE_TITLE_STAGE))
        special.push(`今天是${h.name}`);
    if (profile.birthday && profile.birthday.slice(5) === local.date.slice(5))
      special.push('今天是对方生日');
    const known = await this.growth.getDaysKnown(userId, characterId).catch(() => null);
    for (const a of known?.anniversaries ?? [])
      if (a.nextOccurrence === local.date) special.push(`今天是你们的纪念日「${a.label}」`);
    if (known) special.push(`你们认识第 ${known.daysKnown} 天`);
    lines.push(`【日子】${special.join('；') || '普通的一天'}`);

    // TA 今天的生活（推演）。
    const events = await this.simulation
      .getDailyEvents(userId, characterId, local.date)
      .catch(() => []);
    if (events.length)
      lines.push(
        `【你今天的生活】\n${events
          .slice(0, 5)
          .map((e) => `- ${e.summary}`)
          .join('\n')}`,
      );

    // 朋友圈。
    const since = new Date(nowMs - 7 * 86400_000).toISOString();
    const mine = await this.moments.listCharacterPosts(userId, characterId, since).catch(() => []);
    const userPosts = await this.moments
      .listUserPostsVisibleTo(userId, characterId, since)
      .catch(() => [] as MomentsPost[]);
    const momentLines: string[] = [];
    let c = 0;
    for (const p of mine.slice(0, 3)) {
      momentLines.push(
        `你的动态（${ago(nowMs - Date.parse(p.createdAt))}）：${p.text.slice(0, 80)}`,
      );
      const replied = new Set(
        p.comments
          .filter((x) => x.author.kind === 'character' && x.author.refId === characterId)
          .map((x) => x.replyToCommentId),
      );
      for (const cm of p.comments.slice(-5)) {
        if (cm.author.kind === 'character' && cm.author.refId === characterId) continue;
        if (replied.has(cm.commentId)) continue;
        const key = `C${++c}`;
        targets.set(key, { postId: p.postId, commentId: cm.commentId });
        momentLines.push(
          `  ${key} 还没回的评论（${cm.author.kind === 'user' ? '对方' : '朋友'}）：${cm.text.slice(0, 60)}`,
        );
      }
    }
    let u = 0;
    for (const p of userPosts.slice(0, 3)) {
      const interacted =
        p.likes.some((l) => l.kind === 'character' && l.refId === characterId) ||
        p.comments.some((x) => x.author.kind === 'character' && x.author.refId === characterId);
      if (interacted) continue;
      const key = `U${++u}`;
      targets.set(key, { postId: p.postId });
      const pics =
        (await this.captions
          ?.load(
            userId,
            p.images.map((i) => i.mediaId),
            ['normal'],
          )
          .catch(() => null)) ?? NO_CAPTIONS;
      const picText = p.images
        .map((i) => pics.get(i.mediaId))
        .filter((c) => !!c && captionForMemory(c))
        .map((c) => captionSnapshot(c!))
        .join(' ')
        .slice(0, 160);
      momentLines.push(
        `${key} 对方的动态（${ago(nowMs - Date.parse(p.createdAt))}，你还没互动）：${p.text.slice(0, 80) || (picText ? '' : '（图片）')}${picText ? ` ${picText}` : ''}`,
      );
    }
    let pc = 0;
    const related = await this.social
      .relatedContacts(userId, characterId)
      .catch(() => ({ added: [] }));
    for (const r of related.added.slice(0, 4)) {
      const posts = await this.moments
        .listCharacterPosts(userId, r.characterId, since)
        .catch(() => []);
      const p = posts[0];
      if (!p) continue;
      if (p.likes.some((l) => l.kind === 'character' && l.refId === characterId)) continue;
      const key = `P${++pc}`;
      targets.set(key, { postId: p.postId });
      momentLines.push(`${key} 朋友的动态：${p.text.slice(0, 60)}`);
    }
    if (momentLines.length) lines.push(`【朋友圈】\n${momentLines.join('\n')}`);

    // 群。
    const groups = await this.groups.ecologyGroups(userId, characterId).catch(() => []);
    groups.slice(0, 3).forEach((g, i) => {
      targets.set(`G${i + 1}`, { conversationId: g.conversationId });
    });
    if (groups.length)
      lines.push(
        `【你在的群】${groups
          .slice(0, 3)
          .map((g, i) => `G${i + 1} ${g.title}`)
          .join('；')}`,
      );

    // 你的状态与签名、今天已经做过的。
    const [ep] = await this.db.db
      .select()
      .from(ecologyProfiles)
      .where(and(eq(ecologyProfiles.userId, userId), eq(ecologyProfiles.characterId, characterId)));
    if (ep?.statusText || ep?.signature)
      lines.push(`【你的资料】状态：${ep?.statusText ?? '无'}；签名：${ep?.signature ?? '无'}`);
    const today = await this.db.db
      .select({
        summary: ecologyRuns.actionSummary,
        at: ecologyRuns.createdAt,
        action: ecologyRuns.actionKey,
      })
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.userId, userId),
          eq(ecologyRuns.characterId, characterId),
          eq(ecologyRuns.localDate, local.date),
          inArray(ecologyRuns.status, ['done', 'idle']),
        ),
      )
      .orderBy(desc(ecologyRuns.createdAt))
      .limit(10);
    if (today.length)
      lines.push(
        `【你今天已经做过】${today.map((t) => `${ago(nowMs - t.at.getTime())}${t.summary ?? ''}`).join('；')}`,
      );
    const spend = await this.billing.getSpendStatus(userId).catch(() => null);
    lines.push(
      `【对方的积分】${spend && spend.availableMicros > 2_000_000 ? '充足' : '偏少（尽量少做花钱的事）'}`,
    );

    // 可用工具：开着、平台可执行、此刻合适。
    const chatBlocked = unanswered >= UNANSWERED_LIMIT || sinceUserMs < BUSY_MS;
    const lateNight = local.hour >= 23 || local.hour < 4;
    const tools: EcologyActionKey[] = [];
    const stickers = await this.mediaAi.hasStickers(characterId).catch(() => false);
    const works = (await this.mediaAi.listShareableWorks(characterId).catch(() => [])).length > 0;
    const signatureRecent =
      ep?.signatureUpdatedAt && nowMs - ep.signatureUpdatedAt.getTime() < 3 * 86400_000;
    const weiboReady = await this.weibo.offer(userId, characterId).catch(() => false);
    // 3.29：moment_post 只同步已存在的微博原文/素材；没有素材就不提供该候选（不 AI 编）。
    const momentMaterial = await this.momentsAi
      .hasWeiboMaterial(userId, characterId)
      .catch(() => false);
    const weiboPhoto = await this.momentsAi
      .weiboPhotoForEcology(userId, characterId)
      .catch(() => null);
    for (const def of ACTION_DEF.values()) {
      if (def.mode !== 'decision') continue;
      if (disabled.has(def.key)) continue;
      if (await this.settings.actionAvailable(def.key, config)) continue;
      if (CHAT_ACTIONS.has(def.key) && chatBlocked) continue;
      // H2：私密模式只开放文字与图片（不发语音），且仅单角色（不去群里说话）。
      if (privateMode && (def.key === 'voice' || def.key === 'group_talk')) continue;
      const ok = (() => {
        switch (def.key) {
          case 'weibo_sync':
            return weiboReady;
          case 'moment_post':
            return momentMaterial;
          case 'photo':
            // 3.29：只发该条微博已审核图片；没有图就不提供，不 AI 生图/不用风景图。
            return Boolean(weiboPhoto);
          case 'greeting':
            return (local.hour >= 6 && local.hour < 10) || local.hour >= 21 || local.hour < 1;
          case 'care_late_night':
            return lateNight && lastAppMs < 30 * 60_000;
          case 'care_absence':
            return absenceMs >= ABSENCE_MS;
          case 'care_anniversary':
            return special.some((s) => s.startsWith('今天是'));
          case 'care_follow_up':
            return followUps.length > 0;
          case 'sticker':
            return stickers;
          case 'share_link':
            return works;
          case 'moment_interact':
            return u > 0;
          case 'moment_reply':
            return c > 0;
          case 'moment_peer':
            return pc > 0;
          case 'group_talk':
            return groups.length > 0;
          case 'signature':
            return !signatureRecent;
          default:
            return true;
        }
      })();
      if (ok) tools.push(def.key);
    }
    lines.push(
      `【这次可以做的】（对每个动作只回答 do=true/false；不要写正文、状态签名或碎碎念）\n${tools
        .map((k) => `- ${k}：${ACTION_DEF.get(k)!.tool}`)
        .join('\n')}`,
    );
    if (CHAT_ACTIONS.has('message') && chatBlocked)
      lines.push(
        sinceUserMs < BUSY_MS
          ? '（对方正在和你聊天，这次不主动发私聊消息。）'
          : '（你发的消息对方还没回，这次不再发私聊消息，别纠缠。）',
      );
    if (level < 3)
      lines.push(
        '（好感度还不到「亲密好友」：发消息要有具体内容，不要「在干嘛」「想你了」这类空话。）',
      );
    return {
      text: lines.join('\n'),
      prefix,
      privateMode,
      conversationId: contact.conversationId,
      tools,
      targets,
      hasFollowUps: followUps.length > 0,
      weiboPhoto,
    };
  }

  // =========================================================================
  // 用户在聊天里让角色做的动作（说到做到，17 号 §7）
  // =========================================================================
  private canExecuteRequest(userId: string, action: EcologyActionKey): Promise<boolean> {
    return this.settings.canExecuteRequest(userId, action);
  }

  /** chat.message_created（私聊用户文字）：识别请求并排队执行。 */
  async onUserMessage(
    tx: DbTx,
    input: { userId: string; characterId: string; text: string; messageId: string },
  ): Promise<void> {
    const action = detectUserRequest(input.text);
    if (!action) return;
    if (!(await this.canExecuteRequest(input.userId, action))) return;
    await this.jobs.send(
      ECOLOGY_REQUEST_JOB,
      { ...input, text: input.text.slice(0, 200), action } satisfies EcologyRequestJob,
      { tx, delayMs: REQUEST_DELAY_MS, singletonKey: `eco-req:${input.messageId}`, retryLimit: 1 },
    );
  }

  async runRequest(job: EcologyRequestJob): Promise<void> {
    if (!(await this.canExecuteRequest(job.userId, job.action))) return;
    if (!(await this.contacts.getActiveContact(job.userId, job.characterId))) return;
    const profile = await this.identity.getProfile(job.userId);
    const local = localParts(this.clock.now(), profile?.timeZone ?? 'Asia/Shanghai');
    const run = await this.claim(
      job.userId,
      job.characterId,
      `req:${job.messageId}:${job.action}`,
      'user_request',
      local.date,
    );
    if (!run) return;
    const started = this.clock.nowMs();
    let result: ActionResult;
    if (job.action === 'moment_post') {
      const r = await this.momentsAi.postForEcology({
        userId: job.userId,
        characterId: job.characterId,
        runId: run.id,
      });
      result = r.ok
        ? { ok: true, chargedMicros: r.chargedMicros }
        : { ok: false, chargedMicros: 0, reason: r.reason };
    } else if (job.action === 'nudge') {
      const r = await this.proactive.sendNudge(job.userId, job.characterId, run.id);
      result = r.ok
        ? { ok: true, chargedMicros: 0 }
        : { ok: false, chargedMicros: 0, reason: r.reason };
    } else if (job.action === 'status' || job.action === 'signature') {
      result = await this.requestProfileText(job);
    } else result = { ok: false, chargedMicros: 0, reason: 'not_supported' };
    const def = ACTION_DEF.get(job.action)!;
    await this.finish(run.id, {
      status: result.ok ? 'done' : 'failed',
      outcome: result.ok ? 'sent' : `executor_failed:${result.reason ?? 'unknown'}`,
      actionKey: job.action,
      actionSummary: result.ok ? `你让 TA ${def.label}` : '没做成',
      chargedMicros: result.chargedMicros,
      latencyMs: this.clock.nowMs() - started,
    });
  }

  /** 改状态 / 签名：用用户自己的 chat 场景模型写一句（不用 Gate/Jev 文本）。 */
  private async requestProfileText(job: EcologyRequestJob): Promise<ActionResult> {
    const generated = await this.generateProfileText(
      job.userId,
      job.characterId,
      job.action as 'status' | 'signature',
      `对方在聊天里让你改${job.action === 'status' ? '状态' : '签名'}，对方的原话：「${job.text}」`,
    );
    if (!generated) return { ok: false, chargedMicros: 0, reason: 'model_unavailable_or_unsafe' };
    await this.saveProfileText(
      job.userId,
      job.characterId,
      job.action as 'status' | 'signature',
      generated.text,
    );
    return { ok: true, chargedMicros: generated.chargedMicros };
  }

  // =========================================================================
  // 用户端读取
  // =========================================================================
  async listMurmurs(
    userId: string,
    characterId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: EcologyMurmur[]; nextCursor: string | null }> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      throw new AppError('not_found', '好友不存在');
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.db
      .select()
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.userId, userId),
          eq(ecologyRuns.characterId, characterId),
          isNotNull(ecologyRuns.murmurCiphertext),
          cursor
            ? or(
                lt(ecologyRuns.createdAt, cursor.at),
                and(eq(ecologyRuns.createdAt, cursor.at), lt(ecologyRuns.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(ecologyRuns.createdAt), desc(ecologyRuns.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const items: EcologyMurmur[] = [];
    for (const row of page) {
      const plain = await this.crypto
        .open(userId, `ai:ecology:murmur:${row.id}`, row.murmurCiphertext!)
        .catch(() => null);
      if (!plain) continue;
      const text = plain.toString('utf8').slice(0, 200);
      plain.fill(0);
      items.push({
        murmurId: row.id,
        characterId,
        text,
        actionKey: (row.actionKey as EcologyActionKey | null) ?? null,
        actionSummary: (row.actionSummary ?? '看了看手机，没做什么').slice(0, 60),
        points: microsToPoints(row.chargedMicros),
        origin: row.origin === 'user_request' ? 'user_request' : 'ecology',
        createdAt: row.createdAt.toISOString(),
      });
    }
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    };
  }

  async getCharacterProfile(userId: string, characterId: string): Promise<EcologyCharacterProfile> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      throw new AppError('not_found', '好友不存在');
    const [row] = await this.db.db
      .select()
      .from(ecologyProfiles)
      .where(and(eq(ecologyProfiles.userId, userId), eq(ecologyProfiles.characterId, characterId)));
    return {
      characterId,
      statusText: row?.statusText ?? null,
      statusUpdatedAt: row?.statusUpdatedAt?.toISOString() ?? null,
      signature: row?.signature ?? null,
      signatureUpdatedAt: row?.signatureUpdatedAt?.toISOString() ?? null,
      ecologyEnabled: await this.settings.characterEnabled(userId, characterId),
    };
  }

  // =========================================================================
  // 管理端
  // =========================================================================
  async listRuns(query: {
    userId?: string;
    status?: EcologyRunStatus;
    cursor?: string;
    limit: number;
  }): Promise<{ items: EcologyRunRecord[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.db
      .select()
      .from(ecologyRuns)
      .where(
        and(
          query.userId ? eq(ecologyRuns.userId, query.userId) : undefined,
          query.status ? eq(ecologyRuns.status, query.status) : undefined,
          cursor
            ? or(
                lt(ecologyRuns.createdAt, cursor.at),
                and(eq(ecologyRuns.createdAt, cursor.at), lt(ecologyRuns.id, cursor.id)),
              )
            : undefined,
          gte(ecologyRuns.createdAt, new Date(this.clock.nowMs() - RUN_RETENTION_DAYS * 86400_000)),
        ),
      )
      .orderBy(desc(ecologyRuns.createdAt), desc(ecologyRuns.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        runId: r.id,
        userId: r.userId,
        characterId: r.characterId,
        origin: r.origin === 'user_request' ? 'user_request' : 'ecology',
        status: r.status as EcologyRunStatus,
        actionKey: (r.actionKey as EcologyActionKey | null) ?? null,
        outcome: r.outcome,
        modelKey: r.modelKey,
        points: microsToPoints(r.chargedMicros),
        latencyMs: r.latencyMs,
        scheduledAt: r.scheduledAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > query.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    };
  }
}

const DECISION_SYSTEM = `你是「这次要不要做」的决定器，只做选择，不写任何正文。
规则：
- 对「这次可以做的」里的每一个动作，分别回答 do=true 或 do=false；只能使用给出的动作名。
- 像真人一样克制：大多数时候只有一两个 true，其余 false；深夜一般不打扰（除非催睡觉）。
- 不涉及未成年人的恋爱或性内容；真人角色不编造本人公开声明。
- 不写聊天内容、状态、签名、碎碎念、理由或长规划；执行时由角色自己的模板/模型完成内容。
只输出一个 JSON 对象，不要别的文字：
{"decisions":[{"action":"<动作名>","do":true},{"action":"<动作名>","do":false}]}`;

function ago(ms: number): string {
  if (!Number.isFinite(ms)) return '很久以前';
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function mondayOf(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function decodeCursor(raw?: string): { at: Date; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split('|');
  if (!at || !id || !Id.safeParse(id).success || Number.isNaN(Date.parse(at)))
    throw new AppError('bad_request', '无效的翻页参数');
  return { at: new Date(at), id };
}
