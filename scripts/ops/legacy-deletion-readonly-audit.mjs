/** Authorized read-only review; no production mutation, private file output or model calls. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../../apps/server/node_modules/esbuild/lib/main.js';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
export { deletionFragmentReview } from './legacy-deletion-source-review.mjs';
import { LEGACY_REVIEW_UUID as UUID } from './legacy-deletion-source-review.mjs';
import {
  targetDeletionSql,
  completeDeletionFamilies,
  DELETION_METADATA_QUERIES,
} from './legacy-deletion-target-review.mjs';
export { targetDeletionSql } from './legacy-deletion-target-review.mjs';
import { legacyId } from './legacy-content-rules.mjs';
export function assertDeletionSourceReport(source) {
  if (
    !source.summary ||
    !Array.isArray(source.fragments) ||
    source.fragments.length > 20000 ||
    source.fragments.some(
      (r) => ![r.messageId, r.clientId, r.ownerId].every((v) => UUID.test(v)),
    ) ||
    new Set(source.fragments.map((r) => r.messageId)).size !== source.fragments.length
  )
    throw new Error('SOURCE_REVIEW_INVALID');
  if (
    !Array.isArray(source.mediaFamilies) ||
    source.mediaFamilies.length > 2000 ||
    source.mediaFamilies.some(
      (f) =>
        !['chat_history', 'group_messages'].includes(f.table) ||
        typeof f.sourceId !== 'string' ||
        !f.sourceId ||
        f.sourceId.length > 200 ||
        !UUID.test(f.ownerId) ||
        f.firstMessageId !== legacyId('message', f.table, f.sourceId, 0) ||
        !source.fragments.some((r) => r.messageId === f.firstMessageId && r.ownerId === f.ownerId),
    )
  )
    throw new Error('SOURCE_REVIEW_INVALID');
}
function ssh(site, input) {
  const old = site === 'legacy';
  const command = old
    ? 'node --input-type=module'
    : 'docker exec -i weiban-prod-postgres-1 psql -X -q -t -A -U weiban -d weiban -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate';
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
      old ? 'C:/Users/lomjy3/.ssh/weiban_old.pem' : 'C:/Users/lomjy3/.ssh/weiban_deploy',
      old ? 'ubuntu@152.136.111.51' : 'root@103.231.58.124',
      command,
    ],
    {
      input,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (r.status !== 0) {
    if (!old) {
      const state = r.stderr.match(/ERROR:\s+([0-9A-Z]{5})\b/);
      if (state) throw new Error('TARGET_SQLSTATE_' + state[1]);
    }
    if (old) {
      try {
        const result = JSON.parse(r.stdout);
        if (
          [
            'SOURCE_READ_FAILED',
            'SOURCE_OWNER_SCOPE_INVALID',
            'SOURCE_SCHEMA_INCOMPLETE',
            'DELETION_OWNER_REQUIRED',
            'DELETION_SOURCE_INVALID',
            'SOURCE_DELETION_REVIEW_FAILED',
          ].includes(result.category)
        )
          throw new Error(result.category);
      } catch (error) {
        if (/^SOURCE_|^DELETION_/.test(error.message)) throw error;
      }
    }
    throw new Error(old ? 'SOURCE_TRANSPORT_FAILED' : 'TARGET_TRANSPORT_FAILED');
  }
  return r.stdout;
}
export async function collectDeletionReadAudit({ inspectScope } = {}) {
  const cutoff = new Date().toISOString();
  const compiled = await build({
    stdin: {
      contents: `import {runSourceDeletionReadReview} from './scripts/ops/legacy-deletion-source-review.mjs';
try{process.stdout.write(JSON.stringify(runSourceDeletionReadReview(${JSON.stringify(policy.userIdSha256)},${JSON.stringify(cutoff)})));}catch(error){process.stdout.write(JSON.stringify({ok:false,category:['SOURCE_READ_FAILED','SOURCE_OWNER_SCOPE_INVALID','SOURCE_SCHEMA_INCOMPLETE','DELETION_OWNER_REQUIRED','DELETION_SOURCE_INVALID'].includes(error.message)?error.message:'SOURCE_DELETION_REVIEW_FAILED'}));process.exitCode=1;}`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      loader: 'ts',
    },
    write: false,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'packages',
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (a) =>
            a.path.startsWith('@weiban/') ? undefined : { path: a.path, external: true },
          );
        },
      },
    ],
  });
  const source = JSON.parse(ssh('legacy', compiled.outputFiles[0].text));
  assertDeletionSourceReport(source);
  const targetKeys = [
    'candidateFragments',
    'foundFragments',
    'ownerMismatch',
    'sourceIdentityMismatch',
    'visibleMessageFragments',
    'inHiddenOrArchivedConversation',
    'fullSourceScopeFragments',
    'quoteReferences',
    'favoriteReferences',
  ];
  const targetInput = {
    fragments: source.fragments.map(({ messageId, clientId, ownerId, fullSourceScope }) => ({
      messageId,
      clientId,
      ownerId,
      fullSourceScope,
    })),
    mediaFamilies: source.mediaFamilies.map(({ table, sourceId, ownerId, firstMessageId }) => ({
      table,
      sourceId,
      ownerId,
      firstMessageId,
    })),
  };
  const reader = {
    async query(sql, values) {
      if (
        !DELETION_METADATA_QUERIES.includes(sql) ||
        !Array.isArray(values) ||
        values.length !== 1 ||
        !Array.isArray(values[0]) ||
        values[0].length > 2000 ||
        values[0].some((v) => !UUID.test(v))
      )
        throw new Error('UNREGISTERED_READ_QUERY');
      const ids = 'ARRAY[' + values[0].map((id) => "'" + id + "'").join(',') + ']::uuid[]';
      const bound = sql.replace('$1::uuid[]', ids);
      const text =
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout=5000; SELECT coalesce(json_agg(row_to_json(q)),'[]'::json) FROM (" +
        bound +
        ') q; ROLLBACK;';
      return { rows: JSON.parse(ssh('target', text)) };
    },
  };
  const complete = await completeDeletionFamilies(reader, targetInput, policy.userIdSha256);
  const target = Object.fromEntries(targetKeys.map((key) => [key, 0]));
  let targetReadBatches = 0;
  for (let i = 0; i < Math.max(1, complete.fragments.length); i += 80) {
    const part = JSON.parse(ssh('target', targetDeletionSql(complete.fragments.slice(i, i + 80))));
    if (
      JSON.stringify(Object.keys(part)) !== JSON.stringify(targetKeys) ||
      Object.values(part).some((v) => !Number.isSafeInteger(v) || v < 0)
    )
      throw new Error('TARGET_REVIEW_INVALID');
    for (const key of targetKeys) target[key] += part[key];
    targetReadBatches++;
  }
  return {
    observedAt: new Date().toISOString(),
    cutoff,
    mode: 'read-only-derived-identifiers',
    source: source.summary,
    target,
    mediaCompletion: complete.detail,
    targetConsistentRead: false,
    targetReadBatches,
    writes: false,
    privateValuesReturned: false,
    productionReady: false,
    consistentCutoverSnapshot: false,
    ...(inspectScope ? { relatedEvidence: await inspectScope(complete.fragments) } : {}),
    limitations: [
      'Reads span multiple read-only transactions; repeat against the final frozen snapshot.',
      'Favorites and memory are not deleted by this review.',
      'Actual historical hiding requires an approved exact scope.',
    ],
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length !== 4 ||
      process.argv[2] !== '--read-only' ||
      process.argv[3] !== '--private-memory-authorized'
    )
      throw new Error();
    process.stdout.write(JSON.stringify(await collectDeletionReadAudit()) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category: /^TARGET_SQLSTATE_[0-9A-Z]{5}$/.test(error?.message ?? '')
          ? error.message
          : [
                'SOURCE_READ_FAILED',
                'SOURCE_OWNER_SCOPE_INVALID',
                'SOURCE_SCHEMA_INCOMPLETE',
                'DELETION_OWNER_REQUIRED',
                'DELETION_SOURCE_INVALID',
                'SOURCE_DELETION_REVIEW_FAILED',
                'SOURCE_TRANSPORT_FAILED',
                'TARGET_TRANSPORT_FAILED',
              ].includes(error?.message)
            ? error.message
            : 'DELETION_READ_REVIEW_FAILED',
        writes: false,
        privateValuesReturned: false,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
