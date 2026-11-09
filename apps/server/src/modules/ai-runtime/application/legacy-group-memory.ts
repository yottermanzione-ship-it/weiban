import { Inject, Injectable } from '@nestjs/common';
import type { ChatReadPort, ContactsReadPort, IdentityAccountStatusPort } from '@weiban/contracts';
import {
  AppError,
  assertLegacyMigrationOwnerAllowed,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { ReplyPlanStore } from './plan-store.js';
import { healthPrivate } from '../domain/memory.js';
import {
  LegacySharedGroupBatch,
  LegacySharedGroupPayload,
  legacyGroupDigest,
  legacyGroupSourceTime,
  legacyGroupProvenanceKnown,
  LEGACY_GROUP_CONTEXT_HEADER,
  LEGACY_GROUP_CONTEXT_MAX_BYTES,
  LEGACY_GROUP_CONTEXT_POLICY,
} from '../domain/legacy-group-memory.js';

interface SourceRow {
  source_group_id: string;
  conversation_id: string;
  activation_allowed: boolean;
  source_archived: boolean;
  generation: number;
  review_digest: string;
  target_digest: string;
  deleted_at: Date | null;
}
interface MemoryRow {
  id: string;
  source_memory_id: string;
  source_digest: string;
  ciphertext: Buffer | null;
  deleted_at: Date | null;
  encoded_bytes: number;
}
export interface LegacyGroupContext {
  text: string;
  stamp: string | null;
}

@Injectable()
export class LegacyGroupMemoryService {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(ReplyPlanStore) private readonly owner: ReplyPlanStore,
  ) {}
  async targetSnapshot(userId: string, conversationId: string, tx?: DbTx) {
    if (!this.chat.getGroupMemoryAccess)
      throw new AppError('service_unavailable', '群记忆读取端口尚未接入');
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
    const group = await this.chat.getGroupMemoryAccess(userId, conversationId, tx);
    if (
      !group ||
      group.ownerUserId !== userId ||
      !group.participants.some((p) => p.kind === 'user' && p.refId === userId)
    )
      throw new AppError('not_found', '群聊不存在');
    const reader = tx ?? this.database;
    const generation = Number(
      (
        await reader.query<{ generation: number }>(
          'SELECT generation FROM ai_runtime.group_memory_states WHERE user_id=$1 AND conversation_id=$2',
          [userId, conversationId],
        )
      ).rows[0]?.generation ?? 0,
    );
    const protectedTarget =
      group.archived ||
      group.hidden ||
      group.clearedThroughSeq > 0 ||
      group.lastSeq === 0 ||
      group.scope !== 'normal' ||
      (await this.accounts.isBanned?.(userId, tx)) === true;
    return { group, generation, protectedTarget, digest: legacyGroupDigest({ group, generation }) };
  }
  /** Internal importer only; no HTTP route. The ops adapter must establish an isolated target first. */
  async importBatch(
    userId: string,
    value: unknown,
    extraPreservedOwnerDigests: readonly string[] = [],
  ) {
    assertLegacyMigrationOwnerAllowed(userId, extraPreservedOwnerDigests);
    const input = LegacySharedGroupBatch.parse(value);
    if (
      input.sourceAccountId !== userId ||
      input.sourceGroup.user_id !== userId ||
      !input.evidence.ownerMappingVerified ||
      input.rows.some((row) => row.group_id !== input.sourceGroup.id)
    )
      throw new AppError('forbidden', '旧群记忆来源归属不一致');
    const reviewDigest = legacyGroupDigest({
      evidence: input.evidence,
      sourceGroup: input.sourceGroup,
      target: input.targetConversationId,
      cutoff: input.cutoff,
    });
    return this.database.transaction(async (tx) => {
      if (!(await this.owner.lock(tx, userId, input.targetConversationId)))
        throw new AppError('unauthenticated', '账号已失效');
      const target = await this.targetSnapshot(userId, input.targetConversationId, tx);
      if (target.digest !== input.expectedTargetDigest)
        throw new AppError('conflict', '群聊状态已变化，必须重新核对');
      const existing = (
        await tx.query<SourceRow>(
          `SELECT * FROM ai_runtime.legacy_group_memory_sources
        WHERE user_id=$1 AND (source_group_id=$2 OR conversation_id=$3) FOR UPDATE`,
          [userId, input.sourceGroup.id, input.targetConversationId],
        )
      ).rows;
      if (
        existing.some(
          (row) =>
            row.deleted_at ||
            row.source_group_id !== input.sourceGroup.id ||
            row.conversation_id !== input.targetConversationId ||
            row.review_digest !== reviewDigest ||
            row.target_digest !== target.digest,
        )
      )
        throw new AppError('conflict', '已有群记忆来源或保护状态不能被覆盖');
      const eligible =
        !target.protectedTarget &&
        input.sourceGroup.archived === 0 &&
        input.evidence.sourceComplete &&
        input.evidence.normalScopeVerified &&
        input.evidence.deletionReviewComplete &&
        input.evidence.forgetReviewComplete;
      await tx.query(
        `INSERT INTO ai_runtime.legacy_group_memory_sources
        (user_id,source_account_id,source_group_id,conversation_id,source_archived,activation_allowed,review_digest,target_digest,generation,source_batch,created_at)
        VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [
          userId,
          input.sourceGroup.id,
          input.targetConversationId,
          input.sourceGroup.archived === 1,
          eligible,
          reviewDigest,
          target.digest,
          target.generation,
          input.batchId,
          this.clock.now(),
        ],
      );
      const outcome = { inserted: 0, existing: 0, active: 0, blocked: 0 };
      for (const source of input.rows) {
        const sourceDigest = legacyGroupDigest(source),
          created = legacyGroupSourceTime(source.created_at);
        if (created.getTime() > Date.parse(input.cutoff))
          throw new AppError('bad_request', '旧群记忆超过本批截止点');
        const old = (
          await tx.query<MemoryRow>(
            `SELECT * FROM ai_runtime.legacy_group_memories
          WHERE user_id=$1 AND source_group_id=$2 AND source_memory_id=$3 FOR UPDATE`,
            [userId, source.group_id, source.id],
          )
        ).rows[0];
        if (old) {
          if (old.source_digest !== sourceDigest)
            throw new AppError('conflict', '已迁来源发生变化，不能覆盖');
          outcome.existing++;
          continue;
        }
        const reason = !eligible
          ? 'target_or_evidence_protected'
          : source.enabled !== 1
            ? 'source_disabled'
            : healthPrivate(source.content)
              ? 'private_health'
              : !legacyGroupProvenanceKnown(source.provenance_json)
                ? 'unknown_provenance'
                : null;
        const id = newId(),
          cipher = await this.crypto.seal(
            userId,
            `ai:legacy-group-memory:${id}`,
            JSON.stringify(LegacySharedGroupPayload.parse({ version: 1, source })),
            tx,
          );
        await tx.query(
          `INSERT INTO ai_runtime.legacy_group_memories
          (id,user_id,source_group_id,source_memory_id,source_digest,conversation_id,source_enabled,activation_allowed,blocked_reason,ciphertext,source_created_at,imported_at,encoded_bytes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id,
            userId,
            source.group_id,
            source.id,
            sourceDigest,
            input.targetConversationId,
            source.enabled === 1,
            reason === null,
            reason,
            cipher,
            created,
            this.clock.now(),
            Buffer.byteLength(JSON.stringify(source.content), 'utf8'),
          ],
        );
        outcome.inserted++;
        if (reason) outcome.blocked++;
        else outcome.active++;
      }
      return outcome;
    });
  }
  private async snapshot(userId: string, conversationId: string, characterId: string, tx?: DbTx) {
    const reader = tx ?? this.database;
    const source = (
      await reader.query<SourceRow>(
        `SELECT * FROM ai_runtime.legacy_group_memory_sources
      WHERE user_id=$1 AND conversation_id=$2`,
        [userId, conversationId],
      )
    ).rows[0];
    if (!source || source.deleted_at || !source.activation_allowed || source.source_archived)
      return null;
    let target: Awaited<ReturnType<LegacyGroupMemoryService['targetSnapshot']>>;
    try {
      target = await this.targetSnapshot(userId, conversationId, tx);
    } catch (error) {
      if (error instanceof AppError && ['not_found', 'unauthenticated'].includes(error.code))
        return null;
      throw error;
    }
    const member = target.group.participants.find(
      (p) => p.kind === 'character' && p.refId === characterId,
    );
    if (target.protectedTarget || !member) return null;
    const epoch = await this.contacts.getActiveContactEpoch(userId, characterId, tx);
    // A reset/re-added contact is fenced immediately, before asynchronous contact cleanup runs.
    if (!epoch || Date.parse(epoch.acceptAfter) > Date.parse(member.joinedAt)) return null;
    const blocked = await reader.query(
      `SELECT 1 FROM ai_runtime.legacy_group_memory_exclusions WHERE user_id=$1 AND character_id=$2
      UNION ALL SELECT 1 FROM ai_runtime.memory_states WHERE user_id=$1 AND character_id=$2 AND barrier_seq>0 LIMIT 1`,
      [userId, characterId],
    );
    if (blocked.rows.length) return null;
    // generation fences prepared requests; explicit forget/reset tombstones fence the affected character.
    // A normal extraction retry may also advance generation and must not delete shared group history.
    const candidates = (
      await reader.query<MemoryRow>(
        `SELECT id,source_memory_id,source_digest,ciphertext,deleted_at,encoded_bytes FROM ai_runtime.legacy_group_memories
      WHERE user_id=$1 AND conversation_id=$2 AND source_enabled AND activation_allowed AND deleted_at IS NULL
      ORDER BY source_created_at DESC,source_memory_id DESC LIMIT 30`,
        [userId, conversationId],
      )
    ).rows;
    let bytes = Buffer.byteLength(LEGACY_GROUP_CONTEXT_HEADER, 'utf8') + 2;
    const rows = candidates.filter((row) => {
      const cost = row.encoded_bytes + 1; // Includes a comma even for the first row, conservatively.
      if (!Number.isSafeInteger(cost) || cost < 3 || bytes + cost > LEGACY_GROUP_CONTEXT_MAX_BYTES)
        return false;
      bytes += cost;
      return true;
    });
    if (!rows.length) return null;
    const stamp = legacyGroupDigest({
      owner: userId,
      conversationId,
      characterId,
      epoch: epoch.version,
      generation: target.generation,
      members: target.group.participants,
      review: source.review_digest,
      policy: LEGACY_GROUP_CONTEXT_POLICY,
      maxBytes: LEGACY_GROUP_CONTEXT_MAX_BYTES,
      rows: rows.map((row) => [row.id, row.source_digest]),
    });
    return { rows, stamp };
  }
  /** Pure reads, no new transaction. Existing write transactions are passed through all ports. */
  async context(
    userId: string,
    conversationId: string,
    characterId: string,
    purpose: string,
  ): Promise<LegacyGroupContext> {
    if (purpose !== 'chat_reply') return { text: '', stamp: null };
    const snapshot = await this.snapshot(userId, conversationId, characterId);
    if (!snapshot) return { text: '', stamp: null };
    const lines: string[] = [];
    for (const row of snapshot.rows) {
      if (!row.ciphertext) throw new Error('legacy_group_memory_payload_missing');
      const plain = await this.crypto.open(
        userId,
        `ai:legacy-group-memory:${row.id}`,
        row.ciphertext,
      );
      try {
        const payload = LegacySharedGroupPayload.parse(JSON.parse(plain.toString('utf8')));
        if (
          legacyGroupDigest(payload.source) !== row.source_digest ||
          healthPrivate(payload.source.content) ||
          Buffer.byteLength(JSON.stringify(payload.source.content), 'utf8') !== row.encoded_bytes
        )
          throw new Error('legacy_group_memory_payload_invalid');
        lines.push(payload.source.content);
      } finally {
        plain.fill(0);
      }
    }
    if (!(await this.isCurrent(userId, conversationId, characterId, snapshot.stamp)))
      return { text: '', stamp: null };
    const text = LEGACY_GROUP_CONTEXT_HEADER + JSON.stringify(lines);
    if (Buffer.byteLength(text, 'utf8') > LEGACY_GROUP_CONTEXT_MAX_BYTES)
      throw new Error('legacy_group_memory_budget_exceeded');
    return { text, stamp: snapshot.stamp };
  }
  async isCurrent(
    userId: string,
    conversationId: string,
    characterId: string,
    stamp: string,
    tx?: DbTx,
  ): Promise<boolean> {
    if (tx) {
      // Owner advisory -> contact row -> conversation row, then metadata; no second connection.
      // Holding the chat row closes the clear/hide/dissolve race until the same-tx post commits.
      if (!(await this.contacts.getActiveContactEpoch(userId, characterId, tx))) return false;
      if (!this.chat.getGroupMemoryAccess) return false;
      try {
        await this.chat.getGroupMemoryAccess(userId, conversationId, tx, true);
      } catch (error) {
        if (
          error instanceof AppError &&
          ['not_found', 'not_conversation_member', 'unauthenticated'].includes(error.code)
        )
          return false;
        throw error;
      }
    }
    return (await this.snapshot(userId, conversationId, characterId, tx))?.stamp === stamp;
  }
  async excludeCharacter(tx: DbTx, userId: string, characterId: string): Promise<void> {
    // Delayed lifecycle events must not recreate personal metadata after account erasure.
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active') return;
    await tx.query(
      `INSERT INTO ai_runtime.legacy_group_memory_exclusions(user_id,character_id,blocked_at)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, characterId, this.clock.now()],
    );
  }
  async onDissolved(tx: DbTx, userId: string, conversationId: string): Promise<void> {
    await tx.query(
      'UPDATE ai_runtime.legacy_group_memory_sources SET deleted_at=$3,activation_allowed=false WHERE user_id=$1 AND conversation_id=$2',
      [userId, conversationId, this.clock.now()],
    );
    await tx.query(
      'UPDATE ai_runtime.legacy_group_memories SET deleted_at=$3,ciphertext=NULL,activation_allowed=false WHERE user_id=$1 AND conversation_id=$2',
      [userId, conversationId, this.clock.now()],
    );
  }
}
