import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, lte, ne } from 'drizzle-orm';
import {
  type ChatReadPort,
  type Message,
  type ModelGatewayPort,
  type PolicyPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type JobQueue,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { privateDigests } from '../infra/db/schema.js';
import { healthPrivate } from '../domain/memory.js';
import { outputAllowed } from '../domain/reply-rules.js';
import {
  DIGEST_GIVE_UP_DAYS,
  DIGEST_MAX_ATTEMPTS,
  DIGEST_MAX_MESSAGES,
  DIGEST_MAX_SOURCE_CHARS,
  DIGEST_SYSTEM,
  DIGEST_WAIT_BALANCE_MS,
  PRIVATE_DIGEST_TEMPLATE,
  digestBackoffMs,
  digestIsClean,
  digestMemoryText,
  digestPermanentError,
  digestWaitError,
  parseDigest,
} from '../domain/private-digest.js';
import { readableMessageText } from './content-text.js';
import { MemoryService } from './memory.js';

export const PRIVATE_DIGEST_JOB = 'ai.private_digest';
type Row = typeof privateDigests.$inferSelect;

/**
 * H2（契约 3.28，总经理 10-21 C14 / 20 号 §2.4）：切出私密模式时的「干净整理」。
 *
 * - 切出（切到自动 / 日常 / 任何非私密模式，包括资格收紧、私密模型不可用导致的自动切回）时，
 *   在切换的同一事务里登记一行任务（event_key = 这次切换的幂等键，同一次切换只登记一次），任务之后异步执行，
 *   不阻塞切换。
 * - 执行：读这次私密期间（上一次切出之后到这次切出）的私密消息，交给该用户的私密模型（modelRole = adult，
 *   按用户积分计费）生成不含露骨描写的摘要，检查干净后写成一条日常范围记忆（MemoryService.addPrivateDigest）。
 * - 失败可重试：普通失败按 5 分钟 → 30 分钟 → 2 / 6 / 12 小时重试，最多 6 次；余额不足等不计次数，
 *   14 天后放弃；角色已没有私密资格 / 模型被禁止时跳过（不再把私密内容交给任何模型）。
 * - 原私密记忆、原文仍只在私密模式可见，这里不改它们。
 */
@Injectable()
export class PrivateDigestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  /**
   * 在模式切换的事务里调用：登记这次切出。eventKey 相同的重复调用不会再登记（幂等）。
   * toSeq 取切换时会话的最后序号（切换系统提示之前），整理的就是它之前、上一次切出之后的私密消息。
   */
  async enqueue(
    tx: DbTx,
    input: { userId: string; characterId: string; conversationId: string; eventKey: string },
  ): Promise<void> {
    const conversation = await this.chat.getConversation(input.conversationId, tx);
    if (!conversation) return;
    const id = newId();
    const now = this.clock.now();
    const inserted = await tx.db
      .insert(privateDigests)
      .values({
        id,
        userId: input.userId,
        characterId: input.characterId,
        conversationId: input.conversationId,
        eventKey: input.eventKey.slice(0, 200),
        toSeq: conversation.lastSeq,
        status: 'pending',
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: privateDigests.id });
    if (inserted.length)
      await this.jobs.send(
        PRIVATE_DIGEST_JOB,
        { digestId: id },
        { tx, singletonKey: `digest:${id}`, retryLimit: 0 },
      );
  }

  /** 每分钟对账：把到点该重试的任务重新投递。 */
  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select({ id: privateDigests.id })
      .from(privateDigests)
      .where(
        and(
          inArray(privateDigests.status, ['pending', 'failed']),
          lte(privateDigests.nextAttemptAt, this.clock.now()),
        ),
      )
      .limit(50);
    for (const row of rows)
      await this.jobs.send(
        PRIVATE_DIGEST_JOB,
        { digestId: row.id },
        { singletonKey: `digest:${row.id}`, retryLimit: 0 },
      );
  }

  private async load(id: string): Promise<Row | null> {
    const [row] = await this.db.db.select().from(privateDigests).where(eq(privateDigests.id, id));
    return row ?? null;
  }

  private async finish(
    row: Row,
    patch: Partial<
      Pick<Row, 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'memoryId'>
    > & {
      chargedMicros?: number;
    },
  ): Promise<void> {
    await this.db.db
      .update(privateDigests)
      .set({
        ...patch,
        ...(patch.chargedMicros !== undefined
          ? { chargedMicros: row.chargedMicros + patch.chargedMicros }
          : {}),
        ...(patch.lastError !== undefined
          ? { lastError: patch.lastError?.slice(0, 200) ?? null }
          : {}),
        updatedAt: this.clock.now(),
      })
      .where(eq(privateDigests.id, row.id));
  }

  /** 普通失败：记次数，按退避排下一次；次数用完放弃。 */
  private async fail(row: Row, error: string, charged = 0): Promise<void> {
    const attempts = row.attempts + 1;
    const giveUp =
      attempts >= DIGEST_MAX_ATTEMPTS ||
      this.clock.nowMs() - row.createdAt.getTime() > DIGEST_GIVE_UP_DAYS * 86400_000;
    await this.finish(row, {
      status: giveUp ? 'abandoned' : 'failed',
      attempts,
      nextAttemptAt: new Date(this.clock.nowMs() + digestBackoffMs(attempts)),
      lastError: error,
      chargedMicros: charged,
    });
  }

  /** 这次切出要整理的私密消息：上一次切出之后、这次切出为止（最近的若干条）。 */
  private async sources(row: Row): Promise<Message[]> {
    const [previous] = await this.db.db
      .select({ toSeq: privateDigests.toSeq })
      .from(privateDigests)
      .where(
        and(
          eq(privateDigests.conversationId, row.conversationId),
          ne(privateDigests.id, row.id),
          lt(privateDigests.toSeq, row.toSeq + 1),
          // 同一序号的重复登记（另一个切换键）只认先登记的那一行
          lt(privateDigests.createdAt, row.createdAt),
        ),
      )
      .orderBy(desc(privateDigests.toSeq))
      .limit(1);
    const fromSeq = previous?.toSeq ?? 0;
    if (fromSeq >= row.toSeq) return [];
    const messages = await this.chat.readMessages({
      conversationId: row.conversationId,
      scopes: ['adult'],
      beforeSeq: row.toSeq + 1,
      limit: DIGEST_MAX_MESSAGES,
      excludeLabels: ['health', 'quirk_draft'],
    });
    const picked: Message[] = [];
    let chars = 0;
    for (const m of [...messages].reverse()) {
      if (m.seq <= fromSeq) break;
      if (m.status !== 'normal' || m.senderKind === 'system') continue;
      if (m.content?.type === 'nudge') continue;
      const text = readableMessageText(m);
      if (!text || healthPrivate(text)) continue;
      if (picked.length && chars + text.length > DIGEST_MAX_SOURCE_CHARS) break;
      picked.unshift(m);
      chars += text.length;
    }
    return picked;
  }

  /** 任务入口：意外异常也记一次失败（按退避重试），不让对账每分钟空转。 */
  async run(digestId: string): Promise<void> {
    try {
      await this.process(digestId);
    } catch (error) {
      const row = await this.load(digestId).catch(() => null);
      if (row && ['pending', 'failed'].includes(row.status))
        await this.fail(row, error instanceof Error ? error.message : 'error').catch(() => {});
    }
  }

  private async process(digestId: string): Promise<void> {
    const row = await this.load(digestId);
    if (!row || !['pending', 'failed'].includes(row.status)) return;
    if (row.nextAttemptAt.getTime() > this.clock.nowMs()) return;
    const sources = await this.sources(row);
    if (!sources.length) {
      await this.finish(row, { status: 'skipped', lastError: 'nothing_to_digest' });
      return;
    }
    const [policy, conversation] = await Promise.all([
      this.policy.getCharacterPolicy(row.userId, row.characterId),
      this.chat.getConversation(row.conversationId),
    ]);
    if (!policy || !conversation) {
      await this.finish(row, { status: 'skipped', lastError: 'context_unavailable' });
      return;
    }
    // 角色已没有私密资格：私密内容不再交给任何模型（含私密模型），跳过。
    if (!policy.adultModeEligible) {
      await this.finish(row, { status: 'skipped', lastError: 'adult_mode_not_eligible' });
      return;
    }
    const result = await this.gateway.generateText({
      userId: row.userId,
      characterId: row.characterId,
      conversationId: row.conversationId,
      purpose: 'memory',
      billingOwner: 'user',
      // 只交给该用户的私密模式模型（20 号 §2.4 第 3 条：含私密内容只能给私密模型）。
      modelRole: 'adult',
      countAsBackground: true,
      responseFormat: 'json',
      maxOutputTokens: 600,
      idempotencyKey: `private-digest:${row.id}:${row.attempts}`,
      meta: {
        scenarioMode: 'adult',
        conversationKind: 'direct',
        promptTemplateVersion: PRIVATE_DIGEST_TEMPLATE,
      },
      messages: [
        { role: 'system', content: DIGEST_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            messages: sources.map((m) => ({
              sender: m.senderKind === 'user' ? '用户' : '角色',
              text: readableMessageText(m).slice(0, 2000),
            })),
          }),
        },
      ],
    });
    if (!result.ok) {
      if (digestPermanentError(result.error)) {
        await this.finish(row, { status: 'skipped', lastError: `model_${result.error}` });
        return;
      }
      if (digestWaitError(result.error)) {
        const giveUp =
          this.clock.nowMs() - row.createdAt.getTime() > DIGEST_GIVE_UP_DAYS * 86400_000;
        await this.finish(row, {
          status: giveUp ? 'abandoned' : 'failed',
          nextAttemptAt: new Date(this.clock.nowMs() + DIGEST_WAIT_BALANCE_MS),
          lastError: `model_${result.error}`,
        });
        return;
      }
      await this.fail(row, `model_${result.error}`);
      return;
    }
    const charged = result.value.chargedMicros;
    const summary = parseDigest(result.value.text);
    if (summary === null) {
      await this.fail(row, 'bad_output', charged);
      return;
    }
    if (!summary) {
      // 模型认为没什么可记：算完成，不写记忆。
      await this.finish(row, {
        status: 'done',
        lastError: 'empty_summary',
        chargedMicros: charged,
      });
      return;
    }
    if (
      !digestIsClean(summary) ||
      healthPrivate(summary) ||
      !outputAllowed(summary, { ...policy, romanceAllowed: true }, false)
    ) {
      await this.fail(row, 'not_clean', charged);
      return;
    }
    const demote = await this.db.db
      .select({ memoryId: privateDigests.memoryId })
      .from(privateDigests)
      .where(
        and(
          eq(privateDigests.conversationId, row.conversationId),
          eq(privateDigests.status, 'done'),
          ne(privateDigests.id, row.id),
        ),
      );
    const memoryId = await this.memory.addPrivateDigest({
      userId: row.userId,
      characterId: row.characterId,
      conversationId: row.conversationId,
      clientId: row.id,
      content: digestMemoryText(summary),
      demoteIds: demote.flatMap((d) => (d.memoryId ? [d.memoryId] : [])),
    });
    if (!memoryId) {
      // 好友已删除 / 会话已变化：记忆写不进去，不再重试。
      await this.finish(row, {
        status: 'skipped',
        lastError: 'contact_changed',
        chargedMicros: charged,
      });
      return;
    }
    await this.finish(row, { status: 'done', memoryId, lastError: null, chargedMicros: charged });
  }
}
