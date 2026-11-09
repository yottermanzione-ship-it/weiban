/** Narrow, reviewed ROLE-SPECIFIC candidate only. This cannot import the real shared group source.
 * Shared rows must use the dedicated group-scoped compatibility importer, never fan out to private memories.
 * No model calls or production adapter. */
import { fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import {
  assertMigrationOwnersAllowed,
  assertMigrationConversationOwners,
} from './legacy-migration-owner-guards.mjs';

export async function initializeGroupMemoryFixture(database, target) {
  await assertFixtureDatabase(database, target);
  await database.query(`CREATE TABLE IF NOT EXISTS public.codex_group_memory_receipts(
    source_key text PRIMARY KEY, source_digest text NOT NULL, memory_id uuid NOT NULL UNIQUE,
    user_id uuid NOT NULL, character_id uuid NOT NULL, group_id uuid NOT NULL,
    plan_digest text NOT NULL)`);
}

export async function readGroupMemoryBaseline(database, binding, lock = false, options = {}) {
  assertMigrationOwnersAllowed([binding.ownerUserId], options);
  const suffix = lock ? ' FOR UPDATE' : '';
  const one = async (sql, params) => (await database.query(sql + suffix, params)).rows[0] ?? null;
  const rows = async (sql, params) => (await database.query(sql + suffix, params)).rows;
  const {
    ownerUserId: owner,
    characterId: character,
    groupConversationId: group,
    directConversationId: direct,
  } = binding;
  return {
    owner: await one('SELECT id,status FROM identity.users WHERE id=$1', [owner]),
    group: await one('SELECT * FROM chat.conversations WHERE id=$1', [group]),
    direct: await one('SELECT * FROM chat.conversations WHERE id=$1', [direct]),
    participants: await rows(
      'SELECT * FROM chat.participants WHERE conversation_id=$1 ORDER BY id',
      [group],
    ),
    states: await rows(
      'SELECT * FROM chat.user_conversation_states WHERE user_id=$1 AND conversation_id=ANY($2::uuid[]) ORDER BY conversation_id',
      [owner, [group, direct]],
    ),
    contact: await one('SELECT * FROM contacts.contacts WHERE user_id=$1 AND character_id=$2', [
      owner,
      character,
    ]),
    groupMemory: await one(
      'SELECT * FROM ai_runtime.group_memory_states WHERE user_id=$1 AND conversation_id=$2',
      [owner, group],
    ),
    memoryState: await one(
      'SELECT * FROM ai_runtime.memory_states WHERE user_id=$1 AND character_id=$2 AND conversation_id=$3',
      [owner, character, direct],
    ),
    memories: await rows(
      'SELECT * FROM ai_runtime.memories WHERE user_id=$1 AND character_id=$2 AND conversation_id=$3 ORDER BY id',
      [owner, character, direct],
    ),
    receipts: await rows(
      'SELECT * FROM public.codex_group_memory_receipts WHERE user_id=$1 AND character_id=$2 ORDER BY source_key',
      [owner, character],
    ),
  };
}

function baselineBlockers(baseline, binding) {
  const blocked = [],
    add = (condition, reason) => {
      if (!condition) blocked.push(reason);
    };
  add(
    baseline.owner?.id === binding.ownerUserId && baseline.owner.status === 'active',
    'OWNER_UNAVAILABLE',
  );
  for (const [name, type] of [
    ['group', 'group'],
    ['direct', 'direct'],
  ]) {
    const conversation = baseline[name];
    add(
      conversation?.type === type &&
        conversation.owner_user_id === binding.ownerUserId &&
        conversation.content_scope === 'normal' &&
        !conversation.archived_at,
      `${name.toUpperCase()}_UNAVAILABLE_OR_PROTECTED`,
    );
  }
  add(baseline.direct?.character_id === binding.characterId, 'DIRECT_CHARACTER_MISMATCH');
  add(
    baseline.states.length === 2 &&
      baseline.states.every((row) => !row.hidden && Number(row.cleared_through_seq) === 0),
    'HIDDEN_CLEARED_OR_MISSING_USER_STATE',
  );
  const contact = baseline.contact;
  add(
    contact?.status === 'active' &&
      contact.conversation_id === binding.directConversationId &&
      contact.acceptance_mode !== 'fresh_after_delete' &&
      !contact.deleted_at,
    'CONTACT_DELETED_RECREATED_OR_UNMAPPED',
  );
  const groupState = baseline.groupMemory,
    memoryState = baseline.memoryState;
  add(
    !groupState ||
      (Number(groupState.generation) === 0 &&
        Number(groupState.pending_count) === 0 &&
        Number(groupState.cursor_seq) === 0 &&
        !groupState.lease_id &&
        !groupState.prepared_ciphertext &&
        !groupState.result_ciphertext),
    'GROUP_MEMORY_PROGRESS_OR_FORGET_BARRIER',
  );
  add(
    !memoryState ||
      (Number(memoryState.revision) === 0 &&
        Number(memoryState.barrier_seq) === 0 &&
        Number(memoryState.pending_count) === 0 &&
        Number(memoryState.window_start_seq) === 0 &&
        !memoryState.summary_ciphertext &&
        !memoryState.window_block_ciphertext),
    'MEMORY_MODIFIED_OR_FORGOTTEN',
  );
  const imported = new Set(baseline.receipts.map((row) => row.memory_id));
  add(
    baseline.memories.every((row) => imported.has(row.id)),
    'EXISTING_NATIVE_MEMORY_REQUIRES_CONFLICT_REVIEW',
  );
  return blocked;
}

/** No classifier or audience is guessed from free-text mem_type or the current roster. */
export function planGroupMemoryDelta({
  rows,
  sourceGroup,
  binding,
  baseline,
  review,
  finalCutoff,
  validatePayload,
  healthPrivate,
  options = {},
}) {
  assertMigrationOwnersAllowed(
    [
      binding.ownerUserId,
      binding.legacyOwnerUserId,
      ...(sourceGroup?.user_id ? [sourceGroup.user_id] : []),
    ],
    options,
  );
  invariant(
    Array.isArray(rows) &&
      typeof validatePayload === 'function' &&
      typeof healthPrivate === 'function',
    'GROUP_MEMORY_VALIDATORS_REQUIRED',
  );
  const cutoff = utc(finalCutoff),
    blocked = [],
    skipped = [],
    inserts = [],
    seen = new Map();
  const common = baselineBlockers(baseline, binding);
  if (!(
    sourceGroup?.id === binding.sourceGroupId &&
    sourceGroup.user_id === binding.legacyOwnerUserId &&
    sourceGroup.user_id &&
    sourceGroup.archived === 0
  ))
    common.push('LEGACY_GROUP_OWNERSHIP_OR_STATE_UNVERIFIED');
  if (!(
    review?.synthetic === true &&
    review.ownershipVerified === true &&
    review.historicalAudienceVerified === true &&
    review.normalScopeVerified === true &&
    review.deletionAuditComplete === true &&
    review.noPriorForget === true &&
    review.missingSourceMessageIdsAccepted === true &&
    /^synthetic-[a-z0-9-]+$/u.test(review.decisionId ?? '')
  )) {
    common.push('EXPLICIT_GROUP_MEMORY_REVIEW_REQUIRED');
  }
  const receipts = new Map(baseline.receipts.map((row) => [row.source_key, row]));
  const ownerMember = baseline.participants.find(
    (row) => row.kind === 'user' && row.ref_id === binding.ownerUserId && !row.left_at,
  );
  const peerMember = baseline.participants.find(
    (row) => row.kind === 'character' && row.ref_id === binding.characterId && !row.left_at,
  );
  for (const source of rows) {
    const sourceKey = fingerprint([
      'legacy-group-memory',
      binding.ownerUserId,
      binding.characterId,
      source.group_id,
      source.id,
    ]);
    const sourceDigest = fingerprint(source),
      refuse = (reason) => blocked.push({ sourceKey, reason });
    if (
      typeof source.id !== 'string' ||
      !source.id.trim() ||
      source.group_id !== binding.sourceGroupId
    ) {
      refuse('SOURCE_ID_OR_GROUP_MISMATCH');
      continue;
    }
    if (seen.has(sourceKey)) {
      if (seen.get(sourceKey) !== sourceDigest) refuse('DUPLICATE_SOURCE_ID_CONFLICT');
      else skipped.push({ sourceKey, reason: 'duplicate_source' });
      continue;
    }
    seen.set(sourceKey, sourceDigest);
    const receipt = receipts.get(sourceKey);
    if (receipt) {
      if (receipt.source_digest !== sourceDigest) refuse('IMPORTED_SOURCE_CHANGED_REQUIRES_REVIEW');
      else
        skipped.push({
          sourceKey,
          reason: baseline.memories.some((row) => row.id === receipt.memory_id)
            ? 'already_imported_preserve_target'
            : 'removed_target_do_not_resurrect',
        });
      continue;
    }
    if (source.enabled === 0) {
      skipped.push({ sourceKey, reason: 'source_disabled' });
      continue;
    }
    if (source.enabled !== 1) {
      refuse('SOURCE_ENABLED_UNKNOWN');
      continue;
    }
    if (common.length) {
      common.forEach(refuse);
      continue;
    }
    let createdAt;
    try {
      createdAt = utc(source.created_at);
    } catch {
      refuse('SOURCE_TIME_UNKNOWN');
      continue;
    }
    if (createdAt > cutoff) {
      refuse('SOURCE_AFTER_CUTOFF');
      continue;
    }
    if (
      !ownerMember ||
      !peerMember ||
      utc(ownerMember.joined_at) > createdAt ||
      utc(peerMember.joined_at) > createdAt ||
      utc(baseline.contact.accept_after) > createdAt
    ) {
      refuse('MEMBER_OR_CONTACT_NOT_PRESENT_AT_SOURCE_TIME');
      continue;
    }
    if (source.source !== 'auto') {
      refuse('UNSUPPORTED_SOURCE_KIND');
      continue;
    }
    if (source.supersedes_id) {
      refuse('CORRECTION_CHAIN_REQUIRES_RECONCILIATION');
      continue;
    }
    if (
      source.subject_character_id &&
      source.subject_character_id !== binding.legacySubjectCharacterId
    ) {
      refuse('SUBJECT_CHARACTER_MAPPING_REQUIRED');
      continue;
    }
    let provenance;
    try {
      provenance = JSON.parse(source.provenance_json || '{}');
    } catch {
      refuse('UNKNOWN_PROVENANCE');
      continue;
    }
    if (
      !provenance ||
      Array.isArray(provenance) ||
      typeof provenance !== 'object' ||
      Object.keys(provenance).some((key) => !['scene_type', 'source'].includes(key)) ||
      (provenance.scene_type && provenance.scene_type !== 'group') ||
      (provenance.source && provenance.source !== 'auto')
    ) {
      refuse('UNSUPPORTED_PROVENANCE');
      continue;
    }
    const classification = review.classificationByType?.[source.mem_type];
    if (!classification) {
      refuse('FREE_TEXT_TYPE_REQUIRES_CLASSIFICATION');
      continue;
    }
    if (typeof source.content !== 'string' || healthPrivate(source.content)) {
      refuse('CONTENT_PRIVACY_OR_FORMAT_BLOCKED');
      continue;
    }
    let payload;
    try {
      payload = validatePayload({
        content: source.content,
        category: classification.category,
        importance: classification.importance,
        status: 'current',
        dueAt: null,
        visibility: 'only_this_character',
        sharingClass: 'never',
        sourceMessageIds: [],
        createdBy: 'extracted',
      });
    } catch {
      refuse('TARGET_MEMORY_CONTRACT_REJECTED');
      continue;
    }
    const id = legacyId(
      'legacy-group-memory',
      binding.ownerUserId,
      binding.characterId,
      source.group_id,
      source.id,
    );
    if (baseline.memories.some((row) => row.id === id)) {
      refuse('EXISTING_MEMORY_WITHOUT_SOURCE_RECEIPT');
      continue;
    }
    inserts.push({ id, sourceKey, sourceDigest, createdAt, payload });
  }
  if (baseline.memories.length + inserts.length > 1000) {
    blocked.push({ sourceKey: null, reason: 'TARGET_MEMORY_CAPACITY_REQUIRES_REVIEW' });
  }
  const plan = {
    kind: 'candidate-group-memory-v1',
    synthetic: true,
    binding,
    review,
    finalCutoff: cutoff,
    baseline: fingerprint(baseline),
    inserts,
    skipped,
    blocked,
  };
  return { ...plan, digest: fingerprint(plan) };
}

/** Inserts only; source receipts survive a later target deletion. No memory/job cursor updates. */
export async function applyGroupMemoryDelta({
  database,
  target,
  plan,
  crypto,
  validatePayload,
  healthPrivate,
  maintenance,
  fault,
  options = {},
}) {
  assertMigrationOwnersAllowed([plan.binding.ownerUserId, plan.binding.legacyOwnerUserId], options);
  await assertFixtureDatabase(database, target);
  invariant(
    maintenance?.writersStopped === true && maintenance?.notificationsCaptured === true,
    'MAINTENANCE_REQUIRED',
  );
  const { digest, ...payload } = plan;
  invariant(
    digest === fingerprint(payload) && plan.synthetic === true,
    'GROUP_MEMORY_PLAN_CHANGED',
  );
  invariant(plan.blocked.length === 0, 'GROUP_MEMORY_PLAN_BLOCKED');
  invariant(
    typeof validatePayload === 'function' && typeof healthPrivate === 'function',
    'GROUP_MEMORY_VALIDATORS_REQUIRED',
  );
  return database.transaction(async (tx) => {
    await assertMigrationConversationOwners(
      tx,
      [plan.binding.groupConversationId, plan.binding.directConversationId],
      options,
    );
    const binding = plan.binding;
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('migration-group-memory:' || $1,0))",
      [binding.ownerUserId],
    );
    await tx.query('SELECT id FROM identity.users WHERE id=$1 FOR UPDATE', [binding.ownerUserId]);
    const applied = (
      await tx.query(
        'SELECT * FROM public.codex_group_memory_receipts WHERE source_key=ANY($1::text[])',
        [plan.inserts.map((row) => row.sourceKey)],
      )
    ).rows;
    for (const receipt of applied) {
      const row = plan.inserts.find((entry) => entry.sourceKey === receipt.source_key);
      invariant(
        receipt.source_digest === row.sourceDigest &&
          receipt.memory_id === row.id &&
          receipt.user_id === binding.ownerUserId &&
          receipt.character_id === binding.characterId,
        'GROUP_MEMORY_SOURCE_RECEIPT_CONFLICT',
      );
    }
    if (applied.length === plan.inserts.length) return { status: 'already_applied', inserted: 0 };
    invariant(applied.length === 0, 'PARTIAL_GROUP_MEMORY_PLAN_REQUIRES_REPLAN');
    const baseline = await readGroupMemoryBaseline(tx, binding, true);
    invariant(fingerprint(baseline) === plan.baseline, 'GROUP_MEMORY_TARGET_CHANGED');
    invariant(baselineBlockers(baseline, binding).length === 0, 'GROUP_MEMORY_TARGET_PROTECTED');
    const ciphertexts = await crypto.sealMany(
      binding.ownerUserId,
      plan.inserts.map((row) => {
        invariant(!healthPrivate(row.payload.content), 'GROUP_MEMORY_PRIVATE_HEALTH_BLOCKED');
        return {
          aad: `ai:memory:${row.id}`,
          plaintext: JSON.stringify(validatePayload(row.payload)),
        };
      }),
      tx,
    );
    for (const [index, row] of plan.inserts.entries()) {
      await tx.query(
        `INSERT INTO ai_runtime.memories
        (id,user_id,character_id,conversation_id,client_id,origin,scope,ciphertext,created_at,updated_at)
        VALUES($1,$2,$3,$4,$1,'group','normal',$5,$6,$6)`,
        [
          row.id,
          binding.ownerUserId,
          binding.characterId,
          binding.directConversationId,
          ciphertexts[index],
          row.createdAt,
        ],
      );
      if (fault === 'after-memory') throw new Error('SYNTHETIC_GROUP_MEMORY_INTERRUPTION');
      await tx.query(
        `INSERT INTO public.codex_group_memory_receipts
        (source_key,source_digest,memory_id,user_id,character_id,group_id,plan_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          row.sourceKey,
          row.sourceDigest,
          row.id,
          binding.ownerUserId,
          binding.characterId,
          binding.groupConversationId,
          digest,
        ],
      );
    }
    return { status: 'applied', inserted: plan.inserts.length };
  });
}
