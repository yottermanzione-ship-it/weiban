import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, gt, lte, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ChatReadPort,
  ContactsReadPort,
  ModelGatewayPort,
  PolicyPort,
  Message,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { MODEL_GATEWAY_PORT, contextTokens } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { chatSummaryStates, chatSummaryVersions, memoryStates } from '../infra/db/schema.js';
import {
  CHAT_SUMMARY_PROMPT,
  ChatSummaryItems,
  renderChatSummary,
  validateSummaryAnswer,
  type ChatSummaryItem,
} from '../domain/chat-summary.js';
import { healthPrivate } from '../domain/memory.js';
import { readableMessageText } from './content-text.js';
import { ReplyPlanStore } from './plan-store.js';
import { ImageCaptionStore, NO_CAPTIONS } from './image-captions.js';
import { captionForMemory } from '../domain/image-caption.js';

export const CHAT_SUMMARY_JOB = 'ai.compact_chat';
type Parent = typeof memoryStates.$inferSelect;
type Scope = 'normal' | 'adult';
const Prepared = z.object({
  epoch: z.string(),
  barrier: z.number(),
  fromSeq: z.number(),
  toSeq: z.number(),
  offset: z.number(),
  partialMessageId: z.string().nullable(),
  previous: ChatSummaryItems,
  messages: z.array(
    z.object({
      id: z.string(),
      messageId: z.string(),
      at: z.string(),
      sender: z.string(),
      text: z.string(),
    }),
  ),
  fingerprints: z.array(z.object({ id: z.string(), hash: z.string() })),
});
function fingerprint(m: Message): string {
  return createHash('sha256')
    .update(JSON.stringify([m.messageId, m.scope, m.status, m.content, m.labels]))
    .digest('hex');
}

@Injectable()
export class ChatSummaryService {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) readonly crypto: EnvelopeCrypto,
    @Inject(CHAT_READ_PORT) readonly chat: ChatReadPort,
    @Inject(CONTACTS_READ_PORT) readonly contacts: ContactsReadPort,
    @Inject(MODEL_GATEWAY_PORT) readonly gateway: ModelGatewayPort,
    @Inject(POLICY_PORT) readonly policy: PolicyPort,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(ReplyPlanStore) readonly plans: ReplyPlanStore,
    @Optional() @Inject(ImageCaptionStore) readonly captions?: ImageCaptionStore,
  ) {}

  private async open<T>(
    userId: string,
    aad: string,
    cipher: Buffer,
    schema: z.ZodType<T>,
    tx?: DbTx,
  ): Promise<T> {
    const plain = await this.crypto.open(userId, aad, cipher, tx);
    try {
      return schema.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
  async views(tx: DbTx, parent: Parent, since: string | null) {
    const states = await tx.db
      .select()
      .from(chatSummaryStates)
      .where(eq(chatSummaryStates.parentId, parent.id));
    const out: Partial<Record<Scope, { coveredSeq: number; text: string; version: number }>> = {};
    for (const state of states) {
      if (!state.version || !state.ciphertext) continue;
      const items = await this.open(
        parent.userId,
        `ai:chat-summary:${state.id}`,
        state.ciphertext,
        ChatSummaryItems,
        tx,
      );
      out[state.scope as Scope] = {
        coveredSeq: state.coveredSeq,
        version: state.version,
        text: renderChatSummary(items, since),
      };
    }
    return out;
  }
  async forget(tx: DbTx, parentId: string) {
    await tx.db.delete(chatSummaryStates).where(eq(chatSummaryStates.parentId, parentId));
  }

  /** 压力发生后才登记；继承现有摘要边界，而非事实提取游标。 */
  async request(
    parent: Parent,
    scope: Scope,
    toSeq: number,
    previous: ChatSummaryItem[],
  ): Promise<void> {
    const id = newId();
    const floor = Math.max(parent.barrierSeq, parent.windowStartSeq);
    if (toSeq <= floor) return;
    await this.db.transaction(async (tx) => {
      await this.plans.lock(tx, parent.userId, parent.conversationId);
      const [current] = await tx.db
        .select()
        .from(memoryStates)
        .where(eq(memoryStates.id, parent.id))
        .for('update');
      if (
        !current ||
        current.barrierSeq !== parent.barrierSeq ||
        current.revision !== parent.revision
      )
        return;
      await tx.db
        .insert(chatSummaryStates)
        .values({
          id,
          parentId: parent.id,
          scope,
          coveredSeq: floor,
          targetSeq: toSeq,
          ciphertext: await this.crypto.seal(
            parent.userId,
            `ai:chat-summary:${id}`,
            JSON.stringify(previous),
            tx,
          ),
          updatedAt: this.clock.now(),
        })
        .onConflictDoNothing();
      await tx.query(
        'UPDATE ai_runtime.chat_summary_states SET target_seq=greatest(target_seq,$3) WHERE parent_id=$1 AND scope=$2',
        [parent.id, scope, toSeq],
      );
    });
    const [state] = await this.db.db
      .select()
      .from(chatSummaryStates)
      .where(and(eq(chatSummaryStates.parentId, parent.id), eq(chatSummaryStates.scope, scope)));
    if (state) await this.run(state.id);
  }

  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select({ id: chatSummaryStates.id })
      .from(chatSummaryStates)
      .where(
        and(
          gt(chatSummaryStates.targetSeq, chatSummaryStates.coveredSeq),
          or(
            isNull(chatSummaryStates.retryAfter),
            lte(chatSummaryStates.retryAfter, this.clock.now()),
          ),
          or(
            isNull(chatSummaryStates.leaseUntil),
            lte(chatSummaryStates.leaseUntil, this.clock.now()),
          ),
        ),
      )
      .limit(20);
    for (const row of rows)
      await this.jobs.send(CHAT_SUMMARY_JOB, row, {
        singletonKey: `chat-summary:${row.id}`,
        retryLimit: 0,
      });
  }

  private async load(id: string, tx?: DbTx) {
    const db = tx ?? this.db;
    const [row] = await db.db
      .select({ s: chatSummaryStates, p: memoryStates })
      .from(chatSummaryStates)
      .innerJoin(memoryStates, eq(memoryStates.id, chatSummaryStates.parentId))
      .where(eq(chatSummaryStates.id, id));
    return row;
  }

  async run(id: string): Promise<void> {
    const row = await this.load(id);
    if (!row) return;
    const scope = row.s.scope as Scope;
    const contact = await this.contacts.getActiveContact(row.p.userId, row.p.characterId);
    const epoch = await this.contacts.getActiveContactEpoch(row.p.userId, row.p.characterId);
    if (contact?.conversationId !== row.p.conversationId || !epoch) return;
    if (scope === 'adult' && !(await this.policy.checkAdultGeneration(row.p)).allowed) return;
    const budget = await this.gateway.getContextBudget?.({
      userId: row.p.userId,
      characterId: row.p.characterId,
      modelRole: scope === 'adult' ? 'adult' : 'background',
      purpose: 'memory',
      maxOutputTokens: 2400,
    });
    if (this.gateway.getContextBudget && !budget) return;
    const lease = newId();
    const claimed = await this.db.transaction(async (tx) => {
      await this.plans.lock(tx, row.p.userId, row.p.conversationId);
      const [s] = await tx.db
        .select()
        .from(chatSummaryStates)
        .where(eq(chatSummaryStates.id, id))
        .for('update');
      if (
        !s ||
        s.targetSeq <= s.coveredSeq ||
        (s.retryAfter && s.retryAfter > this.clock.now()) ||
        (s.leaseUntil && s.leaseUntil > this.clock.now())
      )
        return null;
      const attempts = s.preparedCiphertext ? s.attempts : s.attempts >= 4 ? 1 : s.attempts + 1;
      await tx.db
        .update(chatSummaryStates)
        .set({
          leaseId: lease,
          leaseUntil: new Date(this.clock.nowMs() + 180000),
          attempts,
          updatedAt: this.clock.now(),
        })
        .where(eq(chatSummaryStates.id, id));
      return { ...s, attempts };
    });
    if (!claimed) return;
    try {
      let prepared: z.infer<typeof Prepared>;
      if (claimed.preparedCiphertext)
        prepared = await this.open(
          row.p.userId,
          `ai:chat-summary-input:${id}`,
          claimed.preparedCiphertext,
          Prepared,
        );
      else {
        const previous = claimed.ciphertext
          ? await this.open(
              row.p.userId,
              `ai:chat-summary:${id}`,
              claimed.ciphertext,
              ChatSummaryItems,
            )
          : [];
        const history = (
          await this.chat.readMessages({
            conversationId: row.p.conversationId,
            scopes: [scope],
            afterSeq: claimed.coveredSeq,
            limit: 80,
          })
        ).filter((m) => m.seq <= claimed.targetSeq);
        const loaded =
          (await this.captions?.forMessages(row.p.userId, history, [scope]).catch(() => null)) ??
          NO_CAPTIONS;
        const captions = new Map([...loaded].filter(([, value]) => captionForMemory(value)));
        const messages: z.infer<typeof Prepared>['messages'] = [];
        const fingerprints: z.infer<typeof Prepared>['fingerprints'] = [];
        const maxChars = claimed.attempts >= 2 ? 6000 : 12000;
        let chars = 0,
          toSeq = claimed.coveredSeq,
          offset = 0,
          partialMessageId: string | null = null;
        for (const m of history) {
          const text = readableMessageText(m, captions);
          if (
            m.status !== 'normal' ||
            m.senderKind === 'system' ||
            !text ||
            healthPrivate(text) ||
            m.labels?.some((x) => ['health', 'quirk_draft'].includes(x))
          ) {
            toSeq = m.seq;
            continue;
          }
          const start = m.messageId === claimed.partialMessageId ? claimed.partialOffset : 0;
          const end = Math.min(text.length, start + maxChars - chars);
          if (end <= start) break;
          const piece = text.slice(start, end);
          const item = {
            id: `${m.messageId}:${start}:${end}`,
            messageId: m.messageId,
            at: m.createdAt.slice(0, 10),
            sender: m.senderKind,
            text: piece,
          };
          const payload = JSON.stringify({ previous, messages: [...messages, item] });
          if (
            budget &&
            contextTokens([{ content: CHAT_SUMMARY_PROMPT }, { content: payload }]) >
              budget.triggerTokens
          )
            break;
          messages.push(item);
          fingerprints.push({ id: m.messageId, hash: fingerprint(m) });
          chars += piece.length;
          if (end < text.length) {
            offset = end;
            partialMessageId = m.messageId;
            break;
          }
          toSeq = m.seq;
          if (chars >= maxChars) break;
        }
        if (!messages.length && history.length && toSeq === claimed.coveredSeq)
          throw new Error('summary_source_too_large');
        if (
          !history.length ||
          (history.length < 80 && toSeq === history.at(-1)?.seq && offset === 0)
        )
          toSeq = claimed.targetSeq;
        prepared = {
          epoch: epoch.version,
          barrier: row.p.barrierSeq,
          fromSeq: claimed.coveredSeq,
          toSeq,
          offset,
          partialMessageId,
          previous,
          messages,
          fingerprints,
        };
        const cipher = await this.crypto.seal(
          row.p.userId,
          `ai:chat-summary-input:${id}`,
          JSON.stringify(prepared),
        );
        await this.db.db
          .update(chatSummaryStates)
          .set({ preparedCiphertext: cipher })
          .where(and(eq(chatSummaryStates.id, id), eq(chatSummaryStates.leaseId, lease)));
      }
      let items = prepared.previous;
      if (prepared.messages.length) {
        const result = await this.gateway.generateText({
          userId: row.p.userId,
          characterId: row.p.characterId,
          conversationId: row.p.conversationId,
          purpose: 'memory',
          billingOwner: 'user',
          modelRole: scope === 'adult' ? 'adult' : 'background',
          countAsBackground: true,
          responseFormat: 'json',
          maxOutputTokens: 2400,
          idempotencyKey: `chat-summary:${id}:${claimed.version}:${claimed.attempts}`,
          meta: {
            scenarioMode: scope,
            conversationKind: 'direct',
            promptTemplateVersion: 'chat-summary-v2',
          },
          messages: [
            { role: 'system', content: CHAT_SUMMARY_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({ previous: prepared.previous, messages: prepared.messages }),
            },
          ],
        });
        if (!result.ok) throw new Error(`summary_${result.error}`);
        if (result.value.truncated) throw new Error('summary_truncated');
        const sources = new Map(
          [...prepared.previous, ...prepared.messages].map((x) => [x.id, { at: x.at }] as const),
        );
        const values = validateSummaryAnswer(JSON.parse(result.value.text), sources);
        if (!values.length && prepared.previous.length) throw new Error('summary_empty');
        if (values.some((v) => healthPrivate(v.text))) throw new Error('summary_private_health');
        items = values.map((v) => ({ ...v, id: newId() }));
        const sourceSize = contextTokens(
          [...prepared.previous, ...prepared.messages].map((x) => ({ content: x.text })),
        );
        if (contextTokens([{ content: renderChatSummary(items, null) }]) >= sourceSize)
          throw new Error('summary_not_reduced');
      }
      // 回写前重新验证来源，防撤回/删除/范围变化后的旧结果复活。
      for (const source of prepared.fingerprints) {
        const current = await this.chat.getMessage(source.id, [scope]);
        if (!current || fingerprint(current) !== source.hash)
          throw new Error('summary_source_changed');
      }
      await this.db.transaction(async (tx) => {
        await this.plans.lock(tx, row.p.userId, row.p.conversationId);
        const current = await this.load(id, tx);
        if (
          !current ||
          current.s.leaseId !== lease ||
          current.s.version !== claimed.version ||
          current.p.barrierSeq !== prepared.barrier
        )
          return;
        if (
          (await this.contacts.getActiveContactEpoch(row.p.userId, row.p.characterId, tx))
            ?.version !== prepared.epoch
        )
          return;
        if (scope === 'adult' && !(await this.policy.checkAdultGeneration(row.p, tx)).allowed)
          return;
        const ciphertext = await this.crypto.seal(
          row.p.userId,
          `ai:chat-summary:${id}`,
          JSON.stringify(items),
          tx,
        );
        const version = claimed.version + 1;
        await tx.db.insert(chatSummaryVersions).values({
          id: newId(),
          stateId: id,
          version,
          fromSeq: prepared.fromSeq,
          toSeq: prepared.toSeq,
          ciphertext,
          createdAt: this.clock.now(),
        });
        await tx.db
          .update(chatSummaryStates)
          .set({
            coveredSeq: prepared.toSeq,
            partialOffset: prepared.offset,
            partialMessageId: prepared.partialMessageId,
            version,
            ciphertext,
            preparedCiphertext: null,
            attempts: 0,
            retryAfter: null,
            leaseId: null,
            leaseUntil: null,
            updatedAt: this.clock.now(),
          })
          .where(eq(chatSummaryStates.id, id));
        await tx.query(
          'DELETE FROM ai_runtime.chat_summary_versions WHERE state_id=$1 AND version < $2',
          [id, version - 9],
        );
        await tx.db
          .update(memoryStates)
          .set({ windowBlockCiphertext: null })
          .where(eq(memoryStates.id, row.p.id));
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      new Logger(ChatSummaryService.name).warn({
        code: 'ai_chat_summary_failed',
        stateId: id,
        attempt: claimed.attempts,
        reason: /^summary_[a-z_]+$/.test(code) ? code : 'invalid_or_unavailable_input',
      });
      const wait = /insufficient_balance|budget_exceeded/.test(code)
        ? 86400000
        : [300000, 1800000, 7200000, 86400000][Math.min(claimed.attempts - 1, 3)]!;
      await this.db.db
        .update(chatSummaryStates)
        .set({
          leaseId: null,
          leaseUntil: null,
          preparedCiphertext: null,
          retryAfter: new Date(this.clock.nowMs() + wait),
          updatedAt: this.clock.now(),
        })
        .where(and(eq(chatSummaryStates.id, id), eq(chatSummaryStates.leaseId, lease)));
    }
  }
}
