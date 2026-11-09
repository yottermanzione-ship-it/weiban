/**
 * Incremental migration planning. Pure functions: no configuration, connections, credentials,
 * writes, application bootstrap or event publication. Plans are protected operational data;
 * only summarizeDeltaPlan() is suitable for a public receipt.
 */
import { createHash } from 'node:crypto';
import {
  legacyId,
  legacyMessageContents,
  deletedLegacyMessage,
  splitLegacyText,
} from './legacy-content-rules.mjs';
import {
  assertMigrationOwnersAllowed,
  migrationOwnersOf,
  isMigrationOwnerPreserved,
  preservedOwnerSkip,
} from './fast-cutover-owners.mjs';

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

const MISSING_MEDIA_FIELDS = [
  'version',
  'sourceDigest',
  'table',
  'sourceId',
  'ownerUserId',
  'sourceRowDigest',
  'reason',
  'proofDigest',
];
const SHA256 = /^[a-f0-9]{64}$/u;

/** A pure planner can bind a review; only the registered execution reader authenticates its proof. */
export function assertMissingMediaReview({ review, table, row, ownerUserId, sourceDigest }) {
  invariant(
    review &&
      typeof review === 'object' &&
      !Array.isArray(review) &&
      Object.keys(review).length === MISSING_MEDIA_FIELDS.length &&
      Object.keys(review).every((key) => MISSING_MEDIA_FIELDS.includes(key)) &&
      review.version === 1 &&
      ['chat_history', 'group_messages'].includes(review.table) &&
      typeof review.sourceId === 'string' &&
      review.sourceId.length > 0 &&
      typeof review.ownerUserId === 'string' &&
      review.ownerUserId.trim() &&
      ['sourceDigest', 'sourceRowDigest', 'proofDigest'].every((key) => SHA256.test(review[key])) &&
      ['missing_file', 'no_reference'].includes(review.reason),
    'MISSING_MEDIA_REVIEW_INVALID',
  );
  invariant(
    SHA256.test(sourceDigest) &&
      review.sourceDigest === sourceDigest &&
      review.table === table &&
      review.sourceId === String(row.id) &&
      review.ownerUserId === ownerUserId &&
      review.sourceRowDigest === fingerprint(row),
    'MISSING_MEDIA_REVIEW_SOURCE_MISMATCH',
  );
  invariant(
    ['voice', 'image', 'sticker'].includes(row.message_type),
    'MISSING_MEDIA_REVIEW_NOT_MEDIA',
  );
  const references = [row.media_path, row.audio_url, row.image_url];
  invariant(
    references.every((value) => value == null || typeof value === 'string'),
    'MISSING_MEDIA_REFERENCE_SHAPE_INVALID',
  );
  const hasReference = references.some((value) => typeof value === 'string' && value.trim());
  invariant(
    review.reason === 'missing_file' ? hasReference : !hasReference,
    'MISSING_MEDIA_REASON_CONFLICT',
  );
  invariant(
    ['content', 'quoted_content', 'quoted_author'].every(
      (field) => row[field] == null || typeof row[field] === 'string',
    ),
    'MISSING_MEDIA_TEXT_SHAPE_INVALID',
  );
}

function unavailableMediaContents(row) {
  const label = { voice: '语音', image: '图片', sticker: '表情' }[row.message_type];
  const quote = row.quoted_content
    ? `↪ ${row.quoted_author || '引用'}：${row.quoted_content}\n`
    : '';
  const text = String(row.content ?? '').replaceAll('\u0000', '');
  return splitLegacyText(`[旧${label}附件不可用] \n${quote}${text}`).map((part) => ({
    type: 'text',
    text: part,
  }));
}

/** Explicit mapping, never fuzzy-match private role names or guess ownership. */
export function prepareLegacyChatRows({
  rows,
  table,
  mapping,
  cutoff,
  mediaReady = new Map(),
  sourceDigest,
  missingMediaReviews = [],
  validateContent,
  options = {},
}) {
  invariant(['chat_history', 'group_messages'].includes(table), 'UNSUPPORTED_SOURCE_TABLE');
  invariant(typeof validateContent === 'function', 'CONTRACT_VALIDATOR_REQUIRED');
  const end = utc(cutoff);
  const result = [],
    excluded = [];
  invariant(Array.isArray(missingMediaReviews), 'MISSING_MEDIA_REVIEW_LIST_REQUIRED');
  const reviews = new Map(),
    usedReviews = new Set();
  for (const review of missingMediaReviews) {
    invariant(
      review && typeof review.table === 'string' && typeof review.sourceId === 'string',
      'MISSING_MEDIA_REVIEW_INVALID',
    );
    const key = `${review.table}:${review.sourceId}`;
    invariant(!reviews.has(key), 'MISSING_MEDIA_REVIEW_DUPLICATE');
    reviews.set(key, review);
  }
  for (const row of rows) {
    invariant(row.user_id == null || typeof row.user_id === 'string', 'SOURCE_OWNER_INVALID');
    const declaredOwner =
      typeof row.user_id === 'string' && row.user_id.trim() ? row.user_id : null;
    if (declaredOwner && isMigrationOwnerPreserved(declaredOwner, options)) {
      excluded.push(preservedOwnerSkip(declaredOwner));
      continue;
    }
    const sourceId = String(row.id);
    // Legacy direct-chat IDs are SQLite integers; group_messages uses generated text IDs.
    // Preserve the complete opaque group key when deriving the original stable message IDs.
    invariant(
      table === 'chat_history'
        ? /^[0-9]+$/.test(sourceId) && (typeof row.id !== 'number' || Number.isSafeInteger(row.id))
        : typeof row.id === 'string' &&
            sourceId.length > 0 &&
            sourceId.length <= 200 &&
            sourceId.trim() === sourceId &&
            [...sourceId].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
      'SOURCE_ID_REQUIRED',
    );
    const binding = mapping(row);
    invariant(binding && binding.ownerUserId && binding.conversationId, 'UNRESOLVED_CONVERSATION');
    const sourceOwner =
      declaredOwner ??
      binding.legacyOwnerUserId ??
      binding.sourceOwnerUserId ??
      binding.ownerUserId;
    const protectedOwner = [sourceOwner, ...migrationOwnersOf(binding, binding.ownerUserId)].find(
      (owner) => isMigrationOwnerPreserved(owner, options),
    );
    if (protectedOwner) {
      excluded.push(preservedOwnerSkip(protectedOwner));
      continue;
    }
    if (table === 'group_messages') {
      const groupOwner = binding.legacyOwnerUserId ?? binding.sourceOwnerUserId;
      invariant(declaredOwner || groupOwner, 'GROUP_OWNER_PROOF_REQUIRED');
      if (declaredOwner && groupOwner)
        invariant(
          declaredOwner.trim().toLowerCase() === String(groupOwner).trim().toLowerCase(),
          'GROUP_MESSAGE_OWNER_CONFLICT',
        );
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
    const reviewKey = `${table}:${sourceId}`,
      review = reviews.get(reviewKey);
    if (review) {
      assertMissingMediaReview({ review, table, row, ownerUserId: sourceOwner, sourceDigest });
      invariant(review.ownerUserId === binding.ownerUserId, 'MISSING_MEDIA_REVIEW_OWNER_CONFLICT');
      // Even a pending/foreign/wrong-purpose mapping is not a missing-file exception.
      invariant(
        !binding.mediaId && !mediaReady.get(binding.mediaId),
        'MISSING_MEDIA_REVIEW_BINDING_CONFLICT',
      );
      usedReviews.add(reviewKey);
    }
    if (['voice', 'image', 'sticker'].includes(row.message_type)) {
      const ready = mediaReady.get(binding.mediaId);
      if (!review) {
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
    }
    const contents = review ? unavailableMediaContents(row) : legacyMessageContents(row, ref);
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
        source: {
          table,
          id: sourceId,
          part,
          ...(review
            ? {
                mediaUnavailable: {
                  version: 1,
                  sourceDigest: review.sourceDigest,
                  sourceRowDigest: review.sourceRowDigest,
                  reason: review.reason,
                  proofDigest: review.proofDigest,
                },
              }
            : {}),
        },
        content,
      });
    }
  }
  invariant(usedReviews.size === reviews.size, 'MISSING_MEDIA_REVIEW_UNUSED');
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
      (a.source.table === 'chat_history'
        ? BigInt(a.source.id) < BigInt(b.source.id)
          ? -1
          : BigInt(a.source.id) > BigInt(b.source.id)
            ? 1
            : 0
        : Buffer.compare(Buffer.from(a.source.id), Buffer.from(b.source.id))) ||
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

/** Fixed manager policy: only explicitly classified missing sources become text. No recovery pipeline. */
export function prepareFastChatRows({ missingMedia = [], ...input }) {
  const missingMediaReviews = missingMedia.map((item) => ({
    version: 1,
    sourceDigest: input.sourceDigest,
    table: item.table,
    sourceId: String(item.sourceId),
    ownerUserId: item.ownerUserId,
    sourceRowDigest: item.sourceRowDigest,
    reason: item.reason,
    proofDigest: fingerprint({
      policy: 'retain-text-unavailable-do-not-recover-20261109',
      sourceDigest: input.sourceDigest,
      ...item,
    }),
  }));
  return prepareLegacyChatRows({ ...input, missingMediaReviews });
}

export function planFastConversation({ sourceDigest, ...input }) {
  invariant(/^[a-f0-9]{64}$/u.test(sourceDigest), 'FAST_SOURCE_DIGEST_REQUIRED');
  const { digest: _digest, ...plan } = planConversationDelta(input);
  const bound = { ...plan, sourceDigest };
  return { ...bound, digest: fingerprint(bound) };
}
