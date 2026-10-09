import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ChatParticipantPort,
  type ModelGatewayPort,
  type GenerateTextInput,
  type GenerateTextOutput,
  type PortResult,
  type GenerateError,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  P02_SPLIT_BUBBLES,
  P28_INSTANT_REPLY_MIN_TYPING_MS,
  type AuditLog,
  type Clock,
} from '../../../platform/index.js';
import { CHAT_PARTICIPANT_PORT } from '../../chat/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { replyPlans } from '../infra/db/schema.js';
import { ReplyPlanStore, type ReplyPlan } from './plan-store.js';
import { ReplyContext, ReplySnapshot } from './reply-context.js';
import { callModelForCare, careFallback } from './safety-care.js';
import { HEALTH_LABEL } from './health-care.js';
import { outputAllowed, replyDelay, splitReply } from '../domain/reply-rules.js';
const Result = z.object({
  bubbles: z.array(z.string().min(1).max(4000)).min(1).max(4),
  snapshot: ReplySnapshot,
  care: z.boolean(),
});
@Injectable()
export class ReplyEngine {
  constructor(
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyContext) readonly context: ReplyContext,
    @Inject(MODEL_GATEWAY_PORT) readonly gateway: ModelGatewayPort,
    @Inject(CHAT_PARTICIPANT_PORT) readonly writer: ChatParticipantPort,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(AUDIT_LOG) readonly audit: AuditLog,
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
    const saved = await this.saveInput(row, snapshot);
    if (!saved) return;
    const care = snapshot.highRisk || snapshot.careActive;
    let suspected = snapshot.suspected;
    if (suspected && !care) {
      const check = await callModelForCare(
        this.gateway,
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
      );
      suspected = check.ok && check.value.text.trim() === 'HIGH';
    }
    const facts = {
      highRisk: snapshot.highRisk || suspected,
      careActive: snapshot.careActive,
      suspected: false,
    };
    let answer: PortResult<GenerateTextOutput, GenerateError> = snapshot.forceCareFallback
      ? { ok: false, error: 'policy_denied' }
      : await callModelForCare(this.gateway, this.input(row, snapshot, 'reply'), facts);
    if (
      answer.ok &&
      !outputAllowed(answer.value.text, snapshot.policy, snapshot.scope === 'adult')
    ) {
      answer = await callModelForCare(
        this.gateway,
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
    }
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
      });
      const delay = inCare
        ? 0
        : replyDelay(
            bubbles.join(''),
            snapshot.instantReply,
            this.clock.nowMs() - Date.parse(snapshot.triggerAt),
          );
      const dueAt = new Date(
        this.clock.nowMs() + Math.max(0, delay - (inCare ? 0 : P28_INSTANT_REPLY_MIN_TYPING_MS)),
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
      },
    };
  }
  private async saveInput(row: ReplyPlan, snapshot: ReplySnapshot): Promise<boolean> {
    if (row.inputCiphertext) return true;
    return this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return false;
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
      contact?.conversationId === row.conversationId
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
      (await this.context.contacts.getActiveContactEpoch(row.userId, row.characterId))?.version !==
        result.snapshot.epoch ||
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
        (await this.context.contacts.getActiveContactEpoch(row.userId, row.characterId))
          ?.version !== result.snapshot.epoch
      )
        return;
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
            content: { type: 'text', text: result.bubbles[row.nextBubble]! },
            idempotencyKey: `reply:${row.triggerId}:${row.nextBubble}`,
            expectedScope: result.snapshot.scope,
            ...(result.snapshot.healthUsed ? { labels: [HEALTH_LABEL] } : {}),
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
        const nextBubble = row.nextBubble + 1;
        const done = nextBubble >= result.bubbles.length;
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
            resultCiphertext: done ? null : row.resultCiphertext,
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
