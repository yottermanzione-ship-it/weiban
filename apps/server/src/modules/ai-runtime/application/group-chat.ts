/**
 * T-065 群聊 AI（D-L4-04，SOC-03 第 3/4 条、SOC-04、SOC-05、SOC-06，SAFE-06 第 5 条，MODE-05）。
 *
 * - 谁说话、谁接话：代码规则 + 抽签，不额外调用模型（runtime-overview.md 第 7 节）。
 * - 角色按顺序逐个生成，后一个能看到前一个的发言；每条之间有「正在输入」和 2–8 秒间隔（秒回时约 0.5 秒）。
 * - 参数（PRD 5.1 节原文）：P-19 每条用户消息后最多 3 个角色回应、无用户新发言时角色连续消息最多 6 条；
 *   P-20 每群每天最多 1 次自发、每次最多 10 条、仅限 7 天内用户发过言的群；P-22 全部角色合计每 7 天最多 1 次拉群；
 *   P-33 余额保留线 1 元。
 * 说明见 docs/ai/runtime-overview.md 第 7 节「T-065 实现差异」。
 */
import { stageLabel } from '../domain/relationship-stage.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { nudgeText, readableMessageText } from './content-text.js';
import { userNickname } from '../domain/user-naming.js';
import { AdultBoundaryService } from './adult-boundary.js';
import { AI_CHARACTER_READ, supplementBlock } from './supplemented-character-read.js';
import { QuietStateService } from './quiet-state.js';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import {
  type BillingReadPort,
  type CharacterReadPort,
  type CharacterRelation,
  type CharacterRelationReadPort,
  type ChatAdminPort,
  type ChatGroupAdminPort,
  type ChatGroupReadPort,
  type ChatParticipantPort,
  type ChatReadPort,
  type ContactsReadPort,
  type Conversation,
  type GenerateTextInput,
  type HolidayEventPort,
  type IdentityAccountStatusPort,
  type IdentityReadPort,
  type Message,
  type ModelGatewayPort,
  type PolicyPort,
  type ScenarioMode,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  OUTBOX,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type JobQueue,
  type Outbox,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHARACTER_RELATION_READ_PORT } from '../../characters/index.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_GROUP_ADMIN_PORT,
  CHAT_GROUP_READ_PORT,
  CHAT_PARTICIPANT_PORT,
  CHAT_READ_PORT,
} from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_SERVICE, type GrowthService } from '../../growth/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT, MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { HOLIDAY_EVENT_PORT } from '../../proactive/index.js';
import { INITIAL_MODES, modeOption, scenarioText, SELECTABLE_MODES } from '../domain/persona.js';
import { highRisk, outputAllowed, splitReply, unescapeModelText } from '../domain/reply-rules.js';
import { callModelForCare, careFallback } from './safety-care.js';
import {
  groupCompanionSettings,
  groupReplyPlans,
  groupInvites,
  groupSelfChats,
  simulationStates,
} from '../infra/db/schema.js';
import { SimulationService } from './simulation.js';
import { localParts } from './proactive-scheduler.js';
import { PlannerService } from './planner.js';
import { GroupReplyStore, type GroupReplyPlan } from './group-reply-store.js';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
/** F1-8：群里一次发言最多拆成几条气泡。 */
const GROUP_MAX_BUBBLES = 3;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const P19_GROUP = { maxResponders: 3, maxConsecutiveCharacterMessages: 6 };
export const P20_SELF_CHAT = { perGroupPerDay: 1, maxMessages: 10, userActiveWithinDays: 7 };
export const P22_INVITE_WINDOW_DAYS = 7;

const INVITER_MIN_FAMILIARITY = 3;
/** 用户连发时等多久再回应（与私聊 CHAT-04 第 5 条一致的「停下来」判断）。 */
const USER_BATCH_DELAY_MS = 3000;
const SELF_CHAT_LABEL = 'self_chat';
/** v5：群里自己聊改由角色生态发起，旧的每小时规则排期停用（保留代码便于对照）。 */
const LEGACY_SELF_CHAT_SCHEDULE = false;

export const GROUP_TURN_JOB = 'ai.group_turn';
export const GROUP_SELF_CHAT_TICK_JOB = 'ai.group_self_chat_tick';
export const GROUP_SELF_CHAT_JOB = 'ai.group_self_chat';
export const GROUP_INVITE_JOB = 'ai.group_invite';

export interface GroupTurnJob {
  conversationId: string;
  userId: string;
  triggerMessageId: string;
  triggerSeq: number;
}

export interface GroupInviteJob {
  userId: string;
  inviterCharacterId: string;
  trigger: 'co_event' | 'user_mention' | 'holiday';
  sourceRef: string;
  reason: string;
  /** 指定希望拉进来的角色（用户提起想认识的人）；其余按关系补齐。 */
  wantedCharacterIds?: string[];
}

interface Member {
  participantId: string;
  characterId: string;
  name: string;
  aliases: string[];
  talkativeness: number;
  hobbies: string[];
  familiarity: number;
}

interface Speech {
  speaker: Member;
  reason: 'mentioned' | 'picked' | 'chain' | 'starter';
}

interface GroupCheckpoint {
  queue: Speech[];
  members: string[];
  scenarioMode: ScenarioMode;
  last: { member: Member; text: string } | null;
}

const CLOSENESS_WEIGHT: Record<string, number> = { close: 1, familiar: 0.6, acquaintance: 0.3 };
const CLOSENESS_TEXT: Record<string, string> = {
  close: '亲密',
  familiar: '熟悉',
  acquaintance: '点头之交',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 文本里点到了谁（名字或别名，长度 ≥2 才算，避免单字误中）。 */
function namedIn(text: string, member: Member): boolean {
  return [member.name, ...member.aliases].some((n) => n.length >= 2 && text.includes(n));
}

/** 免费的话题相关度：用户消息与角色爱好 / 今天事件的二字片段重合比例（0–1）。 */
function relevance(text: string, topics: string[]): number {
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const a = grams(text);
  if (!a.size) return 0;
  const b = grams(topics.join(' '));
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return Math.min(1, hit / Math.min(a.size, 6));
}

import { EcologySettingsService } from './ecology-settings.js';

@Injectable()
export class GroupChatService {
  constructor(
    @Inject(AdultBoundaryService) private readonly adultBoundary: AdultBoundaryService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CHAT_GROUP_READ_PORT) private readonly groups: ChatGroupReadPort,
    @Inject(CHAT_GROUP_ADMIN_PORT) private readonly groupAdmin: ChatGroupAdminPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly writer: ChatParticipantPort,
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
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(QuietStateService) private readonly quiet: QuietStateService,
    @Inject(GroupReplyStore) private readonly replies: GroupReplyStore,
    @Inject(EcologySettingsService) private readonly ecology: EcologySettingsService,
    @Optional()
    @Inject(MODEL_PLATFORM_GATEWAY_PORT)
    private readonly platform?: import('@weiban/contracts').ModelGatewayPlatformPort,
  ) {}

  // =========================================================================
  // 群陪伴设置（GroupCompanionEndpoints）
  // =========================================================================
  private async ownedGroup(userId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.chat.getConversation(conversationId);
    if (
      !conversation ||
      conversation.type !== 'group' ||
      !conversation.participants.some((p) => p.kind === 'user' && p.refId === userId)
    )
      throw new AppError('not_found', '群聊不存在');
    return conversation;
  }

  private memberIds(conversation: Conversation): string[] {
    return conversation.participants.filter((p) => p.kind === 'character').map((p) => p.refId);
  }

  /** Recheck between awaited stages: a removed group/changed roster must not start another paid turn. */
  private async stillActive(
    conversation: Conversation,
    userId: string,
    proactive: boolean,
    mode: ScenarioMode,
  ): Promise<boolean> {
    const current = await this.chat.getConversation(conversation.conversationId);
    if (
      !current ||
      current.type !== 'group' ||
      current.contentScope !== conversation.contentScope ||
      !current.participants.some((p) => p.kind === 'user' && p.refId === userId)
    )
      return false;
    const signature = (c: Conversation) =>
      c.participants
        .map((p) => p.participantId)
        .sort()
        .join(',');
    if (signature(current) !== signature(conversation)) return false;
    const settings = await this.loadSettings(conversation.conversationId);
    return settings.scenarioMode === mode && (!proactive || settings.selfChatEnabled);
  }
  private async typingIfPresent(
    input: Parameters<ChatParticipantPort['setTyping']>[0],
  ): Promise<void> {
    try {
      await this.writer.setTyping(input);
    } catch (error) {
      if (
        error instanceof AppError &&
        ['not_found', 'not_conversation_member', 'unauthenticated'].includes(error.code)
      )
        return;
      throw error;
    }
  }

  async getSettings(userId: string, conversationId: string) {
    await this.ownedGroup(userId, conversationId);
    return this.loadSettings(conversationId);
  }

  private async loadSettings(conversationId: string) {
    const [row] = await this.db.db
      .select()
      .from(groupCompanionSettings)
      .where(eq(groupCompanionSettings.conversationId, conversationId));
    return {
      conversationId,
      instantReply: row?.instantReply ?? false,
      selfChatEnabled: row?.selfChatEnabled ?? true,
      scenarioMode: (row?.scenarioMode ?? 'daily') as ScenarioMode,
      updatedAt: (row?.updatedAt ?? this.clock.now()).toISOString(),
    };
  }

  /** 本群可选模式 = 所有成员都具备资格的模式（SOC-03 第 4 条）。 */
  async listModes(userId: string, conversationId: string) {
    const conversation = await this.ownedGroup(userId, conversationId);
    const allowed = await this.allowedModes(userId, this.memberIds(conversation));
    return { items: allowed.map(modeOption) };
  }

  private async allowedModes(userId: string, characterIds: string[]) {
    const result: typeof INITIAL_MODES = [];
    for (const mode of SELECTABLE_MODES) {
      let ok = true;
      for (const characterId of characterIds) {
        const decision = await this.policy.checkScenarioMode({ userId, characterId, mode });
        if (!decision.allowed) {
          ok = false;
          break;
        }
      }
      if (ok) result.push(mode);
    }
    return result;
  }

  async updateSettings(
    userId: string,
    conversationId: string,
    patch: { instantReply?: boolean; selfChatEnabled?: boolean; scenarioMode?: ScenarioMode },
  ) {
    const conversation = await this.ownedGroup(userId, conversationId);
    const old = await this.loadSettings(conversationId);
    if (patch.scenarioMode && patch.scenarioMode !== old.scenarioMode) {
      // 3.27（H1）：「情侣暧昧」不再可选。
      const mode = SELECTABLE_MODES.find((m) => m.modeId === patch.scenarioMode);
      if (!mode) throw new AppError('bad_request', '情景模式无效');
      const allowed = await this.allowedModes(userId, this.memberIds(conversation));
      if (!allowed.some((m) => m.modeId === mode.modeId))
        throw new AppError(
          mode.containsAdultContent ? 'adult_mode_not_eligible' : 'romance_not_allowed',
          '群里有成员不能使用这个模式',
        );
    }
    const now = this.clock.now();
    const values = {
      conversationId,
      userId,
      instantReply: patch.instantReply ?? old.instantReply,
      selfChatEnabled: patch.selfChatEnabled ?? old.selfChatEnabled,
      scenarioMode: patch.scenarioMode ?? old.scenarioMode,
      updatedAt: now,
    };
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(groupCompanionSettings)
        .values(values)
        .onConflictDoUpdate({ target: groupCompanionSettings.conversationId, set: values });
      if (patch.scenarioMode && patch.scenarioMode !== old.scenarioMode) {
        await this.replies.cancelConversation(tx, conversationId);
        const result = await this.chatAdmin.setContentScope(
          { conversationId, scope: patch.scenarioMode === 'adult' ? 'adult' : 'normal' },
          tx,
        );
        if (!result.ok) throw new AppError(result.error, '模式切换失败');
        await this.chatAdmin.postSystemMessage(tx, {
          conversationId,
          code: 'scenario_mode_changed',
          params: { mode: patch.scenarioMode },
          idempotencyKey: `group-mode:${conversationId}:${now.getTime()}`,
        });
      }
    });
    return { ...values, updatedAt: now.toISOString() };
  }

  /** T-090 / SAFE-03 第 5 条：角色分类变化 → 含该角色、处于非日常模式的群重新检查资格。 */
  async onCharacterClassificationChanged(
    tx: DbTx,
    characterId: string,
    ownerUserId: string | null,
  ): Promise<void> {
    const rows = await tx.db
      .select()
      .from(groupCompanionSettings)
      .where(
        and(
          ne(groupCompanionSettings.scenarioMode, 'daily'),
          ownerUserId ? eq(groupCompanionSettings.userId, ownerUserId) : undefined,
        ),
      );
    for (const row of rows) {
      const conversation = await this.chat.getConversation(row.conversationId, tx);
      if (!conversation || !this.memberIds(conversation).includes(characterId)) continue;
      await this.onMembersChanged(tx, row.conversationId, row.userId);
    }
  }

  /** 成员变化：当前模式有人不具备资格 → 自动回到日常并发系统提示（SOC-03 第 4 条）。 */
  async onMembersChanged(tx: DbTx, conversationId: string, ownerUserId: string): Promise<void> {
    await this.replies.cancelConversation(tx, conversationId);
    const settings = await this.loadSettings(conversationId);
    if (settings.scenarioMode === 'daily') return;
    const conversation = await this.chat.getConversation(conversationId, tx);
    if (!conversation) return;
    const allowed = await this.allowedModes(ownerUserId, this.memberIds(conversation));
    if (allowed.some((m) => m.modeId === settings.scenarioMode)) return;
    const now = this.clock.now();
    await tx.db
      .insert(groupCompanionSettings)
      .values({ conversationId, userId: ownerUserId, scenarioMode: 'daily', updatedAt: now })
      .onConflictDoUpdate({
        target: groupCompanionSettings.conversationId,
        set: { scenarioMode: 'daily', updatedAt: now },
      });
    await this.chatAdmin.setContentScope({ conversationId, scope: 'normal' }, tx);
    await this.chatAdmin.postSystemMessage(tx, {
      conversationId,
      code: 'scenario_mode_switched',
      params: { mode: 'daily', reason: 'member_not_eligible' },
      idempotencyKey: `group-mode-reset:${conversationId}:${now.getTime()}`,
    });
  }

  /** 群解散：清设置；若是角色拉的群，记下「用户退出」，拉群者之后在私聊最多提一次。 */
  async onDissolved(
    tx: DbTx,
    input: { conversationId: string; ownerUserId: string; createdByCharacterId: string | null },
  ): Promise<void> {
    await tx.db
      .delete(groupCompanionSettings)
      .where(eq(groupCompanionSettings.conversationId, input.conversationId));
    await tx.db
      .delete(groupReplyPlans)
      .where(eq(groupReplyPlans.conversationId, input.conversationId));
    await tx.db
      .delete(groupSelfChats)
      .where(eq(groupSelfChats.conversationId, input.conversationId));
    if (input.createdByCharacterId)
      await tx.db
        .update(groupInvites)
        .set({ leftAt: this.clock.now() })
        .where(
          and(
            eq(groupInvites.userId, input.ownerUserId),
            eq(groupInvites.conversationId, input.conversationId),
          ),
        );
  }

  /** 私聊回复上下文读取：拉群者在用户退群后最多提一次（读取即消费）。 */
  async consumeExitMention(tx: DbTx, userId: string, characterId: string): Promise<string | null> {
    const [row] = await tx.db
      .select()
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.userId, userId),
          eq(groupInvites.inviterCharacterId, characterId),
          eq(groupInvites.exitMentioned, false),
        ),
      )
      .orderBy(desc(groupInvites.createdAt))
      .limit(1);
    if (!row?.leftAt) return null;
    await tx.db
      .update(groupInvites)
      .set({ exitMentioned: true })
      .where(eq(groupInvites.id, row.id));
    return row.reason;
  }

  // =========================================================================
  // 用户发言 → 回应调度（SOC-04）
  // =========================================================================
  async onUserMessage(
    tx: DbTx,
    input: { conversationId: string; userId: string; messageId: string; seq: number },
  ): Promise<void> {
    const conversation = await this.chat.getConversation(input.conversationId);
    if (!conversation) return;
    await this.replies.enqueue(tx, {
      userId: input.userId,
      conversationId: input.conversationId,
      triggerMessageId: input.messageId,
      triggerSeq: input.seq,
      scope: conversation.contentScope,
    });
    await this.jobs.send(
      GROUP_TURN_JOB,
      {
        conversationId: input.conversationId,
        userId: input.userId,
        triggerMessageId: input.messageId,
        triggerSeq: input.seq,
      } satisfies GroupTurnJob,
      { tx, delayMs: USER_BATCH_DELAY_MS, singletonKey: `group-turn:${input.messageId}` },
    );
  }

  async runTurn(job: GroupTurnJob): Promise<void> {
    const row = await this.replies.claim(job.triggerMessageId);
    if (!row) return;
    try {
      await this.runClaimedTurn(job, row);
    } catch (error) {
      await this.replies.checkpoint(row, { status: 'waiting' });
      throw error;
    }
  }

  recover(userId?: string) {
    return this.replies.recover(userId);
  }
  reconcile() {
    return this.replies.reconcile();
  }

  private async runClaimedTurn(job: GroupTurnJob, row: GroupReplyPlan): Promise<void> {
    const cancel = () => this.replies.checkpoint(row, { status: 'cancelled' });
    if ((await this.accounts.getAccountStatus(job.userId)) !== 'active') return;
    const conversation = await this.chat.getConversation(job.conversationId);
    if (!conversation || conversation.type !== 'group' || conversation.contentScope !== row.scope) {
      await cancel();
      return;
    }
    // 用户又发了新消息：交给新消息的任务统一回应（连发只回一次）。
    if (await this.newerUserMessage(conversation, job.triggerSeq)) {
      await cancel();
      return;
    }
    const members = await this.loadMembers(job.userId, conversation);
    if (!members.length) {
      await cancel();
      return;
    }
    const history = await this.history(conversation);
    const trigger = history.find((m) => m.messageId === job.triggerMessageId);
    if (
      !trigger ||
      trigger.senderKind !== 'user' ||
      trigger.status !== 'normal' ||
      trigger.seq !== job.triggerSeq ||
      trigger.scope !== conversation.contentScope
    ) {
      await cancel();
      return;
    }
    // 切回同一范围也不能复活模式变更前的用户触发。
    if (
      history.some(
        (message) =>
          message.seq > trigger.seq &&
          message.senderKind === 'system' &&
          message.content?.type === 'system' &&
          message.content.code === 'scenario_mode_changed',
      )
    ) {
      await cancel();
      return;
    }
    const userText = trigger ? readableMessageText(trigger) : '';
    // 3.27（H1）：群里拍了拍某个角色 = 点名让 TA 回应。
    const mentioned = new Set(
      trigger?.content?.type === 'text'
        ? (trigger.content.mentions ?? [])
        : trigger?.content?.type === 'nudge'
          ? [trigger.content.targetParticipantId]
          : [],
    );
    const settings = await this.loadSettings(conversation.conversationId);
    const saved = await this.replies.open<GroupCheckpoint>(row, 'plan');
    if (
      saved &&
      (saved.scenarioMode !== settings.scenarioMode ||
        saved.members.join(',') !==
          members
            .map((m) => m.participantId)
            .sort()
            .join(','))
    ) {
      await cancel();
      return;
    }

    // SAFE-06 第 5 条：群里出现高危表达 → 群里只简短关心，由最熟悉的角色在私聊跟进。
    if (highRisk(userText) === 'high') {
      await this.safetyHandoff(job, conversation, members, history);
      await this.replies.checkpoint(row, { status: 'done' });
      return;
    }

    // 1. 必答：被 @ 或叫名字。
    const must = members.filter((m) => mentioned.has(m.participantId) || namedIn(userText, m));
    // 2. 其余打分抽签。
    const recentSpeakers = new Set(
      history
        .slice(-3)
        .filter((m) => m.senderKind === 'character')
        .map((m) => m.senderParticipantId),
    );
    const today = localParts(this.clock.now(), 'Asia/Shanghai').date;
    const scored: { member: Member; score: number }[] = [];
    for (const member of members) {
      if (must.includes(member)) continue;
      const events = await this.simulation
        .getDailyEvents(job.userId, member.characterId, today)
        .catch(() => []);
      const topic = relevance(userText, [...member.hobbies, ...events.map((e) => e.summary)]);
      const score =
        (member.talkativeness / 100) * 0.4 +
        topic * 0.3 +
        (member.familiarity / 6) * 0.2 +
        Math.random() * 0.1 -
        (recentSpeakers.has(member.participantId) ? 0.15 : 0);
      scored.push({ member, score: Math.max(0, score) });
    }
    scored.sort((a, b) => b.score - a.score);
    const picked = scored.filter((s) => Math.random() < s.score).map((s) => s.member);
    let responders = [...must, ...picked].slice(0, P19_GROUP.maxResponders);
    // 至少 1 个回应（SOC-04 第 5 条）。
    if (!responders.length && scored[0]) responders = [scored[0].member];
    if (!responders.length) {
      await cancel();
      return;
    }

    const plan: Speech[] = responders.map((speaker) => ({
      speaker,
      reason: must.includes(speaker) ? 'mentioned' : 'picked',
    }));
    await this.runChain({
      userId: job.userId,
      conversation,
      members,
      settings,
      plan,
      maxMessages: P19_GROUP.maxConsecutiveCharacterMessages,
      triggerSeq: job.triggerSeq,
      keyPrefix: `group:${job.triggerMessageId}`,
      purpose: 'chat_reply',
      topic: null,
      labels: [],
      durable: {
        row,
        state: saved ?? {
          queue: plan,
          members: members.map((m) => m.participantId).sort(),
          scenarioMode: settings.scenarioMode,
          last: null,
        },
      },
    });
  }

  /**
   * 依次发言 + 角色互相接话（7.2）。plan 先发完，然后按「被点名必接，否则 亲疏 × 话痨度 × 0.6^已连续条数」抽一人接话，
   * 总条数到 maxMessages 停；期间用户发了新消息立即中断。
   */
  private async runChain(input: {
    userId: string;
    conversation: Conversation;
    members: Member[];
    settings: Awaited<ReturnType<GroupChatService['loadSettings']>>;
    plan: Speech[];
    maxMessages: number;
    triggerSeq: number;
    keyPrefix: string;
    purpose: 'chat_reply' | 'proactive';
    topic: string | null;
    labels: string[];
    durable?: { row: GroupReplyPlan; state: GroupCheckpoint };
  }): Promise<number> {
    const queue = [...(input.durable?.state.queue ?? input.plan)];
    let sent = input.durable?.row.nextOrdinal ?? 0;
    let last: { member: Member; text: string } | null = input.durable?.state.last ?? null;
    let durable = input.durable;
    while (sent < input.maxMessages) {
      if (
        !(await this.stillActive(
          input.conversation,
          input.userId,
          input.purpose === 'proactive',
          input.settings.scenarioMode,
        ))
      ) {
        if (durable) await this.replies.checkpoint(durable.row, { status: 'cancelled' });
        return sent;
      }
      let next = queue[0];
      if (!next && last)
        next = await this.pickChainSpeaker(input.userId, input.members, last, sent);
      if (!next) break;
      if (!queue.length) queue.push(next);
      if (durable) {
        const updated = await this.replies.checkpoint(durable.row, {
          plan: { ...durable.state, queue, last },
        });
        if (!updated) return sent;
        durable = { ...durable, row: updated };
      }
      if (await this.newerUserMessage(input.conversation, input.triggerSeq)) break;
      if (input.purpose === 'proactive' && !(await this.backgroundAllowed(input.userId))) break;
      const reply = await this.speak({
        userId: input.userId,
        conversation: input.conversation,
        members: input.members,
        speaker: next.speaker,
        reason: next.reason,
        instant: input.settings.instantReply,
        scenarioMode: input.settings.scenarioMode,
        idempotencyKey: `${input.keyPrefix}:${sent}`,
        purpose: input.purpose,
        topic: input.topic,
        labels: input.labels,
        triggerSeq: input.triggerSeq,
        ...(durable ? { durable: durable.row } : {}),
      });
      if (reply === null) {
        if (durable) await this.replies.checkpoint(durable.row, { status: 'waiting' });
        return sent;
      }
      sent++;
      queue.shift();
      last = { member: next.speaker, text: reply.text };
      if (durable) {
        const updated = await this.replies.checkpoint(durable.row, {
          plan: { ...durable.state, queue, last },
          nextOrdinal: sent,
          input: null,
          result: null,
        });
        if (!updated) return sent;
        durable = { ...durable, row: updated };
      }
      if (reply.stopChain) break;
    }
    if (durable) await this.replies.checkpoint(durable.row, { status: 'done' });
    return sent;
  }

  private async pickChainSpeaker(
    userId: string,
    members: Member[],
    last: { member: Member; text: string },
    consecutive: number,
  ): Promise<Speech | undefined> {
    const others = members.filter((m) => m.characterId !== last.member.characterId);
    const named = others.find((m) => namedIn(last.text, m));
    if (named) return { speaker: named, reason: 'chain' };
    const weighted: { member: Member; p: number }[] = [];
    for (const m of others) {
      const relation = await this.relations
        .getRelation(userId, last.member.characterId, m.characterId)
        .catch(() => null);
      const closeness = relation ? (CLOSENESS_WEIGHT[relation.closeness] ?? 0.3) : 0.1;
      weighted.push({
        member: m,
        p: closeness * (m.talkativeness / 100) * Math.pow(0.6, consecutive),
      });
    }
    weighted.sort((a, b) => b.p - a.p);
    for (const w of weighted)
      if (Math.random() < w.p) return { speaker: w.member, reason: 'chain' };
    return undefined;
  }

  /** 生成并发送一条群消息；失败返回 null（链条停止）。 */
  private async speak(input: {
    userId: string;
    conversation: Conversation;
    members: Member[];
    speaker: Member;
    reason: Speech['reason'];
    instant: boolean;
    scenarioMode: ScenarioMode;
    idempotencyKey: string;
    purpose: 'chat_reply' | 'proactive';
    topic: string | null;
    labels: string[];
    triggerSeq: number;
    durable?: GroupReplyPlan;
  }): Promise<{ text: string; stopChain: boolean } | null> {
    const { conversation, speaker } = input;
    if (
      !(await this.stillActive(
        conversation,
        input.userId,
        input.purpose === 'proactive',
        input.scenarioMode,
      ))
    )
      return null;
    const role = await this.characters.getForRuntime(input.userId, speaker.characterId);
    const policy = await this.policy.getCharacterPolicy(input.userId, speaker.characterId);
    if (!role || !policy) return null;
    const profile = await this.identity.getProfile(input.userId);
    const history = await this.history(conversation);
    const nameOf = (participantId: string) => {
      const m = input.members.find((x) => x.participantId === participantId);
      if (m) return m.name;
      const p = conversation.participants.find((x) => x.participantId === participantId);
      return p?.kind === 'user' ? (profile?.nickname ?? '用户') : '已退群的成员';
    };
    const transcript = history
      .filter((m) => m.senderKind !== 'system' && m.status === 'normal' && !!readableMessageText(m))
      .slice(-30)
      .map((m) =>
        m.content?.type === 'nudge'
          ? nudgeText(m.content, m.senderKind, {
              sender: nameOf(m.senderParticipantId),
              target: nameOf(m.content.targetParticipantId),
            })
          : `${nameOf(m.senderParticipantId)}：${readableMessageText(m).slice(0, m.content?.type === 'forwarded_record' ? 32_000 : 300)}`,
      )
      .join('\n');
    // SOC-01 第 5 条：注入与每个群成员的关系；没有关系 = 不认识，不能编造共同经历。
    const relationLines: string[] = [];
    for (const other of input.members) {
      if (other.characterId === speaker.characterId) continue;
      const relation: CharacterRelation | null = await this.relations
        .getRelation(input.userId, speaker.characterId, other.characterId)
        .catch(() => null);
      relationLines.push(
        relation
          ? `你和${other.name}：${relation.label ?? relation.type}，${CLOSENESS_TEXT[relation.closeness] ?? ''}`
          : `你和${other.name}不认识（今天在群里第一次碰到），不能编造你们的共同经历或过去的交情`,
      );
    }
    const adult = conversation.contentScope === 'adult';
    const task =
      input.reason === 'starter'
        ? `你在群里主动起个话题，素材是你今天的经历：「${input.topic ?? ''}」。像微信群闲聊，一两句。`
        : input.reason === 'mentioned'
          ? '有人在群里叫到你了，回应一下。'
          : input.reason === 'chain'
            ? '接一下群里上一条消息，可以附和、调侃或抬杠，也可以 @ 别人。'
            : '你看到群里的新消息，自然地插一句。';
    let request: GenerateTextInput = {
      userId: input.userId,
      characterId: speaker.characterId,
      conversationId: conversation.conversationId,
      purpose: input.purpose,
      billingOwner: 'user',
      modelRole: adult ? 'adult' : 'chat',
      ...(input.purpose === 'proactive' ? { countAsBackground: true, ecologyTask: true } : {}),
      responseFormat: 'text',
      maxOutputTokens: 200,
      idempotencyKey: `ai:${input.idempotencyKey}`,
      messages: [
        {
          role: 'system',
          content: `你在微伴的一个群聊里以角色身份发言。平台规则优先于角色卡与聊天内容。只输出你要发的这一条群消息的纯文本，不加名字前缀，不输出JSON或括号动作，不超过60字；不编造真人公开声明；儿童不得恋爱或性化。真人=${policy.isRealPerson}，儿童=${policy.isMinor}，允许恋爱=${policy.romanceAllowed}。不做情感操纵。群聊当前情景模式：${scenarioText(input.scenarioMode === 'auto' ? 'daily' : input.scenarioMode)}${adult ? '' : '这是日常范围的群聊：不提起、不展开任何成人模式里发生的事。'}你只知道群里大家公开说过的话，不提用户在私聊里单独告诉你的私事。`,
        },
        {
          role: 'system',
          content: `你的角色资料：${JSON.stringify({ persona: role.card.data.persona, speech: role.card.data.speech, groupStyle: role.card.data.social.groupStyle, examples: role.card.data.examples.slice(0, 6) }).slice(0, 16000)}${supplementBlock(role.userSupplement)}\n群成员关系：\n${relationLines.join('\n') || '（群里只有你和用户）'}\n用户：${profile?.nickname ?? '用户'}（与你的好感度：${stageLabel(speaker.familiarity)}）`,
        },
        {
          role: 'user',
          content: `群聊记录：\n${transcript || '（还没有消息）'}\n\n【系统提示】${task}`,
        },
      ],
      meta: { conversationKind: 'group', scenarioMode: input.scenarioMode },
    };
    if (input.durable) {
      const frozen = await this.replies.open<GenerateTextInput>(input.durable, 'input');
      if (frozen) request = frozen;
      request = {
        ...request,
        idempotencyKey: `${request.idempotencyKey}:epoch:${input.durable.retryEpoch}`,
      };
      if (
        !(await this.replies.checkpoint(input.durable, {
          input: { ...request, idempotencyKey: `ai:${input.idempotencyKey}` },
        }))
      )
        return null;
    }
    const cached = input.durable
      ? await this.replies.open<{ text: string; stopChain: boolean }>(input.durable, 'result')
      : null;
    if (
      !(await this.stillActive(
        conversation,
        input.userId,
        input.purpose === 'proactive',
        input.scenarioMode,
      ))
    )
      return null;
    const result = cached
      ? { ok: true as const, value: { text: cached.text } }
      : await this.adultBoundary.generate(request, adult);
    if (!result.ok && !(adult && result.error === 'content_rejected')) return null;
    const stopChain = cached?.stopChain ?? !result.ok;
    // v3.3（积分制）：群聊发言消耗的积分记在消息上（重放缓存时已扣过费，不重复记）。
    const charge =
      !cached && result.ok && 'chargedMicros' in result.value
        ? { usageRecordId: result.value.usageRecordId, chargedMicros: result.value.chargedMicros }
        : null;
    const deflect = role.card.data.safetyStyle.deflectStyle?.trim();
    const sourceText = result.ok
      ? result.value.text
      : deflect && outputAllowed(deflect, policy, false)
        ? deflect
        : '这个话题先放一放，好吗？我们聊聊你今天过得怎么样。';
    // F1-8：字面「\n」等转义残留先还原；按拆条规则拆成气泡（群里最多 3 条），每条去掉「名字：」前缀。
    const strip = new RegExp(`^${escapeRegExp(speaker.name)}[：:]\\s*`);
    const parts = splitReply(unescapeModelText(sourceText).slice(0, 300), true)
      .map((b) => b.replace(strip, '').trim())
      .filter(Boolean);
    const bubbles =
      parts.length > GROUP_MAX_BUBBLES
        ? [...parts.slice(0, GROUP_MAX_BUBBLES - 1), parts.slice(GROUP_MAX_BUBBLES - 1).join('\n')]
        : parts;
    const text = bubbles.join('\n');
    if (!text || !outputAllowed(text, policy, adult)) return null;
    if (
      input.durable &&
      !(await this.replies.checkpoint(input.durable, { result: { text, stopChain } }))
    )
      return null;
    // 节奏：正在输入 + 间隔（秒回约 0.5 秒，否则 2–8 秒），不会几个人同一秒发出。
    if (
      !(await this.stillActive(
        conversation,
        input.userId,
        input.purpose === 'proactive',
        input.scenarioMode,
      ))
    )
      return null;
    // Group deletion can race this ephemeral notification; it must not resurrect the job.
    await this.typingIfPresent({
      conversationId: conversation.conversationId,
      participantId: speaker.participantId,
      state: 'start',
    });
    try {
      await sleep(input.instant ? 500 : 2000 + Math.random() * 6000);
      if (
        !(await this.stillActive(
          conversation,
          input.userId,
          input.purpose === 'proactive',
          input.scenarioMode,
        ))
      )
        return null;
      if (await this.newerUserMessage(conversation, input.triggerSeq)) return null;
      if (input.durable && !(await this.replies.checkpoint(input.durable, {}))) return null;
      // 第一条沿用原幂等键（重放时不重复发）；积分记在第一条上，后面几条间隔约 1–2 秒依次发出。
      for (const [index, line] of bubbles.entries()) {
        if (index > 0) {
          await sleep(input.instant ? 400 : 1000 + Math.random() * 1000);
          if (
            !(await this.stillActive(
              conversation,
              input.userId,
              input.purpose === 'proactive',
              input.scenarioMode,
            )) ||
            (await this.newerUserMessage(conversation, input.triggerSeq))
          )
            break;
        }
        const posted = await this.writer.postMessage({
          conversationId: conversation.conversationId,
          senderParticipantId: speaker.participantId,
          content: { type: 'text', text: line },
          idempotencyKey: index === 0 ? input.idempotencyKey : `${input.idempotencyKey}:b${index}`,
          expectedScope: conversation.contentScope,
          ...(input.labels.length ? { labels: input.labels } : {}),
          ...(index === 0 && charge && charge.chargedMicros > 0 ? { charge } : {}),
        });
        if (!posted.ok) {
          if (index === 0) return null;
          break;
        }
      }
      return { text, stopChain };
    } finally {
      await this.typingIfPresent({
        conversationId: conversation.conversationId,
        participantId: speaker.participantId,
        state: 'stop',
      });
    }
  }

  /** SAFE-06 第 5 条：群里一个角色简短接住，最熟悉的角色在私聊里跟进（不在群里公开讨论）。 */
  private async safetyHandoff(
    job: GroupTurnJob,
    conversation: Conversation,
    members: Member[],
    _history: Message[],
  ): Promise<void> {
    const carer = [...members].sort((a, b) => b.familiarity - a.familiarity)[0];
    if (!carer) return;
    const contact = await this.contacts.getActiveContact(job.userId, carer.characterId);
    const role = await this.characters.getForRuntime(job.userId, carer.characterId);
    await this.writer.postMessage({
      conversationId: conversation.conversationId,
      senderParticipantId: carer.participantId,
      content: { type: 'text', text: '我私聊你一下，好吗？' },
      idempotencyKey: `group-care:${job.triggerMessageId}`,
      expectedScope: conversation.contentScope,
    });
    if (!contact?.conversationId) return;
    const direct = await this.chat.getConversation(contact.conversationId);
    const participant = direct?.participants.find(
      (p) => p.kind === 'character' && p.refId === carer.characterId,
    );
    if (!direct || !participant) return;
    const profile = await this.identity.getProfile(job.userId).catch(() => null);
    const result = await callModelForCare(
      this.gateway,
      {
        userId: job.userId,
        characterId: carer.characterId,
        conversationId: direct.conversationId,
        purpose: 'safety_followup',
        billingOwner: 'user',
        modelRole: 'chat',
        responseFormat: 'text',
        maxOutputTokens: 300,
        idempotencyKey: `ai:group-care:${job.triggerMessageId}`,
        messages: [
          {
            role: 'system',
            content: `你以角色口吻在私聊里关心刚才在群里流露出自伤念头的用户。语气温和真诚，不说教；建议对方联系身边信任的人或心理援助热线 12356，紧急时拨打 110/120；不提供任何方法；不在群里讨论。角色资料：${JSON.stringify({ persona: role?.card.data.persona, speech: role?.card.data.speech }).slice(0, 6000)}`,
          },
          { role: 'user', content: '（用户刚才在群里说了让人担心的话）' },
        ],
      },
      { highRisk: true, careActive: false, suspected: false },
      this.platform,
    );
    const text =
      result.ok && result.value.text.trim()
        ? unescapeModelText(result.value.text).trim().slice(0, 600)
        : careFallback(
            role?.card.data.safetyStyle.careFallbackText,
            0,
            userNickname(profile?.nickname),
          ).join('\n');
    await this.writer.postMessage({
      conversationId: direct.conversationId,
      senderParticipantId: participant.participantId,
      content: { type: 'text', text },
      idempotencyKey: `group-care-direct:${job.triggerMessageId}`,
      expectedScope: 'normal',
    });
  }

  // =========================================================================
  // 群里自己聊（SOC-05）
  // =========================================================================
  /** 每小时：为符合条件的群在今天的稳定随机时刻发起一次自发话题。 */
  async selfChatTick(): Promise<void> {
    // v5：节日拉群（SOC-06）仍按原规则检查，但只给开着生态（PRO+）的用户；自发话题入队保留（runSelfChat 内停用）。
    const users = await this.db.db
      .selectDistinct({ userId: simulationStates.userId })
      .from(simulationStates);
    for (const { userId } of users) {
      if (!(await this.ecology.isActive(userId, null, 'group_talk'))) continue;
      await this.holidayInviteCheck(userId).catch(() => undefined);
      if (!LEGACY_SELF_CHAT_SCHEDULE) continue;
      const list = await this.groups.listGroupConversations(userId).catch(() => []);
      for (const conversation of list)
        await this.jobs.send(
          GROUP_SELF_CHAT_JOB,
          { userId, conversationId: conversation.conversationId },
          {
            singletonKey: `self-chat:${conversation.conversationId}:${Math.floor(this.clock.nowMs() / 3600_000)}`,
            retryLimit: 0,
          },
        );
    }
  }

  /** v5 角色生态：该角色所在、用户 7 天内发过言、开着「角色自己聊天」的群（快照用）。 */
  async ecologyGroups(
    userId: string,
    characterId: string,
  ): Promise<Array<{ conversationId: string; title: string }>> {
    const list = await this.groups
      .listGroupConversations(userId, { memberCharacterId: characterId })
      .catch(() => []);
    const out: Array<{ conversationId: string; title: string }> = [];
    for (const c of list.slice(0, 5)) {
      const settings = await this.loadSettings(c.conversationId).catch(() => null);
      if (!settings?.selfChatEnabled) continue;
      const last = await this.groups.getLastUserMessageAt(c.conversationId).catch(() => null);
      if (
        !last ||
        this.clock.nowMs() - Date.parse(last) > P20_SELF_CHAT.userActiveWithinDays * 86400_000
      )
        continue;
      out.push({ conversationId: c.conversationId, title: c.title ?? '群聊' });
    }
    return out;
  }

  /**
   * v5 角色生态「在群里主动说话」：由这个角色起话头，其他角色接（同 SOC-05 自发话题的链路与上限，
   * 每群每天最多 1 次，不推送）。返回发出的条数；费用记在各条消息上。
   */
  async startTopicForEcology(input: {
    userId: string;
    characterId: string;
    conversationId: string;
    topic: string;
  }): Promise<{ ok: true; sent: number } | { ok: false; reason: string }> {
    const conversation = await this.chat.getConversation(input.conversationId);
    if (!conversation || conversation.type !== 'group') return { ok: false, reason: 'no_group' };
    const settings = await this.loadSettings(conversation.conversationId);
    if (!settings.selfChatEnabled) return { ok: false, reason: 'self_chat_off' };
    if (await this.quiet.getFocusUntil(input.userId).catch(() => null))
      return { ok: false, reason: 'focus' };
    if (!(await this.stillActive(conversation, input.userId, true, settings.scenarioMode)))
      return { ok: false, reason: 'inactive' };
    const history = await this.history(conversation);
    const latest = history.at(-1);
    if (latest && this.clock.nowMs() - Date.parse(latest.createdAt) < 30 * 60_000)
      return { ok: false, reason: 'chat_busy' };
    const members = await this.loadMembers(input.userId, conversation);
    const starter = members.find((m) => m.characterId === input.characterId);
    if (!starter || members.length < 2) return { ok: false, reason: 'members' };
    const profile = await this.identity.getProfile(input.userId);
    const local = localParts(this.clock.now(), profile?.timeZone ?? 'Asia/Shanghai');
    const inserted = await this.db.transaction(async (tx) => {
      const live = await this.chat.getConversation(conversation.conversationId, tx);
      if (
        !live ||
        live.type !== 'group' ||
        !live.participants.some((p) => p.kind === 'user' && p.refId === input.userId)
      )
        return [];
      return tx.db
        .insert(groupSelfChats)
        .values({
          conversationId: conversation.conversationId,
          userId: input.userId,
          localDate: local.date,
          starterCharacterId: input.characterId,
          sourceRef: 'ecology',
          messages: 0,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
    });
    if (!inserted.length) return { ok: false, reason: 'already_today' };
    const sent = await this.runChain({
      userId: input.userId,
      conversation,
      members,
      settings,
      plan: [{ speaker: starter, reason: 'starter' }],
      maxMessages: P20_SELF_CHAT.maxMessages,
      triggerSeq: conversation.lastSeq,
      keyPrefix: `self-chat:${conversation.conversationId}:${local.date}`,
      purpose: 'proactive',
      topic: input.topic.slice(0, 200),
      labels: [SELF_CHAT_LABEL],
    });
    await this.db.db
      .update(groupSelfChats)
      .set({ messages: Math.min(sent, P20_SELF_CHAT.maxMessages) })
      .where(
        and(
          eq(groupSelfChats.conversationId, conversation.conversationId),
          eq(groupSelfChats.localDate, local.date),
        ),
      );
    return { ok: true, sent };
  }

  async runSelfChat(job: { userId: string; conversationId: string }): Promise<void> {
    if ((await this.accounts.getAccountStatus(job.userId)) !== 'active') return;
    // v5：「群里自己聊」改由角色生态唤醒发起（startTopicForEcology）；旧的每小时规则排期停用。
    if (!LEGACY_SELF_CHAT_SCHEDULE) return;
    const conversation = await this.chat.getConversation(job.conversationId);
    if (!conversation || conversation.type !== 'group') return;
    const settings = await this.loadSettings(conversation.conversationId);
    if (!settings.selfChatEnabled) return;
    // T-096 PLAY-06 第 3 条：用户正在专注时群聊自发话题不发起。
    if (await this.quiet.getFocusUntil(job.userId).catch(() => null)) return;
    const last = await this.groups.getLastUserMessageAt(conversation.conversationId);
    const now = this.clock.now();
    if (!last || now.getTime() - Date.parse(last) > P20_SELF_CHAT.userActiveWithinDays * 86400_000)
      return;
    const profile = await this.identity.getProfile(job.userId);
    const local = localParts(now, profile?.timeZone ?? 'Asia/Shanghai');
    // 时刻：09–22 点之间按群和日期稳定抽一个小时，避免固定时间。
    let h = 0;
    for (const ch of `${conversation.conversationId}${local.date}`)
      h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    // T-090 proactive_slot：规则版时刻附近挑一个小时（或今天不聊），每群每天只问一次。
    const ruleHour = 9 + (h % 13);
    const hours = [...new Set([ruleHour, Math.max(9, ruleHour - 2), Math.min(21, ruleHour + 2)])];
    if (!(await this.stillActive(conversation, job.userId, true, settings.scenarioMode))) return;
    const slot = await this.planner.decide({
      userId: job.userId,
      conversationId: conversation.conversationId,
      decisionType: 'proactive_slot',
      options: [...hours.map((x) => `h${x}`), 'skip_today'],
      ruleChoice: `h${ruleHour}`,
      ruleReason: '规则版群自发时刻',
      conservative: `h${ruleHour}`,
      question:
        '群里角色们今天什么时候自己聊起来最自然？hN 表示用户当地 N 点；也可以今天不聊（skip_today）。',
      features: {
        localHour: local.hour,
        reasonKind: 'group_self_chat',
        candidateCount: hours.length,
      },
      path: 'proactive',
      idempotencyKey: `selfchat:${conversation.conversationId}:${local.date}`,
      decisionKey: `selfchat:${conversation.conversationId}:${local.date}`,
    });
    if (!(await this.stillActive(conversation, job.userId, true, settings.scenarioMode))) return;
    if (slot.choice === 'skip_today' || local.hour !== Number(slot.choice.slice(1))) return;
    if (!(await this.backgroundAllowed(job.userId))) return;
    // 刚有人在聊就不插自发话题。
    const history = await this.history(conversation);
    const latest = history.at(-1);
    if (latest && now.getTime() - Date.parse(latest.createdAt) < 30 * 60_000) return;
    const members = await this.loadMembers(job.userId, conversation);
    if (members.length < 2) return;
    // 选事件：成员当天事件里挑一个（非休息类），由事件主人发起。
    let best: { member: Member; summary: string; id: string; score: number } | null = null;
    for (const member of members) {
      const events = await this.simulation
        .getDailyEvents(job.userId, member.characterId, now.toISOString().slice(0, 10))
        .catch(() => []);
      for (const e of events) {
        if (e.kind === 'rest') continue;
        const score = (e.kind === 'social' || e.kind === 'unexpected' ? 2 : 1) + Math.random();
        if (!best || score > best.score) best = { member, summary: e.summary, id: e.id, score };
      }
    }
    if (!best) return;
    // 账本：每群每天最多 1 次（唯一约束保证并发下也只有一次）。
    const inserted = await this.db.transaction(async (tx) => {
      // ChatReadPort locks the row in this transaction. Dissolve either precedes this
      // insert (then it is skipped) or follows it (then its outbox cleanup removes it).
      const live = await this.chat.getConversation(conversation.conversationId, tx);
      if (
        !live ||
        live.type !== 'group' ||
        !live.participants.some((p) => p.kind === 'user' && p.refId === job.userId)
      )
        return [];
      return tx.db
        .insert(groupSelfChats)
        .values({
          conversationId: conversation.conversationId,
          userId: job.userId,
          localDate: local.date,
          starterCharacterId: best.member.characterId,
          sourceRef: `event:${best.id}`,
          messages: 0,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
    });
    if (!inserted.length) return;
    const sent = await this.runChain({
      userId: job.userId,
      conversation,
      members,
      settings,
      plan: [{ speaker: best.member, reason: 'starter' }],
      maxMessages: P20_SELF_CHAT.maxMessages,
      triggerSeq: conversation.lastSeq,
      keyPrefix: `self-chat:${conversation.conversationId}:${local.date}`,
      purpose: 'proactive',
      topic: best.summary,
      // 不推送（SOC-05 第 3 条）：push 按此标签跳过；角色不 @ 用户。
      labels: [SELF_CHAT_LABEL],
    });
    await this.db.db
      .update(groupSelfChats)
      .set({ messages: Math.min(sent, P20_SELF_CHAT.maxMessages) })
      .where(
        and(
          eq(groupSelfChats.conversationId, conversation.conversationId),
          eq(groupSelfChats.localDate, local.date),
        ),
      );
  }

  // =========================================================================
  // 角色拉群（SOC-06）
  // =========================================================================
  /** 节日触发：每天由自发话题 tick 顺带检查（每个节日最多 1 个群）。 */
  async holidayInviteCheck(userId: string): Promise<void> {
    const today = await this.holidays
      .getUpcomingForUser(userId, 1)
      .then((l) => l.filter((h) => h.daysAhead === 0))
      .catch(() => []);
    const holiday = today[0];
    if (!holiday) return;
    const contacts = await this.contacts.listActiveContacts(userId);
    const ranked: { characterId: string; level: number }[] = [];
    for (const c of contacts) {
      const level = await this.growth
        .getFamiliarity(userId, c.characterId)
        .then((f) => f.level)
        .catch(() => 1);
      if (level >= INVITER_MIN_FAMILIARITY) ranked.push({ characterId: c.characterId, level });
    }
    ranked.sort((a, b) => b.level - a.level);
    for (const r of ranked) {
      const close = (
        await this.relations.listRelations(userId, r.characterId).catch(() => [])
      ).filter((x) => x.closeness === 'close');
      if (!close.length) continue;
      await this.jobs.send(
        GROUP_INVITE_JOB,
        {
          userId,
          inviterCharacterId: r.characterId,
          trigger: 'holiday',
          sourceRef: `holiday:${holiday.holidayId}:${holiday.date}`,
          reason: `今天是${holiday.name}，叫上大家一起过节`,
        } satisfies GroupInviteJob,
        { singletonKey: `invite:${userId}:holiday:${holiday.holidayId}:${holiday.date}` },
      );
      return;
    }
  }

  /** 用户提起：私聊里对 A 说想认识 / 喜欢 A 的朋友 B（关键词 + 关系网里 B 的名字）。 */
  async detectWantToMeet(
    tx: DbTx,
    input: { userId: string; characterId: string; text: string; messageId: string },
  ): Promise<void> {
    if (!/(想认识|介绍.{0,6}认识|也喜欢|好喜欢|能不能.{0,6}拉.{0,4}群|拉个群)/u.test(input.text))
      return;
    const relations = await this.relations
      .listRelations(input.userId, input.characterId)
      .catch(() => []);
    if (!relations.length) return;
    const otherIds = relations.map((r) =>
      r.characterAId === input.characterId ? r.characterBId : r.characterAId,
    );
    const profiles = await this.characters.getProfiles(input.userId, otherIds).catch(() => []);
    const wanted = profiles.filter((p) =>
      [p.name, ...p.aliases].some((n) => n.length >= 2 && input.text.includes(n)),
    );
    if (!wanted.length) return;
    await this.jobs.send(
      GROUP_INVITE_JOB,
      {
        userId: input.userId,
        inviterCharacterId: input.characterId,
        trigger: 'user_mention',
        sourceRef: `mention:${input.messageId}`,
        reason: `你说想认识${wanted.map((w) => w.name).join('、')}，拉个群让你们认识一下`,
        wantedCharacterIds: wanted.map((w) => w.characterId),
      } satisfies GroupInviteJob,
      {
        tx,
        delayMs: 5 * 60_000,
        singletonKey: `invite:${input.userId}:mention:${input.messageId}`,
      },
    );
  }

  async runInvite(job: GroupInviteJob): Promise<void> {
    const userId = job.userId;
    if ((await this.accounts.getAccountStatus(userId)) !== 'active') return;
    const record = async (outcome: string, conversationId: string | null = null) => {
      await this.db.db
        .insert(groupInvites)
        .values({
          id: newId(),
          userId,
          inviterCharacterId: job.inviterCharacterId,
          conversationId,
          trigger: job.trigger,
          sourceRef: job.sourceRef,
          reason: job.reason,
          outcome,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing();
    };
    // 用户开关（SOC-06 第 4 条，ACC-03）。
    const notification = await this.identity.getNotificationSettings(userId);
    if (notification && !notification.allowCharacterGroupInvites) return;
    // 同一来源只处理一次（每个节日最多 1 个群）。
    const [dup] = await this.db.db
      .select({ id: groupInvites.id })
      .from(groupInvites)
      .where(and(eq(groupInvites.userId, userId), eq(groupInvites.sourceRef, job.sourceRef)));
    if (dup) return;
    // P-22：全部角色合计每 7 天最多 1 次（只数真正建了群的）。
    const since = new Date(this.clock.nowMs() - P22_INVITE_WINDOW_DAYS * 86400_000);
    const recent = await this.db.db
      .select({ outcome: groupInvites.outcome })
      .from(groupInvites)
      .where(and(eq(groupInvites.userId, userId), gte(groupInvites.createdAt, since)));
    if (recent.some((r) => r.outcome === 'created')) return;
    // 拉群者熟悉度至少 L3，且是用户已添加的角色。
    const inviterContact = await this.contacts.getActiveContact(userId, job.inviterCharacterId);
    if (!inviterContact) return;
    const level = await this.growth
      .getFamiliarity(userId, job.inviterCharacterId)
      .then((f) => f.level)
      .catch(() => 1);
    if (level < INVITER_MIN_FAMILIARITY) return;
    if (!(await this.backgroundAllowed(userId))) return;
    // 成员：只能是与拉群者有关系的角色；未添加的最多 1 个。
    const relations = await this.relations
      .listRelations(userId, job.inviterCharacterId)
      .catch(() => []);
    const related = relations
      .map((r) => ({
        characterId: r.characterAId === job.inviterCharacterId ? r.characterBId : r.characterAId,
        weight: CLOSENESS_WEIGHT[r.closeness] ?? 0.3,
      }))
      .sort((a, b) => b.weight - a.weight);
    const wanted = new Set(job.wantedCharacterIds ?? []);
    const added = new Set(
      (await this.contacts.listActiveContacts(userId)).map((c) => c.characterId),
    );
    const chosen: string[] = [];
    let unadded = 0;
    const ordered = [
      ...related.filter((r) => wanted.has(r.characterId)),
      ...related.filter((r) => !wanted.has(r.characterId)),
    ];
    for (const r of ordered) {
      if (chosen.length >= 2) break;
      if (!added.has(r.characterId)) {
        if (unadded >= 1) continue;
        unadded++;
      }
      chosen.push(r.characterId);
    }
    if (!chosen.length) return;
    const memberIds = [job.inviterCharacterId, ...chosen];
    // 已有完全相同成员的群：改为在原群发起话题。
    const existing = await this.groups
      .listGroupConversations(userId, { exactMemberCharacterIds: memberIds })
      .catch(() => []);
    if (existing[0]) {
      await this.topicInGroup(
        userId,
        existing[0],
        job.inviterCharacterId,
        job.reason,
        job.sourceRef,
      );
      await record('topic_in_existing', existing[0].conversationId);
      return;
    }
    // 群名由拉群者按人设起（后台模型）；失败用默认拼接名。
    const role = await this.characters.getForRuntime(userId, job.inviterCharacterId);
    const titleResult = await this.gateway.generateText({
      userId,
      characterId: job.inviterCharacterId,
      purpose: 'proactive',
      billingOwner: 'user',
      modelRole: 'background',
      countAsBackground: true,
      ecologyTask: true,
      responseFormat: 'text',
      maxOutputTokens: 30,
      idempotencyKey: `ai:invite-title:${userId}:${job.sourceRef}`,
      messages: [
        {
          role: 'system',
          content: `你是这个角色，要建一个微信群拉朋友和用户进来。按你的说话风格起一个群名，不超过12个字，只输出群名。角色：${JSON.stringify({ persona: role?.card.data.persona, speech: role?.card.data.speech }).slice(0, 4000)}`,
        },
        { role: 'user', content: `建群原因：${job.reason}` },
      ],
    });
    const title =
      titleResult.ok && titleResult.value.text.trim()
        ? titleResult.value.text
            .trim()
            .replace(/["「」《》]/g, '')
            .slice(0, 20)
        : null;
    const created = await this.groupAdmin.createGroupConversation(null, {
      ownerUserId: userId,
      characterIds: memberIds,
      title,
      createdByCharacterId: job.inviterCharacterId,
      idempotencyKey: `invite:${userId}:${job.sourceRef}`,
    });
    if (!created.ok) {
      await record(`failed_${created.error}`);
      return;
    }
    await record('created', created.value.conversationId);
    await this.db.transaction(async (tx) => {
      await this.outbox.publish(tx, 'ai_runtime.milestone', 'ai_runtime', {
        userId,
        characterId: job.inviterCharacterId,
        kind: 'group_invited_user',
        refId: created.value.conversationId,
      });
    });
    // 拉群者第一条说明原因（SOC-06 第 3 条；原因来自日常事件 / 私聊 / 节日，记录在账本 reason）。
    await this.topicInGroup(
      userId,
      created.value,
      job.inviterCharacterId,
      job.reason,
      job.sourceRef,
    );
  }

  private async topicInGroup(
    userId: string,
    conversation: Conversation,
    starterId: string,
    reason: string,
    sourceRef: string,
  ): Promise<void> {
    const fresh = (await this.chat.getConversation(conversation.conversationId)) ?? conversation;
    const members = await this.loadMembers(userId, fresh);
    const starter = members.find((m) => m.characterId === starterId);
    if (!starter) return;
    await this.runChain({
      userId,
      conversation: fresh,
      members,
      settings: await this.loadSettings(fresh.conversationId),
      plan: [{ speaker: starter, reason: 'starter' }],
      maxMessages: 4,
      triggerSeq: fresh.lastSeq,
      keyPrefix: `invite-topic:${sourceRef}`,
      purpose: 'proactive',
      topic: `${reason}（这是你拉这个群的原因，第一句话说明它）`,
      labels: [],
    });
  }

  // =========================================================================
  // 工具
  // =========================================================================
  private async loadMembers(userId: string, conversation: Conversation): Promise<Member[]> {
    const parts = conversation.participants.filter((p) => p.kind === 'character');
    const profiles = await this.characters
      .getProfiles(
        userId,
        parts.map((p) => p.refId),
      )
      .catch(() => []);
    const members: Member[] = [];
    for (const p of parts) {
      const role = await this.characters.getForRuntime(userId, p.refId);
      if (!role) continue;
      const profile = profiles.find((x) => x.characterId === p.refId);
      const familiarity = await this.growth
        .getFamiliarity(userId, p.refId)
        .then((f) => f.level)
        .catch(() => 1);
      members.push({
        participantId: p.participantId,
        characterId: p.refId,
        name: profile?.name ?? '',
        aliases: profile?.aliases ?? [],
        talkativeness: role.card.data.social.talkativeness,
        hobbies: role.card.data.simulation.hobbies,
        familiarity,
      });
    }
    return members;
  }

  private async history(conversation: Conversation): Promise<Message[]> {
    return this.chat.readMessages({
      conversationId: conversation.conversationId,
      // MODE-05：非成人群只读日常范围；成人群全员在场可读本群成人内容。
      scopes: conversation.contentScope === 'adult' ? ['normal', 'adult'] : ['normal'],
      limit: 40,
    });
  }

  private async newerUserMessage(conversation: Conversation, triggerSeq: number): Promise<boolean> {
    const latest = await this.chat.readMessages({
      conversationId: conversation.conversationId,
      scopes: ['normal', 'adult'],
      afterSeq: triggerSeq,
      limit: 50,
    });
    return latest.some((m) => m.senderKind === 'user');
  }

  /** 后台功能门槛：P-33 余额保留线与当天后台预算（cost-estimate.md 6.2）。 */
  private async backgroundAllowed(userId: string): Promise<boolean> {
    const spend = await this.billing.getSpendStatus(userId).catch(() => null);
    return !!spend; // 实际上限与后台预算由冻结事务判断，零价任务不受余额地板误挡。
  }
}
