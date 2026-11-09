import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditLegacyPersonaInputs } from './legacy-persona-private-audit.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const canary = 'synthetic-private-text-must-not-be-returned';
function fixture() {
  const owner = randomUUID(),
    characterId = randomUUID();
  const classification = {
    basis: 'original',
    realPersonKind: null,
    ageSetting: 'adult',
    childAppearance: false,
  };
  const base = JSON.stringify({
    id: 'synthetic-legacy-role',
    name: 'Synthetic role',
    raw_persona: { soulspec: { personality_core: canary } },
  });
  return {
    input: {
      format: 'weiban-legacy-persona-v1',
      sourceAccountId: owner,
      characterId,
      expectedTargetDigest: digest('target'),
      cutoff: '2026-11-09T00:00:00Z',
      source: {
        personaName: 'Synthetic role',
        version: 1,
        state: 'customized',
        baseSignature: digest('signature'),
        baseRevision: 'r1',
        patchJson: JSON.stringify({
          raw_persona: { soulspec: { personality_core: canary + ' edited' } },
        }),
        updatedAt: '2026-11-08T00:00:00Z',
      },
      base: {
        personaName: 'Synthetic role',
        signature: digest('signature'),
        revision: 'r1',
        packageJson: base,
        packageSha256: digest(base),
      },
      evidence: {
        sourceVerified: true,
        baseVersionVerified: true,
        identityMappingVerified: true,
        targetLifecycleReviewed: true,
        classificationReviewed: true,
      },
      reviewedClassification: classification,
    },
    target: {
      ownerUserId: owner,
      characterId,
      accountActive: true,
      contactActive: true,
      hasPersonalChanges: false,
      classification,
      legacyCard: {
        id: 'synthetic-legacy-role',
        core_persona: 'Current public role',
        raw_json: { soulspec: { personality_core: 'Public updated' } },
      },
      lorebook: [],
      examples: [],
    },
  };
}
function run(items, options) {
  const before = JSON.stringify(items);
  const value = auditLegacyPersonaInputs(
    { format: 'weiban-persona-read-audit-v1', items },
    options,
  );
  assert.equal(JSON.stringify(items), before);
  assert.equal(JSON.stringify(value).includes(canary), false);
  for (const item of items)
    assert.equal(JSON.stringify(value).includes(item.input.sourceAccountId), false);
  assert.equal(
    Object.values(value.counts).reduce((a, b) => a + b, 0),
    items.length,
  );
  assert.equal(value.importApproved, false);
  return value.counts;
}
test('uses actual projection rules, returns counts only, and never changes input', () => {
  assert.equal(run([fixture()]).candidate_projection_verified, 1);
});
test('preserved owner is excluded before malformed private JSON is inspected', () => {
  const f = fixture();
  f.input.source.patchJson = '{' + canary;
  assert.equal(
    run([f], {
      additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(f.input.sourceAccountId)],
    }).preserved_owner,
    1,
  );
  const remapped = fixture();
  remapped.target.ownerUserId = f.input.sourceAccountId;
  remapped.input.source.patchJson = '{' + canary;
  assert.equal(
    run([remapped], {
      additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(f.input.sourceAccountId)],
    }).preserved_owner,
    1,
  );
});
test('resets, latest-target edits, missing dependencies and duplicate sources remain separate', () => {
  const reset = fixture();
  reset.input.source.state = 'reset';
  const edited = fixture();
  edited.target.hasPersonalChanges = true;
  const missing = fixture();
  missing.target.contactActive = false;
  const duplicate = fixture();
  const counts = run([reset, edited, missing, duplicate, structuredClone(duplicate)]);
  assert.equal(counts.source_reset, 1);
  assert.equal(counts.target_personal_changes, 1);
  assert.equal(counts.target_dependency_missing, 1);
  assert.equal(counts.duplicate_source, 2);
});
test('wrong base, owner, unsafe structure and restricted controls cannot be accepted', () => {
  const base = fixture();
  base.input.base.packageSha256 = digest('wrong');
  const owner = fixture();
  owner.target.ownerUserId = randomUUID();
  const unsafe = fixture();
  unsafe.input.source.patchJson = '{"raw_persona":{"soulspec":{"constructor":"' + canary + '"}}}';
  const protectedField = fixture();
  protectedField.input.source.patchJson = '{"raw_persona":{"character":{"name":"' + canary + '"}}}';
  const counts = run([base, owner, unsafe, protectedField]);
  assert.equal(counts.base_missing_or_mismatched, 1);
  assert.equal(counts.identity_mapping_unverified, 1);
  assert.equal(counts.unsupported_structure, 1);
  assert.equal(counts.restricted_identity_change, 1);
});
test('the CLI emits only the fixed aggregate and sanitizes malformed private input', () => {
  const entry = fixture();
  const script = fileURLToPath(new URL('./legacy-persona-private-audit.mjs', import.meta.url));
  const loader = new URL('../../apps/server/node_modules/tsx/dist/loader.mjs', import.meta.url)
    .href;
  for (const [input, expectedStatus] of [
    [JSON.stringify({ format: 'weiban-persona-read-audit-v1', items: [entry] }), 0],
    ['{' + canary, 1],
  ]) {
    const result = spawnSync(process.execPath, ['--import', loader, script, '--stdin'], {
      input,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    assert.equal(result.status, expectedStatus);
    assert.equal((result.stdout + result.stderr).includes(canary), false);
    assert.equal((result.stdout + result.stderr).includes(entry.input.sourceAccountId), false);
    const value = JSON.parse(result.stdout);
    assert.equal(value.writes, false);
    assert.equal(value.privateValuesReturned, false);
    if (expectedStatus === 0) assert.equal(value.counts.candidate_projection_verified, 1);
    else assert.equal(value.category, 'PERSONA_READ_AUDIT_FAILED');
  }
});
