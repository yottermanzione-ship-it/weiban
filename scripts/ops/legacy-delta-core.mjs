/**
 * Incremental migration planning. Pure functions: no configuration, connections, credentials,
 * writes, application bootstrap or event publication. Plans are protected operational data;
 * only summarizeDeltaPlan() is suitable for a public receipt.
 */
import { createHash } from 'node:crypto';
import { legacyId, legacyMessageContents, deletedLegacyMessage } from './legacy-content-rules.mjs';
import {
  assertMigrationOwnersAllowed,
  migrationOwnersOf,
  isMigrationOwnerPreserved,
  preservedOwnerSkip,
} from './legacy-migration-owner-guards.mjs';

export function invariant(value, category) {
  if (!value) throw new Error(category);
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { sha256: createHash('sha256').update(value).digest('hex') };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function utc(value) {
  invariant(typeof value === 'string' || value instanceof Date, 'INVALID_SOURCE_TIME');
  let text = value instanceof Date ? value.toISOString() : value.trim();
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(text)) text = text.replace(' ', 'T') + 'Z';
  invariant(/(?:Z|[+-]\d\d:\d\d)$/.test(text), 'TIMEZONE_REQUIRED');
  const time = new Date(text);
  invariant(Number.isFinite(time.getTime()), 'INVALID_SOURCE_TIME');
  return time.toISOString();
}

export function assertIsolatedTarget(target) {
  invariant(
    target?.kind === 'isolated-fixture' && target.synthetic === true,
    'ISOLATED_FIXTURE_REQUIRED',
  );
  const url = new URL(target.url);
  invariant(['postgres:', 'postgresql:'].includes(url.protocol), 'POSTGRES_REQUIRED');
  invariant(['127.0.0.1', '[::1]'].includes(url.hostname), 'LOOPBACK_REQUIRED');
  invariant(/^\/codex_migration_[a-z0-9_]+$/.test(url.pathname), 'DEDICATED_DATABASE_REQUIRED');
  invariant(!url.search && !url.hash, 'DATABASE_OPTIONS_NOT_ALLOWED');
  return url.pathname.slice(1);
}

/** Explicit mapping, never fuzzy-match private role names or guess ownership. */
export function prepareLegacyChatRows({
  rows,
  table,
  mapping,
  cutoff,
  mediaReady = new Map(),
  validateContent,
  options = {},
}) {
  invariant(['chat_history', 'group_messages'].includes(table), 'UNSUPPORTED_SOURCE_TABLE');
  invariant(typeof validateContent === 'function', 'CONTRACT_VALIDATOR_REQUIRED');
  const end = utc(cutoff);
  const result = [],
    excluded = [];
  for (const row of rows) {
    if (row.user_id != null && isMigrationOwnerPreserved(String(row.user_id), options)) {
      excluded.push(preservedOwnerSkip(String(row.user_id)));
      continue;
    }
    const sourceId = String(row.id);
    invariant(/^[0-9]+$/.test(sourceId), 'SOURCE_ID_REQUIRED');
    const binding = mapping(row);
    invariant(binding && binding.ownerUserId && binding.conversationId, 'UNRESOLVED_CONVERSATION');
    const sourceOwner =
      row.user_id ?? binding.legacyOwnerUserId ?? binding.sourceOwnerUserId ?? binding.ownerUserId;
    const protectedOwner = [sourceOwner, ...migrationOwnersOf(binding, binding.ownerUserId)].find(
      (owner) => isMigrationOwnerPreserved(owner, options),
    );
    if (protectedOwner) {
      excluded.push(preservedOwnerSkip(protectedOwner));
      continue;
    }
    if (deletedLegacyMessage(row)) {
      excluded.push({ table, sourceId, reason: 'source_deleted' });
      continue;
    }
    const createdAt = utc(row.created_at);
    invariant(createdAt <= end, 'SOURCE_AFTER_CUTOFF');
    const role = table === 'chat_history' ? row.role : row.sender_type;
    const kind = ['system', 'call'].includes(row.message_type)
      ? 'system'
      : role === 'user'
        ? 'user'
        : ['assistant', 'character'].includes(role)
          ? binding.peerKind
          : 'system';
    invariant(['user', 'character', 'official', 'system'].includes(kind), 'UNRESOLVED_SENDER');
    if (binding.officialKey)
      invariant(
        binding.officialKey === 'official:xiaov' && kind !== 'character',
        'OFFICIAL_IDENTITY_REQUIRED',
      );
    const participantId =
      kind === 'user'
        ? binding.userParticipantId
        : kind === 'system'
          ? binding.systemParticipantId
          : binding.peerParticipantId;
    invariant(participantId, 'PARTICIPANT_REQUIRED');
    let ref = null;
    if (['voice', 'image', 'sticker'].includes(row.message_type)) {
      const ready = mediaReady.get(binding.mediaId);
      invariant(
        ready && ready.ownerUserId === binding.ownerUserId,
        'MEDIA_NOT_READY_OR_WRONG_OWNER',
      );
      invariant(ready.id === binding.mediaId, 'MEDIA_ID_MISMATCH');
      invariant(
        {
          voice: ['chat_voice', 'generated_voice'],
          image: ['chat_image'],
          sticker: ['user_sticker'],
        }[row.message_type].includes(ready.purpose),
        'MEDIA_PURPOSE_MISMATCH',
      );
      ref = { id: ready.id, stickerId: ready.stickerId ?? null };
    }
    const contents = legacyMessageContents(row, ref);
    for (let part = 0; part < contents.length; part++) {
      const content = validateContent(contents[part]);
      result.push({
        id: legacyId('message', table, sourceId, part),
        client_msg_id: legacyId('client-message', table, sourceId, part),
        conversation_id: binding.conversationId,
        owner_user_id: binding.ownerUserId,
        source_owner_user_id: sourceOwner,
        sender_participant_id: participantId,
        sender_kind: kind,
        created_at: createdAt,
        scope: binding.scope ?? 'normal',
        quote_message_id: binding.quoteMessageId ?? null,
        source: { table, id: sourceId, part },
        content,
      });
    }
  }
  return { messages: result, excluded };
}

/** Translate an existing boundary, including gaps, without marking any old unread row read. */
export function translateBoundary(value, oldRows, newSeq) {
  invariant(Number.isSafeInteger(Number(value)) && Number(value) >= 0, 'INVALID_SEQUENCE_BOUNDARY');
  let low = 0,
    high = oldRows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (Number(oldRows[middle].seq) <= Number(value)) low = middle + 1;
    else high = middle;
  }
  return low
    ? Number(value) + newSeq.get(oldRows[low - 1].id) - Number(oldRows[low - 1].seq)
    : Number(value);
}

/**
 * Existing ciphertext, identity, relative order, hidden/recalled flags and quote IDs survive.
 * Source deletion is a review item, not a DELETE. Pre-cutoff missing rows require a reviewed
 * allow-list so a prior purge cannot silently be undone by a full source snapshot.
 */
export function planConversationDelta({
  target,
  incoming,
  initialCutoff,
  cutoff,
  reviewedGaps = [],
  deletedSource = [],
  protection,
  newConversationReadCursor,
  options = {},
}) {
  assertMigrationOwnersAllowed(
    [
      target?.conversation?.owner_user_id,
      ...incoming.flatMap((row) => migrationOwnersOf(row, row.owner_user_id)),
    ],
    options,
  );
  invariant(protection?.inventoryComplete === true, 'DELETION_INVENTORY_REQUIRED');
  const start = utc(initialCutoff),
    end = utc(cutoff);
  invariant(start < end, 'INVALID_CUTOFF_RANGE');
  const conversation = target.conversation;
  invariant(conversation?.id && conversation.owner_user_id, 'CONVERSATION_REQUIRED');
  const oldRows = [...target.messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  const ids = new Set(),
    sequences = new Set();
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  let previousAt = null;
  for (const row of oldRows) {
    invariant(row.conversation_id === conversation.id, 'TARGET_MESSAGE_WRONG_CONVERSATION');
    invariant(
      Number.isSafeInteger(Number(row.seq)) &&
        Number(row.seq) > 0 &&
        Number(row.seq) <= Number(conversation.last_seq),
      'INVALID_TARGET_SEQUENCE',
    );
    invariant(!ids.has(row.id) && !sequences.has(Number(row.seq)), 'DUPLICATE_TARGET_MESSAGE');
    const at = utc(row.created_at);
    invariant(previousAt === null || at >= previousAt, 'TARGET_CLOCK_INVERSION_REQUIRES_REVIEW');
    previousAt = at;
    ids.add(row.id);
    sequences.add(Number(row.seq));
  }
  const seenSource = new Map(),
    gaps = new Set(reviewedGaps),
    fresh = [],
    excluded = [],
    conflicts = [];
  for (const row of incoming) {
    invariant(
      row.conversation_id === conversation.id && row.owner_user_id === conversation.owner_user_id,
      'SOURCE_OWNERSHIP_MISMATCH',
    );
    invariant(
      row.id === legacyId('message', row.source.table, String(row.source.id), row.source.part),
      'SOURCE_IDENTITY_MISMATCH',
    );
    invariant(utc(row.created_at) <= end, 'SOURCE_AFTER_CUTOFF');
    if (seenSource.has(row.id)) {
      invariant(seenSource.get(row.id) === fingerprint(row), 'SOURCE_DUPLICATE_CONFLICT');
      continue;
    }
    seenSource.set(row.id, fingerprint(row));
    if (ids.has(row.id)) {
      const old = oldById.get(row.id);
      invariant(
        old.sender_participant_id === row.sender_participant_id &&
          old.sender_kind === row.sender_kind &&
          utc(old.created_at) === utc(row.created_at),
        'EXISTING_SOURCE_ID_CONFLICT',
      );
      excluded.push({ id: row.id, reason: 'already_present' });
    } else if (
      protection.permanentlyDeleted ||
      protection.accountDeleted ||
      protection.purgedMessageIds?.includes(row.id)
    ) {
      excluded.push({ id: row.id, reason: 'protected_deletion' });
    } else if (utc(row.created_at) <= start && !gaps.has(row.id)) {
      conflicts.push({ id: row.id, reason: 'pre_cutoff_gap_requires_review' });
    } else {
      fresh.push(row);
    }
  }
  for (const source of deletedSource) {
    for (const row of oldRows) {
      // A deletion decision must include every split fragment. A first-fragment count is not a deletion scope.
      if (
        row.legacy_source?.table === source.table &&
        String(row.legacy_source.id) === String(source.id)
      )
        conflicts.push({ id: row.id, reason: 'source_deletion_requires_review' });
    }
  }
  fresh.sort(
    (a, b) =>
      utc(a.created_at).localeCompare(utc(b.created_at)) ||
      a.source.table.localeCompare(b.source.table) ||
      (BigInt(a.source.id) < BigInt(b.source.id)
        ? -1
        : BigInt(a.source.id) > BigInt(b.source.id)
          ? 1
          : 0) ||
      a.source.part - b.source.part,
  );
  const merged = [];
  let cursor = 0;
  for (const old of oldRows) {
    while (cursor < fresh.length && utc(fresh[cursor].created_at) < utc(old.created_at))
      merged.push(fresh[cursor++]);
    merged.push(old);
  }
  merged.push(...fresh.slice(cursor));
  const newSeq = new Map();
  let added = 0,
    lastOldSeq = 0;
  for (const row of merged) {
    if (oldById.has(row.id)) {
      lastOldSeq = Number(row.seq);
      newSeq.set(row.id, lastOldSeq + added);
    } else {
      added++;
      newSeq.set(row.id, lastOldSeq + added);
    }
  }
  // Preserve trailing sequence holes too; cleared/hidden history is never compacted away.
  for (let index = cursor; index < fresh.length; index++)
    newSeq.set(fresh[index].id, Number(conversation.last_seq) + index + 1);
  const nextIds = new Set(merged.map((row) => row.id));
  for (const row of fresh)
    invariant(!row.quote_message_id || nextIds.has(row.quote_message_id), 'UNRESOLVED_QUOTE');
  const remap = (value) => translateBoundary(value, oldRows, newSeq);
  for (const state of target.states)
    invariant(
      !Number(state.cleared_through_seq) || sequences.has(Number(state.cleared_through_seq)),
      'CLEAR_BOUNDARY_GAP_REQUIRES_REVIEW',
    );
  const states = target.states.map((state) => ({
    ...state,
    read_seq: remap(state.read_seq),
    cleared_through_seq: remap(state.cleared_through_seq),
  }));
  const participants = target.participants.map((participant) => ({
    ...participant,
    read_seq: remap(participant.read_seq),
  }));
  if (newConversationReadCursor !== undefined) {
    invariant(
      oldRows.length === 0 && Number(conversation.last_seq) === 0,
      'SOURCE_READ_CURSOR_ONLY_FOR_NEW_CONVERSATION',
    );
    invariant(
      newConversationReadCursor.verified === true &&
        newConversationReadCursor.userId === conversation.owner_user_id &&
        /^\d+$/.test(String(newConversationReadCursor.lastReadSourceId)),
      'SOURCE_READ_CURSOR_EVIDENCE_REQUIRED',
    );
    let boundary = 0,
      sawUnread = false;
    for (const row of fresh) {
      invariant(
        row.source.table === newConversationReadCursor.table,
        'SOURCE_READ_CURSOR_TABLE_MISMATCH',
      );
      const read = BigInt(row.source.id) <= BigInt(newConversationReadCursor.lastReadSourceId);
      invariant(!(read && sawUnread), 'SOURCE_READ_ORDER_CONFLICT');
      if (read) boundary = newSeq.get(row.id);
      else sawUnread = true;
    }
    for (const state of states)
      if (state.user_id === conversation.owner_user_id) state.read_seq = boundary;
    for (const participant of participants)
      if (participant.kind === 'user' && participant.ref_id === conversation.owner_user_id)
        participant.read_seq = boundary;
  }
  const plan = {
    version: 1,
    conversationId: conversation.id,
    ownerUserId: conversation.owner_user_id,
    baseline: fingerprint(target),
    cutoff: end,
    initialCutoff: start,
    newMessages: fresh.map((row) => ({ ...row, seq: newSeq.get(row.id) })),
    remap: oldRows.map((row) => ({
      id: row.id,
      oldSeq: Number(row.seq),
      newSeq: newSeq.get(row.id),
    })),
    states,
    participants,
    lastSeq: Number(conversation.last_seq) + fresh.length,
    excluded,
    conflicts,
    changed: fresh.length > 0,
  };
  // Sparse target histories are legitimate after deletion: avoid changing anything on a no-op.
  if (!plan.changed) plan.lastSeq = Number(conversation.last_seq);
  return { ...plan, digest: fingerprint(plan) };
}

export function summarizeDeltaPlan(plan) {
  const counts = {};
  for (const item of [...plan.excluded, ...plan.conflicts])
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  return {
    changed: plan.changed,
    newMessages: plan.newMessages.length,
    movedMessages: plan.remap.filter((item) => item.oldSeq !== item.newSeq).length,
    conflicts: plan.conflicts.length,
    classifications: counts,
  };
}

/** Generic three-way comparison shared by settings, profile, memories and memberships.
 * No last-writer-wins guesses. Tombstones/forgotten data win; revisions are opaque digests.
 * Balances are never merged here; a verified source entitlement event is a separate unit.
 */
export function planProtectedRecords({
  domain,
  source,
  target,
  baseline,
  tombstones = [],
  inventoryComplete,
  ownerUserId,
  options = {},
}) {
  invariant(inventoryComplete === true, 'DOMAIN_INVENTORY_REQUIRED');
  invariant(
    !['wallet', 'payment', 'credential'].includes(domain),
    'SPECIALIZED_RECONCILIATION_REQUIRED',
  );
  const old = new Map(baseline.map((row) => [row.key, row]));
  const current = new Map(target.map((row) => [row.key, row]));
  const removed = new Set(tombstones),
    seen = new Set(),
    actions = [];
  for (const row of source) {
    const owner = row.ownerUserId ?? row.user_id ?? ownerUserId;
    const protectedOwner = migrationOwnersOf(row, owner).find((value) =>
      isMigrationOwnerPreserved(value, options),
    );
    if (protectedOwner) {
      actions.push({ ...preservedOwnerSkip(protectedOwner), action: 'preserve_owner' });
      continue;
    }
    invariant(!seen.has(row.key), 'DUPLICATE_DOMAIN_SOURCE');
    seen.add(row.key);
    const was = old.get(row.key),
      now = current.get(row.key);
    let action;
    if (removed.has(row.key) || (was?.targetDigest && !now)) action = 'preserve_deletion';
    else if (!now) action = 'insert';
    else if (row.digest === now.digest || row.digest === was?.sourceDigest) action = 'keep_target';
    else if (was && now.digest === was.targetDigest) action = 'source_change_review';
    else action = 'conflict_review';
    actions.push({ key: row.key, action });
  }
  return actions;
}

/** Password fingerprints are compared in protected memory; hashes themselves never enter a plan. */
export function planAccounts({
  source,
  target,
  baseline,
  deletedIds = [],
  aliases = [],
  inventoryComplete,
  options = {},
}) {
  invariant(inventoryComplete === true, 'ACCOUNT_DELETION_INVENTORY_REQUIRED');
  const existing = new Map(target.map((row) => [row.id, row]));
  const before = new Map(baseline.map((row) => [row.id, row]));
  const deleted = new Set(deletedIds);
  const names = new Map([
    ...target.map((row) => [row.username.toLowerCase(), row.id]),
    ...aliases.map((row) => [row.alias.toLowerCase(), row.userId]),
  ]);
  const seen = new Set();
  return source.map((row) => {
    const protectedOwner = migrationOwnersOf(row, row.id).find((owner) =>
      isMigrationOwnerPreserved(owner, options),
    );
    if (protectedOwner) return { ...preservedOwnerSkip(protectedOwner), action: 'preserve_owner' };
    invariant(!seen.has(row.id), 'DUPLICATE_SOURCE_ACCOUNT');
    seen.add(row.id);
    const now = existing.get(row.id),
      was = before.get(row.id);
    if (deleted.has(row.id) || now?.status === 'deleting' || (was?.imported && !now))
      return { id: row.id, action: 'preserve_deletion' };
    if (!now) {
      if (names.has(row.username.toLowerCase()) && names.get(row.username.toLowerCase()) !== row.id)
        return { id: row.id, action: 'username_conflict_review' };
      names.set(row.username.toLowerCase(), row.id);
      return { id: row.id, action: 'insert', sourceFingerprint: fingerprint(row) };
    }
    if (
      row.credentialDigest === now.credentialDigest ||
      row.credentialDigest === was?.sourceCredentialDigest
    )
      return { id: row.id, action: 'keep_target' };
    return { id: row.id, action: 'credential_conflict_review' };
  });
}

/** Derive deletion scope using the old splitter's real stable IDs, without exposing content. */
export function deletionImpact({
  sourceRows,
  table,
  targetById,
  dependents = [],
  sourceFragments = new Map(),
  ownerUserId,
  options = {},
}) {
  const affected = [];
  const preserved = [];
  let unresolved = 0;
  for (const row of sourceRows.filter(deletedLegacyMessage)) {
    const owner = row.owner_user_id ?? row.user_id ?? ownerUserId;
    if (isMigrationOwnerPreserved(owner, options)) {
      preserved.push(preservedOwnerSkip(owner));
      continue;
    }
    // Media split shape depends on whether the first import had a valid media reference.
    // Its mapping is authoritative; current missing files cannot reconstruct that shape.
    let fragments = sourceFragments.get(table + ':' + String(row.id));
    if (!fragments && ['image', 'voice', 'sticker'].includes(row.message_type)) {
      unresolved++;
      continue;
    }
    fragments ??= legacyMessageContents(row, null).map((_, part) =>
      legacyId('message', table, String(row.id), part),
    );
    for (const id of fragments) {
      if (targetById.has(id))
        if (isMigrationOwnerPreserved(targetById.get(id).owner_user_id ?? owner, options))
          preserved.push(preservedOwnerSkip(targetById.get(id).owner_user_id ?? owner));
        else
          affected.push({
            id,
            dependentCount: dependents.filter((item) => item.messageId === id).length,
          });
    }
  }
  return {
    action: 'review_only',
    ...(preserved.length ? { preserved } : {}),
    affected,
    summary: {
      messages: affected.length,
      dependents: affected.reduce((sum, row) => sum + row.dependentCount, 0),
      unresolved,
    },
  };
}
