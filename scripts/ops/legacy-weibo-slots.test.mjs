import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLegacyWeiboSlots } from './legacy-weibo-slots.mjs';
const digest = (n) => n.toString(16).padStart(64, '0');
const row = (slot = 'main', n = 1, owner = 'old-user') => ({
  legacyBindingId: `old-binding-${n}`,
  legacyUserId: owner,
  slot,
  status: 'active',
  personaKey: `role-${n}`,
  appIdFingerprint: digest(n),
  sourceDigest: digest(100 + n),
});
const maps = {
  userMap: { 'old-user': 'new-user', 'other-old': 'other-new' },
  characterMap: Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`old-user:role-${i + 1}`, `character-${i + 1}`]),
  ),
};
const plan = (source, targets = []) => planLegacyWeiboSlots({ source, targets, ...maps });
function proofs(source) {
  return {
    ...source,
    credentialProof: {
      legacyBindingId: source.legacyBindingId,
      legacyUserId: source.legacyUserId,
      appIdFingerprint: source.appIdFingerprint,
      evidenceDigest: digest(201),
      kind: 'protected-decryptable-credentials',
    },
    peerProof: {
      legacyBindingId: source.legacyBindingId,
      legacyUserId: source.legacyUserId,
      appIdFingerprint: source.appIdFingerprint,
      evidenceDigest: digest(202),
      kind: 'authenticated-inbound-peer',
    },
  };
}

test('all five legacy slots remain separately mapped, always disabled and non-executing', () => {
  const result = plan(
    ['main', 'blue', 'white', 'pink', 'yellow'].map((slot, index) => proofs(row(slot, index + 1))),
  );
  assert.equal(result.status, 'candidate-only');
  assert.equal(result.actions.length, 5);
  assert.equal(new Set(result.actions.map((a) => a.characterId)).size, 5);
  assert.ok(
    result.actions.every(
      (a) =>
        a.activate === false &&
        a.execute === false &&
        a.disposition === 'stage-protected-candidate',
    ),
  );
  assert.equal(result.productionReady, false);
});
test('missing custody or peer evidence cannot enable a binding; bot uid is not a peer', () => {
  const source = proofs(row());
  source.peerProof.kind = 'token-bot-uid';
  const a = plan([source]).actions[0];
  assert.equal(a.disposition, 'stage-disabled');
  assert.equal(a.peerAction, 'none');
  assert.ok(a.required.includes('verified-peer-provenance-or-owner-reauthorization'));
  assert.equal(plan([row()]).actions[0].credentialAction, 'none');
});
test('proofs from another binding/user cannot be reused', () => {
  const source = proofs(row());
  source.credentialProof.legacyUserId = 'other-old';
  source.peerProof.legacyBindingId = 'other-binding';
  const a = plan([source]).actions[0];
  assert.equal(a.credentialAction, 'none');
  assert.equal(a.peerAction, 'none');
});
test('unbound/revoked source stays inactive even if it has old credential proofs', () => {
  for (const status of ['unbound', 'revoked']) {
    const a = plan([{ ...proofs(row()), status }]).actions[0];
    assert.equal(a.disposition, 'archive-inactive');
    assert.equal(a.credentialAction, 'none');
    assert.equal(a.activate, false);
  }
});
test('new target bindings and unbound tombstones are preserved without credential replacement', () => {
  for (const status of ['active', 'unbound']) {
    const a = plan(
      [proofs(row())],
      [
        {
          userId: 'new-user',
          slot: 'main',
          status,
          bindingId: 'target-id',
          characterId: 'newer-character',
          appIdFingerprint: digest(999),
        },
      ],
    ).actions[0];
    assert.equal(a.disposition, 'preserve-target');
    assert.equal(a.targetBindingId, 'target-id');
    assert.equal(a.credentialAction, 'none');
  }
});
test('duplicate slots/roles/AppID and target cross-user credentials block, never pick a row', () => {
  const collision = { ...row('main', 2), personaKey: 'role-1', appIdFingerprint: digest(1) };
  assert.deepEqual(plan([row(), collision]).blocked[0].reasons, [
    'ACTIVE_SLOT_COLLISION',
    'ACTIVE_CHARACTER_COLLISION',
    'ACTIVE_APPID_COLLISION',
  ]);
  const result = plan(
    [row()],
    [
      {
        userId: 'other-new',
        slot: 'main',
        status: 'active',
        bindingId: 'other-binding',
        characterId: 'other-role',
        appIdFingerprint: digest(1),
      },
    ],
  );
  assert.ok(result.blocked[0].reasons.includes('TARGET_APPID_OCCUPIED'));
});
test('private values, unknown slots and missing identity mappings fail closed', () => {
  assert.throws(() => plan([{ ...row(), appSecret: 'do-not-accept' }]), /INVALID_OR_PRIVATE/);
  assert.throws(() => plan([{ ...row(), slot: 'sixth' }]), /INVALID_OR_PRIVATE/);
  assert.equal(plan([{ ...row(), legacyUserId: 'unknown' }]).status, 'blocked');
  assert.throws(
    () =>
      plan(
        [row()],
        [
          {
            bindingId: 'target',
            userId: 'new-user',
            slot: 'main',
            status: 'active',
            appSecret: 'private',
          },
        ],
      ),
    /INVALID_OR_PRIVATE_TARGET/,
  );
  const target = { bindingId: 'target', userId: 'new-user', slot: 'main', status: 'unbound' };
  assert.throws(() => plan([row()], [target, target]), /AMBIGUOUS_TARGET_BASELINE/);
});
