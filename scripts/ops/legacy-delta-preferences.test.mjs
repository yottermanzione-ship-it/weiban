import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fingerprint, invariant } from './legacy-delta-core.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import {
  openLab,
  addFixtureUser,
  addFixtureConversation,
  cutoff,
  maintenance,
} from './legacy-delta-lab.mjs';
import {
  normalizeLegacyPreferences,
  preferenceMediaReferenceDigest,
  preferenceNewAccountRequirements,
  planLegacyPreferences,
  readLegacyPreferencesBaseline,
  initializePreferenceFixture,
  applyLegacyPreferences,
} from './legacy-delta-preferences.mjs';

const OWNER = legacyId('preferences-test', 'owner'),
  PEER = legacyId('preferences-test', 'peer');
const CONV = legacyId('preferences-test', 'conversation'),
  CONTACT = legacyId('preferences-test', 'contact');
const proof = (name) => fingerprint(['synthetic-only', name]);
const sourceId = 'synthetic-legacy-owner';
const refs = {
  chatBackgrounds: '/generated/synthetic/background.png',
  friendAvatars: '/generated/synthetic/avatar.png',
  momentsCover: '/generated/synthetic/cover.png',
};
const purposes = {
  chatBackgrounds: 'chat_background',
  friendAvatars: 'contact_avatar',
  momentsCover: 'moments_cover',
};
const mediaFor = (owner = OWNER) =>
  Object.entries(purposes).map(([section, purpose]) => ({
    ownerUserId: owner,
    referenceDigest: preferenceMediaReferenceDigest(refs[section]),
    purpose,
    mediaId: legacyId('preferences-test', owner, section),
    state: 'ready',
    contentHash: proof(section),
    readyProofDigest: proof(`ready:${section}`),
  }));
const bindingFor = (owner = OWNER, character = PEER, conversation = CONV) => ({
  sourceUserId: sourceId,
  ownerUserId: owner,
  characters: { 合成角色: [character] },
  conversations: { 'single:合成角色': [conversation], 合成角色: [conversation] },
});
const document = () => ({
  v: 1,
  remarks: { 合成角色: '合成备注' },
  chatFlags: {
    'single:合成角色': { name: '合成角色', isGroup: false, isPinned: true, isMuted: true },
  },
  chatBackgrounds: { 合成角色: refs.chatBackgrounds },
  friendAvatars: { 合成角色: refs.friendAvatars },
  momentsCover: refs.momentsCover,
});
function emptySnapshot() {
  return {
    users: [],
    profiles: [],
    contacts: [],
    characters: [],
    conversations: [],
    participants: [],
    states: [],
    media: [],
  };
}
function snapshot() {
  return {
    users: [{ id: OWNER, status: 'active', created_at: cutoff }],
    profiles: [{ user_id: OWNER, moments_cover_media_id: null, updated_at: cutoff }],
    contacts: [
      {
        id: CONTACT,
        user_id: OWNER,
        character_id: PEER,
        status: 'active',
        remark: null,
        custom_avatar_media_id: null,
        conversation_id: CONV,
        deleted_at: null,
        purge_after: null,
      },
    ],
    characters: [
      { id: PEER, kind: 'preset', owner_id: null, status: 'published', is_trial: false },
    ],
    conversations: [
      {
        id: CONV,
        owner_user_id: OWNER,
        type: 'direct',
        character_id: PEER,
        official_identity_key: null,
        archived_at: null,
        trial_expires_at: null,
      },
    ],
    participants: [
      {
        id: legacyId('preferences-test', 'participant'),
        conversation_id: CONV,
        kind: 'user',
        ref_id: OWNER,
        left_at: null,
      },
    ],
    states: [
      {
        conversation_id: CONV,
        user_id: OWNER,
        pinned: false,
        muted: false,
        hidden: false,
        cleared_through_seq: '0',
        read_seq: '0',
        marked_unread: false,
        background_media_id: null,
      },
    ],
    media: mediaFor().map((row) => ({
      id: row.mediaId,
      owner_id: OWNER,
      purpose: row.purpose,
      state: 'ready',
      content_hash: row.contentHash,
      expires_at: null,
    })),
  };
}
function input(doc = document()) {
  const targetBaseline = snapshot();
  return {
    sources: [{ sourceUserId: sourceId, document: doc }],
    bindings: [bindingFor()],
    mediaReady: mediaFor(),
    initialBaseline: {
      sources: [{ sourceUserId: sourceId, document: {} }],
      target: structuredClone(targetBaseline),
    },
    targetBaseline,
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
  };
}
function approve(options) {
  const first = planLegacyPreferences(options);
  return {
    ...options,
    decisions: Object.fromEntries(
      first.candidates.map((candidate) => [
        candidate.fieldKey,
        {
          action: 'apply-reviewed',
          candidateDigest: candidate.candidateDigest,
          proofDigest: proof('explicit-field-review'),
          noTargetEditProofDigest: proof('complete-target-edit-history-reviewed'),
        },
      ]),
    ),
  };
}
const reason = (plan, code) =>
  assert.ok(plan.summary.classifications[code] > 0, `${code}: ${JSON.stringify(plan.summary)}`);
const v2 = (entries, projection = {}) => ({ v: 2, ...projection, _sync: { v: 1, entries } });
const entry = (value, deleted = false, revisedAt = 10) => ({
  value,
  deleted,
  revisedAt,
  writer: 'synthetic-writer',
});

test('v2 authority comes from _sync, preserving tombstones instead of stale projections', () => {
  const normalized = normalizeLegacyPreferences(
    v2(
      { remarks: { 合成角色: entry(null, true) }, momentsCover: { value: entry(null, true) } },
      { remarks: { 合成角色: 'stale' }, momentsCover: '/generated/stale.png' },
    ),
  );
  assert.equal(normalized.version, 2);
  assert.equal(normalized.entries.length, 2);
  assert.ok(normalized.entries.every((row) => row.deleted && row.value === null));
  assert.deepEqual(normalizeLegacyPreferences({ remarks: {} }).entries, []);
  assert.deepEqual(normalizeLegacyPreferences({ momentsCover: null }).entries, []);
});

test('v1 values map to exactly six existing target fields only after explicit review', () => {
  const first = planLegacyPreferences(input());
  assert.equal(first.changes.length, 0);
  reason(first, 'field_review_required');
  const plan = planLegacyPreferences(approve(input()));
  assert.equal(plan.summary.ok, true);
  assert.equal(plan.changes.length, 6);
  assert.deepEqual(
    new Set(plan.changes.map((row) => row.field)),
    new Set([
      'remark',
      'pinned',
      'muted',
      'background_media_id',
      'custom_avatar_media_id',
      'moments_cover_media_id',
    ]),
  );
  assert.equal(plan.summary.productionReady, false);
});

test('source missing entries never delete target values, including missing legacy keys', () => {
  const options = input({});
  options.targetBaseline.contacts[0].remark = '合成新版备注';
  options.initialBaseline.sources[0].document = { remarks: { 合成角色: '旧值' } };
  const plan = planLegacyPreferences(options);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.summary.ok, true);
});

test('reviewed tombstones clear exact unchanged fields, without restoring prior tombstones', () => {
  const options = input(
    v2({
      remarks: { 合成角色: entry(null, true) },
      chatFlags: { 'single:合成角色': entry(null, true) },
      chatBackgrounds: { 合成角色: entry(null, true) },
    }),
  );
  options.targetBaseline.contacts[0].remark = '合成旧备注';
  options.targetBaseline.states[0].pinned = true;
  options.targetBaseline.states[0].muted = true;
  options.targetBaseline.states[0].background_media_id = options.mediaReady[0].mediaId;
  options.initialBaseline.target = structuredClone(options.targetBaseline);
  reason(planLegacyPreferences(options), 'field_review_required');
  const plan = planLegacyPreferences(approve(options));
  assert.equal(plan.changes.length, 4);
  assert.ok(plan.changes.every((row) => row.value === null || row.value === false));
  const revived = input({ remarks: { 合成角色: '不可复活' } });
  revived.initialBaseline.sources[0].document = v2({ remarks: { 合成角色: entry(null, true) } });
  reason(planLegacyPreferences(approve(revived)), 'initial_source_tombstone_preserved');
});

test('new target edits always win even if an operator supplies an apply decision', () => {
  const options = input({ remarks: { 合成角色: '旧源值' } });
  options.targetBaseline.contacts[0].remark = '新版后来编辑';
  const plan = planLegacyPreferences(approve(options));
  assert.equal(plan.changes.length, 0);
  reason(plan, 'target_new_edit_preserved');
});

test('hidden, cleared, archived, left and permanently deleted relations never get preference writes', () => {
  for (const mutate of [
    (x) => (x.targetBaseline.states[0].hidden = true),
    (x) => (x.targetBaseline.states[0].cleared_through_seq = '2'),
    (x) => (x.targetBaseline.conversations[0].archived_at = cutoff),
    (x) => (x.targetBaseline.participants[0].left_at = cutoff),
    (x) => (x.protection.purgedConversationIds = [CONV]),
    (x) => (x.protection.leftParticipantIds = [x.targetBaseline.participants[0].id]),
  ]) {
    const options = input({ remarks: { 合成角色: '旧源值' }, chatFlags: document().chatFlags });
    mutate(options);
    assert.equal(planLegacyPreferences(approve(options)).changes.length, 0);
  }
  const deleted = input({ remarks: { 合成角色: '旧源值' } });
  deleted.targetBaseline.contacts[0].status = 'deleted';
  reason(planLegacyPreferences(deleted), 'deleted_or_missing_contact_preserved');
  const left = input({ chatFlags: document().chatFlags });
  left.targetBaseline.participants.push({
    id: randomUUID(),
    conversation_id: CONV,
    kind: 'character',
    ref_id: PEER,
    left_at: cutoff,
  });
  reason(planLegacyPreferences(left), 'left_member_preserved');
});

test('new-account defaults require a source/absence/current-default proof, not just null fields', () => {
  const options = input();
  options.initialBaseline.target = emptySnapshot();
  reason(planLegacyPreferences(approve(options)), 'new_account_default_proof_required');
  options.newAccountDefaults = {
    [OWNER]: {
      ...preferenceNewAccountRequirements({
        ownerUserId: OWNER,
        source: options.sources[0],
        initialTarget: options.initialBaseline.target,
        targetBaseline: options.targetBaseline,
      }),
      proofDigest: proof('new-account-default-provenance'),
      noTargetEditProofDigest: proof('unchanged-since-account-default-creation'),
    },
  };
  const plan = planLegacyPreferences(options);
  assert.equal(plan.changes.length, 6);
  assert.equal(plan.summary.ok, true);
  options.targetBaseline.contacts[0].remark = 'new';
  reason(planLegacyPreferences(options), 'new_account_default_proof_required');
});

test('review fingerprints bind source, initial target and current target independently', () => {
  for (const mutate of [
    (x) => (x.sources[0].document.remarks['合成角色'] = '变更源'),
    (x) => (x.initialBaseline.sources[0].document = { remarks: { 合成角色: '变更初始源' } }),
    (x) => (x.targetBaseline.profiles[0].updated_at = '2026-11-08T01:00:00Z'),
  ]) {
    const options = approve(input({ remarks: { 合成角色: '旧源值' } }));
    mutate(options);
    reason(planLegacyPreferences(options), 'review_fingerprint_mismatch');
  }
});

test('remarks over 20 UTF-16 code units are classified, never truncated', () => {
  const plan = planLegacyPreferences(input({ remarks: { 合成角色: '长'.repeat(21) } }));
  reason(plan, 'remark_exceeds_20_characters');
  assert.equal(plan.changes.length, 0);
});

test('matching values are insufficient proof of no target edit and an edit ledger blocks round-trip changes', () => {
  const options = approve(input({ remarks: { 合成角色: '待审源值' } }));
  const key = Object.keys(options.decisions)[0];
  delete options.decisions[key].noTargetEditProofDigest;
  reason(planLegacyPreferences(options), 'target_edit_history_proof_required');
  options.protection.editedFieldKeys = [key];
  const plan = planLegacyPreferences(approve(options));
  reason(plan, 'target_edit_ledger_preserved');
  assert.equal(plan.changes.length, 0);
});

test('explicit live nulls clear remark/cover only with review, while unsupported sync versions block', () => {
  const options = input(
    v2({ remarks: { 合成角色: entry(null) }, momentsCover: { value: entry(null) } }),
  );
  options.targetBaseline.contacts[0].remark = '旧备注';
  options.targetBaseline.profiles[0].moments_cover_media_id = options.mediaReady[2].mediaId;
  options.initialBaseline.target = structuredClone(options.targetBaseline);
  assert.equal(planLegacyPreferences(approve(options)).changes.length, 2);
  reason(
    planLegacyPreferences(input({ _sync: { v: 99, entries: {} } })),
    'invalid_preference_document',
  );
});

test('same clock/writer cannot replace a v2 value and mapped contacts must own their direct conversation', () => {
  const options = input(v2({ remarks: { 合成角色: entry('改写') } }));
  options.initialBaseline.sources[0].document = v2({ remarks: { 合成角色: entry('原值') } });
  reason(planLegacyPreferences(options), 'source_clock_equivocation');
  const wrong = input({ remarks: { 合成角色: '备注' } });
  wrong.targetBaseline.conversations[0].character_id = randomUUID();
  reason(planLegacyPreferences(wrong), 'contact_conversation_mapping_mismatch');
});

test('explicit mappings reject ambiguity, foreign/private roles and duplicate destination fields', () => {
  const ambiguous = input();
  ambiguous.bindings[0].characters['合成角色'].push(randomUUID());
  reason(planLegacyPreferences(ambiguous), 'ambiguous_or_missing_identity_mapping');
  const foreign = input();
  foreign.targetBaseline.characters[0] = {
    ...foreign.targetBaseline.characters[0],
    kind: 'custom',
    owner_id: randomUUID(),
  };
  reason(planLegacyPreferences(foreign), 'character_dependency_or_owner_invalid');
  const duplicates = input({ remarks: { 合成角色: '一', alias: '二' } });
  duplicates.bindings[0].characters.alias = [PEER];
  reason(planLegacyPreferences(approve(duplicates)), 'duplicate_target_field');
  const wrongKey = input({ chatFlags: { 合成角色: document().chatFlags['single:合成角色'] } });
  delete wrongKey.bindings[0].conversations['合成角色'];
  reason(planLegacyPreferences(wrongKey), 'ambiguous_or_missing_identity_mapping');
});

test('media needs exact reference, owner, purpose, hash, ready proof and persistent ready object', () => {
  for (const mutate of [
    (x) => (x.mediaReady[0].referenceDigest = proof('different-reference')),
    (x) => (x.targetBaseline.media[0].owner_id = randomUUID()),
    (x) => (x.targetBaseline.media[0].purpose = 'chat_image'),
    (x) => (x.targetBaseline.media[0].state = 'pending'),
    (x) => (x.targetBaseline.media[0].content_hash = proof('other-content')),
    (x) => (x.targetBaseline.media[0].expires_at = cutoff),
    (x) => delete x.mediaReady[0].readyProofDigest,
  ]) {
    const options = input({ chatBackgrounds: document().chatBackgrounds });
    mutate(options);
    const plan = planLegacyPreferences(options);
    assert.equal(plan.summary.ok, false);
    assert.equal(plan.changes.length, 0);
  }
});

test('nicknames, tags, empty starred cancellation and unknown sections are explicit pending dispositions', () => {
  const plan = planLegacyPreferences(
    input(
      v2(
        {
          nicknames: { 合成角色: entry('服务端缓存昵称') },
          tags: { 合成标签: entry(['合成角色'], true) },
        },
        { starred: { v: 2, names: [], revisedAt: 10 }, unknownPreference: 'private' },
      ),
    ),
  );
  assert.equal(plan.pending.length, 4);
  assert.equal(plan.changes.length, 0);
  for (const name of [
    'nickname_source_cache_not_address_as',
    'tags_pending_disposition',
    'starred_pending_disposition',
    'unknown_section_pending_disposition',
  ])
    reason(plan, name);
  assert.equal(
    plan.candidates.some((row) => row.field === 'address_as'),
    false,
  );
});

test('malformed/version-regressed source is blocked and public summaries contain no identities or values', () => {
  const options = input(
    v2({ remarks: { 合成角色: entry('synthetic-sensitive-value', false, 2) } }),
  );
  options.initialBaseline.sources[0].document = v2({
    remarks: { 合成角色: entry('old', false, 5) },
  });
  reason(planLegacyPreferences(options), 'source_clock_regressed');
  const malformed = input(v2({ remarks: [] }));
  reason(planLegacyPreferences(malformed), 'invalid_preference_document');
  const summary = JSON.stringify(planLegacyPreferences(approve(input())).summary);
  for (const secret of [OWNER, PEER, sourceId, '合成角色', '合成备注', ...Object.values(refs)])
    assert.equal(summary.includes(secret), false);
});

const url = process.env.MIGRATION_PREFERENCES_DATABASE_URL;
invariant(
  [
    'postgres://postgres@127.0.0.1:56389/codex_migration_preferences_1109',
    'postgres://postgres@127.0.0.1:56389/codex_migration_preservation_1109',
  ].includes(url),
  'EXPLICIT_PREFERENCE_FIXTURE_URL_REQUIRED',
);
let lab;
before(async () => {
  lab = await openLab(url);
  await initializePreferenceFixture(lab);
});
after(async () => {
  await lab?.close();
});

async function dbFixture() {
  const owner = (await addFixtureUser(lab)).id;
  const convo = await addFixtureConversation(lab, { owner, oldCount: 0 });
  await lab.database.query(
    `INSERT INTO characters.characters(id,kind,owner_id,status,name,search_text,basis,age_setting,child_appearance,child_features_detected,legacy_card,checks,created_at,updated_at,is_trial) VALUES($1,'preset',NULL,'published','合成偏好角色','synthetic','original','adult',false,false,'{"synthetic":true}','{}',$2,$2,false)`,
    [convo.peer, cutoff],
  );
  await lab.database.query(
    `INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type) VALUES($1,$2,$3,'active',$4,'restored',$5,'2026-11-09',$5,$6,'朋友')`,
    [randomUUID(), owner, convo.peer, randomUUID(), cutoff, convo.id],
  );
  const mediaReady = mediaFor(owner);
  for (const media of mediaReady)
    await lab.database.query(
      `INSERT INTO media.objects(id,owner_id,purpose,mime_type,size_bytes,width,height,storage_key,state,created_at,content_hash) VALUES($1,$2,$3,'image/png',8,1,1,$4,'ready',$5,$6)`,
      [
        media.mediaId,
        owner,
        media.purpose,
        `synthetic-only:${media.mediaId}`,
        cutoff,
        media.contentHash,
      ],
    );
  const bindings = [bindingFor(owner, convo.peer, convo.id)];
  const targetBaseline = await readLegacyPreferencesBaseline({ ...lab, bindings, mediaReady });
  const sources = [{ sourceUserId: sourceId, document: document() }];
  return {
    owner,
    convo,
    sources,
    bindings,
    mediaReady,
    targetBaseline,
    initialBaseline: {
      sources: [{ sourceUserId: sourceId, document: {} }],
      target: structuredClone(targetBaseline),
    },
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
  };
}
const readCurrent = (fixture) =>
  readLegacyPreferencesBaseline({
    ...lab,
    bindings: fixture.bindings,
    mediaReady: fixture.mediaReady,
  });
const apply = (plan, extra = {}) => applyLegacyPreferences({ ...lab, plan, maintenance, ...extra });
async function eventCounts() {
  const tables = (
    await lab.database.query(
      "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema','public') AND (table_schema='sync' OR table_name ILIKE '%outbox%' OR table_name ILIKE '%ledger%' OR table_name ILIKE '%charge%' OR table_name IN ('reply_plans','group_reply_plans','sync_events')) ORDER BY table_schema,table_name",
    )
  ).rows;
  const result = [];
  for (const row of tables) {
    assert.match(row.table_schema, /^[a-z_]+$/);
    assert.match(row.table_name, /^[a-z_]+$/);
    result.push({
      table: `${row.table_schema}.${row.table_name}`,
      count: Number(
        (
          await lab.database.query(
            `SELECT count(*) AS n FROM ${row.table_schema}.${row.table_name}`,
          )
        ).rows[0].n,
      ),
    });
  }
  return result;
}

test('real PostgreSQL applies six exact fields without notifications, ledger entries or AI work and retries idempotently', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture)),
    events = await eventCounts();
  assert.equal(plan.summary.ok, true);
  assert.equal(plan.changes.length, 6);
  assert.equal((await apply(plan)).changedFields, 6);
  const current = await readCurrent(fixture);
  assert.equal(current.contacts[0].remark, '合成备注');
  assert.equal(current.contacts[0].custom_avatar_media_id, fixture.mediaReady[1].mediaId);
  assert.equal(current.states[0].pinned, true);
  assert.equal(current.states[0].muted, true);
  assert.equal(current.states[0].background_media_id, fixture.mediaReady[0].mediaId);
  assert.equal(current.profiles[0].moments_cover_media_id, fixture.mediaReady[2].mediaId);
  assert.deepEqual(await eventCounts(), events);
  assert.deepEqual(await apply(plan), {
    status: 'already_applied',
    changedFields: 0,
    changedAfterImportPreserved: 0,
    pending: 0,
  });
});

test('real target change after planning is caught under lock before any field is written', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  await lab.database.query('UPDATE contacts.contacts SET remark=$1 WHERE user_id=$2', [
    '合成并发新编辑',
    fixture.owner,
  ]);
  await assert.rejects(apply(plan), /PREFERENCE_TARGET_CHANGED_REPLAN_REQUIRED/);
  const current = await readCurrent(fixture);
  assert.equal(current.contacts[0].remark, '合成并发新编辑');
  assert.equal(current.states[0].pinned, false);
  const refreshed = planLegacyPreferences(approve({ ...fixture, targetBaseline: current }));
  reason(refreshed, 'target_new_edit_preserved');
});

test('real reviewed tombstones clear six preferences without deleting original media', async () => {
  const fixture = await dbFixture();
  await apply(planLegacyPreferences(approve(fixture)));
  const baseline = await readCurrent(fixture),
    beforeMedia = fingerprint(baseline.media);
  const tombstones = v2({
    remarks: { 合成角色: entry(null, true, 20) },
    chatFlags: { 'single:合成角色': entry(null, true, 20) },
    chatBackgrounds: { 合成角色: entry(null, true, 20) },
    friendAvatars: { 合成角色: entry(null, true, 20) },
    momentsCover: { value: entry(null, true, 20) },
  });
  const next = {
    ...fixture,
    targetBaseline: baseline,
    initialBaseline: { sources: fixture.sources, target: structuredClone(baseline) },
    sources: [{ sourceUserId: sourceId, document: tombstones }],
  };
  reason(planLegacyPreferences(next), 'field_review_required');
  assert.equal((await apply(planLegacyPreferences(approve(next)))).changedFields, 6);
  const current = await readCurrent(fixture);
  assert.equal(current.contacts[0].remark, null);
  assert.equal(current.contacts[0].custom_avatar_media_id, null);
  assert.equal(current.states[0].pinned, false);
  assert.equal(current.states[0].muted, false);
  assert.equal(current.states[0].background_media_id, null);
  assert.equal(current.profiles[0].moments_cover_media_id, null);
  assert.equal(fingerprint(current.media), beforeMedia);
});

test('real failure after partial writes rolls fields and receipts back in the same transaction', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  await assert.rejects(
    apply(plan, {
      fault: (phase, index) => {
        if (phase === 'after_field' && index === 2) throw new Error('SYNTHETIC_INTERRUPTION');
      },
    }),
    /SYNTHETIC_INTERRUPTION/,
  );
  assert.equal(fingerprint(await readCurrent(fixture)), fingerprint(fixture.targetBaseline));
  assert.equal(
    Number(
      (
        await lab.database.query(
          'SELECT count(*) AS n FROM public.codex_migration_preference_receipts WHERE plan_digest=$1',
          [plan.digest],
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal((await apply(plan)).changedFields, 6);
});

test('concurrent identical plans serialize to one apply and one verified replay', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  const results = await Promise.all([apply(plan), apply(plan)]);
  assert.deepEqual(results.map((row) => row.status).sort(), ['already_applied', 'applied']);
});

test('replay preserves edits made after successful import and refuses a damaged receipt', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  await apply(plan);
  await lab.database.query('UPDATE contacts.contacts SET remark=$1 WHERE user_id=$2', [
    '成功导入后的新编辑',
    fixture.owner,
  ]);
  const retry = await apply(plan);
  assert.equal(retry.changedAfterImportPreserved, 1);
  assert.equal((await readCurrent(fixture)).contacts[0].remark, '成功导入后的新编辑');
  await lab.database.query(
    'DELETE FROM public.codex_migration_preference_fields WHERE field_key=$1 AND candidate_digest=$2',
    [plan.changes[0].fieldKey, plan.changes[0].candidateDigest],
  );
  await assert.rejects(apply(plan), /PREFERENCE_RECEIPT_MISMATCH/);
});

test('media invalidation after planning blocks the whole real transaction', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  await lab.database.query("UPDATE media.objects SET state='deleted' WHERE id=$1", [
    fixture.mediaReady[0].mediaId,
  ]);
  await assert.rejects(apply(plan), /PREFERENCE_TARGET_CHANGED_REPLAN_REQUIRED/);
  assert.equal((await readCurrent(fixture)).contacts[0].remark, null);
});

test('real new-account provenance imports defaults but preserves pending tag/star dispositions', async () => {
  const fixture = await dbFixture();
  fixture.initialBaseline.target = emptySnapshot();
  fixture.sources[0].document.tags = { 合成标签: ['合成角色'] };
  fixture.sources[0].document.starred = { v: 2, names: ['合成角色'], revisedAt: 1 };
  fixture.newAccountDefaults = {
    [fixture.owner]: {
      ...preferenceNewAccountRequirements({
        ownerUserId: fixture.owner,
        source: fixture.sources[0],
        initialTarget: fixture.initialBaseline.target,
        targetBaseline: fixture.targetBaseline,
      }),
      proofDigest: proof('synthetic-new-default-provenance'),
      noTargetEditProofDigest: proof('unchanged-since-account-default-creation'),
    },
  };
  const plan = planLegacyPreferences(fixture);
  assert.equal(plan.summary.ok, true);
  assert.equal(plan.pending.length, 2);
  assert.equal((await apply(plan)).pending, 2);
});

test('fixture guard rejects production, wrong database, mismatched connection and missing maintenance before updates', async () => {
  const fixture = await dbFixture(),
    plan = planLegacyPreferences(approve(fixture));
  await assert.rejects(
    applyLegacyPreferences({
      ...lab,
      plan,
      maintenance,
      target: { kind: 'production', synthetic: false, url },
    }),
    /ISOLATED_FIXTURE_REQUIRED/,
  );
  await assert.rejects(
    applyLegacyPreferences({
      ...lab,
      plan,
      maintenance,
      target: {
        ...lab.target,
        url: url.replace(/codex_migration_[a-z0-9_]+$/, 'codex_migration_wrong_domain_1109'),
      },
    }),
    /DEDICATED_PREFERENCE_FIXTURE_REQUIRED/,
  );
  await assert.rejects(
    applyLegacyPreferences({
      ...lab,
      plan,
      maintenance,
      target: { ...lab.target, url: url.replace('56389', '5432') },
    }),
    /PREFERENCE_FIXTURE_ENDPOINT_REQUIRED/,
  );
  const fake = {
    pool: { options: { connectionString: 'postgres://wrong' } },
    query: () => {
      throw new Error('MUST_NOT_QUERY');
    },
  };
  await assert.rejects(
    applyLegacyPreferences({ database: fake, target: lab.target, plan, maintenance }),
    /DATABASE_CONNECTION_MISMATCH/,
  );
  await assert.rejects(
    apply(plan, { maintenance: { writersStopped: true } }),
    /PREFERENCE_MAINTENANCE_REQUIRED/,
  );
  const tampered = structuredClone(plan);
  tampered.changes[0].value = 'tamper';
  await assert.rejects(apply(tampered), /PREFERENCE_PLAN_DIGEST_MISMATCH/);
});
