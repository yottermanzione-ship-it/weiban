/** Offline preference migration. Plans, observations and mappings are protected data;
 * only plan.summary is public. No URL/file readers, business ports or event publishers. */
import { assertIsolatedTarget, fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const HEX = /^[a-f0-9]{64}$/u;
const SECTIONS = ['remarks', 'nicknames', 'chatFlags', 'chatBackgrounds', 'friendAvatars', 'tags'];
const ALL = [...SECTIONS, 'momentsCover'];
const PURPOSE = {
  chatBackgrounds: 'chat_background',
  friendAvatars: 'contact_avatar',
  momentsCover: 'moments_cover',
};
const ABSENT = { present: false };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => typeof value === 'string' && HEX.test(value);
const id = (value) => {
  invariant(typeof value === 'string' && UUID.test(value), 'PREFERENCE_UUID_REQUIRED');
  return value;
};
const clock = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
const countBy = (items) => {
  const counts = {};
  for (const item of items) counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  return counts;
};
const sourceIdentity = (row) => {
  invariant(
    typeof row.sourceUserId === 'string' &&
      row.sourceUserId.length > 0 &&
      row.sourceUserId.length <= 200,
    'PREFERENCE_SOURCE_ID_REQUIRED',
  );
  return row.sourceUserId;
};
function indexed(rows, key, code) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    invariant(!map.has(k), code);
    map.set(k, row);
  }
  return map;
}

/** Mirrors client_prefs_document's authoritative _sync entries. Legacy omissions are
 * unknown, never tombstones. Projection fields cannot override a versioned tombstone. */
export function normalizeLegacyPreferences(document) {
  invariant(isObject(document), 'PREFERENCE_DOCUMENT_REQUIRED');
  invariant(
    document._sync === undefined || (isObject(document._sync) && Number(document._sync.v) === 1),
    'PREFERENCE_SYNC_VERSION_UNSUPPORTED',
  );
  const versioned = isObject(document._sync) && Number(document._sync.v) === 1;
  const entries = [],
    pending = [];
  const source = versioned ? document._sync.entries : document;
  invariant(isObject(source), 'PREFERENCE_ENTRIES_REQUIRED');
  const add = (section, key, raw) => {
    invariant(
      typeof key === 'string' && key.length > 0 && key.length <= 160,
      'PREFERENCE_KEY_INVALID',
    );
    invariant(!versioned || isObject(raw), 'PREFERENCE_ENTRY_INVALID');
    const entry = {
      section,
      key,
      value: structuredClone(versioned ? (raw.value ?? null) : raw),
      deleted: versioned && raw.deleted === true,
      revisedAt: versioned ? clock(raw.revisedAt) : 0,
      writer: versioned ? String(raw.writer || 'legacy').slice(0, 80) : 'legacy',
    };
    entries.push({ ...entry, fingerprint: fingerprint(entry) });
  };
  for (const section of SECTIONS) {
    if (source[section] === undefined) continue;
    invariant(isObject(source[section]), 'PREFERENCE_SECTION_INVALID');
    for (const key of Object.keys(source[section]).sort()) add(section, key, source[section][key]);
  }
  if (versioned) {
    if (source.momentsCover !== undefined) {
      invariant(isObject(source.momentsCover), 'PREFERENCE_COVER_INVALID');
      for (const key of Object.keys(source.momentsCover).sort()) {
        invariant(key === 'value', 'PREFERENCE_COVER_KEY_INVALID');
        add('momentsCover', key, source.momentsCover[key]);
      }
    }
  } else if (source.momentsCover != null && String(source.momentsCover).trim() !== '') {
    add('momentsCover', 'value', source.momentsCover);
  }
  if (Object.hasOwn(document, 'starred'))
    pending.push({
      reason: 'starred_pending_disposition',
      value: structuredClone(document.starred),
    });
  for (const key of Object.keys(document))
    if (![...ALL, 'starred', 'v', '_sync'].includes(key))
      pending.push({
        reason: 'unknown_section_pending_disposition',
        value: { [key]: structuredClone(document[key]) },
      });
  if (versioned)
    for (const key of Object.keys(source))
      if (!ALL.includes(key))
        pending.push({
          reason: 'unknown_section_pending_disposition',
          value: { [key]: structuredClone(source[key]) },
        });
  return { version: versioned ? 2 : 1, entries, pending, digest: fingerprint(document) };
}

export const preferenceMediaReferenceDigest = (reference) =>
  fingerprint(['legacy-preference-media', reference]);
export const preferenceFieldKey = (owner, table, row, field) =>
  fingerprint(['legacy-preference-field', owner, table, row, field]);

function scopeFor(bindings, mediaReady) {
  invariant(Array.isArray(bindings) && Array.isArray(mediaReady), 'PREFERENCE_BINDINGS_REQUIRED');
  indexed(bindings, sourceIdentity, 'DUPLICATE_PREFERENCE_SOURCE_BINDING');
  indexed(bindings, (row) => id(row.ownerUserId), 'AMBIGUOUS_PREFERENCE_OWNER');
  return {
    ownerUserIds: bindings.map((row) => id(row.ownerUserId)).sort(),
    mediaIds: [...new Set(mediaReady.map((row) => id(row.mediaId)))].sort(),
  };
}

async function readBaseline(tx, scope) {
  const owners = scope.ownerUserIds;
  const users = (
    await tx.query(
      'SELECT id,status,created_at FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id',
      [owners],
    )
  ).rows;
  const profiles = (
    await tx.query(
      'SELECT user_id,moments_cover_media_id,updated_at FROM identity.profiles WHERE user_id=ANY($1::uuid[]) ORDER BY user_id',
      [owners],
    )
  ).rows;
  const contacts = (
    await tx.query(
      'SELECT id,user_id,character_id,status,remark,custom_avatar_media_id,conversation_id,deleted_at,purge_after FROM contacts.contacts WHERE user_id=ANY($1::uuid[]) ORDER BY id',
      [owners],
    )
  ).rows;
  const characters = (
    await tx.query(
      'SELECT DISTINCT c.id,c.kind,c.owner_id,c.status,c.is_trial FROM characters.characters c JOIN contacts.contacts k ON k.character_id=c.id WHERE k.user_id=ANY($1::uuid[]) ORDER BY c.id',
      [owners],
    )
  ).rows;
  const conversations = (
    await tx.query(
      'SELECT id,owner_user_id,type,character_id,official_identity_key,archived_at,trial_expires_at FROM chat.conversations WHERE owner_user_id=ANY($1::uuid[]) ORDER BY id',
      [owners],
    )
  ).rows;
  const participants = (
    await tx.query(
      'SELECT p.id,p.conversation_id,p.kind,p.ref_id,p.left_at FROM chat.participants p JOIN chat.conversations c ON c.id=p.conversation_id WHERE c.owner_user_id=ANY($1::uuid[]) ORDER BY p.id',
      [owners],
    )
  ).rows;
  const states = (
    await tx.query(
      'SELECT s.conversation_id,s.user_id,s.pinned,s.muted,s.hidden,s.cleared_through_seq,s.read_seq,s.marked_unread,s.background_media_id FROM chat.user_conversation_states s JOIN chat.conversations c ON c.id=s.conversation_id WHERE c.owner_user_id=ANY($1::uuid[]) ORDER BY s.conversation_id,s.user_id',
      [owners],
    )
  ).rows;
  const media = (
    await tx.query(
      'SELECT id,owner_id,purpose,state,content_hash,expires_at FROM media.objects WHERE id=ANY($1::uuid[]) ORDER BY id',
      [scope.mediaIds],
    )
  ).rows;
  return { users, profiles, contacts, characters, conversations, participants, states, media };
}

async function guard(database, target) {
  invariant(
    assertIsolatedTarget(target) === 'codex_migration_preferences_1109',
    'DEDICATED_PREFERENCE_FIXTURE_REQUIRED',
  );
  invariant(
    target.url === 'postgres://postgres@127.0.0.1:56389/codex_migration_preferences_1109',
    'PREFERENCE_FIXTURE_ENDPOINT_REQUIRED',
  );
  await assertFixtureDatabase(database, target);
}
export async function readLegacyPreferencesBaseline({
  database,
  target,
  bindings,
  mediaReady = [],
}) {
  await guard(database, target);
  return readBaseline(database, scopeFor(bindings, mediaReady));
}

function ownerSnapshot(target, owner) {
  return {
    users: target.users.filter((row) => row.id === owner),
    profiles: target.profiles.filter((row) => row.user_id === owner),
    contacts: target.contacts.filter((row) => row.user_id === owner),
    conversations: target.conversations.filter((row) => row.owner_user_id === owner),
    states: target.states.filter((row) => row.user_id === owner),
  };
}
export function preferenceNewAccountRequirements({
  ownerUserId,
  source,
  initialTarget,
  targetBaseline,
}) {
  return {
    initialAbsenceFingerprint: fingerprint({
      ownerUserId,
      initial: ownerSnapshot(initialTarget, ownerUserId),
    }),
    defaultTargetFingerprint: fingerprint(ownerSnapshot(targetBaseline, ownerUserId)),
    sourceFingerprint: fingerprint(source),
  };
}
function newDefaultApproved(proof, requirements) {
  return (
    proof &&
    digest(proof.proofDigest) &&
    digest(proof.noTargetEditProofDigest) &&
    Object.entries(requirements).every(([key, value]) => proof[key] === value)
  );
}
function targetValue(snapshot, item) {
  const row =
    item.table === 'contacts.contacts'
      ? snapshot.contacts.find((r) => r.id === item.rowId && r.user_id === item.ownerUserId)
      : item.table === 'identity.profiles'
        ? snapshot.profiles.find((r) => r.user_id === item.ownerUserId)
        : snapshot.states.find(
            (r) => r.conversation_id === item.rowId && r.user_id === item.ownerUserId,
          );
  return row && Object.hasOwn(row, item.field) ? { present: true, value: row[item.field] } : ABSENT;
}
function one(mapping) {
  invariant(
    Array.isArray(mapping) && mapping.length === 1,
    'ambiguous_or_missing_identity_mapping',
  );
  invariant(typeof mapping[0] === 'string' && UUID.test(mapping[0]), 'invalid_identity_mapping');
  return mapping[0];
}
function conversationBarrier(snapshot, owner, conversationId, protection) {
  if (protection.purgedConversationIds?.includes(conversationId))
    return 'permanent_deletion_preserved';
  const conversation = snapshot.conversations.find(
    (row) => row.id === conversationId && row.owner_user_id === owner,
  );
  if (!conversation) return 'conversation_dependency_missing';
  const state = snapshot.states.find(
    (row) => row.conversation_id === conversationId && row.user_id === owner,
  );
  const participant = snapshot.participants.find(
    (row) => row.conversation_id === conversationId && row.kind === 'user' && row.ref_id === owner,
  );
  if (!state || !participant) return 'conversation_dependency_missing';
  if (conversation.archived_at || state.hidden || Number(state.cleared_through_seq) > 0)
    return 'hidden_cleared_or_archived_preserved';
  if (participant.left_at || protection.leftParticipantIds?.includes(participant.id))
    return 'left_conversation_preserved';
  if (conversation.trial_expires_at) return 'trial_conversation_preserved';
  if (
    snapshot.participants.some(
      (row) =>
        row.conversation_id === conversationId &&
        row.kind === 'character' &&
        (row.left_at || protection.leftParticipantIds?.includes(row.id)),
    )
  )
    return 'left_member_preserved';
  return null;
}

/** initialBaseline = {sources,target}; sources=[{sourceUserId,document}].
 * bindings=[{sourceUserId,ownerUserId,characters:{legacyName:[uuid]},conversations:{exactLegacyKey:[uuid]}}].
 * decisions[fieldKey]={action:'apply-reviewed'|'preserve-target',candidateDigest,proofDigest,noTargetEditProofDigest}.
 * mediaReady rows bind ownerUserId/referenceDigest/purpose/mediaId/contentHash/readyProofDigest.
 * No missing relation or account is created. Deferred unsupported sections remain in plan.pending. */
export function planLegacyPreferences({
  sources,
  bindings,
  mediaReady = [],
  initialBaseline,
  targetBaseline,
  protection,
  decisions = {},
  newAccountDefaults = {},
  capturedAt,
}) {
  invariant(protection?.inventoryComplete === true, 'PREFERENCE_DELETION_INVENTORY_REQUIRED');
  invariant(
    Array.isArray(sources) &&
      Array.isArray(initialBaseline?.sources) &&
      isObject(initialBaseline.target),
    'PREFERENCE_INITIAL_BASELINE_REQUIRED',
  );
  const scope = scopeFor(bindings, mediaReady),
    at = utc(capturedAt);
  const sourceMap = indexed(sources, sourceIdentity, 'DUPLICATE_PREFERENCE_SOURCE');
  const initialSources = indexed(
    initialBaseline.sources,
    sourceIdentity,
    'DUPLICATE_INITIAL_PREFERENCE_SOURCE',
  );
  const bindingMap = indexed(bindings, sourceIdentity, 'DUPLICATE_PREFERENCE_SOURCE_BINDING');
  const candidates = [],
    changes = [],
    pending = [],
    outcomes = [],
    conflicts = [],
    authorizations = {};
  const fail = (reason) => {
    conflicts.push({ reason });
    outcomes.push({ reason });
  };
  for (const source of sourceMap.values()) {
    const binding = bindingMap.get(source.sourceUserId);
    if (!binding) {
      fail('owner_mapping_missing');
      continue;
    }
    const owner = binding.ownerUserId;
    const user = targetBaseline.users.find((row) => row.id === owner);
    if (!user || user.status !== 'active' || protection.deletedOwnerUserIds?.includes(owner)) {
      outcomes.push({ reason: 'deleted_or_missing_owner_preserved' });
      continue;
    }
    let normalized, initial;
    try {
      normalized = normalizeLegacyPreferences(source.document);
      initial = initialSources.has(source.sourceUserId)
        ? normalizeLegacyPreferences(initialSources.get(source.sourceUserId).document)
        : { entries: [] };
    } catch {
      fail('invalid_preference_document');
      continue;
    }
    pending.push(...normalized.pending.map((row) => ({ ...row, ownerUserId: owner })));
    const initialEntries = new Map(
      initial.entries.map((entry) => [`${entry.section}\0${entry.key}`, entry]),
    );
    for (const entry of normalized.entries) {
      if (['tags', 'nicknames'].includes(entry.section)) {
        pending.push({
          ownerUserId: owner,
          reason:
            entry.section === 'tags'
              ? 'tags_pending_disposition'
              : 'nickname_source_cache_not_address_as',
          entry,
        });
        continue;
      }
      const previous = initialEntries.get(`${entry.section}\0${entry.key}`);
      if (previous?.deleted && !entry.deleted) {
        outcomes.push({ reason: 'initial_source_tombstone_preserved' });
        continue;
      }
      if (
        previous &&
        (entry.revisedAt < previous.revisedAt ||
          (entry.revisedAt === previous.revisedAt &&
            entry.writer.localeCompare(previous.writer) < 0))
      ) {
        fail('source_clock_regressed');
        continue;
      }
      if (
        previous &&
        normalized.version === 2 &&
        previous.revisedAt === entry.revisedAt &&
        previous.writer === entry.writer &&
        previous.fingerprint !== entry.fingerprint
      ) {
        fail('source_clock_equivocation');
        continue;
      }
      try {
        let table, rowId;
        if (['remarks', 'friendAvatars'].includes(entry.section)) {
          const characterId = one(binding.characters?.[entry.key]);
          if (protection.purgedContactKeys?.includes(`${owner}:${characterId}`)) {
            outcomes.push({ reason: 'permanent_deletion_preserved' });
            continue;
          }
          const contact = targetBaseline.contacts.find(
            (row) => row.user_id === owner && row.character_id === characterId,
          );
          if (
            !contact ||
            contact.status !== 'active' ||
            contact.deleted_at ||
            contact.purge_after
          ) {
            outcomes.push({ reason: 'deleted_or_missing_contact_preserved' });
            continue;
          }
          const character = targetBaseline.characters.find((row) => row.id === characterId);
          if (
            !character ||
            character.is_trial ||
            (character.kind === 'custom'
              ? character.owner_id !== owner
              : character.kind !== 'preset' || character.status !== 'published')
          ) {
            fail('character_dependency_or_owner_invalid');
            continue;
          }
          const barrier = conversationBarrier(
            targetBaseline,
            owner,
            contact.conversation_id,
            protection,
          );
          if (barrier) {
            outcomes.push({ reason: barrier });
            continue;
          }
          const linked = targetBaseline.conversations.find(
            (row) => row.id === contact.conversation_id,
          );
          if (linked.type !== 'direct' || linked.character_id !== characterId) {
            fail('contact_conversation_mapping_mismatch');
            continue;
          }
          table = 'contacts.contacts';
          rowId = contact.id;
        } else if (entry.section === 'momentsCover') {
          table = 'identity.profiles';
          rowId = owner;
        } else {
          rowId = one(binding.conversations?.[entry.key]);
          table = 'chat.user_conversation_states';
          const barrier = conversationBarrier(targetBaseline, owner, rowId, protection);
          if (barrier) {
            outcomes.push({ reason: barrier });
            continue;
          }
        }
        let values;
        if (entry.section === 'remarks') {
          invariant(
            entry.deleted || entry.value === null || typeof entry.value === 'string',
            'invalid_remark_value',
          );
          const remark = entry.deleted || entry.value === null ? null : entry.value.trim() || null;
          invariant(remark === null || remark.length <= 20, 'remark_exceeds_20_characters');
          values = { remark };
        } else if (entry.section === 'chatFlags') {
          invariant(entry.deleted || isObject(entry.value), 'invalid_chat_flags');
          values = {
            pinned: !entry.deleted && entry.value.isPinned === true,
            muted: !entry.deleted && entry.value.isMuted === true,
          };
        } else {
          const field = {
            chatBackgrounds: 'background_media_id',
            friendAvatars: 'custom_avatar_media_id',
            momentsCover: 'moments_cover_media_id',
          }[entry.section];
          let mediaId = null;
          if (
            !entry.deleted &&
            !(entry.section === 'momentsCover' && (entry.value === null || entry.value === ''))
          ) {
            invariant(
              typeof entry.value === 'string' && entry.value.trim().length > 0,
              'invalid_media_reference',
            );
            const matches = mediaReady.filter(
              (row) =>
                row.ownerUserId === owner &&
                row.purpose === PURPOSE[entry.section] &&
                row.referenceDigest === preferenceMediaReferenceDigest(entry.value),
            );
            invariant(matches.length === 1, 'media_mapping_missing_or_ambiguous');
            const ready = matches[0],
              object = targetBaseline.media.find((row) => row.id === ready.mediaId);
            invariant(
              ready.state === 'ready' &&
                digest(ready.readyProofDigest) &&
                digest(ready.contentHash) &&
                object &&
                object.owner_id === owner &&
                object.purpose === ready.purpose &&
                object.state === 'ready' &&
                object.content_hash === ready.contentHash &&
                object.expires_at === null,
              'media_owner_purpose_or_readiness_invalid',
            );
            mediaId = ready.mediaId;
          }
          values = { [field]: mediaId };
        }
        for (const [field, value] of Object.entries(values)) {
          const item = { ownerUserId: owner, table, rowId, field, value };
          const before = targetValue(initialBaseline.target, item),
            current = targetValue(targetBaseline, item);
          if (!current.present) {
            fail('target_field_dependency_missing');
            continue;
          }
          const fingerprints = {
            sourceInitial: fingerprint(previous ?? ABSENT),
            source: fingerprint(entry),
            targetInitial: fingerprint(before),
            target: fingerprint(current),
          };
          const fieldKey = preferenceFieldKey(owner, table, rowId, field);
          const candidate = {
            ...item,
            fieldKey,
            fingerprints,
            sourceDeleted: entry.deleted,
            sourceSection: entry.section,
            bindingFingerprint: fingerprint(binding),
            baselineFingerprint: fingerprint(targetBaseline),
            protectionFingerprint: fingerprint(protection),
          };
          candidate.candidateDigest = fingerprint(candidate);
          candidates.push(candidate);
          if (protection.editedFieldKeys?.includes(fieldKey)) {
            outcomes.push({ reason: 'target_edit_ledger_preserved' });
            continue;
          }
          if (fingerprint(current.value) === fingerprint(value)) {
            outcomes.push({ reason: 'already_equal' });
            continue;
          }
          const initialOwner = initialBaseline.target.users.some((row) => row.id === owner);
          if (before.present && fingerprints.targetInitial !== fingerprints.target) {
            outcomes.push({ reason: 'target_new_edit_preserved' });
            continue;
          }
          if (!before.present && initialOwner) {
            fail('initial_target_field_missing');
            continue;
          }
          const decision = decisions[fieldKey];
          const reviewed =
            decision &&
            decision.candidateDigest === candidate.candidateDigest &&
            digest(decision.proofDigest);
          if (reviewed && decision.action === 'preserve-target') {
            outcomes.push({ reason: 'reviewed_target_preserved' });
            continue;
          }
          const requirements = preferenceNewAccountRequirements({
            ownerUserId: owner,
            source,
            initialTarget: initialBaseline.target,
            targetBaseline,
          });
          const defaultValue = ['pinned', 'muted'].includes(field) ? false : null;
          const newDefault =
            !initialOwner &&
            !before.present &&
            Object.values(ownerSnapshot(initialBaseline.target, owner)).every(
              (rows) => rows.length === 0,
            ) &&
            current.value === defaultValue &&
            newDefaultApproved(newAccountDefaults[owner], requirements);
          if (!before.present && !newDefault) {
            fail('new_account_default_proof_required');
            continue;
          }
          if (!(reviewed && decision.action === 'apply-reviewed') && !newDefault) {
            fail(decision ? 'review_fingerprint_mismatch' : 'field_review_required');
            continue;
          }
          if (!newDefault && !digest(decision.noTargetEditProofDigest)) {
            fail('target_edit_history_proof_required');
            continue;
          }
          authorizations[fieldKey] = newDefault
            ? {
                mode: 'proven-new-account-default',
                candidateDigest: candidate.candidateDigest,
                ...requirements,
                proofDigest: newAccountDefaults[owner].proofDigest,
                noTargetEditProofDigest: newAccountDefaults[owner].noTargetEditProofDigest,
              }
            : {
                mode: 'explicit-field-review',
                candidateDigest: candidate.candidateDigest,
                proofDigest: decision.proofDigest,
                noTargetEditProofDigest: decision.noTargetEditProofDigest,
              };
          changes.push(candidate);
          outcomes.push({
            reason: entry.deleted
              ? 'reviewed_source_deletion'
              : newDefault
                ? 'proven_new_account_default'
                : 'reviewed_source_value',
          });
        }
      } catch (error) {
        const known = new Set([
          'ambiguous_or_missing_identity_mapping',
          'invalid_identity_mapping',
          'invalid_remark_value',
          'remark_exceeds_20_characters',
          'invalid_chat_flags',
          'invalid_media_reference',
          'media_mapping_missing_or_ambiguous',
          'media_owner_purpose_or_readiness_invalid',
        ]);
        fail(known.has(error.message) ? error.message : 'invalid_preference_candidate');
      }
    }
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.fieldKey)) fail('duplicate_target_field');
    seen.add(candidate.fieldKey);
  }
  const payload = {
    version: 1,
    scope,
    capturedAt: at,
    baselineFingerprint: fingerprint(targetBaseline),
    sourceFingerprint: fingerprint(sources),
    initialFingerprint: fingerprint(initialBaseline),
    protectionFingerprint: fingerprint(protection),
    authorizations,
    candidates,
    changes,
    pending,
    conflicts,
    summary: {
      productionReady: false,
      ok: conflicts.length === 0,
      sources: sources.length,
      candidates: candidates.length,
      changes: changes.length,
      pending: pending.length,
      conflicts: conflicts.length,
      classifications: countBy([...outcomes, ...pending]),
    },
  };
  return { ...payload, digest: fingerprint(payload) };
}

export async function initializePreferenceFixture({ database, target }) {
  await guard(database, target);
  await database.query(`CREATE TABLE IF NOT EXISTS public.codex_migration_preference_receipts(plan_digest text PRIMARY KEY, applied_fields integer NOT NULL);
    CREATE TABLE IF NOT EXISTS public.codex_migration_preference_fields(field_key text NOT NULL,candidate_digest text NOT NULL,before_fingerprint text NOT NULL,after_fingerprint text NOT NULL,PRIMARY KEY(field_key,candidate_digest))`);
}
/** Whole-table locks are intentionally limited to this explicit synthetic rehearsal DB.
 * A receipt never permits rewriting a later edit; retries re-read their per-field receipts. */
export async function applyLegacyPreferences({ database, target, plan, maintenance, fault }) {
  await guard(database, target);
  invariant(
    maintenance?.writersStopped === true && maintenance?.notificationsCaptured === true,
    'PREFERENCE_MAINTENANCE_REQUIRED',
  );
  const { digest: planDigest, ...payload } = plan;
  invariant(
    plan.version === 1 && planDigest === fingerprint(payload),
    'PREFERENCE_PLAN_DIGEST_MISMATCH',
  );
  invariant(plan.conflicts.length === 0, 'PREFERENCE_PLAN_HAS_CONFLICTS');
  for (const item of plan.changes) {
    const authorization = plan.authorizations?.[item.fieldKey];
    invariant(
      authorization?.candidateDigest === item.candidateDigest &&
        digest(authorization.proofDigest) &&
        digest(authorization.noTargetEditProofDigest),
      'PREFERENCE_FIELD_AUTHORIZATION_REQUIRED',
    );
  }
  return database.transaction(async (tx) => {
    await tx.query(
      'LOCK TABLE identity.users,identity.profiles,characters.characters,contacts.contacts,chat.conversations,chat.participants,chat.user_conversation_states,media.objects,public.codex_migration_preference_receipts,public.codex_migration_preference_fields IN SHARE ROW EXCLUSIVE MODE',
    );
    const current = await readBaseline(tx, plan.scope);
    const receipt = (
      await tx.query(
        'SELECT applied_fields FROM public.codex_migration_preference_receipts WHERE plan_digest=$1',
        [planDigest],
      )
    ).rows[0];
    if (receipt) {
      invariant(receipt.applied_fields === plan.changes.length, 'PREFERENCE_RECEIPT_MISMATCH');
      let changedAfterImport = 0;
      for (const item of plan.changes) {
        const record = (
          await tx.query(
            'SELECT before_fingerprint,after_fingerprint FROM public.codex_migration_preference_fields WHERE field_key=$1 AND candidate_digest=$2',
            [item.fieldKey, item.candidateDigest],
          )
        ).rows[0];
        const after = fingerprint({ present: true, value: item.value });
        invariant(
          record?.before_fingerprint === item.fingerprints.target &&
            record?.after_fingerprint === after,
          'PREFERENCE_RECEIPT_MISMATCH',
        );
        if (fingerprint(targetValue(current, item)) !== after) changedAfterImport++;
      }
      return {
        status: 'already_applied',
        changedFields: 0,
        changedAfterImportPreserved: changedAfterImport,
        pending: plan.pending.length,
      };
    }
    invariant(
      fingerprint(current) === plan.baselineFingerprint,
      'PREFERENCE_TARGET_CHANGED_REPLAN_REQUIRED',
    );
    for (const [index, item] of plan.changes.entries()) {
      invariant(
        item.candidateDigest ===
          fingerprint(
            Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'candidateDigest')),
          ),
        'PREFERENCE_CANDIDATE_DIGEST_MISMATCH',
      );
      invariant(
        item.fieldKey === preferenceFieldKey(item.ownerUserId, item.table, item.rowId, item.field),
        'PREFERENCE_FIELD_KEY_MISMATCH',
      );
      let result;
      if (
        item.table === 'contacts.contacts' &&
        ['remark', 'custom_avatar_media_id'].includes(item.field)
      )
        result = await tx.query(
          `UPDATE contacts.contacts SET ${item.field}=$1 WHERE id=$2 AND user_id=$3 AND status='active'`,
          [item.value, item.rowId, item.ownerUserId],
        );
      else if (
        item.table === 'chat.user_conversation_states' &&
        ['pinned', 'muted', 'background_media_id'].includes(item.field)
      )
        result = await tx.query(
          `UPDATE chat.user_conversation_states SET ${item.field}=$1 WHERE conversation_id=$2 AND user_id=$3`,
          [item.value, item.rowId, item.ownerUserId],
        );
      else if (item.table === 'identity.profiles' && item.field === 'moments_cover_media_id')
        result = await tx.query(
          'UPDATE identity.profiles SET moments_cover_media_id=$1,updated_at=GREATEST(updated_at,$3::timestamptz) WHERE user_id=$2',
          [item.value, item.ownerUserId, plan.capturedAt],
        );
      else invariant(false, 'PREFERENCE_TARGET_FIELD_FORBIDDEN');
      invariant(result.rowCount === 1, 'PREFERENCE_TARGET_ROW_CHANGED');
      await tx.query('INSERT INTO public.codex_migration_preference_fields VALUES($1,$2,$3,$4)', [
        item.fieldKey,
        item.candidateDigest,
        item.fingerprints.target,
        fingerprint({ present: true, value: item.value }),
      ]);
      await fault?.('after_field', index);
    }
    await fault?.('before_receipt');
    await tx.query('INSERT INTO public.codex_migration_preference_receipts VALUES($1,$2)', [
      planDigest,
      plan.changes.length,
    ]);
    return {
      status: 'applied',
      changedFields: plan.changes.length,
      changedAfterImportPreserved: 0,
      pending: plan.pending.length,
    };
  });
}
