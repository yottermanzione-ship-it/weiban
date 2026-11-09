/** In-memory source mapping. Unknown role names are retained at the source and reported only as counts. */
import { legacyId, legacyNameIndex } from './legacy-content-rules.mjs';
import { fingerprint, invariant, utc } from './fast-cutover-core.mjs';
import { isMigrationOwnerPreserved } from './fast-cutover-owners.mjs';
const INITIAL = '2026-10-24T12:02:47.053609Z';
const keyOf = (owner, kind, id) => fingerprint({ owner, kind, id });
const ownerAllowed = (owner) => typeof owner === 'string' && !isMigrationOwnerPreserved(owner);
export function mapFastSource({
  tables,
  characters,
  existingUsers,
  cutoff,
  officialNames = ['小V同学', '小V'],
}) {
  const get = (table) => tables.get(table) ?? [],
    users = new Map(
      get('app_users')
        .filter((row) => ownerAllowed(row.id))
        .map((row) => [row.id, row]),
    );
  const active = new Set(
    existingUsers.filter((row) => row.status === 'active').map((row) => row.id),
  );
  for (const row of users.values())
    if (row.status === 'active' && utc(row.created_at) > utc(INITIAL)) active.add(row.id);
  const publicLookup = legacyNameIndex(characters.filter((row) => row.kind === 'preset'));
  const privateByOwner = new Map();
  for (const row of characters.filter(
    (row) => row.kind === 'custom' && row.owner_id && !row.is_trial,
  )) {
    const list = privateByOwner.get(row.owner_id) ?? [];
    list.push(row);
    privateByOwner.set(row.owner_id, list);
  }
  const privateLookups = new Map(
    [...privateByOwner].map(([owner, rows]) => [owner, legacyNameIndex(rows)]),
  );
  const official = new Set(officialNames),
    relations = new Map(),
    messageSources = [],
    unmapped = { relations: 0, messages: 0 },
    groups = new Map(),
    unmappedKeys = new Set();
  const resolveRole = (owner, name) =>
    official.has(String(name))
      ? { kind: 'official', id: 'official:xiaov' }
      : (() => {
          const id = publicLookup(name) ?? privateLookups.get(owner)?.(name);
          return id ? { kind: 'direct', id } : null;
        })();
  function direct(owner, name, at, friend) {
    const role = resolveRole(owner, name);
    if (!role) {
      unmappedKeys.add(`${owner}:direct:${name}`);
      unmapped.relations = unmappedKeys.size;
      return null;
    }
    const sourceKey = keyOf(owner, role.kind, role.id),
      createdAt = utc(at ?? cutoff);
    let entry = relations.get(sourceKey);
    if (!entry) {
      entry = {
        sourceKey,
        ownerUserId: owner,
        legacyOwnerUserId: owner,
        kind: role.kind,
        createdAt,
        ...(role.kind === 'direct'
          ? { characterCandidates: [role.id], sourceFriendship: 'absent' }
          : {}),
      };
      relations.set(sourceKey, entry);
    }
    if (createdAt < entry.createdAt) entry.createdAt = createdAt;
    if (friend && role.kind === 'direct') {
      entry.sourceFriendship = 'active';
      entry.friendAddedAt = utc(friend.added_at ?? createdAt);
    }
    return entry;
  }
  for (const friend of get('user_friends'))
    if (ownerAllowed(friend.user_id) && active.has(friend.user_id))
      direct(friend.user_id, friend.persona_name, friend.added_at, friend);
  const memberRows = new Map();
  for (const member of get('chat_group_members')) {
    const rows = memberRows.get(String(member.group_id)) ?? [];
    rows.push(member);
    memberRows.set(String(member.group_id), rows);
  }
  for (const group of get('chat_groups')) {
    if (!ownerAllowed(group.user_id) || !active.has(group.user_id)) continue;
    const members = [],
      seen = new Set();
    let unresolved = false;
    for (const raw of memberRows.get(String(group.id)) ?? []) {
      const role = resolveRole(group.user_id, raw.character_name);
      if (!role || role.kind === 'official') {
        unresolved = true;
        continue;
      }
      if (seen.has(role.id)) continue;
      seen.add(role.id);
      members.push({
        characterCandidates: [role.id],
        active: true,
        joinedAt: utc(raw.created_at ?? group.created_at),
      });
    }
    const entry = {
      sourceKey: keyOf(group.user_id, 'group', group.id),
      ownerUserId: group.user_id,
      legacyOwnerUserId: group.user_id,
      kind: 'group',
      sourceGroupId: group.id,
      createdAt: utc(group.created_at),
      title: group.name,
      sourceArchived: !!Number(group.archived),
      ownerLeft: false,
      members,
    };
    groups.set(String(group.id), { raw: group, entry, unresolved });
    if (unresolved) {
      unmappedKeys.add(`${group.user_id}:group:${group.id}`);
      unmapped.relations = unmappedKeys.size;
    } else relations.set(entry.sourceKey, entry);
  }
  for (const row of get('chat_history')) {
    if (
      !ownerAllowed(row.user_id) ||
      !active.has(row.user_id) ||
      String(row.deleted_at ?? '').trim() ||
      utc(row.created_at) <= utc(INITIAL)
    )
      continue;
    const entry = direct(row.user_id, row.persona_name, row.created_at, null);
    if (!entry) {
      unmapped.messages++;
      continue;
    }
    messageSources.push({
      table: 'chat_history',
      row,
      sourceKey: entry.sourceKey,
      sourceOwner: row.user_id,
      characterId: entry.characterCandidates?.[0] ?? null,
    });
  }
  for (const row of get('group_messages')) {
    const group = groups.get(String(row.group_id));
    if (
      !group ||
      group.unresolved ||
      String(row.deleted_at ?? '').trim() ||
      utc(row.created_at) <= utc(INITIAL)
    ) {
      if (!group || group.unresolved) unmapped.messages++;
      continue;
    }
    const owner = group.raw.user_id;
    invariant(!row.user_id || row.user_id === owner, 'FAST_SOURCE_GROUP_OWNER_CONFLICT');
    let characterId = null;
    if (
      ['character', 'assistant'].includes(row.sender_type) &&
      !['call', 'system'].includes(row.message_type)
    ) {
      const role = resolveRole(owner, row.sender_name);
      if (!role || role.kind === 'official') {
        unmapped.messages++;
        continue;
      }
      characterId = role.id;
      if (!group.entry.members.some((member) => member.characterCandidates[0] === characterId))
        group.entry.members.push({
          characterCandidates: [characterId],
          active: false,
          joinedAt: utc(row.created_at),
          leftAt: cutoff,
        });
    }
    messageSources.push({
      table: 'group_messages',
      row,
      sourceKey: group.entry.sourceKey,
      sourceOwner: owner,
      characterId,
    });
  }
  return { sourceRelations: [...relations.values()], messageSources, unmapped, users };
}

/** Conservative protection when the one known complete 10-24 import should already have created the relation. */
export function fastRelationProtection(sourceRelations, baseline) {
  const purgedRelationKeys = [],
    purgedContactKeys = [],
    convs = baseline.conversations,
    contacts = baseline.contacts;
  for (const source of sourceRelations) {
    const character = source.characterCandidates?.[0];
    const existing =
      source.kind === 'group'
        ? convs.find((row) => row.id === legacyId('group-conversation', source.sourceGroupId))
        : source.kind === 'official'
          ? convs.find(
              (row) =>
                row.owner_user_id === source.ownerUserId &&
                row.official_identity_key === 'official:xiaov',
            )
          : convs.find(
              (row) =>
                row.owner_user_id === source.ownerUserId &&
                row.type === 'direct' &&
                row.character_id === character,
            );
    if (!existing && source.kind !== 'official' && utc(source.createdAt) <= utc(INITIAL))
      purgedRelationKeys.push(source.sourceKey);
    if (
      source.kind === 'direct' &&
      source.sourceFriendship === 'active' &&
      utc(source.friendAddedAt) <= utc(INITIAL) &&
      !contacts.some((row) => row.user_id === source.ownerUserId && row.character_id === character)
    )
      purgedContactKeys.push(`${source.ownerUserId}:${character}`);
  }
  return { inventoryComplete: true, purgedRelationKeys, purgedContactKeys };
}
