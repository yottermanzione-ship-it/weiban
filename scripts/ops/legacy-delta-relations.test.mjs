import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { legacyId } from './legacy-content-rules.mjs';
import { fingerprint, invariant, assertIsolatedTarget } from './legacy-delta-core.mjs';
import { openLab, addFixtureUser, cutoff, maintenance } from './legacy-delta-lab.mjs';
import {
  readLegacyRelationsBaseline,
  planLegacyRelations,
  applyLegacyRelations,
  initializeRelationFixture,
  legacyContactKey,
} from './legacy-delta-relations.mjs';
import {
  OFFICIAL_IDENTITY_KEY,
  OFFICIAL_REF_ID,
} from '../../packages/contracts/src/http/official-assistant.ts';

const OWNER = legacyId('relation-test', 'owner');
const PEER = legacyId('relation-test', 'peer');
const OTHER = legacyId('relation-test', 'other');
const fresh = () => ({
  users: [{ id: OWNER, status: 'active' }],
  characters: [{ id: PEER, kind: 'preset', owner_id: null, status: 'published', is_trial: false }],
  conversations: [],
  participants: [],
  states: [],
  contacts: [],
});
const direct = (owner = OWNER, peer = PEER) => ({
  sourceKey: `synthetic-direct:${owner}:${peer}`,
  ownerUserId: owner,
  kind: 'direct',
  characterCandidates: [peer],
  sourceFriendship: 'active',
  createdAt: '2026-10-25T00:00:00Z',
  friendAddedAt: '2026-10-25T00:00:00Z',
});
const protection = { inventoryComplete: true };
function plan(sourceRelations, targetBaseline = fresh(), overrides = {}) {
  return planLegacyRelations({
    sourceRelations,
    targetBaseline,
    protection,
    capturedAt: cutoff,
    ...overrides,
  });
}
function represented(source = direct()) {
  const initial = plan([source]);
  const baseline = fresh();
  baseline.conversations = initial.insert.conversations.map((row) => ({
    ...row,
    last_seq: 10,
    archived_at: null,
    trial_expires_at: null,
  }));
  baseline.participants = initial.insert.participants.map((row) => ({ ...row }));
  baseline.states = initial.insert.states.map((row) => ({
    ...row,
    read_seq: 0,
    cleared_through_seq: 0,
    pinned: false,
    muted: false,
    marked_unread: false,
  }));
  baseline.contacts = initial.insert.contacts.map((row) => ({
    ...row,
    deleted_at: null,
    purge_after: null,
  }));
  return { source, baseline };
}

test('new direct and official bindings use stable identities without creating roles', () => {
  const official = {
    sourceKey: 'synthetic-official',
    ownerUserId: OWNER,
    kind: 'official',
    createdAt: cutoff,
  };
  const result = plan([direct(), official]);
  assert.equal(result.summary.ok, true);
  assert.equal(result.insert.contacts.length, 1);
  assert.equal(result.bindings[0].conversationId, legacyId('direct-conversation', OWNER, PEER));
  const xiaov = result.insert.conversations.find((row) => row.official_identity_key);
  assert.equal(xiaov.official_identity_key, OFFICIAL_IDENTITY_KEY);
  assert.equal(xiaov.character_id, null);
  assert.equal(
    result.insert.participants.find((row) => row.kind === 'official').ref_id,
    OFFICIAL_REF_ID,
  );
  assert.equal(result.bindings.find((row) => row.officialKey).peerKind, 'official');
  assert.deepEqual(result, plan([direct(), official]));
  const summary = JSON.stringify(result.summary);
  for (const value of [OWNER, PEER, official.sourceKey])
    assert.equal(summary.includes(value), false);
});

test('unknown accounts, ambiguous roles, private ownership and unavailable new roles block changes', () => {
  const source = direct();
  assert.equal(
    plan([source], { ...fresh(), users: [] }).conflicts[0].reason,
    'account_dependency_missing_or_inactive',
  );
  assert.equal(
    plan([{ ...source, characterCandidates: [PEER, OTHER] }]).conflicts[0].reason,
    'AMBIGUOUS_CHARACTER_MAPPING',
  );
  const baseline = fresh();
  baseline.characters[0] = { ...baseline.characters[0], kind: 'custom', owner_id: OTHER };
  assert.equal(
    plan([source], baseline).conflicts[0].reason,
    'PRIVATE_CHARACTER_OWNERSHIP_MISMATCH',
  );
  baseline.characters[0] = { ...fresh().characters[0], status: 'unpublished' };
  assert.equal(
    plan([source], baseline).conflicts[0].reason,
    'character_not_available_for_new_contact',
  );
  baseline.characters[0] = {
    ...fresh().characters[0],
    kind: 'custom',
    owner_id: OWNER,
    status: 'active',
  };
  assert.equal(plan([source], baseline).summary.ok, true);
  baseline.characters[0].is_trial = true;
  assert.equal(plan([source], baseline).summary.ok, false);
});

test('old history without friendship is archived and never recreates a contact', () => {
  const result = plan([{ ...direct(), sourceFriendship: 'absent' }]);
  assert.equal(result.insert.contacts.length, 0);
  assert.equal(result.insert.states[0].hidden, true);
  assert.equal(result.insert.conversations[0].archived_at, new Date(cutoff).toISOString());
  assert.equal(result.summary.classifications.history_kept_archived, 1);
  const existing = represented();
  const retained = plan([{ ...existing.source, sourceFriendship: 'absent' }], existing.baseline);
  assert.equal(retained.insert.conversations.length, 0);
  assert.equal(retained.summary.classifications.history_kept_archived, undefined);
  assert.equal(retained.summary.classifications.existing_relation_preserved, 1);
});

test('existing hidden, cleared, archived and left states never become update actions', () => {
  const { source, baseline } = represented();
  baseline.conversations[0].archived_at = cutoff;
  baseline.states[0] = {
    ...baseline.states[0],
    hidden: true,
    read_seq: 8,
    cleared_through_seq: 5,
    muted: true,
    pinned: true,
    marked_unread: true,
  };
  baseline.participants[1].left_at = cutoff;
  baseline.contacts[0] = {
    ...baseline.contacts[0],
    status: 'deleted',
    deleted_at: cutoff,
    purge_after: cutoff,
  };
  const before = fingerprint(baseline),
    result = plan([source], baseline);
  assert.deepEqual(result.insert, {
    conversations: [],
    participants: [],
    states: [],
    contacts: [],
  });
  assert.equal(fingerprint(baseline), before);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.summary.classifications.existing_protection_preserved, 1);
});

test('previously purged or replaced relationships cannot attach history to a new relationship', () => {
  const { source, baseline } = represented();
  const oldId = baseline.conversations[0].id;
  baseline.conversations[0].id = OTHER;
  const result = plan([source], baseline, {
    protection: {
      inventoryComplete: true,
      previouslyImportedRelations: [{ sourceKey: source.sourceKey, conversationId: oldId }],
    },
  });
  assert.equal(result.bindings.length, 0);
  assert.equal(result.insert.contacts.length, 0);
  assert.equal(result.excluded[0].reason, 'preserve_deleted_or_replaced_relation');
  assert.equal(
    plan([source], fresh(), {
      protection: { inventoryComplete: true, purgedContactKeys: [legacyContactKey(OWNER, PEER)] },
    }).bindings.length,
    0,
  );
  assert.equal(
    plan([source], fresh(), {
      protection: { inventoryComplete: true, deletedOwnerUserIds: [OWNER] },
    }).bindings.length,
    0,
  );
});

test('group IDs retain original legacy input types; missing friendships keep imported history archived', () => {
  const baseline = fresh();
  baseline.characters.push({ ...baseline.characters[0], id: OTHER });
  const group = {
    sourceKey: 'synthetic-group',
    ownerUserId: OWNER,
    kind: 'group',
    sourceGroupId: 29,
    createdAt: cutoff,
    members: [
      { characterCandidates: [PEER], active: true },
      { characterCandidates: [OTHER], active: true },
    ],
  };
  const historical = plan([group], baseline);
  assert.equal(historical.insert.conversations[0].id, legacyId('group-conversation', 29));
  assert.notEqual(historical.insert.conversations[0].id, legacyId('group-conversation', '29'));
  assert.equal(historical.insert.states[0].hidden, true);
  assert.equal(historical.insert.contacts.length, 0);
  assert.ok(
    historical.insert.participants
      .filter((row) => row.kind === 'character')
      .every((row) => row.left_at),
  );
  const joined = plan([direct(OWNER, PEER), direct(OWNER, OTHER), group], baseline);
  assert.equal(joined.summary.ok, true);
  assert.equal(joined.insert.contacts.length, 2);
  assert.equal(joined.insert.conversations.find((row) => row.type === 'group').archived_at, null);
});

test('existing conversation without personal state requires review instead of exposing old history', () => {
  const { source, baseline } = represented();
  baseline.states = [];
  const result = plan([source], baseline);
  assert.equal(result.conflicts[0].reason, 'existing_state_missing_requires_review');
  assert.equal(result.insert.states.length, 0);
});

test('an existing native official conversation and native participant IDs are reused without reopening it', () => {
  const source = {
    sourceKey: 'native-official',
    ownerUserId: OWNER,
    kind: 'official',
    createdAt: cutoff,
  };
  const baseline = fresh(),
    conversationId = randomUUID(),
    systemId = randomUUID();
  const userId = randomUUID(),
    officialId = randomUUID();
  baseline.conversations.push({
    id: conversationId,
    owner_user_id: OWNER,
    type: 'direct',
    character_id: null,
    official_identity_key: OFFICIAL_IDENTITY_KEY,
    system_participant_id: systemId,
    archived_at: cutoff,
    trial_expires_at: null,
    last_seq: 23,
    create_key: null,
  });
  baseline.participants.push(
    {
      id: userId,
      conversation_id: conversationId,
      kind: 'user',
      ref_id: OWNER,
      read_seq: 20,
      left_at: null,
    },
    {
      id: officialId,
      conversation_id: conversationId,
      kind: 'official',
      ref_id: OFFICIAL_REF_ID,
      read_seq: 18,
      left_at: null,
    },
  );
  baseline.states.push({
    conversation_id: conversationId,
    user_id: OWNER,
    hidden: true,
    read_seq: 20,
    cleared_through_seq: 12,
    muted: true,
    pinned: false,
    marked_unread: false,
  });
  const result = plan([source], baseline);
  assert.deepEqual(result.insert, {
    conversations: [],
    participants: [],
    states: [],
    contacts: [],
  });
  assert.equal(result.bindings[0].conversationId, conversationId);
  assert.equal(result.bindings[0].userParticipantId, userId);
  assert.equal(result.bindings[0].peerParticipantId, officialId);
  assert.equal(result.bindings[0].systemParticipantId, systemId);
});

test('an owner who left an existing group is not rejoined when a missing historical sender is inserted', () => {
  const third = randomUUID(),
    baseline = fresh();
  baseline.characters.push(
    { ...baseline.characters[0], id: OTHER },
    { ...baseline.characters[0], id: third },
  );
  const group = {
    sourceKey: 'left-group',
    ownerUserId: OWNER,
    kind: 'group',
    sourceGroupId: 852,
    createdAt: cutoff,
    members: [
      { characterCandidates: [PEER], active: true },
      { characterCandidates: [OTHER], active: true },
    ],
  };
  const initial = plan([direct(), direct(OWNER, OTHER), direct(OWNER, third), group], baseline);
  baseline.conversations = initial.insert.conversations.map((row) => ({
    ...row,
    last_seq: 0,
    trial_expires_at: null,
  }));
  baseline.participants = initial.insert.participants.map((row) => ({ ...row }));
  baseline.states = initial.insert.states.map((row) => ({
    ...row,
    read_seq: 0,
    cleared_through_seq: 0,
  }));
  baseline.contacts = initial.insert.contacts.map((row) => ({
    ...row,
    deleted_at: null,
    purge_after: null,
  }));
  const id = initial.bindings.find(
    (binding) => binding.sourceKey === group.sourceKey,
  ).conversationId;
  const existingOwner = baseline.participants.find(
    (row) => row.conversation_id === id && row.kind === 'user',
  );
  existingOwner.left_at = cutoff;
  const departed = baseline.participants.find(
    (row) => row.conversation_id === id && row.ref_id === PEER,
  );
  departed.left_at = cutoff;
  group.members.push({ characterCandidates: [third], active: true });
  const before = fingerprint(baseline),
    result = plan([group], baseline);
  assert.equal(result.insert.participants.length, 1);
  assert.ok(result.insert.participants[0].left_at);
  assert.equal(result.insert.contacts.length, 0);
  assert.equal(result.bindings[0].userParticipantId, existingOwner.id);
  assert.equal(fingerprint(baseline), before);
});

const url = process.env.MIGRATION_RELATIONS_DATABASE_URL;
invariant(url, 'MIGRATION_RELATIONS_DATABASE_URL_REQUIRED_NO_SHARED_DEFAULT');
invariant(
  /^codex_migration_relations_[a-z0-9_]+$/.test(
    assertIsolatedTarget({
      kind: 'isolated-fixture',
      synthetic: true,
      url,
    }),
  ),
  'DEDICATED_RELATION_FIXTURE_REQUIRED',
);
let lab, owner;
before(async () => {
  lab = await openLab(url);
  await initializeRelationFixture(lab);
  owner = (await addFixtureUser(lab)).id;
});
after(async () => {
  await lab?.close();
});
async function character(options = {}) {
  const id = randomUUID();
  await lab.database.query(
    `INSERT INTO characters.characters
    (id,kind,owner_id,status,name,search_text,basis,age_setting,child_appearance,child_features_detected,
    draft_ciphertext,legacy_card,checks,created_at,updated_at,is_trial)
    VALUES($1,$2,$3,$4,'合成关系角色','synthetic','original','adult',false,false,NULL,'{"synthetic":true}','{}',$5,$5,$6)`,
    [
      id,
      options.kind ?? 'preset',
      options.ownerId ?? null,
      options.status ?? 'published',
      cutoff,
      options.isTrial ?? false,
    ],
  );
  return id;
}
async function planned(sourceRelations, extra = {}) {
  const targetBaseline = await readLegacyRelationsBaseline({ ...lab, sourceRelations });
  return planLegacyRelations({
    sourceRelations,
    targetBaseline,
    protection,
    capturedAt: cutoff,
    ...extra,
  });
}
const apply = (plan, extra = {}) => applyLegacyRelations({ ...lab, plan, maintenance, ...extra });
async function counters() {
  return (
    await lab.database.query(`SELECT
    (SELECT count(*)::int FROM platform.outbox) AS outbox,
    (SELECT count(*)::int FROM realtime.user_updates) AS updates,
    (SELECT count(*)::int FROM billing.ledger_entries) AS ledger,
    (SELECT count(*)::int FROM ai_runtime.reply_plans) AS replies,
    (SELECT count(*)::int FROM characters.characters) AS characters`)
  ).rows[0];
}

test('real PostgreSQL dependency inserts, official identity, group membership and idempotent replay', async () => {
  const [a, b, c] = await Promise.all([character(), character(), character()]);
  const source = [
    direct(owner, a),
    direct(owner, b),
    { ...direct(owner, c), sourceFriendship: 'absent' },
    {
      sourceKey: `synthetic-official:${owner}`,
      ownerUserId: owner,
      kind: 'official',
      createdAt: cutoff,
    },
    {
      sourceKey: `synthetic-group:${owner}`,
      ownerUserId: owner,
      kind: 'group',
      sourceGroupId: randomInt(1, 2000000000),
      title: '合成依赖群',
      createdAt: cutoff,
      members: [
        { characterCandidates: [a], active: true },
        { characterCandidates: [b], active: true },
      ],
    },
  ];
  const before = await counters(),
    pending = await planned(source);
  assert.equal(pending.summary.ok, true);
  assert.deepEqual(await apply(pending), {
    status: 'applied',
    conversations: 5,
    participants: 11,
    contacts: 2,
  });
  assert.deepEqual(await counters(), before);
  const result = await readLegacyRelationsBaseline({ ...lab, sourceRelations: source });
  const official = result.conversations.find(
    (row) => row.official_identity_key === OFFICIAL_IDENTITY_KEY,
  );
  assert.ok(official);
  assert.equal(official.character_id, null);
  assert.equal(
    result.contacts.some((row) => row.character_id === OFFICIAL_REF_ID),
    false,
  );
  const historical = result.conversations.find((row) => row.character_id === c);
  assert.ok(historical.archived_at);
  assert.equal(result.states.find((row) => row.conversation_id === historical.id).hidden, true);
  assert.equal((await apply(pending)).status, 'already_applied');
  const replan = await planned(source);
  assert.equal(replan.summary.conversations, 0);
  assert.equal(replan.summary.participants, 0);
  assert.equal(replan.summary.contacts, 0);
  assert.equal(replan.bindings.length, 5);
});

test('real database preserves private contact fields and all existing read/hide/archive/leave state', async () => {
  const peer = await character(),
    source = [direct(owner, peer)];
  const initial = await planned(source);
  await apply(initial);
  const cid = initial.bindings[0].conversationId;
  await lab.database.query('UPDATE chat.conversations SET archived_at=$2 WHERE id=$1', [
    cid,
    cutoff,
  ]);
  await lab.database.query(
    `UPDATE chat.user_conversation_states SET hidden=true,pinned=true,muted=true,
    cleared_through_seq=7,read_seq=9,marked_unread=true WHERE conversation_id=$1`,
    [cid],
  );
  await lab.database.query(
    "UPDATE chat.participants SET left_at=$2,read_seq=5 WHERE conversation_id=$1 AND kind='character'",
    [cid, cutoff],
  );
  await lab.database.query(
    `UPDATE contacts.contacts SET remark='合成新版备注',address_as='合成新版称呼',
    custom_avatar_media_id=$2,status='deleted',deleted_at=$3,purge_after=$3 WHERE conversation_id=$1`,
    [cid, randomUUID(), cutoff],
  );
  const before = (
    await lab.database.query('SELECT * FROM contacts.contacts WHERE conversation_id=$1', [cid])
  ).rows;
  const baseline = await readLegacyRelationsBaseline({ ...lab, sourceRelations: source });
  const result = await planned(source);
  await apply(result);
  assert.deepEqual(
    (await lab.database.query('SELECT * FROM contacts.contacts WHERE conversation_id=$1', [cid]))
      .rows,
    before,
  );
  assert.equal(
    fingerprint(await readLegacyRelationsBaseline({ ...lab, sourceRelations: source })),
    fingerprint(baseline),
  );
  assert.equal(result.summary.classifications.existing_protection_preserved, 1);
});

test('real partial participant repair inserts only the absent participant and retains existing IDs', async () => {
  const peer = await character(),
    source = [direct(owner, peer)];
  const first = await planned(source);
  await apply(first);
  const cid = first.bindings[0].conversationId,
    userPid = first.bindings[0].userParticipantId;
  await lab.database.query(
    "DELETE FROM chat.participants WHERE conversation_id=$1 AND kind='character'",
    [cid],
  );
  const repair = await planned(source);
  assert.equal(repair.insert.conversations.length, 0);
  assert.equal(repair.insert.contacts.length, 0);
  assert.equal(repair.insert.participants.length, 1);
  assert.equal(repair.bindings[0].userParticipantId, userPid);
  await apply(repair);
  assert.equal(
    (
      await lab.database.query(
        'SELECT count(*)::int AS n FROM chat.participants WHERE conversation_id=$1',
        [cid],
      )
    ).rows[0].n,
    2,
  );
});

test('real rollback removes all partial inserts, and both concurrent retries share one receipt', async () => {
  const peer = await character(),
    source = [direct(owner, peer)];
  const pending = await planned(source),
    before = fingerprint(await readLegacyRelationsBaseline({ ...lab, sourceRelations: source }));
  for (const point of ['after_conversations', 'before_relation_receipt']) {
    await assert.rejects(
      apply(pending, {
        fault: (stage) => {
          if (stage === point) throw new Error('SYNTHETIC_RELATION_INTERRUPTION');
        },
      }),
      /SYNTHETIC_RELATION_INTERRUPTION/,
    );
    assert.equal(
      fingerprint(await readLegacyRelationsBaseline({ ...lab, sourceRelations: source })),
      before,
    );
  }
  const results = await Promise.all([apply(pending), apply(pending)]);
  assert.deepEqual(results.map((row) => row.status).sort(), ['already_applied', 'applied']);
});

test('real target changes and nonactive account dependencies reject a stale or blocked plan', async () => {
  const peer = await character(),
    source = [direct(owner, peer)];
  const pending = await planned(source);
  await lab.database.query("UPDATE characters.characters SET status='unpublished' WHERE id=$1", [
    peer,
  ]);
  await assert.rejects(apply(pending), /RELATION_TARGET_CHANGED/);
  const rejected = await planned(source);
  assert.equal(rejected.summary.ok, false);
  await assert.rejects(apply(rejected), /RELATION_PLAN_HAS_CONFLICTS/);
  const missingOwner = randomUUID();
  const missing = await planned([direct(missingOwner, peer)]);
  assert.equal(missing.conflicts[0].reason, 'account_dependency_missing_or_inactive');
  await assert.rejects(apply(missing), /RELATION_PLAN_HAS_CONFLICTS/);
});

test('fixture connection mismatch and missing maintenance refuse before relation writes', async () => {
  const peer = await character(),
    pending = await planned([direct(owner, peer)]);
  await assert.rejects(
    applyLegacyRelations({ ...lab, plan: pending, maintenance: { writersStopped: false } }),
    /MAINTENANCE_REQUIRED/,
  );
  let queried = false;
  await assert.rejects(
    readLegacyRelationsBaseline({
      database: {
        pool: { options: { connectionString: 'synthetic-unmatched' } },
        query: () => {
          queried = true;
          throw new Error('UNEXPECTED_QUERY');
        },
      },
      target: lab.target,
      sourceRelations: [],
    }),
    /DATABASE_CONNECTION_MISMATCH/,
  );
  assert.equal(queried, false);
});
