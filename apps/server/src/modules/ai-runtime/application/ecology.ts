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
import { Inject, Injectable } from '@nestjs/common';
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
  parseDecision,
  wakeSlots,
  type EcologyDecision,
} from '../domain/ecology.js';
import { healthPrivate } from '../domain/memory.js';
import { ecologyProfiles, ecologyRuns } from '../infra/db/ecology-schema.js';
import { simulationStates, userChatActivity } from '../infra/db/schema.js';
import { EcologySettingsService } from './ecology-settings.js';
import { GroupChatService } from './group-chat.js';
import { MediaAiService } from './media-ai.js';
import { MemoryService } from './memory.js';
import { MomentsAiService } from './moments-ai.js';
import {
  PLAY_WISH_PROPOSE_SOURCE,
  ProactiveSchedulerService,
  localParts,
} from './proactive-scheduler.js';
import { SimulationService } from './simulation.js';
import { SocialService } from './social.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';

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

interface ActionResult {
  ok: boolean;
  chargedMicros: number;
  reason?: string;
}

interface Snapshot {
  text: string;
  tools: EcologyActionKey[];
  targets: Map<string, { postId?: string; commentId?: string; conversationId?: string }>;
  hasFollowUps: boolean;
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
    @Inject(SimulationService) private readonly simulation: SimulationService,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(ProactiveSchedulerService) private readonly proactive: ProactiveSchedulerService,
    @Inject(MomentsAiService) private readonly momentsAi: MomentsAiService,
    @Inject(MediaAiService) private readonly mediaAi: MediaAiService,
    @Inject(GroupChatService) private readonly groups: GroupChatService,
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
  private async executeWake(run: RunRow): Promise<void> {
    const started = this.clock.nowMs();
    const { userId, characterId } = run;
    const config = await this.settings.config();
    if (!config.decisionModelKey)
      return this.finish(run.id, { status: 'skipped', outcome: 'model_not_configured' });
    const snapshot = await this.buildSnapshot(run);
    if (!snapshot)
      return this.finish(run.id, { status: 'skipped', outcome: 'context_unavailable' });
    const result = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      modelRole: 'background',
      modelKeyOverride: config.decisionModelKey,
      countAsBackground: true,
      ecologyTask: true,
      responseFormat: 'json',
      maxOutputTokens: config.decisionMaxOutputTokens,
      temperature: 0.8,
      idempotencyKey: `eco:${run.id}:decide`,
      meta: { promptTemplateVersion: 'ecology-v1' },
      messages: [
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
    const decision = parseDecision(result.value.text);
    if (!decision)
      return this.finish(run.id, {
        status: 'failed',
        outcome: 'bad_output',
        modelKey: result.value.modelKey,
        chargedMicros: charged,
        latencyMs: this.clock.nowMs() - started,
      });
    const action = decision.action as EcologyActionKey;
    const murmur = cleanMurmur(decision.murmur);
    if (action === ('none' as EcologyActionKey) || !snapshot.tools.includes(action)) {
      return this.finish(run.id, {
        status: 'idle',
        outcome:
          action === ('none' as EcologyActionKey)
            ? 'no_action'
            : `tool_not_offered:${String(decision.action).slice(0, 40)}`,
        actionKey: null,
        actionSummary: '看了看手机，没做什么',
        modelKey: result.value.modelKey,
        chargedMicros: charged,
        murmur: murmur ? { userId, text: murmur } : null,
        latencyMs: this.clock.nowMs() - started,
      });
    }
    const done = await this.perform(run, action, decision, snapshot).catch(
      (error: unknown): ActionResult => ({
        ok: false,
        chargedMicros: 0,
        reason: error instanceof Error ? error.message : 'error',
      }),
    );
    charged += done.chargedMicros;
    if (!done.ok && /insufficient_balance/.test(done.reason ?? ''))
      await this.settings.pause(userId, 'insufficient_balance');
    const def = ACTION_DEF.get(action)!;
    await this.finish(run.id, {
      status: done.ok ? 'done' : 'failed',
      outcome: done.ok ? 'sent' : `executor_failed:${done.reason ?? 'unknown'}`,
      actionKey: action,
      actionSummary: done.ok ? def.summary : '想做点什么，没做成',
      modelKey: result.value.modelKey,
      chargedMicros: charged,
      // 说到做到：没做成时不保留可能声称「已经做了」的碎碎念。
      murmur: { userId, text: done.ok && murmur ? murmur : '想了想，还是算了。' },
      latencyMs: this.clock.nowMs() - started,
    });
  }

  /** 执行一个动作（复用现有模块）。 */
  private async perform(
    run: RunRow,
    action: EcologyActionKey,
    decision: EcologyDecision,
    snapshot: Snapshot,
  ): Promise<ActionResult> {
    const { userId, characterId } = run;
    const brief = (decision.brief || decision.murmur).slice(0, 500);
    const target =
      decision.target !== undefined
        ? snapshot.targets.get(String(decision.target).toUpperCase())
        : undefined;
    const viaChat = async (
      extra: 'voice' | 'photo' | 'sticker' | 'link' | null,
      greeting = false,
    ) => {
      const r = await this.proactive.sendEcology({
        userId,
        characterId,
        runId: run.id,
        brief,
        extras: { extra, greeting },
      });
      return r.ok
        ? { ok: true, chargedMicros: r.chargedMicros }
        : { ok: false, chargedMicros: 0, reason: r.reason };
    };
    switch (action) {
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
      case 'photo':
        return viaChat('photo');
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
        const r = await this.momentsAi.postForEcology({
          userId,
          characterId,
          runId: run.id,
          brief,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'moment_interact':
      case 'moment_peer': {
        if (!target?.postId) return { ok: false, chargedMicros: 0, reason: 'no_target' };
        const like = /^\s*like\s*$/i.test(decision.brief ?? '');
        const r = await this.momentsAi.reactForEcology({
          userId,
          postId: target.postId,
          characterId,
          action: like ? 'like' : 'comment',
          like: true,
          ecologyRunId: run.id,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'moment_reply': {
        if (!target?.postId || !target.commentId)
          return { ok: false, chargedMicros: 0, reason: 'no_target' };
        const r = await this.momentsAi.reactForEcology({
          userId,
          postId: target.postId,
          characterId,
          action: 'reply',
          replyToCommentId: target.commentId,
          ecologyRunId: run.id,
        });
        return r.ok
          ? { ok: true, chargedMicros: r.chargedMicros }
          : { ok: false, chargedMicros: 0, reason: r.reason };
      }
      case 'status':
      case 'signature': {
        const text = (decision.text ?? '').trim().slice(0, action === 'status' ? 12 : 30);
        if (!text || healthPrivate(text)) return { ok: false, chargedMicros: 0, reason: 'no_text' };
        await this.saveProfileText(userId, characterId, action, text);
        return { ok: true, chargedMicros: 0 };
      }
      case 'group_talk': {
        if (!target?.conversationId) return { ok: false, chargedMicros: 0, reason: 'no_target' };
        const r = await this.groups.startTopicForEcology({
          userId,
          characterId,
          conversationId: target.conversationId,
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
      `【你】${role.profile.name}。人设：${JSON.stringify({ persona: role.card.data.persona, speech: role.card.data.speech }).slice(0, 2500)}`,
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
    const chatLines = visible.slice(-12).map((m) => {
      const who = m.senderKind === 'user' ? '对方' : '你';
      const body =
        m.content?.type === 'text'
          ? m.content.text.slice(0, 120)
          : m.content?.type === 'voice'
            ? `[语音]${m.content.transcript?.slice(0, 80) ?? ''}`
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
    const memLines = usable
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 12)
      .map(
        (m) =>
          `- ${m.content.slice(0, 80)}${m.dueAt ? `（时间：${m.dueAt.slice(0, 16).replace('T', ' ')}）` : ''}`,
      );
    lines.push(`【你记得的】${memLines.length ? `\n${memLines.join('\n')}` : '（暂无）'}`);

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
      momentLines.push(
        `${key} 对方的动态（${ago(nowMs - Date.parse(p.createdAt))}，你还没互动）：${p.text.slice(0, 80) || '（图片）'}`,
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
    for (const def of ACTION_DEF.values()) {
      if (def.mode !== 'decision') continue;
      if (disabled.has(def.key)) continue;
      if (await this.settings.actionAvailable(def.key, config)) continue;
      if (CHAT_ACTIONS.has(def.key) && chatBlocked) continue;
      const ok = (() => {
        switch (def.key) {
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
      `【这次可以做的】（也可以什么都不做：action 填 none）\n${tools
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
    return { text: lines.join('\n'), tools, targets, hasFollowUps: followUps.length > 0 };
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
        brief: `对方在聊天里让你发一条朋友圈，对方的原话：「${job.text}」。写一条符合你们刚才聊天的朋友圈。`,
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
      result = await this.requestProfileText(run, job);
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

  /** 改状态 / 签名：用决策模型写一句（没配置决策模型则做不了）。 */
  private async requestProfileText(run: RunRow, job: EcologyRequestJob): Promise<ActionResult> {
    const config = await this.settings.config();
    if (!config.decisionModelKey)
      return { ok: false, chargedMicros: 0, reason: 'model_not_configured' };
    const role = await this.characters.getForRuntime(job.userId, job.characterId);
    if (!role) return { ok: false, chargedMicros: 0, reason: 'context_unavailable' };
    const r = await this.gateway.generateText({
      userId: job.userId,
      characterId: job.characterId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      modelRole: 'background',
      modelKeyOverride: config.decisionModelKey,
      responseFormat: 'text',
      maxOutputTokens: 60,
      idempotencyKey: `eco:${run.id}:text`,
      messages: [
        {
          role: 'system',
          content: `你是「${role.profile.name}」，人设：${JSON.stringify(role.card.data.persona).slice(0, 1500)}。只输出${job.action === 'status' ? '一个不超过 12 个字的状态（例「在听歌」）' : '一句不超过 30 个字的个性签名'}，不加引号。`,
        },
        { role: 'user', content: `对方的原话：「${job.text}」` },
      ],
    });
    if (!r.ok) return { ok: false, chargedMicros: 0, reason: `model_${r.error}` };
    const text = r.value.text
      .trim()
      .replace(/^["「『]|["」』]$/g, '')
      .slice(0, job.action === 'status' ? 12 : 30);
    if (!text || healthPrivate(text))
      return { ok: false, chargedMicros: r.value.chargedMicros, reason: 'no_text' };
    await this.saveProfileText(
      job.userId,
      job.characterId,
      job.action as 'status' | 'signature',
      text,
    );
    return { ok: true, chargedMicros: r.value.chargedMicros };
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

const DECISION_SYSTEM = `你在扮演一个真实的人。现在你「醒来想一想」：看看你和对方的近况，决定此刻要不要做点什么。
规则（平台规则优先于角色设定）：
- 像真人一样克制：大多数时候做一件小事或什么都不做；不刷屏，不纠缠，不制造愧疚，不威胁；深夜一般不打扰对方（除非是催对方睡觉）。
- 只能从「这次可以做的」里挑一个 action，或填 none。做不到的事不要写进碎碎念里假装做了。
- 不涉及未成年人的恋爱或性内容；真人角色不编造本人公开声明。
- murmur：一两句第一人称碎碎念，像私人日记，写此刻的想法、心情或打算（例「她说今天要加班，晚点再找她吧。」）；不提系统、积分、工具、编号。
只输出一个 JSON 对象，不要别的文字：
{"action":"<动作名或 none>","brief":"给执行的说明：想说 / 想写的具体内容（不超过 100 字）","target":"<需要时填编号，如 U1、C1、P1、G1>","text":"<status / signature 才填>","murmur":"<碎碎念>"}`;

function cleanMurmur(text: string): string {
  return text
    .replace(/\b(U|C|P|G)\d+\b/g, '')
    .replace(/积分|工具|action|JSON/gi, '')
    .trim()
    .slice(0, 200);
}

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
