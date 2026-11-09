/** Insert-only relation dependency preparation. No business creation endpoints or workers.
 * Plans/bindings are protected operator data; only summary is safe for a public receipt. */
import { legacyId } from './legacy-content-rules.mjs';
import { fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import {
  OFFICIAL_IDENTITY_KEY,
  OFFICIAL_REF_ID,
} from '../../packages/contracts/src/http/official-assistant.ts';
import {
  GROUP_MEMBER_LIMIT,
  GROUP_MIN_CHARACTERS,
} from '../../packages/contracts/src/http/chat-groups.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const legacyContactKey = (owner, character) => `${owner}:${character}`;
const participantKey = (conversation, kind, ref) => `${conversation}:${kind}:${ref}`;
const sortedIds = (ids) => [...new Set(ids)].sort();
function identity(id) {
  invariant(typeof id === 'string' && UUID.test(id), 'RELATION_UUID_REQUIRED');
  return id;
}
function oneCandidate(values) {
  invariant(Array.isArray(values) && values.length === 1, 'AMBIGUOUS_CHARACTER_MAPPING');
  return identity(values[0]);
}
function indexBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    invariant(!result.has(value), 'DUPLICATE_TARGET_RELATION');
    result.set(value, row);
  }
  return result;
}
function canAdd(character, owner) {
  return character.kind === 'custom'
    ? character.owner_id === owner && !character.is_trial
    : character.kind === 'preset' && character.status === 'published';
}
function requireCharacter(character, owner) {
  invariant(
    character && ['preset', 'custom'].includes(character.kind),
    'CHARACTER_DEPENDENCY_MISSING',
  );
  invariant(
    character.kind !== 'custom' || (character.owner_id === owner && !character.is_trial),
    'PRIVATE_CHARACTER_OWNERSHIP_MISMATCH',
  );
}
function scopeOf(sourceRelations) {
  return {
    ownerUserIds: sortedIds(sourceRelations.map((row) => identity(row.ownerUserId))),
    characterIds: sortedIds(
      sourceRelations
        .flatMap((row) => [
          ...(row.characterCandidates ?? []),
          ...(row.members ?? []).flatMap((member) => member.characterCandidates ?? []),
        ])
        .map(identity),
    ),
  };
}
async function readBaseline(tx, scope) {
  const { ownerUserIds, characterIds } = scope;
  const users = (
    await tx.query('SELECT id,status FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id', [
      ownerUserIds,
    ])
  ).rows;
  const characters = (
    await tx.query(
      'SELECT id,kind,owner_id,status,is_trial FROM characters.characters WHERE id=ANY($1::uuid[]) ORDER BY id',
      [characterIds],
    )
  ).rows;
  const conversations = (
    await tx.query(
      `SELECT id,owner_user_id,type,character_id,official_identity_key,
    system_participant_id,last_seq,archived_at,trial_expires_at,create_key
    FROM chat.conversations WHERE owner_user_id=ANY($1::uuid[]) ORDER BY id`,
      [ownerUserIds],
    )
  ).rows;
  const participants = (
    await tx.query(
      `SELECT p.id,p.conversation_id,p.kind,p.ref_id,p.joined_at,p.read_seq,p.left_at
    FROM chat.participants p JOIN chat.conversations c ON c.id=p.conversation_id
    WHERE c.owner_user_id=ANY($1::uuid[]) ORDER BY p.id`,
      [ownerUserIds],
    )
  ).rows;
  const states = (
    await tx.query(
      `SELECT s.conversation_id,s.user_id,s.hidden,s.pinned,s.muted,
    s.cleared_through_seq,s.read_seq,s.marked_unread FROM chat.user_conversation_states s
    JOIN chat.conversations c ON c.id=s.conversation_id
    WHERE c.owner_user_id=ANY($1::uuid[]) ORDER BY s.conversation_id,s.user_id`,
      [ownerUserIds],
    )
  ).rows;
  const contacts = (
    await tx.query(
      `SELECT id,user_id,character_id,status,request_id,conversation_id,deleted_at,purge_after
    FROM contacts.contacts WHERE user_id=ANY($1::uuid[]) ORDER BY id`,
      [ownerUserIds],
    )
  ).rows;
  return { users, characters, conversations, participants, states, contacts };
}
export async function readLegacyRelationsBaseline({ database, target, sourceRelations }) {
  await assertFixtureDatabase(database, target);
  return readBaseline(database, scopeOf(sourceRelations));
}

/**
 * sourceRelations: { sourceKey, ownerUserId, kind: direct|official|group, createdAt,
 * characterCandidates?: [uuid], sourceFriendship?: active|absent, friendAddedAt?,
 * sourceGroupId?: original number|string (preserve original legacy ID input type), title?,
 * sourceArchived?: boolean, ownerLeft?: boolean,
 * members?: [{ characterCandidates:[uuid], active:boolean, joinedAt?, leftAt? }] }.
 * Explicit candidates are mandatory: no private-name guessing or orphan-role creation.
 * protection requires inventoryComplete and may supply deletedOwnerUserIds,
 * purgedRelationKeys, purgedConversationIds, previouslyImportedRelations [{sourceKey,conversationId}],
 * purgedContactKeys / previouslyImportedContactKeys (legacyContactKey), and
 * leftParticipantKeys (`conversationId:kind:refId`). Missing deletion evidence is not inferred.
 */
export function planLegacyRelations({ sourceRelations, targetBaseline, protection, capturedAt }) {
  invariant(protection?.inventoryComplete === true, 'RELATION_DELETION_INVENTORY_REQUIRED');
  invariant(Array.isArray(sourceRelations), 'RELATION_SOURCE_REQUIRED');
  const at = utc(capturedAt),
    scope = scopeOf(sourceRelations);
  const baseline = structuredClone(targetBaseline);
  const users = indexBy(baseline.users, (row) => row.id);
  const characters = indexBy(baseline.characters, (row) => row.id);
  const existingById = indexBy(baseline.conversations, (row) => row.id);
  const direct = indexBy(
    baseline.conversations.filter((row) => row.type === 'direct' && row.character_id),
    (row) => legacyContactKey(row.owner_user_id, row.character_id),
  );
  const officials = indexBy(
    baseline.conversations.filter((row) => row.official_identity_key),
    (row) => legacyContactKey(row.owner_user_id, row.official_identity_key),
  );
  const contacts = indexBy(baseline.contacts, (row) =>
    legacyContactKey(row.user_id, row.character_id),
  );
  const participants = indexBy(baseline.participants, (row) =>
    participantKey(row.conversation_id, row.kind, row.ref_id),
  );
  const states = indexBy(baseline.states, (row) => `${row.conversation_id}:${row.user_id}`);
  const prior = indexBy(protection.previouslyImportedRelations ?? [], (row) => row.sourceKey);
  const purgedRelations = new Set(protection.purgedRelationKeys ?? []);
  const purgedConversations = new Set(protection.purgedConversationIds ?? []);
  const deletedOwners = new Set(protection.deletedOwnerUserIds ?? []);
  const deletedContacts = new Set(protection.purgedContactKeys ?? []);
  const priorContacts = new Set(protection.previouslyImportedContactKeys ?? []);
  const leftMembers = new Set(protection.leftParticipantKeys ?? []);
  const insert = { conversations: [], participants: [], states: [], contacts: [] };
  const bindings = [],
    excluded = [],
    conflicts = [],
    seen = new Set(),
    plannedConversationIds = new Set();
  const relationOrder = [...sourceRelations].sort(
    (a, b) => Number(a.kind === 'group') - Number(b.kind === 'group'),
  );
  for (const source of relationOrder) {
    invariant(
      typeof source.sourceKey === 'string' &&
        source.sourceKey.length > 0 &&
        !seen.has(source.sourceKey),
      'DUPLICATE_RELATION_SOURCE',
    );
    seen.add(source.sourceKey);
    const conflict = (reason) => conflicts.push({ sourceKey: source.sourceKey, reason });
    const exclude = (reason) => excluded.push({ sourceKey: source.sourceKey, reason });
    if (deletedOwners.has(source.ownerUserId) || purgedRelations.has(source.sourceKey)) {
      exclude('preserve_permanent_deletion');
      continue;
    }
    if (users.get(source.ownerUserId)?.status !== 'active') {
      conflict('account_dependency_missing_or_inactive');
      continue;
    }
    const begin = utc(source.createdAt);
    invariant(begin <= at, 'RELATION_AFTER_CUTOFF');
    invariant(['direct', 'official', 'group'].includes(source.kind), 'RELATION_KIND_INVALID');
    let characterId = null,
      existing,
      candidateId;
    try {
      if (source.kind === 'direct') {
        characterId = oneCandidate(source.characterCandidates);
        requireCharacter(characters.get(characterId), source.ownerUserId);
        existing = direct.get(legacyContactKey(source.ownerUserId, characterId));
        candidateId = legacyId('direct-conversation', source.ownerUserId, characterId);
        invariant(
          ['active', 'absent'].includes(source.sourceFriendship),
          'SOURCE_FRIENDSHIP_REQUIRED',
        );
      } else if (source.kind === 'official') {
        invariant(
          !source.characterCandidates?.length && !source.members?.length,
          'OFFICIAL_NOT_A_CHARACTER',
        );
        existing = officials.get(legacyContactKey(source.ownerUserId, OFFICIAL_IDENTITY_KEY));
        candidateId = legacyId('official-conversation', source.ownerUserId, OFFICIAL_IDENTITY_KEY);
      } else {
        invariant(
          (typeof source.sourceGroupId === 'number' &&
            Number.isSafeInteger(source.sourceGroupId) &&
            source.sourceGroupId > 0) ||
            (typeof source.sourceGroupId === 'string' &&
              /^[1-9][0-9]*$/.test(source.sourceGroupId)),
          'LEGACY_GROUP_ID_REQUIRED',
        );
        candidateId = legacyId('group-conversation', source.sourceGroupId);
        existing = existingById.get(candidateId);
        invariant(Array.isArray(source.members), 'GROUP_MEMBERS_REQUIRED');
      }
    } catch (error) {
      conflict(error.message);
      continue;
    }
    if (
      existing &&
      (existing.owner_user_id !== source.ownerUserId ||
        existing.type !== (source.kind === 'group' ? 'group' : 'direct') ||
        existing.character_id !== characterId ||
        (existing.official_identity_key ?? null) !==
          (source.kind === 'official' ? OFFICIAL_IDENTITY_KEY : null))
    ) {
      conflict('existing_conversation_identity_conflict');
      continue;
    }
    if (!existing && existingById.has(candidateId)) {
      conflict('legacy_conversation_id_conflict');
      continue;
    }
    const previous = prior.get(source.sourceKey);
    if (
      previous &&
      (!existingById.has(previous.conversationId) || existing?.id !== previous.conversationId)
    ) {
      exclude('preserve_deleted_or_replaced_relation');
      continue;
    }
    const id = existing?.id ?? candidateId;
    if (
      purgedConversations.has(id) ||
      (previous && purgedConversations.has(previous.conversationId))
    ) {
      exclude('preserve_permanent_deletion');
      continue;
    }
    if (plannedConversationIds.has(id)) {
      conflict('duplicate_conversation_source_requires_review');
      continue;
    }
    const state = states.get(`${id}:${source.ownerUserId}`);
    if (existing && !state) {
      conflict('existing_state_missing_requires_review');
      continue;
    }
    const contactKey = characterId ? legacyContactKey(source.ownerUserId, characterId) : null;
    const contact = contactKey ? contacts.get(contactKey) : null;
    if (
      contactKey &&
      (deletedContacts.has(contactKey) || (priorContacts.has(contactKey) && !contact))
    ) {
      exclude('preserve_deleted_contact');
      continue;
    }
    if (contact?.conversation_id && contact.conversation_id !== id) {
      conflict('contact_conversation_mismatch');
      continue;
    }
    if (!existing && contact && contact.status !== 'active') {
      conflict('nonactive_contact_requires_review');
      continue;
    }
    const ownerParticipant = participants.get(participantKey(id, 'user', source.ownerUserId));
    const ownerLeft =
      source.ownerLeft || leftMembers.has(participantKey(id, 'user', source.ownerUserId));
    let archived = Boolean(
      source.sourceArchived ||
      ownerLeft ||
      (source.kind === 'direct' && source.sourceFriendship === 'absent'),
    );
    const protectedExisting = Boolean(
      existing?.archived_at ||
      existing?.trial_expires_at ||
      state?.hidden ||
      Number(state?.cleared_through_seq ?? 0) > 0 ||
      ownerParticipant?.left_at ||
      contact?.status === 'deleted',
    );
    const memberRows = [],
      memberIds = new Set();
    try {
      for (const member of source.kind === 'group' ? source.members : []) {
        const memberId = oneCandidate(member.characterCandidates);
        invariant(!memberIds.has(memberId), 'DUPLICATE_GROUP_MEMBER');
        memberIds.add(memberId);
        requireCharacter(characters.get(memberId), source.ownerUserId);
        invariant(typeof member.active === 'boolean', 'GROUP_MEMBER_STATE_REQUIRED');
        const key = participantKey(id, 'character', memberId);
        const oldMember = participants.get(key);
        const friendship = contacts.get(legacyContactKey(source.ownerUserId, memberId));
        const mayBeActive =
          member.active &&
          canAdd(characters.get(memberId), source.ownerUserId) &&
          friendship?.status === 'active' &&
          !deletedContacts.has(legacyContactKey(source.ownerUserId, memberId)) &&
          !leftMembers.has(key);
        if (!existing && member.active && !mayBeActive) archived = true;
        memberRows.push({ member, memberId, oldMember, key, mayBeActive });
      }
      const activeCount = memberRows.filter(({ member }) => member.active).length;
      if (!existing && !archived)
        invariant(
          (activeCount >= GROUP_MIN_CHARACTERS && activeCount <= GROUP_MEMBER_LIMIT) ||
            source.kind !== 'group',
          'GROUP_ACTIVE_MEMBER_LIMIT_REQUIRES_REVIEW',
        );
    } catch (error) {
      conflict(error.message);
      continue;
    }
    if (
      !archived &&
      !protectedExisting &&
      !contact &&
      source.kind === 'direct' &&
      source.sourceFriendship === 'active' &&
      !canAdd(characters.get(characterId), source.ownerUserId)
    ) {
      conflict('character_not_available_for_new_contact');
      continue;
    }
    const systemId = existing?.system_participant_id ?? legacyId('system-participant', id);
    const createdParticipants = [],
      binding = {
        sourceKey: source.sourceKey,
        ownerUserId: source.ownerUserId,
        conversationId: id,
        systemParticipantId: systemId,
        peerKind: source.kind === 'official' ? 'official' : 'character',
        officialKey: source.kind === 'official' ? OFFICIAL_IDENTITY_KEY : null,
        characterParticipants: [],
      };
    function participant(kind, refId, leftAt = null, joinedAt = begin) {
      const old = participants.get(participantKey(id, kind, refId));
      if (old) return old.id;
      const participantId = legacyId('participant', id, kind, refId);
      if (baseline.participants.some((row) => row.id === participantId))
        throw new Error('PARTICIPANT_ID_CONFLICT');
      createdParticipants.push({
        id: participantId,
        conversation_id: id,
        kind,
        ref_id: refId,
        joined_at: utc(joinedAt),
        read_seq: kind === 'user' ? Number(state?.read_seq ?? 0) : 0,
        left_at: leftAt,
      });
      return participantId;
    }
    try {
      binding.userParticipantId = participant('user', source.ownerUserId, ownerLeft ? at : null);
      if (source.kind === 'direct')
        binding.peerParticipantId = participant('character', characterId);
      if (source.kind === 'official')
        binding.peerParticipantId = participant('official', OFFICIAL_REF_ID);
      for (const { member, memberId, mayBeActive } of memberRows) {
        const left = !mayBeActive || protectedExisting || archived;
        const memberParticipantId = participant(
          'character',
          memberId,
          left ? (member.leftAt ? utc(member.leftAt) : at) : null,
          member.joinedAt ?? begin,
        );
        binding.characterParticipants.push({
          characterId: memberId,
          participantId: memberParticipantId,
        });
      }
    } catch (error) {
      conflict(error.message);
      continue;
    }
    if (!existing) {
      insert.conversations.push({
        id,
        owner_user_id: source.ownerUserId,
        type: source.kind === 'group' ? 'group' : 'direct',
        character_id: characterId,
        official_identity_key: binding.officialKey,
        system_participant_id: systemId,
        title: source.kind === 'group' ? String(source.title ?? '旧群聊') : null,
        archived_at: archived ? at : null,
        created_at: begin,
        updated_at: begin,
        title_customized: source.kind === 'group',
        create_key: source.kind === 'group' ? `legacy-group:${source.sourceGroupId}` : null,
      });
      insert.states.push({ conversation_id: id, user_id: source.ownerUserId, hidden: archived });
    }
    insert.participants.push(...createdParticipants);
    if (
      source.kind === 'direct' &&
      source.sourceFriendship === 'active' &&
      !contact &&
      !archived &&
      !protectedExisting
    ) {
      const addedAt = utc(source.friendAddedAt ?? begin);
      invariant(addedAt <= at, 'FRIENDSHIP_AFTER_CUTOFF');
      const fresh = {
        id: legacyId('contact', source.ownerUserId, characterId),
        user_id: source.ownerUserId,
        character_id: characterId,
        request_id: legacyId('contact-request', source.ownerUserId, characterId),
        conversation_id: id,
        added_at: addedAt,
        known_since: addedAt.slice(0, 10),
        status: 'active',
      };
      insert.contacts.push(fresh);
      contacts.set(contactKey, fresh);
    }
    plannedConversationIds.add(id);
    bindings.push(binding);
    if (archived && !existing)
      excluded.push({ sourceKey: source.sourceKey, reason: 'history_kept_archived' });
    if (archived && existing && !protectedExisting)
      excluded.push({ sourceKey: source.sourceKey, reason: 'existing_relation_preserved' });
    if (protectedExisting)
      excluded.push({ sourceKey: source.sourceKey, reason: 'existing_protection_preserved' });
  }
  const categories = {};
  for (const item of [...excluded, ...conflicts])
    categories[item.reason] = (categories[item.reason] ?? 0) + 1;
  const plan = {
    version: 1,
    scope,
    baseline: fingerprint(targetBaseline),
    capturedAt: at,
    insert,
    bindings,
    excluded,
    conflicts,
    summary: {
      ok: conflicts.length === 0,
      conversations: insert.conversations.length,
      participants: insert.participants.length,
      states: insert.states.length,
      contacts: insert.contacts.length,
      bindings: bindings.length,
      conflicts: conflicts.length,
      classifications: categories,
    },
  };
  return { ...plan, digest: fingerprint(plan) };
}

export async function initializeRelationFixture({ database, target }) {
  await assertFixtureDatabase(database, target);
  await database.query(`CREATE TABLE IF NOT EXISTS public.codex_migration_relation_receipts(
    digest text PRIMARY KEY, inserted_conversations integer NOT NULL,
    inserted_participants integer NOT NULL, inserted_contacts integer NOT NULL)`);
}

/** Real schema inserts in one transaction; receipt shares the transaction and enables retry. */
export async function applyLegacyRelations({ database, target, plan, maintenance, fault }) {
  await assertFixtureDatabase(database, target);
  invariant(maintenance?.writersStopped === true, 'MAINTENANCE_REQUIRED');
  const { digest, ...payload } = plan;
  invariant(plan.version === 1 && digest === fingerprint(payload), 'RELATION_PLAN_DIGEST_MISMATCH');
  invariant(plan.conflicts.length === 0, 'RELATION_PLAN_HAS_CONFLICTS');
  return database.transaction(async (tx) => {
    // Offline-only, whole-table writer locks cover missing-row races as well as existing rows.
    // No live business port is invoked, so no registration/greeting/AI/outbox is published.
    await tx.query(
      'LOCK TABLE identity.users,characters.characters,contacts.contacts,chat.conversations,chat.participants,chat.user_conversation_states IN SHARE ROW EXCLUSIVE MODE',
    );
    const receipt = await tx.query(
      'SELECT digest FROM public.codex_migration_relation_receipts WHERE digest=$1',
      [digest],
    );
    if (receipt.rows.length)
      return { status: 'already_applied', conversations: 0, participants: 0, contacts: 0 };
    const baseline = await readBaseline(tx, plan.scope);
    invariant(fingerprint(baseline) === plan.baseline, 'RELATION_TARGET_CHANGED_REPLAN_REQUIRED');
    for (const row of plan.insert.conversations)
      await tx.query(
        `INSERT INTO chat.conversations
      (id,owner_user_id,type,character_id,official_identity_key,title,system_participant_id,content_scope,last_seq,
      archived_at,created_at,updated_at,title_customized,create_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,'normal',0,$8,$9,$10,$11,$12)`,
        [
          row.id,
          row.owner_user_id,
          row.type,
          row.character_id,
          row.official_identity_key,
          row.title,
          row.system_participant_id,
          row.archived_at,
          row.created_at,
          row.updated_at,
          row.title_customized,
          row.create_key,
        ],
      );
    await fault?.('after_conversations');
    for (const row of plan.insert.participants)
      await tx.query(
        `INSERT INTO chat.participants
      (id,conversation_id,kind,ref_id,joined_at,read_seq,left_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          row.id,
          row.conversation_id,
          row.kind,
          row.ref_id,
          row.joined_at,
          row.read_seq,
          row.left_at,
        ],
      );
    for (const row of plan.insert.states)
      await tx.query(
        `INSERT INTO chat.user_conversation_states
      (conversation_id,user_id,hidden,pinned,muted,cleared_through_seq,read_seq,marked_unread)
      VALUES($1,$2,$3,false,false,0,0,false)`,
        [row.conversation_id, row.user_id, row.hidden],
      );
    for (const row of plan.insert.contacts)
      await tx.query(
        `INSERT INTO contacts.contacts
      (id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type)
      VALUES($1,$2,$3,'active',$4,'restored',$5,$6,$5,$7,'朋友')`,
        [
          row.id,
          row.user_id,
          row.character_id,
          row.request_id,
          row.added_at,
          row.known_since,
          row.conversation_id,
        ],
      );
    await fault?.('before_relation_receipt');
    await tx.query(
      `INSERT INTO public.codex_migration_relation_receipts
      (digest,inserted_conversations,inserted_participants,inserted_contacts) VALUES($1,$2,$3,$4)`,
      [
        digest,
        plan.insert.conversations.length,
        plan.insert.participants.length,
        plan.insert.contacts.length,
      ],
    );
    return {
      status: 'applied',
      conversations: plan.insert.conversations.length,
      participants: plan.insert.participants.length,
      contacts: plan.insert.contacts.length,
    };
  });
}
