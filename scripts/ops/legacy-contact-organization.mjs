/** Isolated-only contact organization migration. No source discovery, credentials or CLI executor. */
import { createHash } from 'node:crypto';
import {
  ContactOrganizationSnapshot,
  ContactOrganizationTag,
} from '../../packages/contracts/src/http/contact-organization.ts';
import { legacyId } from './legacy-content-rules.mjs';
import { fingerprint, invariant } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import { assertMigrationOwnersAllowed } from './legacy-migration-owner-guards.mjs';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => /^[a-f0-9]{64}$/.test(value ?? '');
const clock = (value) => Number.isSafeInteger(value) && value >= 0;
const sealedPlan = (payload) => ({ ...payload, digest: fingerprint(payload) });
const snapshotDigest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(ContactOrganizationSnapshot.parse(value)))
    .digest('hex');
export function planLegacyContactOrganization({
  sourceAccountId,
  userId,
  document,
  mappings,
  targetSnapshot,
  review,
  options = {},
}) {
  assertMigrationOwnersAllowed([sourceAccountId, userId], options);
  const blocked = [],
    skipped = [];
  const block = (reason) => blocked.push({ reason });
  if (sourceAccountId !== userId) block('owner_mapping_mismatch');
  const current = ContactOrganizationSnapshot.parse(targetSnapshot);
  if (current.revision !== 0)
    return sealedPlan({
      kind: 'legacy-contact-organization-plan-v1',
      status: 'target_preserved',
      productionReady: false,
      userId,
      sourceAccountId,
      blocked: [],
      skipped: [{ reason: 'new_site_organization_has_revision' }],
      input: null,
      summary: { stars: 0, tags: 0, blocked: 0, skipped: 1 },
    });
  if (!(
    review?.synthetic === true &&
    /^synthetic-[a-z0-9-]+$/.test(review.decisionId ?? '') &&
    review.ownershipVerified === true &&
    review.deletionInventoryComplete === true &&
    review.targetNeverEditedVerified === true &&
    digest(review.targetNoEditProofDigest)
  ))
    block('verified_source_and_target_no_edit_evidence_required');
  if (!(review?.localNewSiteStateVerified === true && digest(review.localNewSiteStateProofDigest)))
    block('new_site_local_state_not_verified');
  if (!object(document) || !Object.hasOwn(document, 'starred'))
    block('starred_complete_snapshot_required');
  const star = document?.starred;
  let starredNames = [];
  if (Array.isArray(star)) starredNames = star;
  else if (object(star) && star.v === 2 && Array.isArray(star.names) && clock(star.revisedAt))
    starredNames = star.names;
  else block('starred_format_unknown');
  let rawTags;
  const versioned = document?._sync !== undefined;
  if (versioned) {
    if (document._sync?.v !== 1 || !object(document._sync.entries?.tags))
      block('tag_authoritative_snapshot_required');
    else rawTags = document._sync.entries.tags;
  } else if (object(document?.tags)) rawTags = document.tags;
  else block('tag_complete_snapshot_required');
  if (!Array.isArray(mappings)) block('exact_character_mapping_required');
  const index = new Map();
  for (const mapping of mappings ?? []) {
    assertMigrationOwnersAllowed([mapping.ownerUserId], options);
    if (
      typeof mapping.legacyName !== 'string' ||
      !mapping.legacyName.trim() ||
      mapping.ownerUserId !== userId ||
      !digest(mapping.evidenceDigest) ||
      !['active', 'deleted'].includes(mapping.state)
    ) {
      block('invalid_character_mapping');
      continue;
    }
    const key = mapping.legacyName.trim();
    if (index.has(key)) {
      block('ambiguous_character_mapping');
      continue;
    }
    index.set(key, mapping);
  }
  const used = new Map();
  const resolveNames = (values) => {
    if (!Array.isArray(values)) {
      block('member_list_invalid');
      return [];
    }
    const ids = [];
    for (const name of values) {
      if (typeof name !== 'string' || !name.trim()) {
        block('legacy_friend_name_invalid');
        continue;
      }
      const mapping = index.get(name.trim());
      if (!mapping) {
        block('unknown_character_mapping');
        continue;
      }
      if (mapping.state === 'deleted') {
        skipped.push({ reason: 'verified_deleted_contact_not_restored' });
        continue;
      }
      if (
        !/^[a-f0-9-]{36}$/i.test(mapping.characterId ?? '') ||
        !/^[a-f0-9-]{36}$/i.test(mapping.requestId ?? '')
      ) {
        block('active_contact_epoch_required');
        continue;
      }
      const previous = used.get(mapping.characterId);
      if (previous && previous !== mapping.requestId) {
        block('ambiguous_contact_epoch');
        continue;
      }
      used.set(mapping.characterId, mapping.requestId);
      ids.push(mapping.characterId);
    }
    return [...new Set(ids)].sort();
  };
  const starredCharacterIds = resolveNames(starredNames),
    tags = [],
    tagNames = new Set();
  for (const [rawName, raw] of Object.entries(rawTags ?? {})) {
    if (versioned && (!object(raw) || !clock(raw.revisedAt) || typeof raw.deleted !== 'boolean')) {
      block('tag_authority_entry_invalid');
      continue;
    }
    if (versioned && raw.deleted) {
      skipped.push({ reason: 'source_tag_tombstone_preserved' });
      continue;
    }
    const name = rawName.trim();
    if (tagNames.has(name)) {
      block('duplicate_tag_name');
      continue;
    }
    tagNames.add(name);
    const tag = {
      tagId: legacyId('legacy-contact-tag', userId, rawName),
      name,
      characterIds: resolveNames(versioned ? raw.value : raw),
    };
    if (!ContactOrganizationTag.safeParse(tag).success) {
      block('tag_contract_invalid');
      continue;
    }
    tags.push(tag);
  }
  const shape = ContactOrganizationSnapshot.safeParse({
    revision: 0,
    starredCharacterIds,
    tags,
    updatedAt: null,
  });
  if (!shape.success) block('organization_contract_limit');
  const sourceDigest = fingerprint({ sourceAccountId, document });
  const input = blocked.length
    ? null
    : {
        sourceAccountId,
        sourceDigest,
        expectedTargetDigest: snapshotDigest(current),
        expectedRevision: 0,
        starredCharacterIds,
        tags,
        contactEpochs: [...used]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([characterId, requestId]) => ({ characterId, requestId })),
        review,
      };
  return sealedPlan({
    kind: 'legacy-contact-organization-plan-v1',
    status: blocked.length ? 'blocked' : 'planned',
    productionReady: false,
    userId,
    sourceAccountId,
    sourceDigest,
    input,
    blocked,
    skipped,
    summary: {
      stars: starredCharacterIds.length,
      tags: tags.length,
      blocked: blocked.length,
      skipped: skipped.length,
    },
  });
}
export async function applyLegacyContactOrganizationFixture({
  database,
  target,
  service,
  plan,
  maintenance,
  options = {},
}) {
  const { digest: planDigest, ...payload } = plan;
  invariant(planDigest === fingerprint(payload), 'CONTACT_ORGANIZATION_PLAN_CHANGED');
  assertMigrationOwnersAllowed(
    [plan.sourceAccountId, plan.userId, ...(plan.input ? [plan.input.sourceAccountId] : [])],
    options,
  );
  await assertFixtureDatabase(database, target);
  invariant(service?.database === database, 'CONTACT_ORGANIZATION_DATABASE_MISMATCH');
  invariant(
    maintenance?.writersStopped === true && maintenance?.notificationsCaptured === true,
    'CONTACT_ORGANIZATION_MAINTENANCE_REQUIRED',
  );
  if (plan.status === 'target_preserved') return { status: 'target_preserved' };
  invariant(
    plan.kind === 'legacy-contact-organization-plan-v1' &&
      plan.status === 'planned' &&
      plan.blocked.length === 0 &&
      plan.input,
    'CONTACT_ORGANIZATION_PLAN_BLOCKED',
  );
  return service.importLegacy(plan.userId, plan.input, options);
}
