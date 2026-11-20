import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, gt, lte, or, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ChatReadPort,
  ContactsReadPort,
  ModelGatewayPort,
  PolicyPort,
  Message,
  MediaTranscriptPort,
  BillingUsageRefundPort,
  ModelTaskOutcomePort,
} from '@weiban/contracts';
import { MODEL_TASK_OUTCOME_PORT } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  modelTaskKey,
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
  SHORT_REF_SUMMARY_PROMPT,
  ChatSummaryItems,
  renderChatSummary,
  fitSummaryPiece,
  validateSummaryAnswer,
  parseSummaryJson,
  summarySubmission,
  summaryRepairInstruction,
  type ChatSummaryItem,
} from '../domain/chat-summary.js';
import { healthPrivate } from '../domain/memory.js';
import { readableMessageText, withVoiceTranscripts } from './content-text.js';
import { MEDIA_TRANSCRIPT_PORT } from '../../media/index.js';
import { ReplyPlanStore } from './plan-store.js';
import { ImageCaptionStore, NO_CAPTIONS } from './image-captions.js';
import { captionForMemory } from '../domain/image-caption.js';
import { BILLING_USAGE_REFUND_PORT } from '../../billing/index.js';
import {
  isMemoryFundingBlock,
  memoryFailureCode,
  memoryFundingCheckAt,
} from '../domain/memory-funding.js';

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
  shortRefs: z.literal(true).optional(),
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
    @Optional() @Inject(MEDIA_TRANSCRIPT_PORT) readonly transcripts?: MediaTranscriptPort,
    @Optional()
    @Inject(BILLING_USAGE_REFUND_PORT)
    readonly refunds?: BillingUsageRefundPort,
    @Optional() @Inject(MODEL_TASK_OUTCOME_PORT) readonly outcomes?: ModelTaskOutcomePort,
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
    minimumFloorSeq = 0,
  ): Promise<void> {
    const id = newId();
    const floor = Math.max(parent.barrierSeq, parent.windowStartSeq, minimumFloorSeq);
    // 档位窗口前移时从窗口起点重新开始，旧摘要不再带入；否则旧条目会和窗口内消息一起重算。
    const seed = floor > parent.windowStartSeq ? [] : previous;
    await this.db.transaction(async (tx) => {
      if (!(await this.plans.lock(tx, parent.userId, parent.conversationId))) return;
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
            JSON.stringify(seed),
            tx,
          ),
          updatedAt: this.clock.now(),
        })
        .onConflictDoNothing();
      // 免费档窗口前移时，把旧范围直接标成已覆盖，旧摘要一并作废；后台不再补、不再扣费；
      // 窗口内未完成的部分仍保留在 target 里继续增量摘要。
      await tx.query(
        `UPDATE ai_runtime.chat_summary_states
            SET target_seq=greatest(target_seq,$3),
                covered_seq=greatest(covered_seq,$4),
                ciphertext = CASE WHEN covered_seq < $4 THEN NULL ELSE ciphertext END,
                partial_offset = CASE WHEN covered_seq < $4 THEN 0 ELSE partial_offset END,
                partial_message_id = CASE WHEN covered_seq < $4 THEN NULL ELSE partial_message_id END,
                last_failure = CASE WHEN covered_seq < $4 THEN NULL ELSE last_failure END,
                retry_char_limit = CASE WHEN covered_seq < $4 THEN NULL ELSE retry_char_limit END,
                lease_id = CASE WHEN covered_seq < $4 THEN NULL ELSE lease_id END,
                lease_until = CASE WHEN covered_seq < $4 THEN NULL ELSE lease_until END,
                prepared_ciphertext = CASE WHEN covered_seq < $4 THEN NULL ELSE prepared_ciphertext END,
                attempts = CASE WHEN covered_seq < $4 THEN 0 ELSE attempts END,
                retry_after = CASE WHEN covered_seq < $4 THEN NULL ELSE retry_after END
          WHERE parent_id=$1 AND scope=$2`,
        [parent.id, scope, toSeq, floor],
      );
    });
    if (toSeq <= floor) return;
    const [state] = await this.db.db
      .select()
      .from(chatSummaryStates)
      .where(and(eq(chatSummaryStates.parentId, parent.id), eq(chatSummaryStates.scope, scope)));
    if (state) await this.run(state.id);
  }

  async reconcile(): Promise<void> {
    const pending = await this.db.query<{ usage_record_id: string }>(
      'SELECT usage_record_id FROM ai_runtime.summary_refund_jobs WHERE retry_after<=$1 ORDER BY retry_after LIMIT 20',
      [this.clock.now()],
    );
    for (const job of pending.rows) await this.finishRefund(job.usage_record_id);
    const rows = await this.db.db
      .select({ id: chatSummaryStates.id })
      .from(chatSummaryStates)
      .where(
        and(
          gt(chatSummaryStates.targetSeq, chatSummaryStates.coveredSeq),
          sql`${chatSummaryStates.lastFailure} IS DISTINCT FROM 'insufficient_balance'`,
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
    if (
      !row ||
      row.s.targetSeq <= row.s.coveredSeq ||
      row.s.lastFailure === 'insufficient_balance' ||
      (row.s.retryAfter && row.s.retryAfter > this.clock.now())
    )
      return;
    const scope = row.s.scope as Scope;
    const contact = await this.contacts.getActiveContact(row.p.userId, row.p.characterId);
    const epoch = await this.contacts.getActiveContactEpoch(row.p.userId, row.p.characterId);
    if (contact?.conversationId !== row.p.conversationId || !epoch) return;
    if (scope === 'adult' && !(await this.policy.checkAdultGeneration(row.p)).allowed) return;
    const lease = newId();
    const claimed = await this.db.transaction(async (tx) => {
      if (!(await this.plans.lock(tx, row.p.userId, row.p.conversationId))) return null;
      const [s] = await tx.db
        .select()
        .from(chatSummaryStates)
        .where(eq(chatSummaryStates.id, id))
        .for('update');
      if (
        !s ||
        s.lastFailure === 'insufficient_balance' ||
        s.targetSeq <= s.coveredSeq ||
        (s.retryAfter && s.retryAfter > this.clock.now()) ||
        (s.leaseUntil && s.leaseUntil > this.clock.now())
      )
        return null;
      const attempts = s.preparedCiphertext ? s.attempts : Math.min(4, s.attempts + 1);
      const attemptGeneration = s.attemptGeneration + (s.preparedCiphertext ? 0 : 1);
      await tx.db
        .update(chatSummaryStates)
        .set({
          leaseId: lease,
          leaseUntil: new Date(this.clock.nowMs() + 180000),
          attempts,
          attemptGeneration,
          updatedAt: this.clock.now(),
        })
        .where(eq(chatSummaryStates.id, id));
      return { ...s, attempts, attemptGeneration };
    });
    if (!claimed) return;
    let chargedUsageId: string | null = null;
    let acceptedUsageId: string | null = null;
    let stage = 'summary_prepare_failed';
    let sourceChars = 0;
    const nextPrompt = SHORT_REF_SUMMARY_PROMPT + summaryRepairInstruction(claimed.lastFailure);
    const taskKey = modelTaskKey(
      row.p.userId,
      `summary:${id}:${claimed.version}:${claimed.coveredSeq}:${claimed.partialOffset}`,
    );
    try {
      const budget = await this.gateway.getContextBudget?.({
        userId: row.p.userId,
        characterId: row.p.characterId,
        modelRole: scope === 'adult' ? 'adult' : 'background',
        purpose: 'memory',
      });
      if (this.gateway.getContextBudget && !budget) throw new Error('summary_model_unavailable');
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
        // 按所选 background 模型的真实上下文上限读取，而不是固定 80 条。
        const targetSeq = claimed.targetSeq;
        const initialLimit = budget
          ? Math.max(200, Math.min(5000, Math.floor(budget.inputTokens / 20)))
          : 80;
        // Recover in bounded pages as well as bounded prompt bytes.
        const maxMessages = claimed.attempts > 1 ? Math.min(initialLimit, 200) : initialLimit;
        const history: Message[] = [];
        let afterSeq = claimed.coveredSeq;
        while (history.length < maxMessages && afterSeq < targetSeq) {
          const page = await this.chat.readMessages({
            conversationId: row.p.conversationId,
            scopes: [scope],
            afterSeq,
            limit: Math.min(200, maxMessages - history.length),
          });
          if (!page.length) break;
          for (const message of page) {
            if (message.seq > targetSeq) break;
            history.push(message);
            if (history.length >= maxMessages) break;
          }
          const next = page.at(-1)?.seq ?? afterSeq;
          if (next <= afterSeq) break;
          afterSeq = next;
          if (page.length < 200) break;
        }
        const loaded =
          (await this.captions?.forMessages(row.p.userId, history, [scope]).catch(() => null)) ??
          NO_CAPTIONS;
        const captions = new Map([...loaded].filter(([, value]) => captionForMemory(value)));
        const voiced = await withVoiceTranscripts(history, this.transcripts);
        const textById = new Map(
          voiced.map((m) => [m.messageId, readableMessageText(m, captions)]),
        );
        // T-20261103j：被上游安全策略拦过的消息不交给模型（与敏感消息一样跳过、序号照常推进）。
        const blockedRows = await this.db.query<{ seq: string }>(
          'SELECT seq FROM ai_runtime.model_blocked_messages WHERE conversation_id=$1 AND seq>$2 AND seq<=$3',
          [row.p.conversationId, claimed.coveredSeq, targetSeq],
        );
        const blocked = new Set(blockedRows.rows.map((v) => Number(v.seq)));
        const messages: z.infer<typeof Prepared>['messages'] = [];
        const fingerprints: z.infer<typeof Prepared>['fingerprints'] = [];
        const baseChars = budget ? Math.max(12000, Math.floor(budget.triggerTokens * 1.1)) : 12000;
        // 失败重试仍缩批，避免同一超大输入反复失败；首次按模型预算一次读完。
        const maxChars = Math.min(
          baseChars,
          claimed.retryCharLimit ?? Infinity,
          [Infinity, 6000, 3000, 1500][claimed.attempts - 1] ?? 1500,
        );
        // contextTokens 对每条消息计算 ceil(UTF-8字节数/2)+12，空数组的信封先统一扣除。
        const payloadBytes = budget
          ? (budget.triggerTokens - contextTokens([{ content: nextPrompt }]) - 12) * 2
          : Infinity;
        let remainingBytes =
          payloadBytes - Buffer.byteLength(JSON.stringify({ previous, messages: [] }), 'utf8');
        let chars = 0,
          toSeq = claimed.coveredSeq,
          offset = 0,
          partialMessageId: string | null = null;
        for (const m of history) {
          const text = textById.get(m.messageId) ?? '';
          if (
            m.status !== 'normal' ||
            m.senderKind === 'system' ||
            !text ||
            healthPrivate(text) ||
            m.labels?.some((x) => ['health', 'quirk_draft'].includes(x)) ||
            blocked.has(m.seq)
          ) {
            toSeq = m.seq;
            continue;
          }
          const start = m.messageId === claimed.partialMessageId ? claimed.partialOffset : 0;
          const comma = messages.length ? 1 : 0;
          const piece = fitSummaryPiece(
            { messageId: m.messageId, at: m.createdAt.slice(0, 10), sender: m.senderKind },
            text,
            start,
            maxChars - chars,
            remainingBytes - comma,
          );
          if (!piece) break;
          const { item, end, bytes } = piece;
          remainingBytes -= bytes + comma;
          messages.push(item);
          fingerprints.push({ id: m.messageId, hash: fingerprint(m) });
          chars += item.text.length;
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
        const reachedTarget = (history.at(-1)?.seq ?? claimed.coveredSeq) >= claimed.targetSeq;
        if (!history.length || (reachedTarget && toSeq === history.at(-1)?.seq && offset === 0))
          toSeq = claimed.targetSeq;
        prepared = {
          epoch: epoch.version,
          barrier: row.p.barrierSeq,
          fromSeq: claimed.coveredSeq,
          toSeq,
          offset,
          partialMessageId,
          previous,
          shortRefs: true,
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
        if (claimed.preparedCiphertext) {
          if (epoch.version !== prepared.epoch || row.p.barrierSeq !== prepared.barrier)
            throw Error('summary_source_changed');
          await this.db.transaction((tx) =>
            this.checkSources(tx, row.p, scope, prepared, claimed.targetSeq),
          );
        }
        const submission = summarySubmission(prepared);
        sourceChars = prepared.messages.reduce((n, m) => n + m.text.length, 0);
        stage = 'summary_gateway_failed';
        const result = await this.gateway.generateText({
          userId: row.p.userId,
          characterId: row.p.characterId,
          conversationId: row.p.conversationId,
          purpose: 'memory',
          billingOwner: 'user',
          modelRole: scope === 'adult' ? 'adult' : 'background',
          countAsBackground: true,
          responseFormat: 'json',
          maxOutputTokens: budget?.reservedOutputTokens ?? 2400,
          taskKey,
          idempotencyKey: claimed.attemptGeneration
            ? `chat-summary:${id}:${claimed.version}:g${claimed.attemptGeneration}`
            : `chat-summary:${id}:${claimed.version}:${claimed.attempts}`,
          meta: {
            scenarioMode: scope,
            conversationKind: 'direct',
            promptTemplateVersion: prepared.shortRefs ? 'chat-summary-v3' : 'chat-summary-v2',
          },
          messages: [
            { role: 'system', content: prepared.shortRefs ? nextPrompt : CHAT_SUMMARY_PROMPT },
            {
              role: 'user',
              content: JSON.stringify(submission.payload),
            },
          ],
        });
        if (!result.ok) throw new Error(memoryFailureCode(result));
        acceptedUsageId = result.value.usageRecordId;
        if (result.value.chargedMicros > 0) chargedUsageId = result.value.usageRecordId;
        if (result.value.truncated) throw new Error('summary_truncated');
        stage = 'summary_fields';
        const values = validateSummaryAnswer(
          parseSummaryJson(result.value.text),
          submission.sources,
        );
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
      stage = 'summary_write_failed';
      await this.db.transaction(async (tx) => {
        if (!(await this.plans.lock(tx, row.p.userId, row.p.conversationId)))
          throw Error('summary_permission_changed');
        const current = await this.load(id, tx);
        if (
          !current ||
          current.s.leaseId !== lease ||
          current.s.version !== claimed.version ||
          current.p.barrierSeq !== prepared.barrier ||
          current.s.coveredSeq !== prepared.fromSeq ||
          current.s.partialOffset !== claimed.partialOffset
        )
          throw new Error('summary_state_changed');
        if (
          (await this.contacts.getActiveContactEpoch(row.p.userId, row.p.characterId, tx))
            ?.version !== prepared.epoch
        )
          throw new Error('summary_contact_changed');
        if (scope === 'adult' && !(await this.policy.checkAdultGeneration(row.p, tx)).allowed)
          throw new Error('summary_permission_changed');
        await this.checkSources(tx, row.p, scope, prepared, claimed.targetSeq);
        const ciphertext = await this.crypto.seal(
          row.p.userId,
          `ai:chat-summary:${id}`,
          JSON.stringify(items),
          tx,
        );
        // Older releases could reset the public version at a changed tier floor while
        // keeping historical version rows. Never reuse an extant version number.
        const highest = await tx.query<{ v: number }>(
          'SELECT coalesce(max(version),0)::int v FROM ai_runtime.chat_summary_versions WHERE state_id=$1',
          [id],
        );
        const version = Math.max(claimed.version, highest.rows[0]?.v ?? 0) + 1;
        await tx.db.insert(chatSummaryVersions).values({
          id: newId(),
          stateId: id,
          version,
          adoptedUsageId: acceptedUsageId,
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
            lastFailure: null,
            retryCharLimit: null,
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
        if (acceptedUsageId)
          await this.outcomes?.record(
            {
              taskKey,
              userId: row.p.userId,
              purpose: 'memory',
              state: 'saved',
              reason: 'summary_saved',
              usageRecordId: claimed.attemptGeneration ? acceptedUsageId : null,
            },
            tx,
          );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known =
        /^(?:summary_(?:json|fields|reference_fields|unknown_source|too_long|empty|private_health|not_reduced|truncated|source_changed|state_changed|contact_changed|permission_changed|source_too_large|model_unavailable)|insufficient_balance|budget_exceeded|request_too_large|concurrency_limited|model_unavailable|provider_unavailable|content_rejected|bad_request|not_configured|policy_denied)$/u;
      const reason = known.test(message) ? message : stage;
      const shrink =
        (!!summaryRepairInstruction(reason) || reason === 'request_too_large') && sourceChars > 0;
      const retryCharLimit = shrink
        ? Math.max(128, Math.floor(sourceChars / 2))
        : claimed.retryCharLimit;
      const exhausted = shrink && claimed.retryCharLimit !== null && sourceChars <= 128;
      const retryAt = isMemoryFundingBlock(reason)
        ? memoryFundingCheckAt(reason, this.clock.now())
        : new Date(
            this.clock.nowMs() +
              (exhausted
                ? 86400000
                : [300000, 1800000, 7200000, 86400000][Math.min(claimed.attempts - 1, 3)]!),
          );
      new Logger(ChatSummaryService.name).warn({
        code: 'ai_chat_summary_failed',
        stateId: id,
        attempt: claimed.attempts,
        reason,
      });
      const refund = await this.db.transaction(async (tx) => {
        if (!(await this.plans.lock(tx, row.p.userId, row.p.conversationId)))
          return !!chargedUsageId;
        const current = await this.load(id, tx);
        if (
          current?.s.leaseId &&
          current.s.leaseId !== lease &&
          current.s.attemptGeneration === claimed.attemptGeneration &&
          current.s.preparedCiphertext
        )
          return false;
        if (chargedUsageId) {
          const adopted = await tx.query(
            'SELECT 1 FROM ai_runtime.chat_summary_versions WHERE state_id=$1 AND adopted_usage_id=$2',
            [id, chargedUsageId],
          );
          if (adopted.rows.length) return false;
          await tx.query(
            'INSERT INTO ai_runtime.summary_refund_jobs(usage_record_id,user_id,retry_after) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [chargedUsageId, row.p.userId, this.clock.now()],
          );
        }
        if (current?.s.leaseId === lease) {
          await tx.db
            .update(chatSummaryStates)
            .set({
              leaseId: null,
              leaseUntil: null,
              preparedCiphertext: null,
              lastFailure: reason,
              retryAfter: retryAt,
              retryCharLimit,
              updatedAt: this.clock.now(),
            })
            .where(eq(chatSummaryStates.id, id));
          await this.outcomes?.record(
            {
              taskKey,
              userId: row.p.userId,
              purpose: 'memory',
              state: 'deferred',
              reason,
              retryAt: retryAt.toISOString(),
              usageRecordId: claimed.attemptGeneration ? acceptedUsageId : null,
            },
            tx,
          );
        }
        return !!chargedUsageId;
      });
      if (refund && chargedUsageId) await this.finishRefund(chargedUsageId);
    }
  }

  private async checkSources(
    tx: DbTx,
    parent: Parent,
    scope: Scope,
    prepared: z.infer<typeof Prepared>,
    target: number,
  ) {
    const expected = new Map(prepared.fingerprints.map((source) => [source.id, source.hash]));
    const pieces = new Map(prepared.messages.map((m) => [m.messageId, m]));
    const end = prepared.partialMessageId ? target : prepared.toSeq;
    if (!expected.size) return;
    const blockedRows = await tx.query<{ seq: string }>(
      'SELECT seq FROM ai_runtime.model_blocked_messages WHERE conversation_id=$1 AND seq>$2 AND seq<=$3',
      [parent.conversationId, prepared.fromSeq, end],
    );
    const blocked = new Set(blockedRows.rows.map((row) => Number(row.seq)));
    let after = prepared.fromSeq;
    while (expected.size && after < end) {
      const page = await this.chat.readMessages(
        {
          conversationId: parent.conversationId,
          scopes: [scope],
          afterSeq: after,
          limit: Math.min(200, end - after),
        },
        tx,
      );
      if (!page.length) break;
      const media = page.filter(
        (m) =>
          expected.has(m.messageId) &&
          ['voice', 'image', 'sticker', 'forwarded_record'].includes(m.content?.type ?? ''),
      );
      const captions = media.length
        ? await this.captions?.forMessages(parent.userId, media, [scope], tx)
        : undefined;
      const safe = new Map([...(captions ?? NO_CAPTIONS)].filter(([, v]) => captionForMemory(v)));
      const voiced = await withVoiceTranscripts(media, this.transcripts, tx);
      for (const m of voiced) {
        const piece = pieces.get(m.messageId);
        const range = piece && /:(\d+):(\d+)$/.exec(piece.id);
        const rendered = readableMessageText(m, safe);
        if (
          !piece ||
          !range ||
          healthPrivate(rendered) ||
          rendered.slice(Number(range[1]), Number(range[2])) !== piece.text
        )
          throw Error('summary_source_changed');
      }
      for (const message of page) {
        if (message.seq > end) break;
        const hash = expected.get(message.messageId);
        if (!hash) continue;
        if (blocked.has(message.seq) || fingerprint(message) !== hash)
          throw Error('summary_source_changed');
        expected.delete(message.messageId);
      }
      const next = page.at(-1)!.seq;
      if (next <= after) break;
      after = next;
    }
    if (expected.size) throw Error('summary_source_changed');
  }

  private async finishRefund(usageRecordId: string) {
    if (!this.refunds) return;
    try {
      await this.refunds.refundUsage(usageRecordId, '摘要未入库，自动退回');
      await this.db.query('DELETE FROM ai_runtime.summary_refund_jobs WHERE usage_record_id=$1', [
        usageRecordId,
      ]);
    } catch {
      await this.db.query(
        'UPDATE ai_runtime.summary_refund_jobs SET retry_after=$2 WHERE usage_record_id=$1',
        [usageRecordId, new Date(this.clock.nowMs() + 300000)],
      );
      new Logger(ChatSummaryService.name).warn({
        code: 'ai_chat_summary_refund_failed',
        usageRecordId,
      });
    }
  }
}
