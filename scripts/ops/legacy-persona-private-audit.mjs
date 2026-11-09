/** In-memory review only. No database, SSH, file output, model or migration entry point. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LegacyPersonaImport,
  assertSafePersonaJson,
  bytesDigest,
  editablePersonaDocument,
  isObject,
  personaDigest,
  personaPatchReason,
  projectPersonalPersona,
  targetPersonaPackage,
} from '../../apps/server/src/modules/characters/domain/legacy-persona.ts';
import { isLegacyMigrationOwnerPreserved } from './legacy-migration-preservation.mjs';

const categories = Object.freeze([
  'preserved_owner',
  'invalid_input',
  'duplicate_source',
  'source_unverified',
  'source_after_cutoff',
  'source_reset',
  'target_dependency_missing',
  'target_personal_changes',
  'classification_unverified',
  'base_missing_or_mismatched',
  'identity_mapping_unverified',
  'restricted_identity_change',
  'unsupported_structure',
  'candidate_projection_verified',
]);
const empty = () => Object.fromEntries(categories.map((key) => [key, 0]));

/** Inputs are protected review data. This return value is counts-only and safe for a report. */
export function auditLegacyPersonaInputs(envelope, options = {}) {
  if (
    envelope?.format !== 'weiban-persona-read-audit-v1' ||
    !Array.isArray(envelope.items) ||
    envelope.items.length > 2000 ||
    Object.keys(envelope).some((key) => !['format', 'items'].includes(key))
  )
    throw new Error('PERSONA_AUDIT_ENVELOPE_INVALID');
  const counts = empty();
  const sourceKeys = new Map();
  const preserved = (entry) =>
    [entry?.input?.sourceAccountId, entry?.target?.ownerUserId].some(
      (owner) =>
        typeof owner === 'string' &&
        isLegacyMigrationOwnerPreserved(owner, options.additionalPreservedOwnerDigests),
    );
  for (const entry of envelope.items) {
    const owner = entry?.input?.sourceAccountId;
    if (typeof owner !== 'string' || preserved(entry)) continue;
    if (typeof entry?.input?.source?.personaName === 'string') {
      const key = personaDigest([owner, entry.input.source.personaName]);
      sourceKeys.set(key, (sourceKeys.get(key) ?? 0) + 1);
    }
  }
  for (const entry of envelope.items) {
    const category = (() => {
      const owner = entry?.input?.sourceAccountId;
      // Check the fixed exclusion before parsing any private patch/base.
      if (typeof owner !== 'string') return 'invalid_input';
      if (preserved(entry)) return 'preserved_owner';
      const parsed = LegacyPersonaImport.safeParse(entry.input);
      if (!parsed.success) return 'invalid_input';
      const input = parsed.data;
      if (sourceKeys.get(personaDigest([owner, input.source.personaName])) !== 1)
        return 'duplicate_source';
      if (!input.evidence.sourceVerified) return 'source_unverified';
      if (Date.parse(input.source.updatedAt) > Date.parse(input.cutoff))
        return 'source_after_cutoff';
      if (input.source.state === 'reset') return 'source_reset';
      const target = entry.target;
      if (!target?.accountActive || !target?.contactActive || !isObject(target.legacyCard))
        return 'target_dependency_missing';
      if (!input.evidence.targetLifecycleReviewed || target.hasPersonalChanges !== false)
        return 'target_personal_changes';
      if (
        target.ownerUserId !== owner ||
        target.characterId !== input.characterId ||
        !input.evidence.identityMappingVerified
      )
        return 'identity_mapping_unverified';
      if (
        !input.evidence.classificationReviewed ||
        !input.reviewedClassification ||
        personaDigest({
          basis: target.classification?.basis,
          realPersonKind: target.classification?.realPersonKind,
          ageSetting: target.classification?.ageSetting,
          childAppearance: target.classification?.childAppearance,
        }) !== personaDigest(input.reviewedClassification)
      )
        return 'classification_unverified';
      if (
        !input.base ||
        !input.evidence.baseVersionVerified ||
        !/^[a-f0-9]{64}$/.test(input.source.baseSignature) ||
        input.base.personaName !== input.source.personaName ||
        input.base.signature !== input.source.baseSignature ||
        input.base.revision !== input.source.baseRevision ||
        bytesDigest(input.base.packageJson) !== input.base.packageSha256
      )
        return 'base_missing_or_mismatched';
      try {
        const base = JSON.parse(input.base.packageJson);
        assertSafePersonaJson(base);
        if (
          !isObject(base) ||
          !base.id ||
          base.id !== target.legacyCard.id ||
          (base.display_name ?? base.name) !== input.source.personaName
        )
          return 'identity_mapping_unverified';
        editablePersonaDocument(base);
      } catch {
        return 'base_missing_or_mismatched';
      }
      try {
        const patch = JSON.parse(input.source.patchJson);
        if (Buffer.byteLength(input.source.patchJson, 'utf8') > 524288)
          return 'unsupported_structure';
        const reason = personaPatchReason(patch);
        if (reason)
          return reason === 'restricted_identity_change' ? reason : 'unsupported_structure';
        projectPersonalPersona(
          target.legacyCard,
          targetPersonaPackage(target.legacyCard, target.lorebook ?? [], target.examples ?? []),
          patch,
          'read-audit-only',
        );
        return 'candidate_projection_verified';
      } catch {
        return 'unsupported_structure';
      }
    })();
    counts[category]++;
  }
  return {
    format: 'weiban-persona-read-audit-result-v1',
    total: envelope.items.length,
    counts,
    privateValuesReturned: false,
    writes: false,
    importApproved: false,
    targetLifecycleAndSourceProofsStillRequired: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--stdin') throw new Error();
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 256 * 1024 * 1024) {
          chunk.fill(0);
          throw new Error();
        }
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks);
      try {
        process.stdout.write(
          JSON.stringify(auditLegacyPersonaInputs(JSON.parse(input.toString('utf8')))) + '\n',
        );
      } finally {
        input.fill(0);
      }
    } finally {
      chunks.forEach((chunk) => chunk.fill(0));
    }
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category: 'PERSONA_READ_AUDIT_FAILED',
        privateValuesReturned: false,
        writes: false,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
