import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../../apps/server/node_modules/esbuild/lib/main.js';
import { collectDeletionReadAudit } from './legacy-deletion-readonly-audit.mjs';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
export async function readDeletionMemoryScope(refs) {
  const compiled = await build({
    stdin: {
      contents: `import pg from 'pg';import {loadConfig} from './apps/server/src/platform/config/config.ts';import {loadKekRing} from './apps/server/src/platform/crypto/kek-ring.ts';import {EnvelopeCrypto} from './apps/server/src/platform/crypto/envelope.ts';import {runRemoteDeletionMemoryReview} from './scripts/ops/legacy-deletion-memory-review.mjs';await runRemoteDeletionMemoryReview(${JSON.stringify(refs.map(({ messageId, ownerId }) => ({ messageId, ownerId })))},${JSON.stringify(policy.userIdSha256)},{pg,loadConfig,loadKekRing,EnvelopeCrypto});`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      loader: 'ts',
    },
    write: false,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'external-packages',
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith('@weiban/') ? undefined : { path: args.path, external: true },
          );
        },
      },
    ],
  });
  const response = spawnSync(
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
      'docker exec -i weiban-prod-app-1 node --input-type=module',
    ],
    {
      input: compiled.outputFiles[0].text,
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 65536,
      windowsHide: true,
    },
  );
  if (response.status !== 0) {
    let stage = 'transport';
    try {
      const result = JSON.parse(response.stdout);
      if (['configuration', 'connection', 'inspection', 'rollback'].includes(result.stage))
        stage = result.stage;
    } catch {
      /*No private error output.*/
    }
    throw new Error('DELETION_MEMORY_' + stage.toUpperCase() + '_FAILED');
  }
  const value = JSON.parse(response.stdout);
  const expected = [
    'matchedMessages',
    'affectedConversations',
    'memoryRows',
    'current_direct_reference',
    'past_direct_reference',
    'current_without_source_ids',
    'past_without_source_ids',
    'other_source_reference',
    'invalid_payload',
    'decrypt_failed',
    'summaryStatesCoveringDeletedRows',
    'rollingSummariesCoveringDeletedRows',
    'provenanceComplete',
    'semanticComparisonPerformed',
    'writes',
    'privateValuesReturned',
  ];
  if (
    Object.keys(value).some((key) => !expected.includes(key)) ||
    Object.values(value).some((v) => typeof v !== 'boolean' && (!Number.isSafeInteger(v) || v < 0))
  )
    throw new Error('DELETION_MEMORY_RESULT_INVALID');
  return value;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length !== 4 ||
      process.argv[2] !== '--read-only' ||
      process.argv[3] !== '--private-memory-authorized'
    )
      throw new Error();
    process.stdout.write(
      JSON.stringify(await collectDeletionReadAudit({ inspectScope: readDeletionMemoryScope })) +
        '\n',
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category:
          /^DELETION_MEMORY_(CONFIGURATION|CONNECTION|INSPECTION|ROLLBACK|TRANSPORT)_FAILED$/.test(
            error.message,
          )
            ? error.message
            : 'DELETION_MEMORY_READ_FAILED',
        writes: false,
        privateValuesReturned: false,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
