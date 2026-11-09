/** Internal chat-history adapter. Sources are registered readers, never connection strings or CLI input. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  fingerprint,
  assertMissingMediaReview,
  invariant,
  planConversationDelta,
  prepareLegacyChatRows,
  translateBoundary,
  utc,
} from './legacy-delta-core.mjs';
import {
  applyExecutionConversationDelta,
  readConversationExecutionBaseline,
} from './legacy-delta-db.mjs';
import {
  assertExecutionTransaction,
  executionPolicyDigest,
  MigrationExecutionError,
} from './migration-execution-ledger.mjs';
import { assertMigrationOwnersAllowed } from './legacy-migration-owner-guards.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';

const HEX = /^[a-f0-9]{64}$/u;
const DOMAIN = 'chat-history';
const unique = (values) => [...new Set(values)].sort();
const digestFile = (name) =>
  createHash('sha256')
    .update(readFileSync(new URL(name, import.meta.url)))
    .digest('hex');
const implementation = Object.fromEntries(
  [
    './chat-execution-handler.mjs',
    './legacy-delta-db.mjs',
    './legacy-delta-core.mjs',
    './legacy-content-rules.mjs',
  ].map((name) => [name, digestFile(name)]),
);
// A JSON-safe baseline contains hashes of existing ciphertext, never decrypted old history.
function normalized(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { sha256: createHash('sha256').update(value).digest('hex') };
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  return value;
}
const messageColumns = [
  'id',
  'conversation_id',
  'seq',
  'sender_participant_id',
  'sender_kind',
  'client_msg_id',
  'content_ciphertext',
  'quote_message_id',
  'status',
  'scope',
  'labels',
  'content_type',
  'action_id',
  'action_chosen_at',
  'created_at',
  'recalled_at',
  'charged_micros',
  'usage_record_id',
].sort();
const scopeOf = (payload) =>
  fingerprint({
    version: payload.version,
    sourceKey: payload.sourceKey,
    reviewDigest: payload.reviewDigest,
    conversationId: payload.plan.conversationId,
    ownerUserId: payload.plan.ownerUserId,
    baseline: payload.plan.baseline,
    cursorFloor: payload.cursorFloor,
  });

function projectAfter(payload) {
  const { plan } = payload,
    result = structuredClone(payload.baseline);
  const byId = new Map(plan.remap.map((row) => [row.id, row.newSeq]));
  const bySeq = new Map(plan.remap.map((row) => [row.oldSeq, row.newSeq]));
  const boundary = (value) =>
    value === null ? null : String(translateBoundary(value, payload.baseline.messages, byId));
  for (const row of result.messages) row.seq = String(byId.get(row.id));
  for (const row of plan.newMessages)
    result.messages.push({
      id: row.id,
      conversation_id: row.conversation_id,
      seq: String(row.seq),
      sender_participant_id: row.sender_participant_id,
      sender_kind: row.sender_kind,
      client_msg_id: row.client_msg_id,
      content_ciphertext: { sourceContentDigest: fingerprint(row.content) },
      quote_message_id: row.quote_message_id,
      status: 'normal',
      scope: row.scope,
      labels: null,
      content_type: row.content.type,
      action_id: null,
      action_chosen_at: null,
      created_at: utc(row.created_at),
      recalled_at: null,
      charged_micros: null,
      usage_record_id: null,
    });
  result.messages.sort((a, b) => Number(a.seq) - Number(b.seq));
  result.conversation.last_seq = String(plan.lastSeq);
  result.states = normalized(plan.states).map((row) => ({
    ...row,
    read_seq: String(row.read_seq),
    cleared_through_seq: String(row.cleared_through_seq),
  }));
  result.participants = normalized(plan.participants).map((row) => ({
    ...row,
    read_seq: String(row.read_seq),
  }));
  for (const ref of result.references)
    for (const row of ref.rows) {
      for (const column of ref.columns) {
        if (ref.table === 'library.favorites') {
          invariant(byId.has(row.source_id), 'MISSING_REFERENCED_MESSAGE_REQUIRES_REVIEW');
          // source_seq in library.favorites is integer; the other references are bigint.
          row[column] = byId.get(row.source_id);
        } else if (ref.table === 'ai_runtime.model_blocked_messages') {
          const next = row.message_id ? byId.get(row.message_id) : bySeq.get(Number(row.seq));
          invariant(next !== undefined, 'MISSING_BLOCKED_MESSAGE_REQUIRES_REVIEW');
          row[column] = String(next);
        } else row[column] = boundary(row[column]);
      }
      if (ref.table === 'channels.bindings') row.generation++;
    }
  return result;
}

/**
 * sourceReader = {mode,digest,read({sourceKey,tx})}. It must verify/read a fixed source checkpoint,
 * exact relation/media mapping and deletion review artifact. It is trusted code, not a Boolean
 * attestation. No production reader is provided here. The fixture reader reads real local PG rows.
 */
export function createChatExecutionHandler({
  mode = 'plan',
  sourceReader,
  crypto,
  validateContent,
  options = {},
  fault,
} = {}) {
  invariant(['plan', 'rehearsal', 'production'].includes(mode), 'CHAT_EXECUTION_MODE_INVALID');
  invariant(
    sourceReader?.mode === mode &&
      HEX.test(sourceReader?.digest) &&
      typeof sourceReader?.read === 'function',
    'CHAT_SOURCE_READER_REQUIRED',
  );
  invariant(
    typeof validateContent === 'function' &&
      typeof crypto?.sealMany === 'function' &&
      typeof crypto?.openMany === 'function',
    'CHAT_CONTRACT_CRYPTO_REQUIRED',
  );
  invariant(!fault || mode === 'rehearsal', 'CHAT_PRODUCTION_FAULT_HOOK_REFUSED');
  const policyDigest = executionPolicyDigest(options);
  const digest = fingerprint({
    domain: DOMAIN,
    version: 1,
    mode,
    implementation,
    reader: sourceReader.digest,
    policyDigest,
  });

  async function source(tx, sourceKey) {
    invariant(HEX.test(sourceKey), 'CHAT_SOURCE_KEY_INVALID');
    const data = await sourceReader.read({ sourceKey, tx });
    invariant(
      data &&
        HEX.test(data.snapshotDigest) &&
        ['chat_history', 'group_messages'].includes(data.table),
      'CHAT_SOURCE_CHECKPOINT_REQUIRED',
    );
    invariant(
      Array.isArray(data.rows) &&
        data.rows.length > 0 &&
        data.rows.length <= 100_000 &&
        Array.isArray(data.bindings),
      'CHAT_SOURCE_ROWS_REQUIRED',
    );
    invariant(
      data.review?.inventory?.complete === true &&
        HEX.test(data.review.inventory.digest) &&
        data.review.inventory.sourceDigest === data.snapshotDigest,
      'CHAT_DELETION_REVIEW_REQUIRED',
    );
    const bindings = new Map(data.bindings.map((row) => [row.sourceId, row]));
    invariant(
      bindings.size === data.bindings.length && bindings.size === data.rows.length,
      'CHAT_SOURCE_BINDING_SET_MISMATCH',
    );
    const sourceOwnerIds = [],
      targetOwnerIds = [],
      rows = [],
      ownersBySource = new Map();
    for (const raw of data.rows) {
      invariant(
        raw.content == null || typeof raw.content === 'string',
        'CHAT_SOURCE_CONTENT_SHAPE_INVALID',
      );
      const binding = bindings.get(String(raw.id));
      invariant(binding?.conversationId && binding.ownerUserId, 'CHAT_SOURCE_BINDING_MISSING');
      let owner;
      if (data.table === 'chat_history') {
        invariant(
          typeof raw.user_id === 'string' && raw.user_id.trim(),
          'CHAT_SOURCE_OWNER_MISSING',
        );
        owner = raw.user_id;
      } else {
        invariant(
          data.group?.id === raw.group_id &&
            typeof data.group?.user_id === 'string' &&
            data.group.user_id.trim(),
          'CHAT_GROUP_OWNER_PROOF_REQUIRED',
        );
        owner = data.group.user_id;
        invariant(
          raw.user_id == null || raw.user_id === '' || raw.user_id === owner,
          'CHAT_GROUP_OWNER_CONFLICT',
        );
      }
      assertMigrationOwnersAllowed([owner], options);
      for (const field of ['legacyOwnerUserId', 'sourceOwnerUserId'])
        invariant(
          binding[field] == null || binding[field] === owner,
          'CHAT_SOURCE_MAPPING_OWNER_CONFLICT',
        );
      // Original identity is retained; arbitrary account remapping is outside this adapter.
      invariant(binding.ownerUserId === owner, 'CHAT_SOURCE_TARGET_IDENTITY_CONFLICT');
      sourceOwnerIds.push(owner);
      targetOwnerIds.push(binding.ownerUserId);
      ownersBySource.set(String(raw.id), owner);
      // Keep the original source bytes/fields for review digests; group ownership is separate proof.
      rows.push({ ...raw });
      bindings.set(String(raw.id), { ...binding, legacyOwnerUserId: owner });
    }
    assertMigrationOwnersAllowed([...sourceOwnerIds, ...targetOwnerIds], options);
    invariant(
      unique(data.bindings.map((row) => row.conversationId)).length === 1,
      'CHAT_SINGLE_CONVERSATION_REQUIRED',
    );
    invariant(unique(sourceOwnerIds).length === 1, 'CHAT_SINGLE_OWNER_REQUIRED');
    const missingMediaReviews = data.review.missingMediaReviews ?? [];
    invariant(Array.isArray(missingMediaReviews), 'MISSING_MEDIA_REVIEW_LIST_REQUIRED');
    if (missingMediaReviews.length) {
      invariant(
        typeof sourceReader.readMediaReview === 'function',
        'CHAT_MISSING_MEDIA_PROOF_READER_REQUIRED',
      );
      for (const review of missingMediaReviews) {
        const raw = data.rows.find((row) => String(row.id) === review?.sourceId);
        invariant(raw, 'MISSING_MEDIA_REVIEW_SOURCE_MISMATCH');
        assertMissingMediaReview({
          review,
          table: data.table,
          row: raw,
          ownerUserId: ownersBySource.get(String(raw.id)),
          sourceDigest: data.snapshotDigest,
        });
        const proof = await sourceReader.readMediaReview({ proofDigest: review.proofDigest, tx });
        const { proofDigest, ...scope } = review;
        invariant(
          proof &&
            typeof proof === 'object' &&
            !Array.isArray(proof) &&
            HEX.test(proof.authorityDigest) &&
            HEX.test(proof.evidenceDigest) &&
            fingerprint(proof) === proofDigest &&
            fingerprint(proof) ===
              fingerprint({
                ...scope,
                kind: 'legacy-missing-media-review',
                decision: 'retain-text-unavailable',
                authorityDigest: proof.authorityDigest,
                evidenceDigest: proof.evidenceDigest,
              }),
          'CHAT_MISSING_MEDIA_PROOF_INVALID',
        );
      }
    }
    const mediaReady = new Map();
    for (const binding of bindings.values())
      if (binding.mediaId) {
        const row = (
          await tx.query(
            'SELECT id,owner_id,purpose,state,expires_at FROM media.objects WHERE id=$1 FOR SHARE',
            [binding.mediaId],
          )
        ).rows[0];
        invariant(
          row?.owner_id === binding.ownerUserId &&
            row.state === 'ready' &&
            (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
          'CHAT_MEDIA_DEPENDENCY_NOT_READY',
        );
        if (
          data.rows.find((raw) => String(raw.id) === binding.sourceId)?.message_type === 'sticker'
        ) {
          const sticker = (
            await tx.query(
              'SELECT user_id,media_id FROM media.user_stickers WHERE id=$1 FOR SHARE',
              [binding.stickerId ?? null],
            )
          ).rows[0];
          invariant(
            sticker?.user_id === binding.ownerUserId && sticker.media_id === row.id,
            'CHAT_STICKER_DEPENDENCY_NOT_READY',
          );
        }
        mediaReady.set(row.id, {
          id: row.id,
          ownerUserId: row.owner_id,
          purpose: row.purpose,
          stickerId: binding.stickerId ?? null,
        });
      }
    const prepared = prepareLegacyChatRows({
      rows,
      table: data.table,
      mapping: (row) => bindings.get(String(row.id)),
      cutoff: data.review.cutoff,
      mediaReady,
      sourceDigest: data.snapshotDigest,
      missingMediaReviews,
      validateContent,
      options,
    });
    const reviewDigest = fingerprint(data);
    const result = {
      data,
      prepared,
      reviewDigest,
      sourceOwnerIds: unique(sourceOwnerIds),
      binding: bindings.values().next().value,
    };
    await assertPriorMediaDecisions(tx, result);
    return result;
  }

  function mediaDecisionEvents(src) {
    const groups = new Map(),
      fragmentsBySource = new Map();
    for (const row of src.prepared.messages) {
      const items = fragmentsBySource.get(row.source.id) ?? [];
      items.push(row);
      fragmentsBySource.set(row.source.id, items);
    }
    for (const raw of src.data.rows)
      if (['voice', 'image', 'sticker'].includes(raw.message_type)) {
        const fragments = fragmentsBySource.get(String(raw.id)) ?? [];
        if (!fragments.length) continue;
        groups.set(String(raw.id), {
          key: fingerprint({
            kind: 'legacy-chat-media-decision-v1',
            table: src.data.table,
            sourceId: String(raw.id),
          }),
          digest: fingerprint({ sourceRowDigest: fingerprint(raw), fragments }),
        });
      }
    return groups;
  }

  /** A later ready attachment is a different source decision, never an automatic extra fragment. */
  async function assertPriorMediaDecisions(tx, src) {
    const decisions = [...mediaDecisionEvents(src).values()];
    if (!decisions.length) return;
    const identity = (
      await tx.query(`SELECT installation_id::text AS "installationId",current_database() AS database,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS "databaseOid"
      FROM platform.legacy_migration_target_identity WHERE singleton=true`)
    ).rows[0];
    invariant(identity, 'TARGET_INSTALLATION_IDENTITY_MISSING');
    const prior = (
      await tx.query(
        'SELECT event_key,event_digest FROM platform.legacy_migration_events WHERE target_digest=$1 AND domain=$2 AND event_key=ANY($3::text[])',
        [fingerprint(identity), DOMAIN, decisions.map((item) => item.key)],
      )
    ).rows;
    invariant(
      prior.every((item) =>
        decisions.some(
          (expected) => expected.key === item.event_key && expected.digest === item.event_digest,
        ),
      ),
      'CHAT_MEDIA_REPAIR_REVIEW_REQUIRED',
    );
  }

  async function target(tx, plan) {
    const baseline = await readConversationExecutionBaseline(tx, plan, options);
    const owners = unique([
      baseline.conversation.owner_user_id,
      ...baseline.states.map((row) => row.user_id),
      ...baseline.participants.filter((row) => row.kind === 'user').map((row) => row.ref_id),
      ...baseline.hidden.map((row) => row.user_id),
      ...baseline.references.flatMap((ref) =>
        ref.rows.filter((row) => row.user_id != null).map((row) => row.user_id),
      ),
    ]);
    assertMigrationOwnersAllowed(owners, options);
    invariant(
      owners.length === 1 && owners[0] === plan.ownerUserId,
      'CHAT_TARGET_OWNER_SCOPE_CONFLICT',
    );
    const columns = (
      await tx.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='chat' AND table_name='messages' ORDER BY column_name",
      )
    ).rows.map((row) => row.column_name);
    invariant(
      fingerprint(columns) === fingerprint(messageColumns),
      'CHAT_MESSAGE_SCHEMA_REQUIRES_REVIEW',
    );
    return { baseline, targetOwnerIds: owners };
  }

  function derive(src, baseline) {
    invariant(
      (src.data.table === 'group_messages') === (baseline.conversation.type === 'group'),
      'CHAT_RELATION_TYPE_MISMATCH',
    );
    for (const row of src.prepared.messages) {
      invariant(row.scope === baseline.conversation.content_scope, 'CHAT_CONTENT_SCOPE_CONFLICT');
      const user = baseline.participants.find((p) => p.id === src.binding.userParticipantId);
      invariant(
        user?.kind === 'user' && user.ref_id === baseline.conversation.owner_user_id,
        'CHAT_USER_PARTICIPANT_CONFLICT',
      );
    }
    return planConversationDelta({
      target: baseline,
      incoming: src.prepared.messages,
      initialCutoff: src.data.review.initialCutoff,
      cutoff: src.data.review.cutoff,
      reviewedGaps: src.data.review.reviewedGaps ?? [],
      deletedSource: src.data.review.deletedSource ?? [],
      protection: { ...src.data.review.protection, inventoryComplete: true },
      newConversationReadCursor: src.data.review.newConversationReadCursor,
      options,
    });
  }

  async function checked(tx, payload) {
    invariant(
      payload?.version === 1 &&
        HEX.test(payload.reviewDigest) &&
        Number.isSafeInteger(payload.cursorFloor) &&
        payload.cursorFloor > 0,
      'CHAT_PAYLOAD_INVALID',
    );
    const src = await source(tx, payload.sourceKey);
    invariant(src.reviewDigest === payload.reviewDigest, 'CHAT_SOURCE_REVIEW_CHANGED');
    invariant(
      fingerprint(payload.baseline) === payload.plan.baseline,
      'CHAT_BASELINE_PAYLOAD_CHANGED',
    );
    const rebuilt = derive(src, payload.baseline);
    invariant(
      rebuilt.digest === payload.plan.digest && fingerprint(rebuilt) === fingerprint(payload.plan),
      'CHAT_PLAN_NOT_DERIVED_FROM_SOURCE',
    );
    invariant(
      rebuilt.changed && rebuilt.conflicts.length === 0,
      'CHAT_REVIEW_CONFLICT_OR_EMPTY_UNIT',
    );
    const actual = await target(tx, payload.plan);
    return { ...src, ...actual };
  }

  function events(src, plan) {
    const byId = new Map(src.data.rows.map((row) => [String(row.id), row]));
    const mediaDecisions = mediaDecisionEvents(src);
    const fragments = plan.newMessages.map((row) => ({
      key: fingerprint({
        domain: DOMAIN,
        table: row.source.table,
        sourceId: row.source.id,
        part: row.source.part,
      }),
      digest: fingerprint({ row: byId.get(row.source.id), fragment: { ...row, seq: undefined } }),
    }));
    const decisions = unique(plan.newMessages.map((row) => row.source.id)).flatMap((id) =>
      mediaDecisions.has(id) ? [mediaDecisions.get(id)] : [],
    );
    return [...fragments, ...decisions].sort((a, b) => a.key.localeCompare(b.key));
  }

  async function observation(tx, payload, requireAfter = false) {
    const checkedState = await checked(tx, payload);
    const { baseline, data, sourceOwnerIds, targetOwnerIds } = checkedState;
    const actual = normalized(baseline),
      imported = new Set(payload.plan.newMessages.map((row) => row.id));
    const present = baseline.messages.filter((row) => imported.has(row.id));
    const plaintexts = await crypto.openMany(
      payload.plan.ownerUserId,
      present.map((row) => ({ aad: `chat:message:${row.id}`, sealed: row.content_ciphertext })),
      tx,
    );
    try {
      for (let index = 0; index < present.length; index++) {
        const content = JSON.parse(plaintexts[index].toString('utf8'));
        validateContent(content);
        actual.messages.find((row) => row.id === present[index].id).content_ciphertext = {
          sourceContentDigest: fingerprint(content),
        };
      }
    } finally {
      plaintexts.forEach((plain) => plain.fill(0));
    }
    const after = present.length === imported.size;
    invariant(!requireAfter || after, 'CHAT_IMPORTED_MESSAGE_MISSING');
    if (after) {
      const cursor = (
        await tx.query(
          'SELECT last_update_seq,trimmed_through FROM realtime.user_update_cursors WHERE user_id=$1',
          [payload.plan.ownerUserId],
        )
      ).rows[0];
      invariant(
        cursor &&
          BigInt(cursor.last_update_seq) >= BigInt(payload.cursorFloor) &&
          cursor.last_update_seq === cursor.trimmed_through,
        'CHAT_SYNC_INVALIDATION_MISSING',
      );
    }
    return {
      stateDigest: fingerprint({
        baseline: actual,
        cursorFloor: after ? payload.cursorFloor : null,
      }),
      planDigest: payload.plan.digest,
      scopeDigest: scopeOf(payload),
      sourceDigest: data.snapshotDigest,
      events: events(checkedState, payload.plan),
      sourceOwnerIds,
      targetOwnerIds,
    };
  }

  // Never expose crypto/SQL errors containing raw owners, content, or paths.
  const safe =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof MigrationExecutionError) throw error;
        if (/^[A-Z][A-Z0-9_]{1,99}$/u.test(error?.message ?? ''))
          throw new MigrationExecutionError(error.message);
        throw new MigrationExecutionError('CHAT_EXECUTION_ADAPTER_FAILED');
      }
    };
  return Object.freeze({
    mode,
    domain: DOMAIN,
    digest,
    metrics: ['inserted'],
    prepare: safe(async (tx, { sourceKey, dependsOn = [] }) => {
      const src = await source(tx, sourceKey);
      const actual = await target(tx, {
        conversationId: src.binding.conversationId,
        ownerUserId: src.binding.ownerUserId,
      });
      const baseline = normalized(actual.baseline),
        plan = derive(src, baseline);
      invariant(plan.conflicts.length === 0, 'CHAT_REVIEW_HAS_CONFLICTS');
      if (!plan.changed) return { status: 'unchanged', unit: null, payload: null };
      const cursor = (
        await tx.query(
          'SELECT last_update_seq FROM realtime.user_update_cursors WHERE user_id=$1',
          [plan.ownerUserId],
        )
      ).rows[0];
      const cursorFloor = Number(cursor?.last_update_seq ?? 0) + 1;
      invariant(Number.isSafeInteger(cursorFloor), 'CHAT_CURSOR_RANGE_REQUIRES_REVIEW');
      const payload = {
        version: 1,
        sourceKey,
        reviewDigest: src.reviewDigest,
        baseline,
        plan,
        cursorFloor,
      };
      const unit = {
        key: fingerprint({
          domain: DOMAIN,
          conversationId: plan.conversationId,
          plan: plan.digest,
        }),
        domain: DOMAIN,
        handlerDigest: digest,
        planDigest: plan.digest,
        scopeDigest: scopeOf(payload),
        beforeDigest: fingerprint({ baseline, cursorFloor: null }),
        afterDigest: fingerprint({ baseline: projectAfter(payload), cursorFloor }),
        sourceOwnerDigests: src.sourceOwnerIds.map(legacyMigrationOwnerDigest).sort(),
        targetOwnerDigests: actual.targetOwnerIds.map(legacyMigrationOwnerDigest).sort(),
        events: events(src, plan),
        dependsOn,
      };
      return { status: 'planned', unit, payload, sourceDigest: src.data.snapshotDigest };
    }),
    inspect: safe((tx, payload) => observation(tx, payload)),
    inspectAfter: safe((tx, payload) => observation(tx, payload, true)),
    apply: safe(async (tx, payload) => {
      const scope = {
        mode,
        domain: DOMAIN,
        planDigest: payload.plan.digest,
        scopeDigest: scopeOf(payload),
        handlerDigest: digest,
        policyDigest,
      };
      assertExecutionTransaction(tx, scope);
      const current = await checked(tx, payload);
      assertExecutionTransaction(tx, { ...scope, sourceDigest: current.data.snapshotDigest });
      const result = await applyExecutionConversationDelta(
        tx,
        { plan: payload.plan, crypto, validateContent, options, fault },
        scope,
      );
      invariant(result.status === 'applied', 'CHAT_EXECUTION_UNEXPECTED_NOOP');
      return { inserted: result.inserted };
    }),
  });
}
