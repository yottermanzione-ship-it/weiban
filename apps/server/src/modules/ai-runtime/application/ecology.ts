/**
 * 角色生态 v1：统一循环（docs/product/input/2026-10-18-gm-ecology-vision.md；17 号；说明见 docs/ai/ecology-v1.md）。
 *
 * 批 EJ（docs/ai/2026-10-23-ecology-native-decision-spec.md §四、ADR-20261024）：
 * 定时唤醒 → 程序预筛「已开启、此刻可做、用户对应模型可用」的候选（固定 ID）
 * → 一次原生判定请求（ModelGatewayMediaPort.decide，后台选的 Jev）批量问每个候选做不做
 * → 低把握 / 超时 / 陌生 ID 一律不做，程序排互斥与过度打扰 → 用户自己选的模型逐项执行 → 成功才记「已做」。
 * Jev 只收净化后的数字 / 布尔特征和固定题干，不收聊天、记忆、人设或私密原文；不写任何内容。
 *
 * - 决策模型由后台配置且必须是 Jev 类判定模型；未配置时不运行，不回退文字模型判定。
 * - 每次唤醒和动作都走网关的积分冻结 / 结算（ecologyTask = true，不透支）；积分不足静默暂停，
 *   下次打开 App 的一次提示由 billing 记录（16 号 §8）。
 * - 说到做到（17 号 §7）：碎碎念只在动作真的执行成功时保留，失败改成中性一句；用户在聊天里让角色做的动作
 *   （发朋友圈、拍一拍、改状态、改签名）不受生态开关限制，PRO+ + 积分够就执行。
 */
import { ROMANCE_TITLE_STAGE } from '../domain/relationship-stage.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import {
  Id,
  type AdultModelReadPort,
  type CharacterReadPort,
  type ChatReadPort,
  type ContactsReadPort,
  type DecideOutput,
  type EcologyActionKey,
  type EcologyCharacterProfile,
  type EcologyMurmur,
  type EcologyRunRecord,
  type EcologyRunStatus,
  type GenerateError,
  type HolidayEventPort,
  type IdentityMembershipReadPort,
  type IdentityReadPort,
  type ModelGatewayMediaPort,
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
import {
  ADULT_MODEL_READ_PORT,
  MODEL_GATEWAY_MEDIA_PORT,
  MODEL_GATEWAY_PORT,
} from '../../model-access/index.js';
import { MOMENTS_READ_PORT } from '../../moments/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { HOLIDAY_EVENT_PORT } from '../../proactive/index.js';
import {
  ACTION_DEF,
  JEV_OPTIONS,
  LEVEL_ORDER,
  TEXT_MODEL_ACTIONS,
  detectUserRequest,
  ecoRandom,
  ecologyFallback,
  interpretJevAnswers,
  jevPrompt,
  microsToPoints,
  resolveEcologyConflicts,
  wakeSlots,
} from '../domain/ecology.js';
import {
  absenceGreetedSince,
  chatActionCountAllowed,
  countMainUnreplied,
  greetingDone,
  separateLineDoneToday,
  shouldAutoOff,
  type EcologyRunCount,
} from '../domain/ecology-counters.js';
import {
  FOLLOW_UP_DAILY_MAX,
  followUpDedupHash,
  followUpTriggerAt,
  followUpTriggerRule,
  isFollowUpDue,
  isFollowUpExpired,
} from '../domain/follow-ups.js';
import { detectFormSuppressions } from '../domain/chat-form-suppression.js';
import { momentsReactDelayMs } from '../domain/moments-reactions.js';
import { healthPrivate } from '../domain/memory.js';
import { outputAllowed } from '../domain/reply-rules.js';
import { scrubSummary } from './planner.js';
import { ecologyProfiles, ecologyRuns, followUps } from '../infra/db/ecology-schema.js';
import { simulationStates, userChatActivity } from '../infra/db/schema.js';
import { EcologySettingsService } from './ecology-settings.js';
import { GroupChatService } from './group-chat.js';
import { MediaAiService } from './media-ai.js';
import { MemoryService } from './memory.js';
import { CompanionSettingsService } from './settings.js';
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
import { WeiboSyncService } from './weibo.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { characterView, rolePersonaSpeechText } from './character-view.js';
import { MOMENTS_REACT_JOB, type MomentsReactJob } from './moments-ai.js';

export const ECOLOGY_TICK_JOB = 'ai.ecology_tick';
export const ECOLOGY_USER_JOB = 'ai.ecology_user';
export const ECOLOGY_REQUEST_JOB = 'ai.ecology_request';
export const ECOLOGY_CLEANUP_JOB = 'ai.ecology_cleanup';

/** 每个用户每次调度最多唤醒几个角色（其余下一个 10 分钟再说，避免多个角色同时冒出来）。 */
const MAX_WAKES_PER_TICK = 2;
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

/** 3.29：每轮最多执行几个动作。候选全部交给 Jev 评估；这里只防一轮刷屏。 */
const MAX_ACTIONS_PER_WAKE = 2;
/** 批 EJ：一次判定最多等多久（网关 decide 自身上限也是 10 秒）；超时就不做，不重试。 */
const JEV_TIMEOUT_MS = 10_000;

/**
 * 3.29：动作正文由用户自己的场景模型生成；这里只给生成器一句**程序侧**的任务说明。
 * Gate（Jev）不再提供 brief/target/text，避免它越权写正文。
 */
const ACTION_BRIEF: Partial<Record<EcologyActionKey, string>> = {
  message: '主动给对方发一条私聊消息，结合你们最近的聊天和今天的情况，说一件具体的小事。',
  greeting: '跟对方道早安或晚安，结合今天的具体情况，不要用套话。',
  voice: '用一两句口语的话给对方发一条语音消息。',
  sticker: '发一个表情包，配一句很短的话。',
  nudge:
    '主动给对方发一条私聊消息，结合你们最近的聊天和今天的情况，说一件具体的小事；发完会顺手「拍一拍」对方，话里不用提拍一拍。',
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

/** 批 EJ：发给 Jev 的情境，只允许数字 / 布尔 / null（不含任何原文）。 */
export type JevState = Record<string, number | boolean | null>;

interface Snapshot {
  /** 净化后的判定特征（白名单字段，见 buildSnapshot）。 */
  features: JevState;
  /**
   * 净化后的对话现状（总经理 10-26：Jev 要基于语境判断）：最近几条日常范围消息要点（每条截短、隐私词替换、
   * 健康内容剔除）、未回复情况、今天做过什么。私密范围原文、人设、记忆正文不进。
   */
  summary: string;
  /** 余额不足：不向 Jev 付费询问，直接暂停（欠费即停）。 */
  balanceInsufficient: boolean;
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
  /** 主线未回复次数（只数主线动作的成功行，单独线不计入）。 */
  mainUnreplied: number;
  /** 久未问候（+1）是否已发过。 */
  absenceGreeted: boolean;
  /** 是否触发 3 天自动关（只看最后用户消息时间 + 主线次数）。 */
  autoOff: boolean;
  /** 到点的跟进事项（没有就是 null；问完标记只问一次）。 */
  followUpDue: {
    id: string;
    eventText: string;
    eventSummary: string;
  } | null;
}

type FollowUpRow = typeof followUps.$inferSelect;

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
    @Inject(MODEL_GATEWAY_MEDIA_PORT) private readonly media: ModelGatewayMediaPort,
    @Inject(ADULT_MODEL_READ_PORT) private readonly adultModels: AdultModelReadPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(GROWTH_SERVICE) private readonly growth: GrowthService,
    @Inject(HOLIDAY_EVENT_PORT) private readonly holidays: HolidayEventPort,
    @Inject(MOMENTS_READ_PORT) private readonly moments: MomentsReadPort,
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(CompanionSettingsService) private readonly companion: CompanionSettingsService,
    @Inject(SharedEpisodesService) private readonly episodes: SharedEpisodesService,
    @Inject(SimulationService) private readonly simulation: SimulationService,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(ProactiveSchedulerService) private readonly proactive: ProactiveSchedulerService,
    @Inject(MomentsAiService) private readonly momentsAi: MomentsAiService,
    @Inject(MediaAiService) private readonly mediaAi: MediaAiService,
    @Inject(GroupChatService) private readonly groups: GroupChatService,
    @Inject(WeiboSyncService) private readonly weibo: WeiboSyncService,
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
   * 批 EJ：一次唤醒最多一次原生判定（Jev）请求，对全部候选逐项问 act / defer（允许多项通过）。
   * Jev 不写正文、状态签名或碎碎念；通过的动作由程序排冲突后，交给用户自己选的模型逐项执行。
   * 低把握、超时、陌生 ID、网关失败一律不做；不重试、不回落到文字模型判定。
   */
  private async executeWake(run: RunRow): Promise<void> {
    const started = this.clock.nowMs();
    const { userId, characterId } = run;
    const config = await this.settings.config();
    if (!config.decisionModelKey)
      return this.finish(run.id, { status: 'skipped', outcome: 'model_not_configured' });
    if ((await this.settings.decisionProblem(config.decisionModelKey)) !== null)
      return this.finish(run.id, { status: 'skipped', outcome: 'model_not_decision' });
    const snapshot = await this.buildSnapshot(run);
    if (!snapshot)
      return this.finish(run.id, { status: 'skipped', outcome: 'context_unavailable' });
    // 欠费即停：余额不足时不向 Jev 付费询问。
    if (snapshot.balanceInsufficient) {
      await this.settings.pause(userId, 'insufficient_balance');
      return this.finish(run.id, { status: 'paused', outcome: 'insufficient_balance' });
    }
    // 3 天自动关（对照表 v3）：72 小时无用户消息且主线已满 3 次，就关掉该角色生态；
    // 单独线（早安晚安、跟进）发了多少都不影响这个判定。关之前不问 Jev。
    if (snapshot.autoOff) {
      await this.settings.setCharacter(userId, characterId, false).catch(() => undefined);
      return this.finish(run.id, {
        status: 'skipped',
        outcome: 'auto_off_no_reply',
        actionKey: null,
        actionSummary: '3 天没回消息，生态自动关了',
        latencyMs: this.clock.nowMs() - started,
      });
    }
    const idle = async (
      outcome: string,
      extra: { modelKey?: string; chargedMicros?: number } = {},
    ) => {
      const murmur = await this.generateMurmur(run, snapshot, []);
      return this.finish(run.id, {
        status: 'idle',
        outcome,
        actionKey: null,
        actionSummary: '看了看手机，没做什么',
        // 碎碎念每天都要写（对照表 v3「TA 的生活」）：没做什么时也写一句中性的，
        // 只基于快照里的真实情况，不编造。生成失败就留空，不伪造。
        murmur: murmur ? { userId, text: murmur.text } : null,
        modelKey: extra.modelKey,
        chargedMicros: (extra.chargedMicros ?? 0) + (murmur?.chargedMicros ?? 0),
        latencyMs: this.clock.nowMs() - started,
      });
    };
    // 无候选不调用 Jev（不花钱问空问题）。
    if (!snapshot.tools.length) return idle('no_action');
    const candidates = snapshot.tools.slice(0, 20);
    const asked = await this.askJev(
      run,
      config.decisionModelKey,
      { features: snapshot.features, summary: snapshot.summary },
      candidates,
    );
    if (!asked.ok) {
      if (asked.error === 'insufficient_balance' || asked.error === 'budget_exceeded') {
        if (asked.error === 'insufficient_balance')
          await this.settings.pause(userId, 'insufficient_balance');
        return this.finish(run.id, { status: 'paused', outcome: asked.error });
      }
      // 超时也可能已被供应商处理：实际费用以网关结算为准，这里不宣称免费，也不重试。
      return this.finish(run.id, {
        status: 'failed',
        outcome: asked.error === 'timeout' ? 'jev_timeout' : `jev_${asked.error}`,
        modelKey: config.decisionModelKey,
        latencyMs: this.clock.nowMs() - started,
      });
    }
    let charged = asked.chargedMicros;
    const verdict = interpretJevAnswers(candidates, asked.answers);
    const resolved = resolveEcologyConflicts(verdict.approved, MAX_ACTIONS_PER_WAKE);
    const { dropped } = resolved;
    let { selected } = resolved;
    let trace = jevTrace(verdict, dropped);
    if (!selected.length) {
      // 保底：Jev 一项都没通过但此刻不打扰时，发一条主动消息（详见 ecologyFallback）。
      const fallback = ecologyFallback(candidates, asked.answers, {
        lateNight: snapshot.features.lateNight === true,
        unansweredCount: Number(snapshot.features.unansweredCount ?? 0),
        userActiveInApp30m: snapshot.features.userActiveInApp30m === true,
      });
      if (fallback) {
        selected = [fallback.action];
        trace += `${trace ? ' ' : ' | '}fb=${fallback.action}:${fallback.score.toFixed(2)}`;
      }
    }
    if (!selected.length)
      return idle(
        `${verdict.lowConfidence.length ? 'jev_low_confidence' : verdict.invalid.length ? 'jev_invalid' : 'jev_declined'}${trace}`,
        { modelKey: asked.modelKey, chargedMicros: charged },
      );
    const done: Array<{ action: EcologyActionKey; result: ActionResult }> = [];
    for (const action of selected) {
      // 每项执行前再核对：生态仍开着、动作没被关掉、平台仍开放。
      const recheck = await this.stillAllowed(userId, action);
      const outcome: ActionResult = recheck
        ? { ok: false, chargedMicros: 0, reason: recheck }
        : await this.perform(run, action, snapshot).catch((error: unknown): ActionResult => ({
            ok: false,
            chargedMicros: error instanceof ProactiveChargeError ? error.chargedMicros : 0,
            reason: error instanceof Error ? error.message : 'error',
          }));
      charged += outcome.chargedMicros;
      done.push({ action, result: outcome });
      if (!outcome.ok && /insufficient_balance/.test(outcome.reason ?? '')) {
        await this.settings.pause(userId, 'insufficient_balance');
        break;
      }
    }
    if (
      done.length === 1 &&
      done[0]!.action === 'weibo_sync' &&
      done[0]!.result.reason === 'no_new_public_posts'
    ) {
      const murmur = await this.generateMurmur(run, snapshot, ['看了看微博，暂时没有新动态']);
      return this.finish(run.id, {
        status: 'idle',
        outcome: `no_new_public_posts${trace}`,
        actionKey: 'weibo_sync',
        actionSummary: '看了看微博，暂时没有新动态',
        modelKey: asked.modelKey,
        chargedMicros: charged + (murmur?.chargedMicros ?? 0),
        murmur: murmur ? { userId, text: murmur.text } : null,
        latencyMs: this.clock.nowMs() - started,
      });
    }
    const succeeded = done.filter((item) => item.result.ok);
    // 成功才说做了：没做成的写「没做成」，不假装成功。
    const summaries = done.map(({ action, result: r }) => {
      const def = ACTION_DEF.get(action)!;
      return r.ok ? def.summary : `${def.label}没做成`;
    });
    const murmur = await this.generateMurmur(run, snapshot, summaries);
    await this.finish(run.id, {
      status: succeeded.length ? 'done' : 'failed',
      outcome: `${
        succeeded.length
          ? 'sent'
          : `executor_failed:${done.map((item) => item.result.reason ?? 'unknown').join(',')}`
      }${trace}`,
      // 多个动作时单条 actionKey 会误导；用 null，动作明细在 actionSummary。
      actionKey: done.length === 1 ? done[0]!.action : null,
      actionSummary: summaries.join('；').slice(0, 500),
      modelKey: asked.modelKey,
      chargedMicros: charged + (murmur?.chargedMicros ?? 0),
      murmur: murmur ? { userId, text: murmur.text } : null,
      latencyMs: this.clock.nowMs() - started,
    });
  }

  /**
   * 原生判定：同一情境的全部候选一次请求（每题固定 ID = 动作名、选项 act / defer）。
   * 计费由网关按 Jev 价目记一条用量（用户付、计入后台额度、生态任务不透支）；同一次唤醒幂等键固定，重放不重复扣费。
   */
  private async askJev(
    run: RunRow,
    modelKey: string,
    state: { features: JevState; summary: string },
    candidates: readonly EcologyActionKey[],
  ): Promise<
    | {
        ok: true;
        answers: DecideOutput['answers'];
        chargedMicros: number;
        modelKey: string;
      }
    | { ok: false; error: GenerateError | 'timeout' }
  > {
    const deadline = this.clock.nowMs() + JEV_TIMEOUT_MS;
    const call = this.media
      .decide({
        userId: run.userId,
        characterId: run.characterId,
        purpose: 'behavior_planning',
        billingOwner: 'user',
        countAsBackground: true,
        ecologyTask: true,
        modelKey,
        state,
        questions: candidates.map((action) => ({
          questionId: action,
          kind: 'choice' as const,
          prompt: jevPrompt(action),
          options: [...JEV_OPTIONS],
        })),
        deadlineAt: new Date(deadline).toISOString(),
        idempotencyKey: `eco:${run.id}:jev`,
      })
      .catch(() => ({ ok: false as const, error: 'provider_unavailable' as const }));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ ok: false; error: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), JEV_TIMEOUT_MS + 1_000);
    });
    try {
      const result = await Promise.race([call, timeout]);
      if (!result.ok) return result;
      return {
        ok: true,
        answers: result.value.answers,
        chargedMicros: result.value.chargedMicros,
        modelKey: result.value.modelKey,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 碎碎念（对照表 v3「TA 的生活」）：每次唤醒写一两句第一人称日记，每天都要有，
   * 不管用户有没有互动。只基于快照与本次真实做了什么写，不编造；只进 ecology_runs
   * 的加密展示字段，绝不写回记忆、绝不记成事实（无例外）。
   * 返回 null = 生成失败 / 内容不安全：留空，不伪造。
   */
  private async generateMurmur(
    run: RunRow,
    snapshot: Snapshot,
    doneSummaries: readonly string[],
  ): Promise<{ text: string; chargedMicros: number } | null> {
    // 碎碎念只是展示内容：任何失败（模型、资料、政策）都留空，绝不能打断唤醒本身。
    try {
      return await this.generateMurmurInner(run, snapshot, doneSummaries);
    } catch {
      return null;
    }
  }

  private async generateMurmurInner(
    run: RunRow,
    snapshot: Snapshot,
    doneSummaries: readonly string[],
  ): Promise<{ text: string; chargedMicros: number } | null> {
    const role = await this.characters.getForRuntime(run.userId, run.characterId).catch(() => null);
    if (!role) return null;
    const policy = await this.policy
      .getCharacterPolicy(run.userId, run.characterId)
      .catch(() => null);
    if (!policy) return null;
    const doneText = doneSummaries.length ? doneSummaries.join('；') : '看了看手机，没做什么';
    const r = await this.gateway
      .generateText({
        userId: run.userId,
        characterId: run.characterId,
        purpose: 'behavior_planning',
        billingOwner: 'user',
        ...(snapshot.privateMode
          ? {
              modelRole: 'adult' as const,
              conversationId: snapshot.conversationId,
              countAsBackground: true,
              ecologyTask: true,
              meta: { scenarioMode: 'adult' as const },
            }
          : { modelRole: 'chat' as const }),
        responseFormat: 'text',
        maxOutputTokens: 80,
        idempotencyKey: `eco:murmur:${run.id}`,
        messages: [
          {
            role: 'system',
            content: `你是「${role.profile.name}」，人设：${
              role.card
                ? JSON.stringify(role.card.data.persona).slice(0, 1200)
                : rolePersonaSpeechText(characterView(role), 1200)
            }。只输出一两句第一人称的日记（碎碎念），不超过 60 字，不加引号。只写下面给出的真实情况，不编造没发生的事、不写具体人名和私事，不含成人内容，不提健康隐私。`,
          },
          {
            role: 'user',
            content: `今天的情况：${snapshot.summary.slice(0, 300)}\n这次做了：${doneText}`,
          },
        ],
      })
      .catch(() => null);
    if (!r?.ok) return null;
    const text = r.value.text
      .trim()
      .replace(/^["「『]|["」』]$/g, '')
      .slice(0, 200);
    if (!text || healthPrivate(text) || !outputAllowed(text, policy, false)) return null;
    return { text, chargedMicros: r.value.chargedMicros };
  }

  /** 执行前复核；返回 null = 可以执行，否则返回不执行的原因。 */
  private async stillAllowed(userId: string, action: EcologyActionKey): Promise<string | null> {
    if (!(await this.settings.isActive(userId))) return 'ecology_inactive';
    const row = await this.settings.row(userId);
    if (row?.disabledActions?.includes(action)) return 'action_disabled';
    if (await this.settings.actionAvailable(action)) return 'action_unavailable';
    return null;
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
        ? { ok: true, chargedMicros: r.chargedMicros, messageId: r.messageId }
        : { ok: false, chargedMicros: r.chargedMicros ?? 0, reason: r.reason };
    };
    switch (action) {
      case 'weibo_sync':
        return this.weibo.run(userId, characterId);
      case 'message':
      case 'care_anniversary':
      case 'care_absence':
      case 'care_late_night':
        return viaChat(null);
      case 'care_follow_up': {
        // 跟进问的是到点的那件具体事：brief 里写清事项，问完立刻标记已问、只问一次。
        // 单独线：发完不计入主线次数（计数口径见 ecology-counters）。
        const due = snapshot.followUpDue;
        const r = due
          ? await this.proactive.sendEcology({
              userId,
              characterId,
              runId: run.id,
              brief: `跟进对方之前提过的事「${due.eventSummary}」，自然地问问结果怎么样。`,
              extras: { extra: null },
            })
          : await this.proactive.sendEcology({
              userId,
              characterId,
              runId: run.id,
              brief,
              extras: { extra: null },
            });
        if (!r.ok) return { ok: false, chargedMicros: r.chargedMicros ?? 0, reason: r.reason };
        if (due) await this.markFollowUpAsked(due.id, r.messageId);
        return { ok: true, chargedMicros: r.chargedMicros };
      }
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
        // 10-28 总经理：拍一拍夹在聊天里，不能只拍不说话。先发一句话（发不出去就整项不做），再顺手拍一拍；
        // 拍一拍没成功不影响这一项（话已经说了）。用户在聊天里点名「拍拍我」走 runRequest，照旧只拍。
        const said = await viaChat(null);
        if (!said.ok) return said;
        await this.proactive.sendNudge(userId, characterId, run.id);
        return said;
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
        // 点赞和评论是分开的两件事（对照表 v3 §4，照抄旧版）：点赞立即执行、不调模型；
        // 评论另排一个任务（延迟 1–15 分钟、单独去重键），旧版概率：用户动态 45%、角色动态 35%。
        // 评论任务失败不影响点赞这一项的结果。
        const r = await this.momentsAi.reactForEcology({
          userId,
          postId: post.postId,
          characterId,
          action: 'like',
          like: true,
          ecologyRunId: run.id,
        });
        if (!r.ok) return { ok: false, chargedMicros: 0, reason: r.reason };
        const commentProbability = action === 'moment_peer' ? 0.35 : 0.45;
        if (ecoRandom(run.id, 'moments-comment') < commentProbability) {
          const job: MomentsReactJob = {
            userId,
            postId: post.postId,
            characterId,
            action: 'comment',
            ecologyRunId: run.id,
          };
          await this.jobs
            .send(MOMENTS_REACT_JOB, job, {
              delayMs: momentsReactDelayMs(ecoRandom(run.id, 'moments-delay')),
              singletonKey: `moments-comment:${post.postId}:${characterId}`,
              retryLimit: 1,
              retryBackoff: true,
            })
            .catch(() => undefined);
        }
        return { ok: true, chargedMicros: r.chargedMicros };
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
          // H2：私密模式期间用该用户的私密模型写回复（输出仍按日常范围检查）。
          ...(snapshot.privateMode ? { privateConversationId: snapshot.conversationId } : {}),
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'status':
      case 'signature': {
        // 3.29：状态/签名由用户自己的 chat 场景模型写，不用 Gate 输出的 text。
        const generated = await this.generateProfileText(
          userId,
          characterId,
          action,
          undefined,
          snapshot.privateMode ? snapshot.conversationId : undefined,
        );
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
   * 3.29：用**用户自己的 chat 场景模型**写状态/签名；Jev 不输出 text。
   * 批 EJ：角色处于私密模式（生态发起）时按 H2 用该用户的私密模型写（传私聊会话，输出仍按日常范围过滤）。
   * 返回 null = 用户没配对应模型 / 生成失败 / 内容不安全，不做任何替换模型。
   */
  private async generateProfileText(
    userId: string,
    characterId: string,
    action: 'status' | 'signature',
    hint?: string,
    privateConversationId?: string,
  ): Promise<{ text: string; chargedMicros: number } | null> {
    const role = await this.characters.getForRuntime(userId, characterId);
    if (!role) return null;
    const r = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      ...(privateConversationId
        ? {
            modelRole: 'adult' as const,
            conversationId: privateConversationId,
            countAsBackground: true,
            ecologyTask: true,
            meta: { scenarioMode: 'adult' as const },
          }
        : { modelRole: 'chat' as const }),
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
    // 状态 / 签名是日常范围可见的资料：私密模型写的也按日常范围检查，不放行成人用词。
    const policy = await this.policy.getCharacterPolicy(userId, characterId).catch(() => null);
    if (!policy || !outputAllowed(text, policy, false)) return null;
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
  /**
   * 批 EJ：组装判定所需的**结构化特征**与候选。只读日常范围；不再拼聊天 / 记忆 / 朋友圈原文
   * （Jev 只收白名单数字与布尔值）。目标（朋友圈评论、群）由程序记下，执行时使用，不交给 Jev。
   */
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
    const config = await this.settings.config();
    const userRow = await this.settings.row(userId);
    const disabled = new Set(userRow?.disabledActions ?? []);
    const now = this.clock.now();
    const nowMs = now.getTime();
    const local = localParts(now, profile.timeZone);
    const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
    const level = await this.growth
      .getFamiliarity(userId, characterId)
      .then((f) => f.level)
      .catch(() => 1);
    const targets: Snapshot['targets'] = new Map();

    // 聊天：只数时间（日常范围），不读正文给判定（压制检测只看用户原话里的明确关键词）。
    const history = await this.chat
      .readMessages({ conversationId: contact.conversationId, scopes: ['normal'], limit: 30 })
      .catch(() => []);
    const visible = history.filter((m) => m.senderKind !== 'system' && m.status === 'normal');
    const lastUserIndex = visible.map((m) => m.senderKind).lastIndexOf('user');
    const lastUser = lastUserIndex >= 0 ? visible[lastUserIndex] : undefined;
    const sinceUserMs = lastUser ? nowMs - Date.parse(lastUser.createdAt) : Infinity;
    const lastUserAtMs = lastUser ? Date.parse(lastUser.createdAt) : null;
    // 三线分账（对照表 v3）：主线次数只数 ecology_runs 里主线动作的成功行，
    // 单独线（早安晚安 / 跟进 / 纪念日）各记各的，绝不共用一个计数字段。
    const recentDoneRows = await this.db.db
      .select({
        actionKey: ecologyRuns.actionKey,
        finishedAt: ecologyRuns.finishedAt,
        localDate: ecologyRuns.localDate,
      })
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.userId, userId),
          eq(ecologyRuns.characterId, characterId),
          eq(ecologyRuns.status, 'done'),
        ),
      )
      .orderBy(desc(ecologyRuns.createdAt))
      .limit(30)
      .catch(() => []);
    const runCounts: EcologyRunCount[] = recentDoneRows.map((row) => ({
      actionKey: row.actionKey,
      finishedAtMs: row.finishedAt ? new Date(row.finishedAt).getTime() : null,
      localDate: row.localDate,
      localHour: row.finishedAt
        ? localParts(new Date(row.finishedAt), profile.timeZone).hour
        : null,
    }));
    const mainUnreplied = countMainUnreplied(runCounts, lastUserAtMs);
    const absenceGreeted = absenceGreetedSince(runCounts, lastUserAtMs);
    const greeting = greetingDone(runCounts, local.date);
    const anniversaryDoneToday = separateLineDoneToday(runCounts, 'care_anniversary', local.date);
    const lateNightDoneToday = separateLineDoneToday(runCounts, 'care_late_night', local.date);
    const nudgeDoneToday = runCounts.some(
      (row) => row.actionKey === 'nudge' && row.localDate === local.date,
    );
    // 拍一拍绝不在每天第一条自动拍：今天角色已经主动做过事（或已在聊天里说过话）才进候选。
    const actedToday =
      runCounts.some((row) => row.localDate === local.date) ||
      visible.some(
        (m) =>
          m.senderKind === 'character' &&
          localParts(new Date(m.createdAt), profile.timeZone).date === local.date,
      );
    const autoOff = shouldAutoOff({ nowMs, lastUserAtMs, mainUnreplied });
    // 会话压制：用户在聊天里明确说过不喜欢某一种形式，就不进对应候选；后来明确要了就恢复。
    const userTexts = visible
      .filter((m) => m.senderKind === 'user')
      .slice(-30)
      .flatMap((m) => {
        const raw =
          m.content?.type === 'text'
            ? m.content.text
            : m.content?.type === 'voice'
              ? (m.content.transcript ?? '')
              : '';
        return raw.trim() ? [raw] : [];
      });
    const suppressedForms = detectFormSuppressions(userTexts).suppressed;
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

    // 记忆：只读日常范围（不含健康隐私）。定时跟进只认 follow_ups 表里到点的行
    // （草案 §4）；commitment 记忆是建行来源，由 syncFollowUps 里再筛。
    const memories = await this.memory
      .list(userId, characterId, { limit: 60 })
      .then((r) => r.items)
      .catch(() => []);
    await this.syncFollowUps(
      userId,
      characterId,
      memories,
      profile.timeZone,
      contact.conversationId,
    ).catch(() => undefined);
    const followUpDue = await this.dueFollowUp(
      userId,
      characterId,
      nowMs,
      local.date,
      profile.timeZone,
    ).catch(() => null);

    // 日子：节日、生日、纪念日。
    let specialDay = false;
    const holidays = await this.holidays.getUpcomingForUser(userId, 1).catch(() => []);
    for (const h of holidays)
      // 3.27（H1）：恋爱节日只对好感度到「恋人」阶段的角色（不再看手选的关系类型）。
      if (h.daysAhead === 0 && (!h.romantic || level >= ROMANCE_TITLE_STAGE)) specialDay = true;
    if (profile.birthday && profile.birthday.slice(5) === local.date.slice(5)) specialDay = true;
    const known = await this.growth.getDaysKnown(userId, characterId).catch(() => null);
    for (const a of known?.anniversaries ?? [])
      if (a.nextOccurrence === local.date) specialDay = true;

    // 朋友圈：只记目标编号与数量。
    const since = new Date(nowMs - 7 * 86400_000).toISOString();
    const mine = await this.moments.listCharacterPosts(userId, characterId, since).catch(() => []);
    const userPosts = await this.moments
      .listUserPostsVisibleTo(userId, characterId, since)
      .catch(() => [] as MomentsPost[]);
    let c = 0;
    for (const p of mine.slice(0, 3)) {
      const replied = new Set(
        p.comments
          .filter((x) => x.author.kind === 'character' && x.author.refId === characterId)
          .map((x) => x.replyToCommentId),
      );
      for (const cm of p.comments.slice(-5)) {
        if (cm.author.kind === 'character' && cm.author.refId === characterId) continue;
        if (replied.has(cm.commentId)) continue;
        targets.set(`C${++c}`, { postId: p.postId, commentId: cm.commentId });
      }
    }
    let u = 0;
    for (const p of userPosts.slice(0, 3)) {
      const interacted =
        p.likes.some((l) => l.kind === 'character' && l.refId === characterId) ||
        p.comments.some((x) => x.author.kind === 'character' && x.author.refId === characterId);
      if (interacted) continue;
      targets.set(`U${++u}`, { postId: p.postId });
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
      targets.set(`P${++pc}`, { postId: p.postId });
    }

    // 群。
    const groups = await this.groups.ecologyGroups(userId, characterId).catch(() => []);
    groups.slice(0, 3).forEach((g, i) => {
      targets.set(`G${i + 1}`, { conversationId: g.conversationId });
    });

    // 资料与今天已经做过的次数。
    const [ep] = await this.db.db
      .select()
      .from(ecologyProfiles)
      .where(and(eq(ecologyProfiles.userId, userId), eq(ecologyProfiles.characterId, characterId)));
    const today = await this.db.db
      .select({ action: ecologyRuns.actionKey, summary: ecologyRuns.actionSummary })
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.userId, userId),
          eq(ecologyRuns.characterId, characterId),
          eq(ecologyRuns.localDate, local.date),
          eq(ecologyRuns.status, 'done'),
        ),
      )
      .orderBy(desc(ecologyRuns.createdAt))
      .limit(20);
    const [lastProactive] = await this.db.db
      .select({ at: sql<Date | null>`max(${ecologyRuns.finishedAt})` })
      .from(ecologyRuns)
      .where(
        and(
          eq(ecologyRuns.userId, userId),
          eq(ecologyRuns.characterId, characterId),
          eq(ecologyRuns.status, 'done'),
        ),
      );
    const spend = await this.billing.getSpendStatus(userId).catch(() => null);

    // 执行侧模型是否可用（角色覆盖优先，其次用户场景；私密模式用私密模型）。缺了就不进候选，不换模型。
    const textReady = privateMode
      ? await this.adultModels
          .getAdultModelStatus(userId, characterId)
          .then((s) => s.available)
          .catch(() => false)
      : await this.gateway
          .getModelStatus(userId, characterId)
          // 余额另外判断（欠费即停）；这里只看模型是否选了、是否可用。
          .then((s) => s.available || s.reason === 'insufficient_balance')
          .catch(() => false);

    // 可用工具：开着、平台可执行、此刻合适、对应模型可用。
    // 计数闸门只看三线分账：主线满 3 次挡主线动作，单独线永远不被主线挡；
    // 用户 5 分钟内在聊天时不插聊天类动作（忙碌保护，不是计数）。
    const busyBlocked = sinceUserMs < BUSY_MS;
    const lateNight = local.hour >= 23 || local.hour < 4;
    const tools: EcologyActionKey[] = [];
    const stickers = await this.mediaAi.hasStickers(characterId).catch(() => false);
    const works = (await this.mediaAi.listShareableWorks(characterId).catch(() => [])).length > 0;
    const signatureRecent =
      !!ep?.signatureUpdatedAt && nowMs - ep.signatureUpdatedAt.getTime() < 3 * 86400_000;
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
      if (CHAT_ACTIONS.has(def.key)) {
        if (busyBlocked) continue;
        if (!chatActionCountAllowed(def.key, { mainUnreplied, absenceGreeted })) continue;
        // 会话压制：用户说过不喜欢，就不进候选（只压说的那一种）。
        if (def.key === 'sticker' && suppressedForms.has('sticker')) continue;
        if (def.key === 'voice' && suppressedForms.has('voice')) continue;
        if (def.key === 'nudge' && suppressedForms.has('nudge')) continue;
      }
      // H2：私密模式只开放文字与图片（不发语音），且仅单角色（不去群里说话）。
      if (privateMode && (def.key === 'voice' || def.key === 'group_talk')) continue;
      if (TEXT_MODEL_ACTIONS.has(def.key) && !textReady) continue;
      const ok = await (async () => {
        switch (def.key) {
          case 'weibo_sync':
            return weiboReady;
          case 'moment_post':
            return momentMaterial;
          case 'photo':
            // 3.29：只发该条微博已审核图片；没有图就不提供，不 AI 生图/不用风景图。
            return Boolean(weiboPhoto);
          case 'voice':
            // 文字由用户文字模型写、声音由用户语音消息模型合成；音色与所选模型不兼容就不提供。
            return this.voiceReady(userId, characterId);
          case 'greeting': {
            const inWindow =
              (local.hour >= 6 && local.hour < 10) || local.hour >= 21 || local.hour < 1;
            if (!inWindow) return false;
            // 早安晚安各记各的：早上发过早安就不再发早安，晚上发过晚安就不再发晚安。
            const isMorning = local.hour >= 6 && local.hour < 10;
            return isMorning ? !greeting.morningDone : !greeting.eveningDone;
          }
          case 'care_late_night':
            return lateNight && lastAppMs < 30 * 60_000 && !lateNightDoneToday;
          case 'care_absence':
            return absenceMs >= ABSENCE_MS;
          case 'care_anniversary':
            return specialDay && !anniversaryDoneToday;
          case 'care_follow_up':
            // 定时跟进：只有 follow_ups 里到点、没问过、今天没超 2 条的事项才进候选。
            return followUpDue !== null;
          case 'sticker':
            return stickers;
          case 'share_link':
            return works;
          case 'nudge':
            // 约每天 1 次、看场合、绝不在每天第一条自动拍：今天已拍过或今天还没动过时不进候选。
            return !nudgeDoneToday && actedToday;
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
    const features: JevState = {
      // 10-27：用户在生态设置里选的活跃程度（1 偶尔冒泡 … 4 形影不离），Jev 据此决定主动的力度。
      userActivityLevel:
        LEVEL_ORDER.indexOf((userRow?.activityLevel ?? 'often') as (typeof LEVEL_ORDER)[number]) +
        1,
      localHour: local.hour,
      weekday,
      lateNight,
      specialDay,
      familiarityLevel: level,
      minutesSinceLastUserMsg: Number.isFinite(sinceUserMs)
        ? Math.min(525_600, Math.round(sinceUserMs / 60_000))
        : null,
      // Jev 看到的未回复数是主线次数（单独线不计入，见 ecology-counters）。
      unansweredCount: mainUnreplied,
      userActiveInApp30m: lastAppMs < 30 * 60_000,
      daysSinceLastChat: Math.min(365, Math.floor(absenceMs / 86400_000)),
      pendingFollowUp: followUpDue !== null,
      pendingCommentReplies: c,
      userPostsToInteract: u,
      friendPostsToInteract: pc,
      sharedGroups: Math.min(3, groups.length),
      weiboLeadAvailable: weiboReady,
      signatureChangedRecently: signatureRecent,
      actionsDoneToday: today.length,
      chatActionsDoneToday: today.filter(
        (t) => !!t.action && CHAT_ACTIONS.has(t.action as EcologyActionKey),
      ).length,
      pointsLow: !(spend && spend.availableMicros > 2_000_000),
      candidateCount: tools.length,
    };
    const summary = jevSummary({
      local,
      weekday,
      recent: visible.slice(-6).flatMap((m) => {
        const raw =
          m.content?.type === 'text'
            ? m.content.text
            : m.content?.type === 'voice'
              ? (m.content.transcript ?? '')
              : '';
        if (!raw.trim() || healthPrivate(raw) || m.labels?.includes('health')) return [];
        return [
          { who: m.senderKind === 'user' ? ('user' as const) : ('character' as const), text: raw },
        ];
      }),
      unanswered: mainUnreplied,
      sinceUserMs,
      doneToday: today.flatMap((t) => (t.summary ? [t.summary] : [])),
      sinceProactiveMs: lastProactive?.at ? nowMs - new Date(lastProactive.at).getTime() : Infinity,
      userActiveRecently: lastAppMs < 30 * 60_000,
    });
    return {
      features,
      summary,
      balanceInsufficient: spend?.insufficient === true,
      privateMode,
      conversationId: contact.conversationId,
      tools,
      targets,
      hasFollowUps: followUpDue !== null,
      weiboPhoto,
      mainUnreplied,
      absenceGreeted,
      autoOff,
      followUpDue: followUpDue
        ? {
            id: followUpDue.id,
            eventText: followUpDue.eventText,
            eventSummary: followUpDue.eventSummary,
          }
        : null,
    };
  }

  /**
   * 定时跟进同步（草案 §4）：记忆里带明确 dueAt 的 commitment 事实 → follow_ups 行。
   * 同一件事同一时间只建一行（dedup_hash 唯一约束）；时间含糊的约定没有 dueAt，不建行。
   * 记忆转为过去（用户已说结果、记忆整理改了状态）时，对应待问行改成已取消。
   * 只读写跟进表自己的字段，不动记忆、不动主线计数。
   */
  private async syncFollowUps(
    userId: string,
    characterId: string,
    memories: readonly {
      category: string;
      status: string;
      scope: string;
      content: string;
      dueAt: string | null;
      sourceMessageIds: readonly string[];
    }[],
    timeZone: string,
    conversationId: string,
  ): Promise<void> {
    const now = this.clock.now();
    for (const m of memories) {
      if (m.category !== 'commitment' || m.status !== 'current' || !m.dueAt) continue;
      if (m.scope !== 'normal' || healthPrivate(m.content)) continue;
      const dueMs = Date.parse(m.dueAt);
      if (!Number.isFinite(dueMs)) continue;
      const eventText = m.content.slice(0, 200);
      const dedupHash = followUpDedupHash(userId, characterId, eventText, dueMs);
      await this.db.db
        .insert(followUps)
        .values({
          id: newId(),
          userId,
          characterId,
          conversationId,
          sourceMessageId: m.sourceMessageIds[0] ?? null,
          eventText,
          eventSummary: eventText,
          triggerAt: new Date(followUpTriggerAt(dueMs, timeZone)),
          triggerRule: followUpTriggerRule(dueMs, timeZone),
          status: 'pending',
          dedupHash,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .catch(() => undefined);
    }
    // 已过去的约定：对应待问行取消（按原话消息 id 认，不靠内容猜）。
    const pastSourceIds = new Set(
      memories
        .filter((m) => m.category === 'commitment' && m.status === 'past')
        .flatMap((m) => m.sourceMessageIds),
    );
    if (!pastSourceIds.size) return;
    const pending = await this.db.db
      .select({ id: followUps.id, sourceMessageId: followUps.sourceMessageId })
      .from(followUps)
      .where(
        and(
          eq(followUps.userId, userId),
          eq(followUps.characterId, characterId),
          eq(followUps.status, 'pending'),
        ),
      )
      .catch(() => []);
    for (const row of pending) {
      if (row.sourceMessageId && pastSourceIds.has(row.sourceMessageId))
        await this.db.db
          .update(followUps)
          .set({ status: 'cancelled', cancelledReason: 'memory_superseded', updatedAt: now })
          .where(eq(followUps.id, row.id))
          .catch(() => undefined);
    }
  }

  /**
   * 到点的跟进事项：最早到点的一行；到点后超 24 小时没问的改成已过期；
   * 每天（用户当地日期）每角色最多 2 条，超了返回 null。
   */
  private async dueFollowUp(
    userId: string,
    characterId: string,
    nowMs: number,
    localDate: string,
    timeZone: string,
  ): Promise<FollowUpRow | null> {
    const now = new Date(nowMs);
    const pending = await this.db.db
      .select()
      .from(followUps)
      .where(
        and(
          eq(followUps.userId, userId),
          eq(followUps.characterId, characterId),
          eq(followUps.status, 'pending'),
        ),
      )
      .orderBy(followUps.triggerAt)
      .limit(10);
    for (const row of pending) {
      if (isFollowUpExpired('pending', row.triggerAt.getTime(), nowMs))
        await this.db.db
          .update(followUps)
          .set({ status: 'expired', cancelledReason: 'expired', updatedAt: now })
          .where(eq(followUps.id, row.id))
          .catch(() => undefined);
    }
    const due = pending.find((row) => isFollowUpDue('pending', row.triggerAt.getTime(), nowMs));
    if (!due) return null;
    const asked = await this.db.db
      .select({ askedAt: followUps.askedAt })
      .from(followUps)
      .where(
        and(
          eq(followUps.userId, userId),
          eq(followUps.characterId, characterId),
          eq(followUps.status, 'asked'),
        ),
      )
      .catch(() => []);
    const askedToday = asked.filter(
      (row) =>
        row.askedAt !== null && localParts(new Date(row.askedAt), timeZone).date === localDate,
    ).length;
    if (askedToday >= FOLLOW_UP_DAILY_MAX) return null;
    return due;
  }

  /** 问完立刻标记已问、写 asked_at 与消息 id，用户不回也不再问第二遍。 */
  private async markFollowUpAsked(id: string, messageId: string | null): Promise<void> {
    await this.db.db
      .update(followUps)
      .set({
        status: 'asked',
        askedAt: this.clock.now(),
        askMessageId: messageId,
        updatedAt: this.clock.now(),
      })
      .where(eq(followUps.id, id))
      .catch(() => undefined);
  }

  /** 语音候选预检：陪伴设置里的音色（没有就用角色默认）必须和用户为语音消息选的模型一致。 */
  private async voiceReady(userId: string, characterId: string): Promise<boolean> {
    if (!this.media.speechSynthesisReady) return false;
    if (!(await this.media.isServiceEnabled('speech_synthesis').catch(() => false))) return false;
    const settings = await this.companion.get(userId, characterId).catch(() => null);
    const voiceId = await this.mediaAi
      .resolveVoice(characterId, settings?.voiceId ?? null)
      .catch(() => null);
    if (!voiceId) return false;
    return this.media.speechSynthesisReady({ userId, characterId, voiceId }).catch(() => false);
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

/**
 * 批 EJ：给 Jev 的对话现状文字（净化后）。只用日常范围消息：每条最多 60 字、隐私词与第三方称呼替换、
 * 健康内容在调用方已剔除；整体最多 600 字。不含人设、记忆正文或私密范围内容。
 */
export function jevSummary(input: {
  local: { hour: number; minute: number };
  weekday: number;
  recent: Array<{ who: 'user' | 'character'; text: string }>;
  unanswered: number;
  sinceUserMs: number;
  doneToday: string[];
  /** 距角色上次主动（生态成功做过动作）多久；没有记录为 Infinity / 不传。 */
  sinceProactiveMs?: number;
  /** 对方 30 分钟内在用应用。 */
  userActiveRecently?: boolean;
}): string {
  const ago = (m: number) =>
    m < 60 ? `${m} 分钟` : m < 2880 ? `${Math.round(m / 60)} 小时` : `${Math.round(m / 1440)} 天`;
  const clock = `${String(input.local.hour).padStart(2, '0')}:${String(input.local.minute).padStart(2, '0')}`;
  const lines = [`现在是对方当地时间周${'日一二三四五六'[input.weekday] ?? ''} ${clock}。`];
  const minutes = Number.isFinite(input.sinceUserMs)
    ? Math.round(input.sinceUserMs / 60_000)
    : null;
  lines.push(
    minutes === null
      ? '对方很久没来聊天。'
      : `对方上次发消息在 ${ago(minutes)}前；角色发了还没被回的消息 ${input.unanswered} 条。`,
  );
  // 对方状态（程序推断，不读对方任何原文）：刚在聊 / 在用应用却没回（可能在忙或暂时不想回）/ 不在应用里。
  if (minutes !== null && minutes < 5) lines.push('对方刚刚还在聊天。');
  else if (input.unanswered > 0 && input.userActiveRecently)
    lines.push('对方最近在用应用，但还没回角色的消息（可能在忙或暂时不想回）。');
  else if (input.userActiveRecently === false) lines.push('对方最近半小时不在应用里。');
  const proactive =
    input.sinceProactiveMs !== undefined && Number.isFinite(input.sinceProactiveMs)
      ? Math.round(input.sinceProactiveMs / 60_000)
      : null;
  lines.push(
    proactive === null ? '角色最近没有主动找过对方。' : `角色上次主动是 ${ago(proactive)}前。`,
  );
  if (input.recent.length)
    lines.push(
      `最近对话要点：${input.recent
        .map(
          (m) =>
            `${m.who === 'user' ? '对方' : '角色'}：${scrubSummary(m.text.replace(/\s+/g, ' ').slice(0, 60), true)}`,
        )
        .join(' / ')}`,
    );
  lines.push(
    input.doneToday.length
      ? `角色今天已经做过：${input.doneToday.slice(0, 5).join('；')}。`
      : '角色今天还没主动做过什么。',
  );
  return lines.join('\n').slice(0, 600);
}

/**
 * 后台运行记录用的判定摘要（只有动作名和把握值，不含任何内容）：
 * 例 ` | ok=message:0.82 low=voice def=nudge drop=sticker unk=1`。
 */
export function jevTrace(
  verdict: ReturnType<typeof interpretJevAnswers>,
  dropped: readonly EcologyActionKey[],
): string {
  const parts = [
    verdict.approved.length
      ? `ok=${verdict.approved.map((a) => `${a.action}:${a.confidence.toFixed(2)}`).join(',')}`
      : '',
    verdict.lowConfidence.length ? `low=${verdict.lowConfidence.join(',')}` : '',
    verdict.declined.length ? `def=${verdict.declined.join(',')}` : '',
    verdict.invalid.length ? `bad=${verdict.invalid.join(',')}` : '',
    dropped.length ? `drop=${dropped.join(',')}` : '',
    verdict.unknownIds ? `unk=${verdict.unknownIds}` : '',
  ].filter(Boolean);
  return parts.length ? ` | ${parts.join(' ')}` : '';
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
