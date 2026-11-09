/** Explicitly authorized read-only private-memory audit. No files, imports or models are written. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../apps/server/node_modules/esbuild/lib/main.js';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
import { auditLegacyPersonaInputs } from './legacy-persona-private-audit.mjs';
import { bytesDigest } from '../../apps/server/src/modules/characters/domain/legacy-persona.ts';
import { isLegacyMigrationOwnerPreserved } from './legacy-migration-preservation.mjs';
import { utc } from './legacy-delta-core.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = () => {
  throw new Error('READ_ONLY_REVIEW_INPUT_INVALID');
};
function lines(text) {
  if (typeof text !== 'string' || text.length > 256 * 1024 * 1024) fail();
  return text.trim()
    ? text
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
export function legacyReadTransaction(query) {
  return `PRAGMA query_only=ON;\nBEGIN;\n${query}\nROLLBACK;\n`;
}
export function targetReadTransaction(query) {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='5s';\n${query}\nROLLBACK;\n`;
}
export async function collectPersonaReadOnlyReview({
  readLegacy,
  readTarget,
  readSupplementShapes,
  cutoff,
  options = {},
}) {
  utc(cutoff);
  const scope = lines(
    await readLegacy(
      legacyReadTransaction(
        `SELECT json_object('userId',user_id,'rows',count(*)) FROM persona_customizations GROUP BY user_id;`,
      ),
    ),
  );
  if (
    scope.some((r) => !UUID.test(r.userId ?? '') || !Number.isSafeInteger(r.rows) || r.rows < 0) ||
    scope.length > 10000
  )
    fail();
  const allowed = scope.filter(
    (r) => !isLegacyMigrationOwnerPreserved(r.userId, options.additionalPreservedOwnerDigests),
  );
  const preserved = scope.filter((r) => !allowed.includes(r)).reduce((n, r) => n + r.rows, 0);
  if (!allowed.length)
    return {
      mode: 'read-only-private-memory',
      sourceRows: preserved,
      preservedRows: preserved,
      reviewedRows: 0,
      counts: {},
      writes: false,
      privateValuesReturned: false,
      productionReady: false,
    };
  const ids = JSON.stringify(allowed.map((r) => r.userId)); // UUID-only, safe SQLite literal.
  const rows = lines(
    await readLegacy(
      legacyReadTransaction(`
SELECT json_object('userId',c.user_id,'personaName',c.persona_name,'version',c.version,'state',c.state,
'baseSignature',c.base_signature,'baseRevision',c.base_revision,'updatedAt',c.updated_at,
'patchJson',CASE WHEN c.state='customized' THEN c.patch_json ELSE NULL END,
'baseCount',(SELECT count(*) FROM persona_base_versions b WHERE b.persona_name=c.persona_name AND b.signature=c.base_signature AND coalesce(b.revision,'')=coalesce(c.base_revision,'')),
'basePackageJson',CASE WHEN c.state='customized' THEN (SELECT b.package_json FROM persona_base_versions b WHERE b.persona_name=c.persona_name AND b.signature=c.base_signature AND coalesce(b.revision,'')=coalesce(c.base_revision,'') LIMIT 1) ELSE NULL END)
FROM persona_customizations c WHERE c.user_id IN (SELECT value FROM json_each('${ids}'));
`),
    ),
  );
  const allowedIds = new Set(allowed.map((r) => r.userId));
  if (rows.some((r) => !allowedIds.has(r.userId)) || rows.length > 10000) fail();
  const metadata = {
    source_reset: 0,
    invalid_source: 0,
    base_missing_or_invalid: 0,
    target_mapping_missing: 0,
    target_mapping_ambiguous: 0,
  };
  const candidates = [];
  for (const row of rows) {
    if (row.state === 'reset') {
      metadata.source_reset++;
      continue;
    }
    if (row.state !== 'customized' || typeof row.personaName !== 'string') {
      metadata.invalid_source++;
      continue;
    }
    let base;
    try {
      base = JSON.parse(row.basePackageJson);
      if (row.baseCount !== 1 || typeof base?.id !== 'string' || !base.id) throw new Error();
    } catch {
      metadata.base_missing_or_invalid++;
      continue;
    }
    candidates.push({ row, base });
  }
  const refs = candidates.map(({ row, base }) => ({ user_id: row.userId, legacy_id: base.id }));
  // Only fixed SQL plus hex-encoded data crosses the shell. No untrusted SQL identifiers.
  const hex = Buffer.from(JSON.stringify(refs)).toString('hex');
  const flags = lines(
    await readTarget(
      targetReadTransaction(
        `SELECT json_build_object('personalTable',to_regclass('characters.legacy_persona_overrides') IS NOT NULL);`,
      ),
    ),
  );
  if (flags.length !== 1 || typeof flags[0].personalTable !== 'boolean') fail();
  const personal = flags[0].personalTable
    ? ` OR EXISTS(SELECT 1 FROM characters.legacy_persona_overrides p WHERE p.user_id=s.user_id AND p.character_id=c.id)`
    : '';
  const targets = lines(
    await readTarget(
      targetReadTransaction(`
WITH sources AS (SELECT DISTINCT user_id::uuid,legacy_id FROM jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) AS x(user_id text,legacy_id text))
SELECT json_build_object('legacyId',s.legacy_id,'target',json_build_object(
'ownerUserId',s.user_id,'characterId',c.id,
'accountActive',EXISTS(SELECT 1 FROM identity.users u WHERE u.id=s.user_id AND u.status='active'),
'contactActive',EXISTS(SELECT 1 FROM contacts.contacts f WHERE f.user_id=s.user_id AND f.character_id=c.id AND f.status='active'),
'contactState',coalesce((SELECT f.status FROM contacts.contacts f WHERE f.user_id=s.user_id AND f.character_id=c.id LIMIT 1),'absent'),
'hasPersonalChanges',(EXISTS(SELECT 1 FROM characters.user_supplements p WHERE p.user_id=s.user_id AND p.character_id=c.id)${personal}),
'classification',coalesce(c.eligibility_override,jsonb_build_object('basis',c.basis,'realPersonKind',c.real_person_kind,'ageSetting',c.age_setting,'childAppearance',c.child_appearance)),
'legacyCard',c.legacy_card,
'lorebook',coalesce((SELECT jsonb_agg(l.payload ORDER BY l.id) FROM characters.legacy_lorebook_entries l WHERE l.character_id=c.id),'[]'::jsonb),
'examples',coalesce((SELECT jsonb_agg(e.payload ORDER BY e.sort_order,e.id) FROM characters.legacy_example_dialogues e WHERE e.character_id=c.id),'[]'::jsonb)))
FROM sources s JOIN characters.characters c ON c.legacy_card->>'id'=s.legacy_id
 AND ((c.kind='preset' AND c.status IN ('published','unpublished')) OR (c.kind='custom' AND c.owner_id=s.user_id));
`),
    ),
  );
  if (targets.some((r) => !allowedIds.has(r.target?.ownerUserId)) || targets.length > 10000) fail();
  const items = [];
  for (const { row, base } of candidates) {
    const matching = targets.filter(
      (t) => t.legacyId === base.id && t.target.ownerUserId === row.userId,
    );
    if (!matching.length) {
      metadata.target_mapping_missing++;
      continue;
    }
    if (matching.length !== 1) {
      metadata.target_mapping_ambiguous++;
      continue;
    }
    const target = matching[0].target;
    items.push({
      target,
      input: {
        format: 'weiban-legacy-persona-v1',
        sourceAccountId: row.userId,
        characterId: target.characterId,
        // Deliberately not an executable target fingerprint: this tool cannot create an import plan.
        expectedTargetDigest: bytesDigest('READ_ONLY_NO_IMPORT_PLAN'),
        cutoff,
        source: {
          personaName: row.personaName,
          version: row.version,
          state: row.state,
          baseSignature: String(row.baseSignature ?? ''),
          baseRevision: String(row.baseRevision ?? ''),
          patchJson: row.patchJson,
          updatedAt: utc(row.updatedAt),
        },
        base: {
          personaName: row.personaName,
          signature: String(row.baseSignature ?? ''),
          revision: String(row.baseRevision ?? ''),
          packageJson: row.basePackageJson,
          packageSha256: bytesDigest(row.basePackageJson),
        },
        evidence: {
          sourceVerified: true,
          baseVersionVerified: true,
          identityMappingVerified: true,
          targetLifecycleReviewed: target.contactActive === true,
          classificationReviewed: true,
        },
        reviewedClassification: target.classification,
      },
    });
  }
  const review = auditLegacyPersonaInputs(
    { format: 'weiban-persona-read-audit-v1', items },
    options,
  );
  const dependencyCounts = {
    account_not_active: 0,
    contact_absent: 0,
    contact_deleted: 0,
    contact_pending: 0,
    contact_other: 0,
  };
  for (const entry of items) {
    if (!entry.target.accountActive) dependencyCounts.account_not_active++;
    else if (!entry.target.contactActive) {
      const key = 'contact_' + entry.target.contactState;
      dependencyCounts[Object.hasOwn(dependencyCounts, key) ? key : 'contact_other']++;
    }
  }
  // Conversion-only analysis does NOT approve target changes or create a reusable import input.
  const structureOnly = auditLegacyPersonaInputs(
    {
      format: 'weiban-persona-read-audit-v1',
      items: items.map((entry) => ({
        input: {
          ...entry.input,
          evidence: { ...entry.input.evidence, targetLifecycleReviewed: true },
        },
        target: {
          ...entry.target,
          accountActive: true,
          contactActive: true,
          hasPersonalChanges: false,
        },
      })),
    },
    options,
  );
  const baseGuardCategories = {
    secret_named_fields: 0,
    credential_named_fields: 0,
    prototype_named_fields: 0,
    non_hex_signature: 0,
  };
  for (const { row, base } of candidates) {
    if (!/^[a-f0-9]{64}$/.test(String(row.baseSignature ?? '')))
      baseGuardCategories.non_hex_signature++;
    const found = new Set();
    let visits = 0;
    const visit = (value, depth = 0) => {
      if (++visits > 20000 || depth > 32) return;
      if (Array.isArray(value)) {
        value.forEach((v) => visit(v, depth + 1));
        return;
      }
      if (value && typeof value === 'object')
        for (const [key, v] of Object.entries(value)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key))
            found.add('prototype_named_fields');
          if (/secret/iu.test(key)) found.add('secret_named_fields');
          if (/(?:password|passwd|access.?token|api.?key|authorization|credential)/iu.test(key))
            found.add('credential_named_fields');
          visit(v, depth + 1);
        }
    };
    visit(base);
    for (const category of found) baseGuardCategories[category]++;
  }
  const overlapRefs = items.flatMap((entry, index) =>
    entry.target.hasPersonalChanges
      ? [
          {
            index,
            userId: entry.input.sourceAccountId,
            characterId: entry.input.characterId,
            sourceUpdatedAt: entry.input.source.updatedAt,
          },
        ]
      : [],
  );
  const overlapAnalysis = {
    placeholder_before_first_cutoff: 0,
    placeholder_after_or_unknown: 0,
    other_text: 0,
    empty: 0,
    unavailable: 0,
    read_failed: 0,
    preserved_owner: 0,
  };
  let overlapSourceTimeMatches = 0;
  if (readSupplementShapes && overlapRefs.length) {
    const shapes = await readSupplementShapes(overlapRefs);
    const validIndexes = new Set(overlapRefs.map((r) => r.index)),
      seen = new Set();
    if (!Array.isArray(shapes) || shapes.length !== overlapRefs.length) fail();
    for (const shape of shapes) {
      if (
        !validIndexes.has(shape.index) ||
        seen.has(shape.index) ||
        !Object.hasOwn(overlapAnalysis, shape.kind)
      )
        fail();
      seen.add(shape.index);
      overlapAnalysis[shape.kind]++;
      if (shape.sourceTimeMatches === true) overlapSourceTimeMatches++;
    }
  }
  return {
    mode: 'read-only-private-memory',
    observedAt: new Date().toISOString(),
    cutoff,
    sourceRows: rows.length + preserved,
    preservedRows: preserved,
    reviewedRows: rows.length,
    metadata,
    projectionCounts: review.counts,
    dependencyCounts,
    conversionOnlyCounts: structureOnly.counts,
    conversionOnlyIsNotImportApproval: true,
    baseGuardCategories,
    overlapAnalysis,
    overlapSourceTimeMatches,
    overlapReadPerformed: !!readSupplementShapes,
    writes: false,
    privateValuesReturned: false,
    productionReady: false,
    consistentCutoverSnapshot: false,
  };
}

export async function buildSupplementReviewSource(refs) {
  const compiled = await build({
    stdin: {
      contents: `import pg from 'pg';
import {loadConfig} from './apps/server/src/platform/config/config.ts';
import {loadKekRing} from './apps/server/src/platform/crypto/kek-ring.ts';
import {EnvelopeCrypto} from './apps/server/src/platform/crypto/envelope.ts';
import {runRemoteSupplementReview} from './scripts/ops/legacy-supplement-shape-review.mjs';
await runRemoteSupplementReview(${JSON.stringify(policy.userIdSha256)},${JSON.stringify(refs)},{pg,loadConfig,loadKekRing,EnvelopeCrypto});`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      loader: 'ts',
    },
    write: false,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    logLevel: 'silent',
    sourcemap: false,
    plugins: [
      {
        name: 'externalize-runtime-packages',
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith('@weiban/') ? undefined : { path: args.path, external: true },
          );
        },
      },
    ],
  });
  return compiled.outputFiles[0].text;
}
export async function readRemoteSupplementShapes(refs) {
  const source = await buildSupplementReviewSource(refs);
  const command = 'docker exec -i weiban-prod-app-1 node --input-type=module';
  const r = spawnSync(
    'ssh',
    [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=8',
      '-i',
      'C:/Users/lomjy3/.ssh/weiban_deploy',
      'root@103.231.58.124',
      command,
    ],
    {
      input: source,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (r.status !== 0) {
    let stage = 'transport';
    try {
      const result = JSON.parse(r.stdout);
      if (['configuration', 'connection', 'begin', 'inspection', 'rollback'].includes(result.stage))
        stage = result.stage;
    } catch {
      // Unexpected remote output stays private; report only the fixed transport category.
    }
    throw new Error('SUPPLEMENT_REVIEW_' + stage.toUpperCase() + '_FAILED');
  }
  return JSON.parse(r.stdout);
}
function sshRead(site, sql) {
  const old = site === 'legacy';
  const result = spawnSync(
    'ssh',
    [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=8',
      '-i',
      old ? 'C:/Users/lomjy3/.ssh/weiban_old.pem' : 'C:/Users/lomjy3/.ssh/weiban_deploy',
      old ? 'ubuntu@152.136.111.51' : 'root@103.231.58.124',
      old
        ? 'sqlite3 -readonly -batch -cmd ".timeout 5000" /opt/weiban-server/weiban.db'
        : 'docker exec -i weiban-prod-postgres-1 psql -X -q -t -A -U weiban -d weiban -v ON_ERROR_STOP=1',
    ],
    {
      input: sql,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error('READ_ONLY_SOURCE_QUERY_FAILED');
  return result.stdout;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length !== 4 ||
      process.argv[2] !== '--read-only' ||
      process.argv[3] !== '--private-memory-authorized'
    )
      throw new Error();
    const result = await collectPersonaReadOnlyReview({
      cutoff: new Date().toISOString(),
      readLegacy: (q) => sshRead('legacy', q),
      readTarget: (q) => sshRead('target', q),
      readSupplementShapes: readRemoteSupplementShapes,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category:
          /^SUPPLEMENT_REVIEW_(CONFIGURATION|CONNECTION|BEGIN|INSPECTION|ROLLBACK|TRANSPORT)_FAILED$/.test(
            error?.message ?? '',
          )
            ? error.message
            : [
                  'READ_ONLY_SOURCE_QUERY_FAILED',
                  'READ_ONLY_REVIEW_INPUT_INVALID',
                  'PERSONA_AUDIT_ENVELOPE_INVALID',
                ].includes(error?.message)
              ? error.message
              : 'PERSONA_READ_ONLY_REVIEW_FAILED',
        errorClass: ['TypeError', 'SyntaxError', 'Error'].includes(error?.name)
          ? error.name
          : 'Other',
        privateValuesReturned: false,
        writes: false,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
