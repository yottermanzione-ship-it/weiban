import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  MessageContent,
  type ChatParticipantPort,
  type ModelGatewayPort,
  type ModelGatewayPlatformPort,
  type GenerateTextInput,
  type GenerateTextOutput,
  type PortResult,
  type GenerateError,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  OUTBOX,
  type Outbox,
  P01_REPLY_DELAY,
  P02_SPLIT_BUBBLES,
  P28_INSTANT_REPLY_MIN_TYPING_MS,
  type AuditLog,
  type Clock,
} from '../../../platform/index.js';
import { CHAT_PARTICIPANT_PORT } from '../../chat/index.js';
import { MODEL_GATEWAY_PORT, MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';
import { replyPlans } from '../infra/db/schema.js';
import { ReplyPlanStore, type ReplyPlan } from './plan-store.js';
import { ReplyContext, ReplySnapshot } from './reply-context.js';
import { callModelForCare, careFallback } from './safety-care.js';
import { HEALTH_LABEL } from './health-care.js';
import { AdultBoundaryService } from './adult-boundary.js';
import { MediaAiService } from './media-ai.js';
import { PlannerService } from './planner.js';
import { QuirkService } from './quirk-service.js';
import { typoCorrection } from '../domain/quirks.js';
import { outputAllowed, replyDelay, splitReply } from '../domain/reply-rules.js';
const Result = z.object({
  bubbles: z.array(z.string().min(1).max(4000)).min(1).max(4),
  snapshot: ReplySnapshot,
  care: z.boolean(),
  /** T-071：实际要发的内容（语音替换文字、附表情包 / 作品链接）；没有时按 bubbles 发文字。 */
  contents: z.array(MessageContent).max(6).optional(),
  quirkDraftMessageId: z.uuid().optional(),
  /** v3.3：这次回复消耗（各次调用合计），发第一个正式气泡时交给 chat。 */
  charge: z
    .object({ usageRecordId: z.string().nullable(), chargedMicros: z.number().nonnegative() })
    .optional(),
});
@Injectable()
export class ReplyEngine {
  constructor(
    @Inject(AdultBoundaryService) readonly adultBoundary: AdultBoundaryService,
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyContext) readonly context: ReplyContext,
    @Inject(MODEL_GATEWAY_PORT) readonly gateway: ModelGatewayPort,
    @Inject(CHAT_PARTICIPANT_PORT) readonly writer: ChatParticipantPort,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(AUDIT_LOG) readonly audit: AuditLog,
    @Inject(MediaAiService) readonly mediaAi: MediaAiService,
    @Inject(OUTBOX) readonly outbox: Outbox,
    @Inject(PlannerService) readonly planner: PlannerService,
    @Inject(QuirkService) readonly quirks: QuirkService,
    @Optional() @Inject(MODEL_PLATFORM_GATEWAY_PORT) readonly platform?: ModelGatewayPlatformPort,
  ) {}
  async run(id: string): Promise<void> {
    if (!z.uuid().safeParse(id).success) return;
    const row = await this.store.claim(id);
    if (!row) return;
    if (row.status === 'sending') {
      await this.emit(row);
      return;
    }
    const snapshot = row.inputCiphertext
      ? ReplySnapshot.parse(await this.store.open(row, 'input'))
      : await this.context.build(row);
    if (!snapshot) {
      await this.store.cancel(id);
      return;
    }
    if (snapshot.trial && (await this.context.currentEpoch(row, snapshot)) !== snapshot.epoch) {
      await this.store.cancel(id);
      return;
    }
    const saved = await this.saveInput(row, snapshot);
    if (!saved) return;
    await this.writer.markRead({
      conversationId: row.conversationId,
      participantId: snapshot.participantId,
      readSeq: snapshot.lastUserSeq,
    });
    // v3.3（积分制）：累计这次回复各次调用扣的钱，记在第一个气泡上（Message.pointsCost）。
    const charge = { usageRecordId: null as string | null, chargedMicros: 0 };
    const gw = trackCharges(this.gateway, charge);
    const care = snapshot.highRisk || snapshot.careActive;
    let suspected = snapshot.suspected;
    if (suspected && !care) {
      const check = await callModelForCare(
        gw,
        {
          ...this.input(row, snapshot, 'check'),
          purpose: 'safety_check',
          messages: [
            {
              role: 'system',
              content: '仅判断是否有现实自杀/自伤高风险，输出HIGH或LOW；不提供任何方法。',
            },
            {
              role: 'user',
              content: snapshot.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '',
            },
          ],
          maxOutputTokens: 20,
        },
        { highRisk: false, careActive: false, suspected: true },
        this.platform,
      );
      suspected = check.ok && check.value.text.trim() === 'HIGH';
    }
    const facts = {
      highRisk: snapshot.highRisk || suspected,
      careActive: snapshot.careActive,
      suspected: false,
    };
    const adult = snapshot.scope === 'adult' && !facts.highRisk && !facts.careActive;
    const inputReview = adult
      ? await this.adultBoundary.review(
          this.input(row, snapshot, 'reply'),
          this.adultBoundary.inputText(this.input(row, snapshot, 'reply')),
          'input',
        )
      : 'allowed';
    let answer: PortResult<GenerateTextOutput, GenerateError> =
      inputReview !== 'allowed'
        ? { ok: false, error: inputReview === 'blocked' ? 'content_rejected' : 'not_configured' }
        : snapshot.forceCareFallback
          ? { ok: false, error: 'policy_denied' }
          : await callModelForCare(gw, this.input(row, snapshot, 'reply'), facts);
    let adultOutput =
      adult && answer.ok
        ? await this.adultBoundary.review(
            this.input(row, snapshot, 'reply'),
            answer.value.text,
            'output',
          )
        : 'allowed';
    if (
      answer.ok &&
      (!outputAllowed(answer.value.text, snapshot.policy, snapshot.scope === 'adult') ||
        adultOutput === 'blocked')
    ) {
      answer = await callModelForCare(
        gw,
        {
          ...this.input(row, snapshot, 'guard'),
          messages: [
            ...snapshot.messages,
            {
              role: 'system',
              content:
                '上次输出不符合平台边界。请重新用安全、人设内的聊天纯文本回复，不透露技术原因。',
            },
          ],
        },
        facts,
      );
      adultOutput =
        adult && answer.ok
          ? await this.adultBoundary.review(
              this.input(row, snapshot, 'guard'),
              answer.value.text,
              'output',
            )
          : 'allowed';
    }
    if (answer.ok && adultOutput !== 'allowed')
      answer = {
        ok: false,
        error: adultOutput === 'blocked' ? 'content_rejected' : 'not_configured',
      };
    const inCare = facts.highRisk || facts.careActive;
    let bubbles: string[] = [];
    let fallbackReason: string | null = null;
    if (answer.ok && outputAllowed(answer.value.text, snapshot.policy, snapshot.scope === 'adult'))
      bubbles = splitReply(answer.value.text, snapshot.splitBubbles);
    if (!bubbles.length) {
      if (inCare) {
        bubbles = careFallback(snapshot.careFallback, snapshot.careVariant, snapshot.addressAs);
        fallbackReason = answer.ok ? 'output_guard' : answer.error;
      } else if (row.kind === 'greeting')
        bubbles = splitReply(
          snapshot.fallbackGreetings.find((s) => outputAllowed(s, snapshot.policy, false)) ??
            '你好，很高兴认识你。',
          snapshot.splitBubbles,
        );
      else if ((!answer.ok && answer.error === 'content_rejected') || answer.ok)
        bubbles = splitReply(snapshot.deflect, snapshot.splitBubbles);
      else {
        await this.wait(row, answer.error);
        return;
      }
    }
    if (!bubbles.length) {
      await this.wait(row, 'output_guard');
      return;
    }
    if (inCare && !bubbles.every((b) => outputAllowed(b, snapshot.policy, false)))
      bubbles = careFallback(undefined, snapshot.careVariant, null);
    // T-071 MED-04 第 2 条：识过图的回合，回复里出现名单外真人姓名 → 重写一次，仍不行用安全说法。
    if (!inCare && snapshot.allowedNames) {
      const bad = await this.mediaAi.offendingNames(
        bubbles.join('\n'),
        snapshot.allowedNames,
        snapshot.userText,
      );
      if (bad.length) {
        const retry = await callModelForCare(
          gw,
          {
            ...this.input(row, snapshot, 'names'),
            messages: [
              ...snapshot.messages,
              {
                role: 'system',
                content: `上次回复说出了你不能认出的人（${bad.join('、')}）。图片里名单外的人不能说出或猜测身份。请重新回复，只按外观描述，不提这些名字。`,
              },
            ],
          },
          facts,
        );
        const again =
          retry.ok && outputAllowed(retry.value.text, snapshot.policy, snapshot.scope === 'adult')
            ? splitReply(retry.value.text, snapshot.splitBubbles)
            : [];
        bubbles =
          again.length &&
          !(
            await this.mediaAi.offendingNames(
              again.join('\n'),
              snapshot.allowedNames,
              snapshot.userText,
            )
          ).length
            ? again
            : ['图里的人我不太认得呢，你跟我说说？'];
      }
    }
    // T-071：语音 / 表情包 / 作品链接（只在日常范围的普通回复里）。
    let contents: MessageContent[] | null = null;
    if (
      !inCare &&
      row.kind === 'message' &&
      !snapshot.trial &&
      snapshot.scope === 'normal' &&
      !['recall', 'typo'].includes(snapshot.quirk.kind)
    ) {
      const history = await this.context.chat
        .readMessages({ conversationId: row.conversationId, scopes: ['normal'], limit: 100 })
        .catch(() => []);
      contents = await this.mediaAi
        .planExtras({
          ctx: {
            userId: row.userId,
            characterId: row.characterId,
            conversationId: row.conversationId,
            defaultVoiceId: snapshot.defaultVoiceId,
          },
          triggerId: row.triggerId,
          bubbles,
          userText: snapshot.userText,
          history,
          voiceId: snapshot.voiceId,
          instant: snapshot.instantReply,
          quiet: snapshot.effectiveStyle === 'treehole',
        })
        .catch(() => null);
    }
    if (!inCare && snapshot.quirk.kind === 'recall') {
      const first = bubbles[0]!;
      const draft =
        '唔，' + [...first].slice(0, Math.max(1, Math.floor([...first].length / 2))).join('');
      if (outputAllowed(draft, snapshot.policy, false))
        contents = [
          { type: 'text', text: draft },
          ...bubbles.map((text) => ({ type: 'text' as const, text })),
        ];
      else snapshot.quirk.kind = 'none';
    }
    if (!inCare && snapshot.quirk.kind === 'typo') {
      const change = typoCorrection(bubbles[0]!);
      if (change && outputAllowed(change.text, snapshot.policy, false))
        contents = [
          { type: 'text', text: change.text },
          { type: 'text', text: change.correction },
          ...bubbles.slice(1).map((text) => ({ type: 'text' as const, text })),
        ];
      else snapshot.quirk.kind = 'none';
    }
    // T-090 reply_timing：秒回关闭时由决策层在 fast / normal / slow 间挑（仍在 P-01 上下限内）；秒回开启不加人为延迟。
    let timing: 'fast' | 'normal' | 'slow' = 'normal';
    if (!inCare && !snapshot.instantReply && row.kind === 'message') {
      const d = await this.planner
        .decide({
          userId: row.userId,
          characterId: row.characterId,
          conversationId: row.conversationId,
          decisionType: 'reply_timing',
          options: ['fast', 'normal', 'slow'],
          ruleChoice: 'normal',
          ruleReason: '规则版按长度',
          conservative: 'normal',
          question:
            '这次回复按什么节奏发出：fast（按长度下限，像正好拿着手机）、normal（按长度中值）、slow（按长度上限，像在忙）？',
          features: {
            userMsgLength: [...snapshot.userText].length,
            replyLength: bubbles.join('').length,
            scenarioMode: snapshot.scenarioMode,
          },
          summary: snapshot.scope === 'adult' ? null : snapshot.userText.slice(0, 100),
          adult: snapshot.scope === 'adult',
          path: 'reply',
          idempotencyKey: `${row.id}:${row.retryEpoch}:timing`,
          timeoutMs: 3000,
        })
        .catch(() => null);
      if (d && (d.choice === 'fast' || d.choice === 'slow')) timing = d.choice;
    }
    await this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
      const [current] = await tx.db
        .select()
        .from(replyPlans)
        .where(eq(replyPlans.id, row.id))
        .for('update');
      if (
        (await this.context.memory.revision(
          tx,
          row.userId,
          row.characterId,
          row.conversationId,
        )) !== snapshot.memoryRevision
      )
        return;
      if (!current || current.status !== 'generating' || current.leaseId !== row.leaseId) return;
      const resultCiphertext = await this.store.seal(tx, row, 'result', {
        bubbles,
        snapshot: { ...snapshot, highRisk: facts.highRisk },
        care: inCare,
        ...(contents ? { contents } : {}),
        ...(charge.chargedMicros > 0 ? { charge } : {}),
      });
      const elapsed = this.clock.nowMs() - Date.parse(snapshot.triggerAt);
      const base = inCare ? 0 : replyDelay(bubbles.join(''), snapshot.instantReply, elapsed);
      const delay =
        inCare || snapshot.instantReply || timing === 'normal'
          ? base
          : Math.max(
              0,
              Math.min(
                Math.min(
                  P01_REPLY_DELAY.maxMs,
                  Math.max(P01_REPLY_DELAY.minMs, base * (timing === 'fast' ? 0.6 : 1.5)),
                ),
                P01_REPLY_DELAY.firstBubbleDeadlineMs - elapsed,
              ),
            );
      const dueAt = new Date(
        Math.max(
          this.clock.nowMs() + Math.max(0, delay - (inCare ? 0 : P28_INSTANT_REPLY_MIN_TYPING_MS)),
          !inCare && snapshot.quirk.kind === 'read_delay' && snapshot.quirk.respondAt
            ? Date.parse(snapshot.quirk.respondAt) - P28_INSTANT_REPLY_MIN_TYPING_MS
            : 0,
        ),
      );
      await tx.db
        .update(replyPlans)
        .set({
          status: 'sending',
          resultCiphertext,
          dueAt,
          leaseId: null,
          leaseUntil: null,
          careUntil: inCare ? new Date(this.clock.nowMs() + 30 * 60000) : null,
        })
        .where(eq(replyPlans.id, row.id));
      if (fallbackReason)
        await this.audit.record(
          {
            module: 'ai_runtime',
            action: 'care.fallback',
            actorType: 'system',
            actorId: row.userId,
            targetType: 'character',
            targetId: row.characterId,
            details: { planId: row.id, reason: fallbackReason },
          },
          tx,
        );
      await this.store.schedule(tx, row.id, dueAt);
    });
  }
  private input(row: ReplyPlan, snapshot: ReplySnapshot, suffix: string): GenerateTextInput {
    return {
      userId: row.userId,
      characterId: row.characterId,
      conversationId: row.conversationId,
      purpose: 'chat_reply',
      billingOwner: 'user',
      modelRole: snapshot.scope === 'adult' ? 'adult' : 'chat',
      messages: snapshot.messages,
      deadlineAt: snapshot.deadlineAt,
      responseFormat: 'text',
      maxOutputTokens: 600,
      idempotencyKey: `ai:${row.id}:${row.retryEpoch}:${suffix}`,
      meta: {
        personaVersion: snapshot.personaVersion,
        promptTemplateVersion: snapshot.promptTemplateVersion,
        conversationKind: 'direct',
        scenarioMode: snapshot.scenarioMode,
        ...(snapshot.stablePrefixChars > 0
          ? { stablePrefixChars: snapshot.stablePrefixChars }
          : {}),
      },
    };
  }
  private async saveInput(row: ReplyPlan, snapshot: ReplySnapshot): Promise<boolean> {
    if (row.inputCiphertext) return true;
    const proposed = await this.quirks
      .choose(row, snapshot)
      .catch(() => ({ kind: 'none' as const, respondAt: null, typingCycles: 0 }));
    return this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return false;
      const [current] = await tx.db
        .select()
        .from(replyPlans)
        .where(eq(replyPlans.id, row.id))
        .for('update');
      if (!current || current.status !== 'generating' || current.leaseId !== row.leaseId)
        return false;
      snapshot.quirk = await this.quirks.reserve(tx, row, proposed, snapshot.timeZone);
      if (snapshot.quirk.kind === 'read_delay')
        snapshot.messages.push({
          role: 'system',
          content:
            '本轮你有意稍等了一会儿再回复。按人设自然体现稍微晾了一下，不要假装没看到；不得冷落、责怪或操纵用户。',
        });
      const cipher = await this.store.seal(tx, row, 'input', snapshot);
      const saved = await tx.db
        .update(replyPlans)
        .set({ inputCiphertext: cipher })
        .where(and(eq(replyPlans.id, row.id), eq(replyPlans.leaseId, row.leaseId!)))
        .returning();
      return saved.length > 0;
    });
  }
  private async wait(row: ReplyPlan, reason: string): Promise<void> {
    await this.store.db.db
      .update(replyPlans)
      .set({ status: 'waiting', failure: reason, leaseId: null, leaseUntil: null })
      .where(and(eq(replyPlans.id, row.id), eq(replyPlans.leaseId, row.leaseId!)));
  }
  private async emit(row: ReplyPlan): Promise<void> {
    const result = Result.parse(await this.store.open(row, 'result'));
    const contact = await this.context.contacts.getActiveContact(row.userId, row.characterId);
    const conversation =
      contact?.conversationId === row.conversationId ||
      (result.snapshot.trial &&
        (await this.context.currentEpoch(row, result.snapshot)) === result.snapshot.epoch)
        ? await this.context.chat.getConversation(row.conversationId)
        : null;
    const policy = conversation
      ? await this.context.policy.getCharacterPolicy(row.userId, row.characterId)
      : null;
    if (result.care && conversation && policy) {
      if (conversation.contentScope === 'adult' && !policy.adultModeEligible) {
        const safe = await this.context.admin.setContentScope({
          conversationId: row.conversationId,
          scope: 'normal',
        });
        if (!safe.ok) {
          await this.store.cancel(row.id);
          return;
        }
        conversation.contentScope = 'normal';
      }
      result.snapshot.scope = conversation.contentScope;
      if (!result.bubbles.every((b) => outputAllowed(b, policy, false))) {
        const safe = careFallback(undefined, result.snapshot.careVariant, null);
        result.bubbles = Array.from(
          { length: Math.max(2, result.bubbles.length) },
          (_, i) => safe[i === 0 ? 0 : 1]!,
        );
      }
      await this.store.db.transaction(async (tx) => {
        if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
        const cipher = await this.store.seal(tx, row, 'result', result);
        await tx.db
          .update(replyPlans)
          .set({ resultCiphertext: cipher })
          .where(and(eq(replyPlans.id, row.id), eq(replyPlans.status, 'sending')));
        row.resultCiphertext = cipher;
      });
    }
    if (
      (await this.context.currentEpoch(row, result.snapshot)) !== result.snapshot.epoch ||
      !conversation ||
      !policy ||
      conversation.contentScope !== result.snapshot.scope ||
      !result.bubbles.every((b) => outputAllowed(b, policy, result.snapshot.scope === 'adult'))
    ) {
      await this.store.cancel(row.id);
      return;
    }
    await this.writer.markRead({
      conversationId: row.conversationId,
      participantId: result.snapshot.participantId,
      readSeq: result.snapshot.lastUserSeq,
    });
    if (!result.care) {
      if (
        row.nextBubble === 0 &&
        result.snapshot.quirk.kind === 'shy_typing' &&
        (await this.quirks.consumeTyping(row))
      ) {
        for (let i = 0; i < result.snapshot.quirk.typingCycles; i++) {
          await this.writer.setTyping({
            conversationId: row.conversationId,
            participantId: result.snapshot.participantId,
            state: 'start',
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          await this.writer.setTyping({
            conversationId: row.conversationId,
            participantId: result.snapshot.participantId,
            state: 'stop',
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
      }
      await this.writer.setTyping({
        conversationId: row.conversationId,
        participantId: result.snapshot.participantId,
        state: 'start',
      });
      await new Promise<void>((resolve) => setTimeout(resolve, P28_INSTANT_REPLY_MIN_TYPING_MS));
    }
    try {
      const current = await this.store.get(row.id);
      if (
        current?.status !== 'sending' ||
        (await this.context.currentEpoch(row, result.snapshot)) !== result.snapshot.epoch
      )
        return;
      if (
        !result.care &&
        row.nextBubble === 1 &&
        result.snapshot.quirk.kind === 'recall' &&
        result.quirkDraftMessageId
      ) {
        const recalled = await this.writer.recall({
          conversationId: row.conversationId,
          participantId: result.snapshot.participantId,
          messageId: result.quirkDraftMessageId,
        });
        if (!recalled.ok && recalled.error === 'not_sender') {
          await this.store.cancel(row.id);
          return;
        }
      }
      await this.store.db.transaction(async (tx) => {
        if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
        const [pending] = await tx.db
          .select()
          .from(replyPlans)
          .where(eq(replyPlans.id, row.id))
          .for('update');
        if (
          !pending ||
          pending.status !== 'sending' ||
          pending.nextBubble !== row.nextBubble ||
          (await this.context.currentEpoch(row, result.snapshot, tx)) !== result.snapshot.epoch ||
          (await this.context.memory.revision(
            tx,
            row.userId,
            row.characterId,
            row.conversationId,
          )) !== result.snapshot.memoryRevision
        )
          return;
        const posted = await this.writer.postMessage(
          {
            conversationId: row.conversationId,
            senderParticipantId: result.snapshot.participantId,
            content: result.contents?.[row.nextBubble] ?? {
              type: 'text',
              text: result.bubbles[row.nextBubble]!,
            },
            idempotencyKey: `reply:${row.triggerId}:${row.nextBubble}`,
            expectedScope: result.snapshot.scope,
            ...(result.charge &&
            row.nextBubble === (result.snapshot.quirk.kind === 'recall' && !result.care ? 1 : 0)
              ? { charge: result.charge }
              : {}),
            ...(result.snapshot.trial
              ? { labels: ['trial'] }
              : result.snapshot.healthUsed
                ? { labels: [HEALTH_LABEL] }
                : row.nextBubble === 0 && result.snapshot.quirk.kind === 'recall'
                  ? { labels: ['quirk_draft'] }
                  : {}),
          },
          tx,
        );
        if (!posted.ok) {
          await tx.db
            .update(replyPlans)
            .set({ status: 'cancelled', inputCiphertext: null, resultCiphertext: null })
            .where(eq(replyPlans.id, row.id));
          return;
        }
        // T-071：角色发出语音 → 成就第 11 号（ai_runtime.milestone voice_message_sent）。
        if (posted.value.content?.type === 'voice')
          await this.outbox.publish(tx, 'ai_runtime.milestone', 'ai_runtime', {
            userId: row.userId,
            characterId: row.characterId,
            kind: 'voice_message_sent',
            refId: posted.value.messageId,
          });
        const nextBubble = row.nextBubble + 1;
        if (row.nextBubble === 0 && result.snapshot.quirk.kind === 'recall')
          result.quirkDraftMessageId = posted.value.messageId;
        const done = nextBubble >= (result.contents?.length ?? result.bubbles.length);
        const dueAt = new Date(
          this.clock.nowMs() + (result.care ? 0 : P02_SPLIT_BUBBLES.minIntervalMs),
        );
        await tx.db
          .update(replyPlans)
          .set({
            nextBubble,
            status: done ? 'done' : 'sending',
            dueAt,
            inputCiphertext: done ? null : row.inputCiphertext,
            resultCiphertext: done ? null : await this.store.seal(tx, row, 'result', result),
          })
          .where(
            and(
              eq(replyPlans.id, row.id),
              eq(replyPlans.nextBubble, row.nextBubble),
              eq(replyPlans.status, 'sending'),
            ),
          );
        if (!done) await this.store.schedule(tx, row.id, dueAt);
      });
    } finally {
      await this.writer.setTyping({
        conversationId: row.conversationId,
        participantId: result.snapshot.participantId,
        state: 'stop',
      });
    }
  }
}

/** v3.3：包一层网关，累计成功调用的扣费；回复类调用（reply / guard / names）的用量记录 ID 记为这次回复的调用。 */
function trackCharges(
  gateway: ModelGatewayPort,
  sink: { usageRecordId: string | null; chargedMicros: number },
): ModelGatewayPort {
  return new Proxy(gateway, {
    get(target, prop, receiver) {
      if (prop === 'generateText')
        return async (input: GenerateTextInput) => {
          const result = await target.generateText(input);
          if (result.ok) {
            sink.chargedMicros += Math.max(0, result.value.chargedMicros);
            if (/:(reply|guard|names)$/.test(input.idempotencyKey))
              sink.usageRecordId = result.value.usageRecordId;
          }
          return result;
        };
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
