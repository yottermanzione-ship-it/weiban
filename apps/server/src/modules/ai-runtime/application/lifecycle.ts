import { Inject, Injectable, type OnModuleInit, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { type ChatReadPort, type ContactsReadPort } from '@weiban/contracts';
import {
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { CHARACTER_TRIAL_READ_PORT } from '../../characters/index.js';
import type { CharacterTrialReadPort } from '@weiban/contracts';
import {
  companionSettings,
  replyPlans,
  memories,
  memoryStates,
  simulationStates,
  dailyEvents,
  moodStates,
} from '../infra/db/schema.js';
import { GENERATE_REPLY_JOB, ReplyPlanStore } from './plan-store.js';
import { MemoryService, EXTRACT_MEMORY_JOB, type MemoryJob } from './memory.js';
import { ReplyEngine } from './reply-engine.js';
import { HealthCareService, HEALTH_CARE_CHECK_JOB, HEALTH_CARE_SWEEP_JOB } from './health-care.js';
import { invalidateReplyPlans } from './invalidate.js';
import {
  ProactiveSchedulerService,
  PROACTIVE_TICK_JOB,
  PROACTIVE_USER_JOB,
  PROACTIVE_CLEANUP_JOB,
} from './proactive-scheduler.js';
import {
  GroupChatService,
  GROUP_TURN_JOB,
  GROUP_SELF_CHAT_TICK_JOB,
  GROUP_SELF_CHAT_JOB,
  GROUP_INVITE_JOB,
  type GroupTurnJob,
  type GroupInviteJob,
} from './group-chat.js';
import {
  SimulationService,
  SIMULATE_CHARACTER_JOB,
  RUN_DAILY_SIMULATIONS_JOB,
} from './simulation.js';
import { SocialService, CARD_RECOMMEND_JOB, type CardRecommendJob } from './social.js';
import {
  MomentsAiService,
  MOMENTS_TICK_JOB,
  MOMENTS_USER_JOB,
  MOMENTS_REACT_JOB,
  type MomentsReactJob,
} from './moments-ai.js';
import { MediaAiService } from './media-ai.js';
import { QuietStateService } from './quiet-state.js';
import { CallSchedulerService } from './call-scheduler.js';
import { PlannerService, PLANNER_CLEANUP_JOB } from './planner.js';
import { CompanionSettingsService } from './settings.js';
import { CARE_PLAN_PREFIX } from './health-care.js';
import {
  PlayAiService,
  PLAY_DAILY_ANSWER_JOB,
  PLAY_FOCUS_LINE_JOB,
  PLAY_LETTER_REPLY_JOB,
  PLAY_LETTER_SWEEP_JOB,
  PLAY_RECOVER_JOB,
  PLAY_REMINDER_PHRASINGS_JOB,
  PLAY_TICK_JOB,
  PLAY_USER_JOB,
} from './play-ai.js';
import {
  PLAY_LETTER_ANNIV_SOURCE,
  PLAY_WISH_FOLLOW_SOURCE,
  PLAY_WISH_PROPOSE_SOURCE,
} from './proactive-scheduler.js';
const TRANSCRIBE_VOICE_JOB = 'ai.transcribe_voice';
@Injectable()
export class AiRuntimeLifecycle implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(CHARACTER_TRIAL_READ_PORT) readonly trials: CharacterTrialReadPort,
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyEngine) readonly engine: ReplyEngine,
    @Inject(MemoryService) readonly memory: MemoryService,
    @Inject(SimulationService) readonly simulation: SimulationService,
    @Inject(HealthCareService) readonly healthCare: HealthCareService,
    @Inject(ProactiveSchedulerService) readonly proactive: ProactiveSchedulerService,
    @Inject(GroupChatService) readonly groupChat: GroupChatService,
    @Inject(SocialService) readonly social: SocialService,
    @Inject(MomentsAiService) readonly momentsAi: MomentsAiService,
    @Inject(EVENT_BUS) readonly bus: EventBus,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) readonly registry: UserDataRegistry,
    @Inject(CHAT_READ_PORT) readonly chat: ChatReadPort,
    @Inject(CONTACTS_READ_PORT) readonly contacts: ContactsReadPort,
    @Inject(MediaAiService) readonly mediaAi: MediaAiService,
    @Inject(QuietStateService) readonly quiet: QuietStateService,
    @Inject(CallSchedulerService) readonly calls: CallSchedulerService,
    @Inject(PlannerService) readonly planner: PlannerService,
    @Inject(CompanionSettingsService) readonly companion: CompanionSettingsService,
    @Inject(PlayAiService) readonly playAi: PlayAiService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.jobs.isReady)
      await this.jobs.send('ai.reconcile', {}, { retryLimit: 10, retryBackoff: true });
  }
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'ai_runtime',
      purgeUser: (id) => this.store.purgeUser(id),
      countUserData: (id) => this.store.countUserData(id),
    });
    await this.jobs.work<{ planId: string }>(
      GENERATE_REPLY_JOB,
      (j) => this.engine.run(j.data.planId),
      { pollingIntervalSeconds: 0.5, localConcurrency: 4 },
    );
    await this.jobs.work<{ userId?: string }>('ai.recover_replies', (job) =>
      this.store.recover(job.data.userId),
    );
    await this.jobs.work<MemoryJob>(EXTRACT_MEMORY_JOB, (j) => this.memory.extract(j.data), {
      pollingIntervalSeconds: 0.5,
      localConcurrency: 2,
    });
    await this.jobs.work('ai.reconcile', async () => {
      await this.store.reconcile();
      await this.memory.reconcile();
    });
    await this.jobs.schedule('ai.reconcile', '* * * * *');

    // 推演引擎（T-051）：每角色日常事件与心情
    await this.jobs.work<{ userId: string; characterId: string }>(
      SIMULATE_CHARACTER_JOB,
      (j) => this.simulation.simulateCharacter(j.data.userId, j.data.characterId),
      { pollingIntervalSeconds: 2, localConcurrency: 2 },
    );
    await this.jobs.work(RUN_DAILY_SIMULATIONS_JOB, () => this.simulation.runDailySimulations());
    // 每天凌晨 2:00（北京时间）触发推演调度
    await this.jobs.schedule(RUN_DAILY_SIMULATIONS_JOB, '0 18 * * *'); // UTC 18:00 = 北京 02:00

    // T-090 行为规划：决策记录保留 90 天，每天清理一次。
    await this.jobs.work(PLANNER_CLEANUP_JOB, () => this.planner.cleanup());
    await this.jobs.schedule(PLANNER_CLEANUP_JOB, '41 3 * * *');
    // T-090：经期关怀经主动消息调度器登记，到点由 health-care 现取数据发送。
    this.proactive.registerPlanHandler(CARE_PLAN_PREFIX, (input) =>
      this.healthCare.sendPlanned(input),
    );
    // T-096 玩法里角色怎么说话：每日一问、心愿提议与跟进、慢信、陪你专注、提醒说法。
    this.proactive.registerPlanHandler(PLAY_WISH_PROPOSE_SOURCE, (input) =>
      this.playAi.sendWishProposal(input),
    );
    this.proactive.registerPlanHandler(PLAY_WISH_FOLLOW_SOURCE, (input) =>
      this.playAi.sendWishFollowUp(input),
    );
    this.proactive.registerPlanHandler(PLAY_LETTER_ANNIV_SOURCE, (input) =>
      this.playAi.sendAnniversaryLetter(input),
    );
    await this.jobs.work<{ answerId: string }>(PLAY_DAILY_ANSWER_JOB, (j) =>
      this.playAi.runDailyAnswer(j.data.answerId),
    );
    await this.jobs.work<{ userId: string }>(
      PLAY_LETTER_REPLY_JOB,
      (j) => this.playAi.runLetterReplies(j.data.userId),
      { localConcurrency: 2 },
    );
    await this.jobs.work(PLAY_LETTER_SWEEP_JOB, () => this.playAi.letterSweep());
    await this.jobs.schedule(PLAY_LETTER_SWEEP_JOB, '*/5 * * * *');
    await this.jobs.work<{
      userId: string;
      characterId: string;
      focusId: string;
      kind: 'start' | 'completed' | 'ended_early';
      minutes: number;
    }>(PLAY_FOCUS_LINE_JOB, (j) => this.playAi.runFocusLine(j.data), {
      pollingIntervalSeconds: 1,
    });
    await this.jobs.work<{ userId: string; reminderId: string }>(PLAY_REMINDER_PHRASINGS_JOB, (j) =>
      this.playAi.runReminderPhrasings(j.data.userId, j.data.reminderId),
    );
    await this.jobs.work<{ userId: string }>(PLAY_RECOVER_JOB, (j) =>
      this.playAi.recover(j.data.userId),
    );
    await this.jobs.work(PLAY_TICK_JOB, () => this.playAi.tick());
    await this.jobs.schedule(PLAY_TICK_JOB, '13 * * * *');
    await this.jobs.work<{ userId: string }>(PLAY_USER_JOB, (j) =>
      this.playAi.runForUser(j.data.userId),
    );
    this.bus.subscribe({
      consumer: 'ai.play_daily_answer',
      eventType: 'play.daily_answer_submitted',
      handle: async (event) => {
        await this.playAi.onDailyAnswerSubmitted(event.payload.answerId);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_wishlist_changed',
      eventType: 'play.wishlist_item_changed',
      handle: async (event) => {
        await this.playAi.onWishlistItemChanged(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_wishlist_completed',
      eventType: 'play.wishlist_item_completed',
      handle: async (event) => {
        await this.playAi.onWishlistItemCompleted(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_letter_sent',
      eventType: 'play.letter_sent',
      handle: async (event) => {
        await this.playAi.onLetterSent(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_anniversary_letter',
      eventType: 'growth.anniversary_reached',
      handle: async (event) => {
        await this.playAi.onAnniversaryReached(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_focus_started',
      eventType: 'play.focus_started',
      handle: async (event) => {
        const p = event.payload;
        await this.playAi.onFocusEvent({
          userId: p.userId,
          characterId: p.characterId,
          focusId: p.focusId,
          kind: 'start',
          minutes: 0,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_focus_ended',
      eventType: 'play.focus_ended',
      handle: async (event) => {
        const p = event.payload;
        await this.playAi.onFocusEvent({
          userId: p.userId,
          characterId: p.characterId,
          focusId: p.focusId,
          kind: p.result,
          minutes: p.minutes,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.play_reminder_saved',
      eventType: 'play.reminder_saved',
      handle: async (event) => {
        await this.playAi.onReminderSaved(event.payload);
      },
    });
    // T-090 / SAFE-03 第 5 条：分类变化 → 资格变「否」的成人模式（及不可恋爱的恋爱模式）立即切回日常并提示。
    this.bus.subscribe({
      consumer: 'ai.on_classification_changed',
      eventType: 'characters.character_classification_changed',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.adultModeEligible && p.romanceAllowed) return;
        await this.companion.onClassificationChanged(tx, p);
        await this.groupChat.onCharacterClassificationChanged(tx, p.characterId, p.ownerUserId);
      },
    });

    // 经期关怀（T-060）：每小时扫描一次，按用户时区与活跃时段判断；每周期每名额最多一次。
    await this.jobs.work<{ userId: string }>(HEALTH_CARE_CHECK_JOB, async (j) => {
      await this.healthCare.checkUser(j.data.userId);
    });
    await this.jobs.work(HEALTH_CARE_SWEEP_JOB, () => this.healthCare.sweep());
    await this.jobs.schedule(HEALTH_CARE_SWEEP_JOB, '7 * * * *');

    // 主动消息调度（T-053）：每 10 分钟按用户检查一次；每天清理过期计划与活跃记录。
    await this.jobs.work<{ userId: string }>(PROACTIVE_USER_JOB, (j) =>
      this.proactive.runForUser(j.data.userId),
    );
    await this.jobs.work(PROACTIVE_TICK_JOB, () => this.proactive.tick());
    await this.jobs.schedule(PROACTIVE_TICK_JOB, '*/10 * * * *');
    await this.jobs.work(PROACTIVE_CLEANUP_JOB, () => this.proactive.cleanup());
    await this.jobs.schedule(PROACTIVE_CLEANUP_JOB, '23 * * * *');
    // T-071 MED-03 第 3 条：用户语音（私聊或群聊）尽快转文字，写回 media（「转文字」按钮与群聊上下文用）。
    await this.jobs.work<{ userId: string; messageId: string; conversationId: string }>(
      TRANSCRIBE_VOICE_JOB,
      async (j) => {
        const message = await this.chat.getMessage(j.data.messageId, ['normal', 'adult']);
        if (message?.content?.type !== 'voice') return;
        const conversation = await this.chat.getConversation(j.data.conversationId);
        const role =
          conversation?.type === 'direct'
            ? conversation.participants.find((member) => member.kind === 'character')
            : undefined;
        await this.mediaAi.transcribe(
          {
            userId: j.data.userId,
            conversationId: j.data.conversationId,
            ...(role ? { characterId: role.refId } : {}),
          },
          message.content.mediaId,
        );
      },
      { pollingIntervalSeconds: 1, localConcurrency: 2 },
    );
    this.bus.subscribe({
      consumer: 'ai.transcribe_voice',
      eventType: 'chat.message_created',
      handle: async (event) => {
        const p = event.payload;
        if (p.senderKind !== 'user' || !p.senderRefId || p.contentType !== 'voice') return;
        await this.jobs.send(
          TRANSCRIBE_VOICE_JOB,
          { userId: p.senderRefId, messageId: p.messageId, conversationId: p.conversationId },
          { singletonKey: `voice:${p.messageId}`, retryLimit: 3, retryBackoff: true },
        );
      },
    });
    // T-072 P-45：用户说「不方便」→ 2 小时静默；再发任何消息提前结束（任一会话）。
    this.bus.subscribe({
      consumer: 'ai.quiet_state',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.senderKind !== 'user' || !p.senderRefId) return;
        const message =
          p.contentType === 'text'
            ? await this.chat.getMessage(p.messageId, ['normal', 'adult'])
            : null;
        await this.quiet.onUserMessage(
          tx,
          p.senderRefId,
          message?.content?.type === 'text' ? message.content.text : null,
        );
      },
    });
    // T-072 来电：未接 / 拒接后续消息（MED-07 第 5 条）；熟悉度到 L3 征求同意；用户点「可以」开启。
    this.bus.subscribe({
      consumer: 'ai.call_ended',
      eventType: 'calls.call_ended',
      handle: async (event) => {
        await this.calls.onCallEnded(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.call_permission_ask',
      eventType: 'growth.familiarity_leveled_up',
      handle: async (event) => {
        if (event.payload.level >= 3)
          await this.calls.askPermission(event.payload.userId, event.payload.characterId);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.call_permission_chosen',
      eventType: 'chat.message_action_chosen',
      handle: async (event) => {
        const p = event.payload;
        if (p.cardKind !== 'call_permission' || !p.characterId) return;
        await this.calls.onPermissionChosen(p.userId, p.characterId, p.actionId);
      },
    });
    // P-06/P-09：记录用户在任一会话（私聊或群聊）发消息的时间。
    this.bus.subscribe({
      consumer: 'ai.proactive_activity',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.senderKind !== 'user' || !p.senderRefId) return;
        await this.proactive.recordUserActivity(tx, p.senderRefId, new Date(event.occurredAt));
      },
    });

    // 群聊（T-065）：用户在群里发言交给群聊调度，不走私聊回复；自发话题与拉群。
    await this.jobs.work<GroupTurnJob>(GROUP_TURN_JOB, (j) => this.groupChat.runTurn(j.data), {
      pollingIntervalSeconds: 1,
      localConcurrency: 4,
    });
    await this.jobs.work<{ userId: string; conversationId: string }>(GROUP_SELF_CHAT_JOB, (j) =>
      this.groupChat.runSelfChat(j.data),
    );
    await this.jobs.work<GroupInviteJob>(GROUP_INVITE_JOB, (j) => this.groupChat.runInvite(j.data));
    await this.jobs.work(GROUP_SELF_CHAT_TICK_JOB, () => this.groupChat.selfChatTick());
    await this.jobs.schedule(GROUP_SELF_CHAT_TICK_JOB, '5 * * * *');
    this.bus.subscribe({
      consumer: 'ai.group_on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'group' || p.senderKind !== 'user' || !p.senderRefId) return;
        await this.groupChat.onUserMessage(tx, {
          conversationId: p.conversationId,
          userId: p.senderRefId,
          messageId: p.messageId,
          seq: p.seq,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.group_invite_intent',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        if (p.contentType !== 'text' || p.scope !== 'normal') return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        if (!role) return;
        const message = await this.chat.getMessage(p.messageId, ['normal']);
        if (message?.content?.type !== 'text') return;
        await this.groupChat.detectWantToMeet(tx, {
          userId: p.senderRefId,
          characterId: role.refId,
          text: message.content.text,
          messageId: p.messageId,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.group_members_changed',
      eventType: 'chat.group_members_changed',
      handle: async (event, tx) => {
        await this.groupChat.onMembersChanged(
          tx,
          event.payload.conversationId,
          event.payload.ownerUserId,
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.group_dissolved',
      eventType: 'chat.group_dissolved',
      handle: async (event, tx) => {
        await this.groupChat.onDissolved(tx, event.payload);
      },
    });

    // T-066 朋友圈（SOC-07～SOC-09）：每小时检查发圈；互动由 moments 事件触发，P-29 两小时内。
    await this.jobs.work(MOMENTS_TICK_JOB, () => this.momentsAi.tick());
    await this.jobs.schedule(MOMENTS_TICK_JOB, '17 * * * *');
    await this.jobs.work<{ userId: string }>(MOMENTS_USER_JOB, (j) =>
      this.momentsAi.runForUser(j.data.userId),
    );
    await this.jobs.work<MomentsReactJob>(
      MOMENTS_REACT_JOB,
      (j) => this.momentsAi.runReact(j.data),
      {
        pollingIntervalSeconds: 5,
        localConcurrency: 2,
      },
    );
    this.bus.subscribe({
      consumer: 'ai.moments_post_created',
      eventType: 'moments.post_created',
      handle: async (event) => {
        await this.momentsAi.onPostCreated(event.payload);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.moments_comment_created',
      eventType: 'moments.comment_created',
      handle: async (event) => {
        await this.momentsAi.onCommentCreated(event.payload);
      },
    });
    // T-066 关系删除：两人之间的共同事件不再使用。
    this.bus.subscribe({
      consumer: 'ai.relation_changed',
      eventType: 'characters.relation_changed',
      handle: async (event, tx) => {
        if (event.payload.action === 'deleted')
          await this.social.onRelationDeleted(tx, event.payload);
      },
    });
    // T-066 名片推荐（CHR-04）：用户在私聊问起关系网里没添加的人 → 角色回复后发名片。
    await this.jobs.work<CardRecommendJob>(CARD_RECOMMEND_JOB, (j) =>
      this.social.runCardRecommend(j.data),
    );
    this.bus.subscribe({
      consumer: 'ai.card_on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        if (p.contentType !== 'text' || p.scope !== 'normal') return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        if (!role) return;
        const message = await this.chat.getMessage(p.messageId, ['normal']);
        if (message?.content?.type !== 'text') return;
        await this.social.onUserDirectMessage(tx, {
          userId: p.senderRefId,
          characterId: role.refId,
          text: message.content.text,
          messageId: p.messageId,
        });
      },
    });

    this.bus.subscribe({
      consumer: 'ai.on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        if (!role) return;
        if (!(await this.store.lock(tx, p.senderRefId, p.conversationId))) return;
        const contact = await this.contacts.getActiveContact(p.senderRefId, role.refId, tx);
        if (contact) await this.simulation.markActive(tx, p.senderRefId, role.refId);
        else if (
          !(await this.trials.getTrial(
            { userId: p.senderRefId, characterId: role.refId, conversationId: p.conversationId },
            tx,
          ))
        )
          return;
        await this.store.enqueue(tx, {
          userId: p.senderRefId,
          characterId: role.refId,
          conversationId: p.conversationId,
          triggerId: p.messageId,
          triggerSeq: p.seq,
          kind: 'message',
          triggeredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.memory_on_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind === 'system') return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        const user = conversation?.participants.find((member) => member.kind === 'user');
        if (!role || !user) return;
        const epoch = await this.contacts.getActiveContactEpoch(user.refId, role.refId);
        if (!epoch || new Date(event.occurredAt) < new Date(epoch.acceptAfter)) return;
        const message =
          p.senderKind === 'character'
            ? await this.chat.getMessage(p.messageId, ['normal', 'adult'])
            : null;
        if (message?.labels?.includes('quirk_draft')) return;
        const promise =
          message?.content?.type === 'text' &&
          /记住了|我会记住|我记下了/u.test(message.content.text);
        await this.memory.observe(
          tx,
          {
            userId: user.refId,
            characterId: role.refId,
            conversationId: p.conversationId,
            epoch: epoch.version,
          },
          p.senderKind === 'user',
          !!promise,
          p.seq,
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async (event, tx) => {
        if (!(await this.store.lock(tx, event.payload.userId))) return;
        await this.simulation.markActive(tx, event.payload.userId, event.payload.characterId);
        // CHR-04 第 3 条：通过名片添加，第一条消息提到推荐人。
        if (event.payload.referrerCharacterId)
          await this.social.recordReferral(tx, {
            userId: event.payload.userId,
            characterId: event.payload.characterId,
            referrerCharacterId: event.payload.referrerCharacterId,
          });
        await this.store.enqueue(tx, {
          ...event.payload,
          triggerId: event.eventId,
          triggerSeq: 0,
          kind: 'greeting',
          triggeredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_removed',
      eventType: 'contacts.contact_removed',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        if (await this.contacts.getActiveContact(userId, characterId)) return;
        await this.store.lock(tx, userId);
        await tx.db
          .update(replyPlans)
          .set({
            status: 'cancelled',
            inputCiphertext: null,
            resultCiphertext: null,
            leaseId: null,
            leaseUntil: null,
          })
          .where(
            and(
              eq(replyPlans.userId, userId),
              eq(replyPlans.characterId, characterId),
              inArray(replyPlans.status, ['queued', 'generating', 'waiting', 'sending']),
            ),
          );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_context_changed',
      eventType: 'contacts.contact_updated',
      handle: async (event, tx) => {
        if (
          !event.payload.changedFields.some((field) =>
            ['relationshipType', 'addressAs'].includes(field),
          )
        )
          return;
        await this.store.lock(tx, event.payload.userId);
        await invalidateReplyPlans(tx, this.store, event.payload.userId, event.payload.characterId);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId, conversationId } = event.payload;
        await this.store.lock(tx, userId);
        if (conversationId) {
          await tx.db
            .delete(memories)
            .where(and(eq(memories.userId, userId), eq(memories.conversationId, conversationId)));
          await tx.db
            .delete(memoryStates)
            .where(
              and(eq(memoryStates.userId, userId), eq(memoryStates.conversationId, conversationId)),
            );
        }
        if (conversationId)
          await tx.db
            .delete(replyPlans)
            .where(
              and(eq(replyPlans.userId, userId), eq(replyPlans.conversationId, conversationId)),
            );
        if (!(await this.contacts.getActiveContact(userId, characterId))) {
          await tx.db
            .delete(simulationStates)
            .where(
              and(
                eq(simulationStates.userId, userId),
                eq(simulationStates.characterId, characterId),
              ),
            );
          await tx.db
            .delete(dailyEvents)
            .where(and(eq(dailyEvents.userId, userId), eq(dailyEvents.characterId, characterId)));
          await this.proactive.purgePair(tx, userId, characterId);
          // T-066：朋友圈账本、共同事件、名片推荐人。
          await tx.query(
            'DELETE FROM ai_runtime.moments_plans WHERE user_id=$1 AND character_id=$2',
            [userId, characterId],
          );
          await tx.query(
            'DELETE FROM ai_runtime.joint_events WHERE user_id=$1 AND (character_a_id=$2 OR character_b_id=$2)',
            [userId, characterId],
          );
          await tx.query(
            'DELETE FROM ai_runtime.card_referrals WHERE user_id=$1 AND (character_id=$2 OR referrer_character_id=$2)',
            [userId, characterId],
          );
          await tx.db
            .delete(moodStates)
            .where(and(eq(moodStates.userId, userId), eq(moodStates.characterId, characterId)));
          await tx.db
            .delete(companionSettings)
            .where(
              and(
                eq(companionSettings.userId, userId),
                eq(companionSettings.characterId, characterId),
              ),
            );
        }
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_balance_restored',
      eventType: 'billing.balance_restored',
      handle: async (event, tx) => {
        await this.jobs.send(
          'ai.recover_replies',
          { userId: event.payload.userId },
          { tx, retryLimit: 10, retryBackoff: true },
        );
        // T-096：补揭晓每日一问、补生成回信与提醒说法。
        await this.jobs.send(
          PLAY_RECOVER_JOB,
          { userId: event.payload.userId },
          { tx, retryLimit: 3, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_model_recovered',
      eventType: 'model_access.model_status_changed',
      handle: async (event, tx) => {
        if (event.payload.available) {
          await this.jobs.send(
            'ai.recover_replies',
            {},
            { tx, retryLimit: 10, retryBackoff: true },
          );
          const users = await tx.query<{ user_id: string }>(
            'SELECT DISTINCT user_id FROM ai_runtime.simulation_states',
          );
          for (const user of users.rows)
            await this.jobs.send(
              PLAY_RECOVER_JOB,
              { userId: user.user_id },
              { tx, retryLimit: 3, retryBackoff: true },
            );
        }
      },
    });
  }
}
