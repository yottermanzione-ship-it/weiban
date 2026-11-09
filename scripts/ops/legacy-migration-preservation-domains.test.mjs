import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  legacyMigrationOwnerDigest,
  isLegacyMigrationOwnerDigestPreserved,
} from './legacy-migration-preservation.mjs';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
import { assertLegacySnapshotOwnersAllowed } from './legacy-migration-owner-guards.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import {
  fingerprint,
  planAccounts,
  planProtectedRecords,
  deletionImpact,
  prepareLegacyChatRows,
  planConversationDelta,
} from './legacy-delta-core.mjs';
import {
  applyConversationDelta,
  applyMissingAccounts,
  readConversationBaseline,
} from './legacy-delta-db.mjs';
import {
  planLegacyRelations,
  applyLegacyRelations,
  readLegacyRelationsBaseline,
} from './legacy-delta-relations.mjs';
import {
  buildLegacyDeltaMediaPlan,
  transferLegacyDeltaMedia,
  importLegacyDeltaMedia,
  createLegacyDeltaMediaPort,
} from './legacy-delta-media.mjs';
import { planFavoriteSources, applyFavoriteSources } from './legacy-delta-favorite-sources.mjs';
import { planEntitlementDelta, applyEntitlementDelta } from './legacy-delta-entitlements.mjs';
import { planGroupMemoryDelta, applyGroupMemoryDelta } from './legacy-delta-group-memory.mjs';
import { planLegacyPreferences, applyLegacyPreferences } from './legacy-delta-preferences.mjs';
import { applySharedGroupMemoryFixture } from './legacy-shared-group-memory.mjs';
import { planLegacyWeiboSlots } from './legacy-weibo-slots.mjs';
import {
  openLab,
  addFixtureUser,
  addFixtureConversation,
  fixtureIncoming,
  fixturePlan,
  cutoff,
  maintenance,
  validateContent,
} from './legacy-delta-lab.mjs';

const excluded = randomUUID(),
  allowed = randomUUID();
const options = { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(excluded)] };
const category = /LEGACY_MIGRATION_OWNER_PRESERVED/;
const empty = () => ({
  users: [],
  profiles: [],
  contacts: [],
  characters: [],
  conversations: [],
  participants: [],
  states: [],
  media: [],
});
const signed = (payload) => ({ ...payload, digest: fingerprint(payload) });
const assertPrivateSkip = (result) =>
  assert.equal(JSON.stringify(result).includes(excluded), false);

test('the immutable digest policy remains active with omitted or unrelated extra lists', () => {
  assert.ok(policy.userIdSha256.length > 0);
  for (const digest of policy.userIdSha256) {
    assert.equal(isLegacyMigrationOwnerDigestPreserved(digest), true);
    assert.equal(isLegacyMigrationOwnerDigestPreserved(digest, []), true);
    assert.equal(
      isLegacyMigrationOwnerDigestPreserved(digest, [legacyMigrationOwnerDigest(allowed)]),
      true,
    );
  }
});

test('account/protected-record/deletion/chat preparation skip only the synthetic protected owner', () => {
  const accounts = planAccounts({
    source: [
      { id: excluded, username: 'synthetic_excluded' },
      { id: allowed, username: 'synthetic_allowed' },
    ],
    target: [],
    baseline: [],
    inventoryComplete: true,
    options,
  });
  assert.equal(accounts[0].action, 'preserve_owner');
  assert.equal(accounts[1].action, 'insert');
  assertPrivateSkip(accounts);
  const records = planProtectedRecords({
    domain: 'memory',
    ownerUserId: excluded,
    source: [{ key: 'synthetic-memory', digest: 'x' }],
    target: [],
    baseline: [],
    inventoryComplete: true,
    options,
  });
  assert.equal(records[0].action, 'preserve_owner');
  assertPrivateSkip(records);
  const deletion = deletionImpact({
    sourceRows: [
      { id: 1, user_id: excluded, deleted_at: cutoff, message_type: 'text', content: 'synthetic' },
    ],
    table: 'chat_history',
    targetById: new Map(),
    options,
  });
  assert.equal(deletion.affected.length, 0);
  assert.equal(deletion.preserved.length, 1);
  assertPrivateSkip(deletion);
  const oldId = legacyId('message', 'chat_history', '2', 0);
  const destination = deletionImpact({
    sourceRows: [
      { id: 2, user_id: allowed, deleted_at: cutoff, message_type: 'text', content: 'synthetic' },
    ],
    table: 'chat_history',
    targetById: new Map([[oldId, { owner_user_id: excluded }]]),
    options,
  });
  assert.equal(destination.affected.length, 0);
  assert.equal(destination.preserved.length, 1);
  assertPrivateSkip(destination);
  const chat = prepareLegacyChatRows({
    rows: [{ id: 1, user_id: excluded }],
    table: 'chat_history',
    mapping: () => ({ ownerUserId: excluded, conversationId: randomUUID() }),
    cutoff,
    validateContent,
    options,
  });
  assert.equal(chat.messages.length, 0);
  assert.equal(chat.excluded.length, 1);
  assertPrivateSkip(chat);
});

test('multi-owner relation/preferences/favorite/weibo planners expose only digest skip receipts', () => {
  const relations = planLegacyRelations({
    sourceRelations: [{ sourceKey: 'synthetic', ownerUserId: excluded }],
    targetBaseline: empty(),
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
    options,
  });
  assert.deepEqual(relations.scope.ownerUserIds, []);
  assert.equal(relations.summary.classifications.preserve_new_account, 1);
  assertPrivateSkip(relations);
  const prefs = planLegacyPreferences({
    sources: [{ sourceUserId: excluded, document: {} }],
    bindings: [{ sourceUserId: excluded, ownerUserId: excluded }],
    initialBaseline: { sources: [], target: empty() },
    targetBaseline: empty(),
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
    options,
  });
  assert.equal(prefs.changes.length, 0);
  assert.equal(prefs.summary.classifications.preserve_new_account, 1);
  assertPrivateSkip(prefs);
  const favorites = planFavoriteSources({
    baseline: { userIds: [excluded], users: [{ id: excluded }], sources: [], media: [] },
    sourceAccounts: [{ userId: excluded, sourceUserId: excluded }],
    sourceSnapshotDigest: 'a'.repeat(64),
    sourceBatch: 'synthetic',
    cutoff,
    inventoryComplete: true,
    options,
  });
  assert.equal(favorites.insert.length, 0);
  assert.equal(favorites.summary.preserved, 1);
  assertPrivateSkip(favorites);
  const weibo = planLegacyWeiboSlots({
    source: [
      {
        legacyBindingId: 'synthetic-binding',
        legacyUserId: excluded,
        slot: 'main',
        status: 'active',
        personaKey: 'synthetic-role',
        appIdFingerprint: 'b'.repeat(64),
        sourceDigest: 'c'.repeat(64),
      },
    ],
    userMap: { [excluded]: excluded },
    characterMap: {},
    options,
  });
  assert.equal(weibo.actions.length, 0);
  assert.equal(weibo.preserved.length, 1);
  assertPrivateSkip(weibo);
});

test('single-owner planners and full-import source preflights refuse with a fixed category before private processing', () => {
  assert.throws(
    () =>
      planConversationDelta({
        target: { conversation: { owner_user_id: excluded } },
        incoming: [],
        options,
      }),
    category,
  );
  assert.throws(
    () => planEntitlementDelta({ userId: excluded, sourceEvents: [], options }),
    category,
  );
  assert.throws(
    () =>
      planGroupMemoryDelta({
        binding: { ownerUserId: excluded, legacyOwnerUserId: excluded },
        options,
      }),
    category,
  );
  for (const snapshot of [
    new Map([['app_users', [{ id: excluded }]]]),
    new Map([['user_memories', [{ user_key: `${excluded}::synthetic` }]]]),
    new Map([['chat_history', [{ user_id: excluded }]]]),
  ])
    assert.throws(() => assertLegacySnapshotOwnersAllowed(snapshot, options), category);
  assert.doesNotThrow(() =>
    assertLegacySnapshotOwnersAllowed(new Map([['app_users', [{ id: allowed }]]]), options),
  );
});

test('a wrong user mapping cannot move preserved source ownership into an allowed destination', () => {
  let mapped = 0;
  const chat = prepareLegacyChatRows({
    rows: [{ id: 1, user_id: excluded }],
    table: 'chat_history',
    mapping: () => {
      mapped++;
      return { ownerUserId: allowed, conversationId: randomUUID() };
    },
    cutoff,
    validateContent,
    options,
  });
  assert.equal(mapped, 0);
  assert.equal(chat.messages.length, 0);
  const relation = planLegacyRelations({
    sourceRelations: [
      { sourceKey: 'synthetic-remap', ownerUserId: allowed, legacyOwnerUserId: excluded },
    ],
    targetBaseline: empty(),
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
    options,
  });
  assert.equal(relation.bindings.length, 0);
  assert.equal(relation.excluded.length, 1);
  const preferences = planLegacyPreferences({
    sources: [{ sourceUserId: excluded, document: {} }],
    bindings: [{ sourceUserId: excluded, ownerUserId: allowed }],
    initialBaseline: { sources: [], target: empty() },
    targetBaseline: empty(),
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
    options,
  });
  assert.equal(preferences.changes.length, 0);
  assert.deepEqual(preferences.scope.ownerUserIds, []);
  const favorites = planFavoriteSources({
    baseline: { userIds: [allowed], users: [{ id: allowed }], sources: [], media: [] },
    sourceAccounts: [{ userId: allowed, sourceUserId: excluded }],
    sourceSnapshotDigest: 'a'.repeat(64),
    sourceBatch: 'synthetic-remap',
    cutoff,
    inventoryComplete: true,
    options,
  });
  assert.equal(favorites.insert.length, 0);
  assert.equal(favorites.summary.preserved, 1);
  const weibo = planLegacyWeiboSlots({
    source: [
      {
        legacyBindingId: 'synthetic-remap',
        legacyUserId: excluded,
        slot: 'main',
        status: 'active',
        personaKey: 'synthetic',
        appIdFingerprint: 'b'.repeat(64),
        sourceDigest: 'c'.repeat(64),
      },
    ],
    userMap: { [excluded]: allowed },
    characterMap: {},
    options,
  });
  assert.equal(weibo.actions.length, 0);
  assert.equal(weibo.preserved.length, 1);
});

test('shared source media remains available for another owner; protected/re-signed media plans write nothing', async (t) => {
  const temp = path.resolve(os.tmpdir()),
    root = await fs.mkdtemp(path.join(temp, 'weiban-preservation-synthetic-'));
  t.after(async () => {
    const relative = path.relative(temp, path.resolve(root));
    assert.ok(
      relative.startsWith('weiban-preservation-synthetic-') && !relative.includes(path.sep),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const sourceRoot = path.join(root, 'source'),
    stagingRoot = path.join(root, 'staging');
  await fs.mkdir(sourceRoot);
  await fs.mkdir(stagingRoot);
  const bytes = Buffer.from('synthetic shared media source');
  await fs.writeFile(path.join(sourceRoot, 'shared.bin'), bytes);
  const object = (ownerUserId) => ({
    id: legacyId('media', ownerUserId, 'chat_voice', '/synthetic/shared.bin'),
    ownerUserId,
    purpose: 'chat_voice',
    asset: {
      kind: 'file',
      path: '/synthetic/shared.bin',
      archive: 'shared.bin',
      bytes: bytes.length,
    },
  });
  const mixed = await buildLegacyDeltaMediaPlan({
    objects: [object(excluded), object(allowed)],
    sourceRoot,
    options,
  });
  assert.equal(mixed.objects.length, 1);
  assert.equal(mixed.files.length, 1);
  assert.equal(mixed.summary.preservedObjects, 1);
  assertPrivateSkip(mixed);
  const remapped = await buildLegacyDeltaMediaPlan({
    objects: [{ ...object(allowed), sourceOwnerUserId: excluded }],
    sourceRoot,
    options,
  });
  assert.equal(remapped.objects.length, 0);
  assert.equal(remapped.summary.preservedObjects, 1);
  assert.equal(
    (await transferLegacyDeltaMedia({ plan: mixed, sourceRoot, stagingRoot, options })).summary.ok,
    true,
  );
  assert.deepEqual(await fs.readFile(path.join(sourceRoot, 'shared.bin')), bytes);
  const forged = await buildLegacyDeltaMediaPlan({ objects: [object(excluded)], sourceRoot });
  const before = await fs.readdir(stagingRoot);
  await assert.rejects(
    transferLegacyDeltaMedia({ plan: forged, sourceRoot, stagingRoot, options }),
    category,
  );
  let invoked = 0;
  await assert.rejects(
    importLegacyDeltaMedia({
      plan: forged,
      stagingRoot,
      mediaPort: { importLegacyObject: () => invoked++ },
      options,
    }),
    category,
  );
  const port = createLegacyDeltaMediaPort({
    media: { importLegacyObject: () => invoked++ },
    lookupObject: async () => null,
    adminId: randomUUID(),
    options,
  });
  assert.throws(() => port.importLegacyObject(object(excluded), {}), category);
  assert.equal(invoked, 0);
  assert.deepEqual(await fs.readdir(stagingRoot), before);
  await assert.rejects(
    importLegacyDeltaMedia({
      plan: mixed,
      stagingRoot,
      options,
      normalize: () => {
        throw new Error('MUST_NOT_NORMALIZE');
      },
      mediaPort: {
        lookup: async () => ({ ownerId: excluded }),
        expectedHash: async () => '',
        readOwned: async () => ({}),
        importLegacyObject: async () => {
          invoked++;
        },
      },
    }),
    category,
  );
  assert.equal(invoked, 0);
  const orphan = { ...mixed, objects: [] };
  const { fingerprint: _f, summary: _s, ...payload } = orphan;
  orphan.fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await assert.rejects(
    transferLegacyDeltaMedia({ plan: orphan, sourceRoot, stagingRoot, options }),
    /MEDIA_PLAN_INVALID/,
  );
  assert.deepEqual(await fs.readFile(path.join(sourceRoot, 'shared.bin')), bytes);
});

const url = process.env.MIGRATION_PRESERVATION_DATABASE_URL;
assert.equal(url, 'postgres://postgres@127.0.0.1:56389/codex_migration_preservation_1109');
let lab, conversation;
before(async () => {
  lab = await openLab(url);
  await addFixtureUser(lab, excluded);
  await addFixtureUser(lab, allowed);
  conversation = await addFixtureConversation(lab, { owner: excluded });
});
after(async () => {
  await lab?.close();
});
async function snapshot() {
  const rows = [];
  for (const [table, key, value] of [
    ['identity.users', 'id', excluded],
    ['identity.profiles', 'user_id', excluded],
    ['identity.notification_settings', 'user_id', excluded],
    ['identity.memberships', 'user_id', excluded],
    ['chat.conversations', 'owner_user_id', excluded],
    ['chat.messages', 'conversation_id', conversation.id],
    ['chat.user_conversation_states', 'user_id', excluded],
    ['contacts.contacts', 'user_id', excluded],
    ['library.favorites', 'user_id', excluded],
    ['media.objects', 'owner_id', excluded],
    ['channels.bindings', 'user_id', excluded],
    ['ai_runtime.memories', 'user_id', excluded],
  ])
    rows.push([
      table,
      (await lab.database.query(`SELECT * FROM ${table} WHERE ${key}=$1 ORDER BY 1`, [value])).rows,
    ]);
  return fingerprint(rows);
}
test('all executors reject a re-signed protected write scope with actual PostgreSQL rows byte-for-byte unchanged', async () => {
  const baseline = await snapshot();
  const plan = await fixturePlan(lab, conversation, fixtureIncoming(conversation));
  let writes = 0;
  const watch = (target) =>
    new Proxy(target, {
      get(value, key) {
        if (key === 'query')
          return (sql, args) => {
            if (/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)) writes++;
            return value.query(sql, args);
          };
        if (key === 'transaction') return (fn) => value.transaction((tx) => fn(watch(tx)));
        const result = Reflect.get(value, key);
        return typeof result === 'function' ? result.bind(value) : result;
      },
    });
  const observed = { ...lab, database: watch(lab.database) };
  const calls = [
    () => applyConversationDelta({ ...observed, plan, validateContent, maintenance, options }),
    () =>
      applyMissingAccounts({
        ...observed,
        plan: [{ id: excluded, action: 'insert' }],
        source: [{ id: excluded }],
        maintenance,
        options,
      }),
    () =>
      applyLegacyRelations({
        ...observed,
        plan: signed({
          scope: { ownerUserIds: [excluded] },
          bindings: [],
          insert: { conversations: [], participants: [], states: [], contacts: [] },
        }),
        maintenance,
        options,
      }),
    () =>
      applyFavoriteSources({
        ...observed,
        plan: signed({ userIds: [excluded], insert: [], links: [] }),
        maintenance,
        options,
      }),
    () =>
      applyEntitlementDelta({
        ...observed,
        plan: signed({ userId: excluded }),
        maintenance,
        options,
      }),
    () =>
      applyGroupMemoryDelta({
        ...observed,
        plan: signed({ binding: { ownerUserId: excluded, legacyOwnerUserId: excluded } }),
        maintenance,
        options,
      }),
    () =>
      applyLegacyPreferences({
        ...observed,
        plan: signed({
          scope: { ownerUserIds: [excluded] },
          changes: [],
          candidates: [],
          pending: [],
        }),
        maintenance,
        options,
      }),
    () =>
      applySharedGroupMemoryFixture({
        ...observed,
        input: { sourceAccountId: excluded },
        service: {
          database: lab.database,
          importBatch: () => {
            throw new Error('MUST_NOT_DELEGATE');
          },
        },
        maintenance,
        options,
      }),
  ];
  for (const execute of calls) {
    await assert.rejects(execute, category);
    assert.equal(await snapshot(), baseline);
    assert.equal(writes, 0);
  }
  // Re-sign every declared plan owner as allowed. The actual target conversation still wins.
  const forged = structuredClone(plan);
  delete forged.digest;
  forged.ownerUserId = allowed;
  forged.newMessages.forEach((row) => (row.owner_user_id = allowed));
  forged.states.forEach((row) => (row.user_id = allowed));
  forged.participants.filter((row) => row.kind === 'user').forEach((row) => (row.ref_id = allowed));
  await assert.rejects(
    applyConversationDelta({
      ...observed,
      plan: signed(forged),
      validateContent,
      maintenance,
      options,
    }),
    category,
  );
  assert.equal(await snapshot(), baseline);
  assert.equal(writes, 0);
  const sourceRelations = [
    {
      sourceKey: 'synthetic-allowed-official',
      ownerUserId: allowed,
      kind: 'official',
      createdAt: cutoff,
    },
  ];
  const targetBaseline = await readLegacyRelationsBaseline({ ...lab, sourceRelations });
  const relations = planLegacyRelations({
    sourceRelations,
    targetBaseline,
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
  });
  assert.equal(relations.conflicts.length, 0);
  delete relations.digest;
  relations.insert.states.push({
    user_id: allowed,
    conversation_id: conversation.id,
    hidden: false,
  });
  await assert.rejects(
    applyLegacyRelations({ ...observed, plan: signed(relations), maintenance, options }),
    category,
  );
  assert.equal(writes, 0);
  assert.equal(await snapshot(), baseline);
  const current = await readConversationBaseline(lab.database, conversation.id);
  assert.equal(current.conversation.owner_user_id, excluded);
});
