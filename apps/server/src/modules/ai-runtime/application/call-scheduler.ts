/**
 * T-072 主动来电调度（MED-07、P-10，D-L5-09 AI 部分）。说明见 docs/ai/call-and-image.md 第 4 节。
 *
 * 由主动消息调度器（T-053）的用户级任务登记调用：只有在调度器已判断「全局主动消息开关、免打扰、活跃时段」都允许时才会进来。
 * 本服务再判断（PRD 原文见任务卡）：
 * - 开关：该角色 proactiveCalls（默认关闭；熟悉度首次到 L3 时角色在私聊问「以后可以给你打电话吗？」，点「可以」即开启）。
 * - P-10：每角色每 7 天最多 1 次，全部角色每 7 天最多 3 次；熟悉度 L3 及以上。
 * - 触发：今天的纪念日、约定结果、想分享的日常事件（取自主动消息计划）。
 * - P-09：用户 5 分钟内在任一会话发过消息就不打，也不延后补打。
 * - P-45「不方便」静默期不打；专注中不打（play 模块未就绪，接入后补）；余额低于 P-33（1 元）不打；
 *   语音服务未开通不打；已有通话不打；当天该角色未接 / 拒接过不再打；每人每天最多一次来电。
 * - 未接 / 拒接后发一条消息（不情感操纵），当天不再打。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type {
  BillingReadPort,
  CallSessionPort,
  ChatParticipantPort,
  ChatReadPort,
  Contact,
  ContactsReadPort,
  ModelGatewayMediaPort,
  ModelGatewayPort,
  CharacterReadPort,
  PolicyPort,
  IdentitySettingsWritePort,
} from '@weiban/contracts';
import { CLOCK, DATABASE, newId, type Clock, type Database } from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CALL_SESSION_PORT } from '../../calls/index.js';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_SERVICE, type GrowthService } from '../../growth/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { IDENTITY_SETTINGS_WRITE_PORT } from '../../identity/index.js';
import { outputAllowed } from '../domain/reply-rules.js';
import { callAttempts, proactivePlans, userChatActivity } from '../infra/db/schema.js';
import { QuietStateService } from './quiet-state.js';
import { PlannerService } from './planner.js';
import { CompanionSettingsService } from './settings.js';

/** P-10 原文：每角色每 7 天最多 1 次；全部角色每 7 天最多 3 次；要求熟悉度 L3 及以上。 */
export const P10_CALLS = { perCharacter: 1, total: 3, windowMs: 7 * 86_400_000, minLevel: 3 };
/** P-09：用户 5 分钟内发过消息。 */
const P09_BUSY_MS = 5 * 60_000;
/** P-33：余额保留线 1 元。 */

const COUNTED = ['started', 'completed', 'missed', 'declined', 'failed'];
/** 各触发理由在当天被选中拨出的概率：T-090 起作为决策层 call_slot 的规则版与退路。 */
const TRIGGER_CHANCE: Record<string, number> = {
  anniversary: 1,
  follow_up: 0.5,
  daily_event: 0.15,
};

function stableRandom(...keys: string[]): number {
  let h = 2166136261;
  for (const ch of keys.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

@Injectable()
export class CallSchedulerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CALL_SESSION_PORT) private readonly sessions: CallSessionPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(MODEL_GATEWAY_MEDIA_PORT) private readonly media: ModelGatewayMediaPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(GROWTH_SERVICE) private readonly growth: GrowthService,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly writer: ChatParticipantPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CompanionSettingsService) private readonly settings: CompanionSettingsService,
    @Inject(QuietStateService) private readonly quiet: QuietStateService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(IDENTITY_SETTINGS_WRITE_PORT)
    private readonly identitySettings: IdentitySettingsWritePort,
  ) {}

  /** 调度器用户级任务里调用：最多发起一通来电。 */
  async consider(ctx: { userId: string; localDate: string }, contacts: Contact[]): Promise<void> {
    const now = this.clock.now();
    if (await this.quiet.getInconvenientUntil(ctx.userId)) return;
    // T-096 PLAY-06 第 3 条：用户正在专注时主动来电不拨出。
    if (await this.quiet.getFocusUntil(ctx.userId).catch(() => null)) return;
    const [busy] = await this.db.db
      .select({ at: userChatActivity.lastAt })
      .from(userChatActivity)
      .where(
        and(
          eq(userChatActivity.userId, ctx.userId),
          gte(userChatActivity.lastAt, new Date(now.getTime() - P09_BUSY_MS)),
        ),
      )
      .limit(1);
    if (busy) return;
    const spend = await this.billing.getSpendStatus(ctx.userId).catch(() => null);
    if (!spend) return; // 开场模型先做真实上限冻结，失败不发起来电。
    if (
      !(await this.media.isServiceEnabled('speech_recognition')) ||
      !(await this.media.isServiceEnabled('speech_synthesis'))
    )
      return;
    if (await this.sessions.getActiveCall(ctx.userId)) return;

    const recent = await this.db.db
      .select()
      .from(callAttempts)
      .where(
        and(
          eq(callAttempts.userId, ctx.userId),
          gte(callAttempts.createdAt, new Date(now.getTime() - P10_CALLS.windowMs)),
        ),
      );
    const counted = recent.filter((r) => COUNTED.includes(r.outcome));
    if (counted.length >= P10_CALLS.total) return;
    if (counted.some((r) => r.localDate === ctx.localDate)) return;

    const triggers = await this.db.db
      .select()
      .from(proactivePlans)
      .where(
        and(
          eq(proactivePlans.userId, ctx.userId),
          eq(proactivePlans.localDate, ctx.localDate),
          inArray(proactivePlans.reason, ['anniversary', 'follow_up', 'daily_event']),
        ),
      );
    for (const contact of contacts) {
      if (!contact.conversationId) continue;
      const characterId = contact.characterId;
      if (counted.some((r) => r.characterId === characterId)) continue;
      const settings = await this.settings.get(ctx.userId, characterId).catch(() => null);
      if (!settings?.proactiveCalls) continue;
      const level = await this.growth
        .getFamiliarity(ctx.userId, characterId)
        .then((f) => f.level)
        .catch(() => 1);
      if (level < P10_CALLS.minLevel) continue;
      // T-090 call_slot：P-10、熟悉度、P-45、开关都已由代码先扣掉；决策层只在「今天打 / 今天不打」里挑，每个来源每天只问一次。
      let trigger: (typeof triggers)[number] | undefined;
      for (const t of triggers.filter((x) => x.characterId === characterId)) {
        const ruleCall =
          stableRandom(ctx.userId, t.sourceRef, 'call') < (TRIGGER_CHANCE[t.reason] ?? 0);
        const d = await this.planner.decide({
          userId: ctx.userId,
          characterId,
          conversationId: contact.conversationId,
          decisionType: 'call_slot',
          options: ['call_now', 'skip_today'],
          ruleChoice: ruleCall ? 'call_now' : 'skip_today',
          ruleReason: ruleCall ? `规则版：${t.reason}` : '规则版：今天不打',
          conservative: 'skip_today',
          question:
            '角色今天要不要为这件事主动给用户打一通语音电话（call_now）还是今天不打（skip_today）？',
          features: {
            reasonKind: t.reason,
            familiarityLevel: level,
          },
          path: 'proactive',
          idempotencyKey: `call:${ctx.localDate}:${t.sourceRef}`,
          decisionKey: `call:${ctx.localDate}:${t.sourceRef}`,
        });
        if (d.choice === 'call_now') {
          trigger = t;
          break;
        }
      }
      if (!trigger) continue;
      const attemptId = newId();
      const inserted = await this.db.db
        .insert(callAttempts)
        .values({
          id: attemptId,
          userId: ctx.userId,
          characterId,
          localDate: ctx.localDate,
          reason: trigger.brief.slice(0, 500),
          sourceRef: `call:${trigger.sourceRef}`.slice(0, 200),
          outcome: 'starting',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: callAttempts.id });
      if (!inserted.length) continue;
      const started = await this.sessions.startIncomingCall({
        userId: ctx.userId,
        characterId,
        reason: trigger.reason,
        idempotencyKey: `ai-call:${attemptId}`,
      });
      await this.db.db
        .update(callAttempts)
        .set({
          outcome: started.ok ? 'started' : `skipped_${started.error}`,
          callId: started.ok ? started.value.callId : null,
          updatedAt: this.clock.now(),
        })
        .where(eq(callAttempts.id, attemptId));
      return;
    }
  }

  /** calls.call_ended：记结局；来电未接 / 拒接 → 发一条消息（不情感操纵），当天不再打。 */
  async onCallEnded(p: {
    callId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    direction: 'outgoing' | 'incoming';
    outcome: string;
  }): Promise<void> {
    if (p.direction !== 'incoming') return;
    await this.db.db
      .update(callAttempts)
      .set({
        outcome: ['missed', 'declined'].includes(p.outcome) ? p.outcome : 'completed',
        updatedAt: this.clock.now(),
      })
      .where(eq(callAttempts.callId, p.callId));
    if (!['missed', 'declined'].includes(p.outcome)) return;
    const conversation = await this.chat.getConversation(p.conversationId);
    const participant = conversation?.participants.find(
      (m) => m.kind === 'character' && m.refId === p.characterId,
    );
    const contact = await this.contacts.getActiveContact(p.userId, p.characterId);
    if (!conversation || !participant || contact?.conversationId !== p.conversationId) return;
    const policy = await this.policy.getCharacterPolicy(p.userId, p.characterId);
    const role = await this.characters.getForRuntime(p.userId, p.characterId);
    const fallback =
      p.outcome === 'declined'
        ? '刚刚是不是不方便接？没关系，我们打字聊也一样～'
        : '刚想打电话跟你说点事，你应该在忙吧。等你有空再说，不急～';
    let text = fallback;
    if (role && policy) {
      const result = await this.gateway.generateText({
        userId: p.userId,
        characterId: p.characterId,
        conversationId: p.conversationId,
        purpose: 'proactive',
        billingOwner: 'user',
        modelRole: 'chat',
        countAsBackground: true,
        ecologyTask: true,
        responseFormat: 'text',
        maxOutputTokens: 80,
        idempotencyKey: `call-after:${p.callId}`,
        messages: [
          {
            role: 'system',
            content: `你以角色口吻给用户发一条私聊消息：你刚才给对方打电话，对方${p.outcome === 'declined' ? '挂断了' : '没有接'}。只写一句短消息，表示理解、没关系、可以打字聊。绝对不能让对方愧疚、不说难过委屈或一直在等、不追问原因、不要求回电。只输出消息正文。真人=${policy.isRealPerson}，儿童=${policy.isMinor}，允许恋爱=${policy.romanceAllowed}。`,
          },
          {
            role: 'system',
            content: `角色资料：${JSON.stringify({ persona: role.card.data.persona, speech: role.card.data.speech }).slice(0, 6000)}`,
          },
        ],
      });
      if (result.ok) {
        const candidate = result.value.text.trim().slice(0, 120);
        if (
          candidate &&
          outputAllowed(candidate, policy, false) &&
          !/(难过|委屈|伤心|一直在等|为什么不接|不理我|失望)/u.test(candidate)
        )
          text = candidate;
      }
    }
    await this.writer.postMessage({
      conversationId: p.conversationId,
      senderParticipantId: participant.participantId,
      content: { type: 'text', text },
      idempotencyKey: `call-after:${p.callId}`,
      expectedScope: conversation.contentScope,
    });
  }

  /** MED-07 第 1 条：熟悉度首次到 L3，角色在私聊问能不能打电话（只问一次，幂等键保证）。 */
  async askPermission(userId: string, characterId: string): Promise<void> {
    const settings = await this.settings.get(userId, characterId).catch(() => null);
    if (!settings || settings.proactiveCalls) return;
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact?.conversationId) return;
    const conversation = await this.chat.getConversation(contact.conversationId);
    const participant = conversation?.participants.find(
      (m) => m.kind === 'character' && m.refId === characterId,
    );
    if (!conversation || !participant) return;
    await this.writer.postMessage({
      conversationId: conversation.conversationId,
      senderParticipantId: participant.participantId,
      content: {
        type: 'action_card',
        cardKind: 'call_permission',
        text: '以后可以给你打电话吗？',
        actions: [
          { actionId: 'allow', label: '可以', style: 'primary' },
          { actionId: 'later', label: '先不要', style: 'secondary' },
        ],
        ref: { kind: 'call_permission', id: characterId },
      },
      idempotencyKey: `call-permission:${userId}:${characterId}`,
      expectedScope: conversation.contentScope,
    });
  }

  /** 用户点了「可以」：为该角色开启主动来电。 */
  async onPermissionChosen(userId: string, characterId: string, actionId: string): Promise<void> {
    if (actionId !== 'allow') return;
    if (!(await this.identitySettings.enableProactiveCalls(userId))) return;
    await this.settings.update(userId, characterId, { proactiveCalls: true });
  }
}
