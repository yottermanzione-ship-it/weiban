import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fingerprint } from './legacy-delta-core.mjs';
import {
  initializeGroupMemoryFixture,
  readGroupMemoryBaseline,
  planGroupMemoryDelta,
  applyGroupMemoryDelta,
} from './legacy-delta-group-memory.mjs';

const requireServer = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const unregister = requireServer('tsx/esm/api').register({
  tsconfig: fileURLToPath(new URL('../../apps/server/tsconfig.json', import.meta.url)),
});
const { MemoryPayload, healthPrivate } =
  await import('../../apps/server/src/modules/ai-runtime/domain/memory.ts');
const { MemoryEntry } = await import('../../packages/contracts/src/http/memory.ts');
const validatePayload = (value) => MemoryPayload.parse(value);
const cutoff = '2026-11-09T00:00:00.000Z';
const review = {
  synthetic: true,
  ownershipVerified: true,
  historicalAudienceVerified: true,
  normalScopeVerified: true,
  deletionAuditComplete: true,
  noPriorForget: true,
  missingSourceMessageIdsAccepted: true,
  decisionId: 'synthetic-group-memory-review',
  classificationByType: { fact: { category: 'basic', importance: 5 } },
};
const source = (groupId, override = {}) => ({
  id: randomUUID(),
  group_id: groupId,
  mem_type: 'fact',
  content: 'Synthetic group agreed to meet at a public library.',
  confidence: 0.8,
  enabled: 1,
  source: 'auto',
  created_at: cutoff,
  subject_character_id: '',
  supersedes_id: '',
  provenance_json: '{"scene_type":"group","source":"auto"}',
  ...override,
});
function example() {
  const owner = randomUUID(),
    character = randomUUID(),
    group = randomUUID(),
    direct = randomUUID();
  const binding = {
    ownerUserId: owner,
    legacyOwnerUserId: owner,
    characterId: character,
    groupConversationId: group,
    directConversationId: direct,
    sourceGroupId: 'synthetic-old-group',
    legacySubjectCharacterId: 'synthetic-subject',
  };
  const conversation = { owner_user_id: owner, content_scope: 'normal', archived_at: null };
  const baseline = {
    owner: { id: owner, status: 'active' },
    group: { ...conversation, id: group, type: 'group' },
    direct: { ...conversation, id: direct, type: 'direct', character_id: character },
    states: [
      { hidden: false, cleared_through_seq: 0 },
      { hidden: false, cleared_through_seq: 0 },
    ],
    participants: [
      { kind: 'user', ref_id: owner, joined_at: cutoff, left_at: null },
      { kind: 'character', ref_id: character, joined_at: cutoff, left_at: null },
    ],
    contact: {
      status: 'active',
      conversation_id: direct,
      acceptance_mode: 'restored',
      accept_after: cutoff,
      deleted_at: null,
    },
    groupMemory: null,
    memoryState: null,
    memories: [],
    receipts: [],
  };
  return {
    binding,
    baseline,
    sourceGroup: { id: binding.sourceGroupId, user_id: owner, archived: 0 },
    review,
    finalCutoff: cutoff,
    validatePayload,
    healthPrivate,
  };
}

test('explicitly reviewed source maps to the actual target payload without invented message IDs', () => {
  const input = example(),
    row = source(input.binding.sourceGroupId);
  const plan = planGroupMemoryDelta({ ...input, rows: [row, row] });
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.inserts.length, 1);
  assert.deepEqual(MemoryPayload.parse(plan.inserts[0].payload), {
    content: row.content,
    category: 'basic',
    status: 'current',
    importance: 5,
    dueAt: null,
    visibility: 'only_this_character',
    sharingClass: 'never',
    sourceMessageIds: [],
    createdBy: 'extracted',
  });
  assert.equal(plan.skipped[0].reason, 'duplicate_source');
  assert.equal(
    planGroupMemoryDelta({ ...input, rows: [source(input.binding.sourceGroupId, { enabled: 0 })] })
      .inserts.length,
    0,
  );
});

test('missing audience, free-text type, scope, correction chain and unknown provenance are blocked', () => {
  const input = example();
  for (const overrides of [
    { mem_type: 'unmapped free text' },
    { source: '' },
    { enabled: null },
    { supersedes_id: randomUUID() },
    { subject_character_id: 'unmapped-character' },
    { provenance_json: '{"private_scope":"unknown"}' },
    { content: 'Synthetic menstrual health fact' },
    { content: 'x'.repeat(1001) },
  ]) {
    assert.ok(
      planGroupMemoryDelta({ ...input, rows: [source(input.binding.sourceGroupId, overrides)] })
        .blocked.length > 0,
    );
  }
  for (const field of [
    'ownershipVerified',
    'historicalAudienceVerified',
    'normalScopeVerified',
    'deletionAuditComplete',
    'noPriorForget',
    'missingSourceMessageIdsAccepted',
  ]) {
    assert.ok(
      planGroupMemoryDelta({
        ...input,
        review: { ...review, [field]: false },
        rows: [source(input.binding.sourceGroupId)],
      }).blocked.length > 0,
    );
  }
});

test('native memory, clear/hide, membership recreation and group progress are never overwritten', () => {
  const input = example();
  for (const mutate of [
    (b) => {
      b.memories.push({ id: randomUUID() });
    },
    (b) => {
      b.states[0].cleared_through_seq = 1;
    },
    (b) => {
      b.states[1].hidden = true;
    },
    (b) => {
      b.contact.acceptance_mode = 'fresh_after_delete';
    },
    (b) => {
      b.memoryState = { revision: 1 };
    },
    (b) => {
      b.groupMemory = { generation: 1 };
    },
    (b) => {
      b.participants[1].left_at = cutoff;
    },
  ]) {
    const baseline = structuredClone(input.baseline);
    mutate(baseline);
    assert.ok(
      planGroupMemoryDelta({ ...input, baseline, rows: [source(input.binding.sourceGroupId)] })
        .blocked.length > 0,
    );
  }
});

const url = process.env.MIGRATION_GROUP_MEMORY_DATABASE_URL;
describe('actual group memory schema, EnvelopeCrypto and protected states', { skip: !url }, () => {
  let lab, helpers;
  const maintenance = { writersStopped: true, notificationsCaptured: true };
  before(async () => {
    assert.ok(
      ['/codex_migration_group_memory_1109', '/codex_migration_preservation_1109'].includes(
        new URL(url).pathname,
      ),
    );
    helpers = await import('./legacy-delta-lab.mjs');
    lab = await helpers.openLab(url);
    await initializeGroupMemoryFixture(lab.database, lab.target);
  });
  after(async () => {
    await lab?.close();
  });
  async function fixture() {
    const owner = (await helpers.addFixtureUser(lab)).id;
    const group = await helpers.addFixtureConversation(lab, { owner, type: 'group', oldCount: 0 });
    const direct = await helpers.addFixtureConversation(lab, { owner, oldCount: 0 });
    await lab.database.query('UPDATE chat.participants SET ref_id=$1 WHERE id=$2', [
      direct.peer,
      group.peerParticipant,
    ]);
    await lab.database.query(
      `INSERT INTO contacts.contacts
      (id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type)
      VALUES($1,$2,$3,'active',$4,'restored',$5,'2026-11-09',$5,$6,'friend')`,
      [randomUUID(), owner, direct.peer, randomUUID(), cutoff, direct.id],
    );
    await lab.database.query(
      `INSERT INTO ai_runtime.group_memory_states(id,user_id,conversation_id,last_user_at)
      VALUES($1,$2,$3,$4)`,
      [randomUUID(), owner, group.id, cutoff],
    );
    await lab.database.query(
      `INSERT INTO ai_runtime.memory_states(id,user_id,character_id,conversation_id,updated_at)
      VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), owner, direct.peer, direct.id, cutoff],
    );
    const binding = {
      ownerUserId: owner,
      legacyOwnerUserId: owner,
      characterId: direct.peer,
      groupConversationId: group.id,
      directConversationId: direct.id,
      sourceGroupId: randomUUID(),
      legacySubjectCharacterId: 'synthetic-subject',
    };
    const row = source(binding.sourceGroupId);
    const makePlan = async (rows = [row]) =>
      planGroupMemoryDelta({
        rows,
        sourceGroup: { id: binding.sourceGroupId, user_id: owner, archived: 0 },
        binding,
        baseline: await readGroupMemoryBaseline(lab.database, binding),
        review,
        finalCutoff: cutoff,
        validatePayload,
        healthPrivate,
      });
    const apply = (plan, fault) =>
      applyGroupMemoryDelta({ ...lab, plan, maintenance, validatePayload, healthPrivate, fault });
    return { owner, group, direct, binding, row, makePlan, apply };
  }
  test('real encrypted insert is idempotent and decrypts only for the owner', async () => {
    const f = await fixture(),
      plan = await f.makePlan();
    assert.deepEqual(plan.blocked, []);
    const before = await readGroupMemoryBaseline(lab.database, f.binding);
    const outcomes = await Promise.all([f.apply(plan), f.apply(plan), f.apply(plan)]);
    assert.equal(outcomes.filter((r) => r.status === 'applied').length, 1);
    const after = await readGroupMemoryBaseline(lab.database, f.binding);
    assert.equal(after.memories.length, 1);
    assert.equal(after.receipts.length, 1);
    assert.equal(after.memories[0].origin, 'group');
    assert.equal(after.memories[0].conversation_id, f.direct.id);
    assert.equal(fingerprint(after.groupMemory), fingerprint(before.groupMemory));
    assert.equal(fingerprint(after.memoryState), fingerprint(before.memoryState));
    const stored = after.memories[0];
    const plain = await lab.crypto.open(f.owner, `ai:memory:${stored.id}`, stored.ciphertext);
    try {
      const payload = MemoryPayload.parse(JSON.parse(plain.toString()));
      assert.equal(payload.content, f.row.content);
      MemoryEntry.parse({
        ...payload,
        memoryId: stored.id,
        characterId: f.direct.peer,
        scope: 'normal',
        origin: 'group',
        knownBy: [f.direct.peer],
        createdAt: stored.created_at.toISOString(),
        updatedAt: stored.updated_at.toISOString(),
      });
    } finally {
      plain.fill(0);
    }
    const other = (await helpers.addFixtureUser(lab)).id;
    await assert.rejects(lab.crypto.open(other, `ai:memory:${stored.id}`, stored.ciphertext));
    assert.equal((await f.makePlan()).inserts.length, 0);
  });
  test('source tombstone survives removal and keeps later target forget barriers unchanged', async () => {
    const f = await fixture();
    await f.apply(await f.makePlan());
    await lab.database.query('DELETE FROM ai_runtime.memories WHERE user_id=$1', [f.owner]);
    await lab.database.query(
      'UPDATE ai_runtime.memory_states SET revision=1,barrier_seq=3 WHERE user_id=$1',
      [f.owner],
    );
    await lab.database.query(
      'UPDATE ai_runtime.group_memory_states SET generation=1 WHERE user_id=$1',
      [f.owner],
    );
    const before = await readGroupMemoryBaseline(lab.database, f.binding),
      plan = await f.makePlan();
    assert.equal(plan.skipped[0].reason, 'removed_target_do_not_resurrect');
    assert.equal((await f.apply(plan)).inserted, 0);
    assert.equal(
      fingerprint(await readGroupMemoryBaseline(lab.database, f.binding)),
      fingerprint(before),
    );
  });
  test('partial insert failure rolls memory and receipt back together; retry inserts once', async () => {
    const f = await fixture(),
      plan = await f.makePlan(),
      before = await readGroupMemoryBaseline(lab.database, f.binding);
    await assert.rejects(f.apply(plan, 'after-memory'), /SYNTHETIC_GROUP_MEMORY_INTERRUPTION/u);
    assert.equal(
      fingerprint(await readGroupMemoryBaseline(lab.database, f.binding)),
      fingerprint(before),
    );
    assert.equal((await f.apply(plan)).inserted, 1);
    assert.equal((await f.apply(plan)).inserted, 0);
  });
  test('post-plan clear/forget and changed source payload refuse writes', async () => {
    const f = await fixture(),
      plan = await f.makePlan();
    await lab.database.query(
      'UPDATE chat.user_conversation_states SET cleared_through_seq=1 WHERE conversation_id=$1',
      [f.group.id],
    );
    await assert.rejects(f.apply(plan), /GROUP_MEMORY_TARGET_CHANGED/u);
    assert.ok((await f.makePlan()).blocked.length > 0);
    const g = await fixture();
    await g.apply(await g.makePlan());
    const changed = await g.makePlan([
      { ...g.row, content: 'Changed source requires reconciliation.' },
    ]);
    assert.equal(changed.blocked[0].reason, 'IMPORTED_SOURCE_CHANGED_REQUIRES_REVIEW');
    await assert.rejects(g.apply(changed), /GROUP_MEMORY_PLAN_BLOCKED/u);
  });
  test('native target memory remains byte-identical and no billing/outbox/jobs are produced', async () => {
    const effects = {};
    for (const table of ['platform.outbox', 'billing.ledger_entries'])
      effects[table] = Number(
        (await lab.database.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
      );
    const pendingBefore = Number(
      (
        await lab.database.query(
          'SELECT sum(pending_count) AS n FROM ai_runtime.group_memory_states',
        )
      ).rows[0].n,
    );
    const f = await fixture(),
      id = randomUUID();
    const payload = validatePayload({
      content: 'Synthetic NEW-site manual memory.',
      category: 'basic',
      importance: 6,
      status: 'current',
      dueAt: null,
      visibility: 'only_this_character',
      sharingClass: 'never',
      sourceMessageIds: [],
      createdBy: 'user_manual',
    });
    await lab.database.transaction(async (tx) => {
      const sealed = await lab.crypto.sealMany(
        f.owner,
        [{ aad: `ai:memory:${id}`, plaintext: JSON.stringify(payload) }],
        tx,
      );
      await tx.query(
        `INSERT INTO ai_runtime.memories(id,user_id,character_id,conversation_id,origin,scope,ciphertext,created_at,updated_at)
        VALUES($1,$2,$3,$4,'private_chat','normal',$5,$6,$6)`,
        [id, f.owner, f.direct.peer, f.direct.id, sealed[0], cutoff],
      );
    });
    const before = await readGroupMemoryBaseline(lab.database, f.binding),
      plan = await f.makePlan();
    assert.ok(
      plan.blocked.some((row) => row.reason === 'EXISTING_NATIVE_MEMORY_REQUIRES_CONFLICT_REVIEW'),
    );
    await assert.rejects(f.apply(plan), /GROUP_MEMORY_PLAN_BLOCKED/u);
    assert.equal(
      fingerprint(await readGroupMemoryBaseline(lab.database, f.binding)),
      fingerprint(before),
    );
    for (const table of ['platform.outbox', 'billing.ledger_entries']) {
      assert.equal(
        Number((await lab.database.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
        effects[table],
      );
    }
    assert.equal(
      Number(
        (
          await lab.database.query(
            'SELECT sum(pending_count) AS n FROM ai_runtime.group_memory_states',
          )
        ).rows[0].n,
      ),
      pendingBefore,
    );
  });
});
after(async () => {
  await unregister();
});
