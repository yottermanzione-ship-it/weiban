import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../../apps/server/node_modules/esbuild/lib/main.js';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function mediaUnresolvedTargetSql(refs) {
  if (
    !Array.isArray(refs) ||
    refs.length > 80 ||
    refs.some(
      (r) =>
        !UUID.test(r.ownerId) ||
        !UUID.test(r.messageId) ||
        !['missing', 'no_reference', 'path_rejected', 'external_not_fetched'].includes(
          r.category,
        ) ||
        !Array.isArray(r.mediaIds) ||
        r.mediaIds.some((id) => !UUID.test(id)),
    )
  )
    throw new Error('MEDIA_REFERENCE_INVALID');
  const hex = Buffer.from(JSON.stringify(refs)).toString('hex');
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout=5000;
WITH refs AS (SELECT * FROM jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) AS r(category text,"ownerId" uuid,"messageId" uuid,"mediaIds" jsonb)),
review AS (SELECT r.*,m.id AS message_id,m.content_type,c.owner_user_id,
EXISTS(SELECT 1 FROM media.objects o WHERE o.id IN (SELECT jsonb_array_elements_text(r."mediaIds")::uuid) AND o.owner_id=r."ownerId" AND o.state='ready') AS media_ready,
EXISTS(SELECT 1 FROM media.objects o WHERE o.id IN (SELECT jsonb_array_elements_text(r."mediaIds")::uuid) AND o.owner_id IS DISTINCT FROM r."ownerId") AS media_wrong_owner
FROM refs r LEFT JOIN chat.messages m ON m.id=r."messageId" LEFT JOIN chat.conversations c ON c.id=m.conversation_id)
SELECT coalesce(json_agg(row_to_json(x)),'[]'::json) FROM (SELECT category,count(*) AS source_rows,count(message_id) AS existing_message,count(*) FILTER(WHERE message_id IS NOT NULL AND owner_user_id IS DISTINCT FROM "ownerId") AS message_wrong_owner,count(*) FILTER(WHERE media_ready) AS target_media_ready,count(*) FILTER(WHERE media_wrong_owner) AS media_wrong_owner,count(*) FILTER(WHERE message_id IS NOT NULL AND content_type='text') AS existing_text_placeholder FROM review GROUP BY category) x;ROLLBACK;`;
}
export async function collectMediaReadReview({ metadataOnly = false, includeTarget = true } = {}) {
  const compiled = await build({
    stdin: {
      contents: `import {runSourceMediaReview} from './scripts/ops/legacy-media-readonly-review.mjs';try{process.stdout.write(JSON.stringify(await runSourceMediaReview(${JSON.stringify(policy.userIdSha256)},${JSON.stringify({ metadataOnly, includeUnresolved: metadataOnly })})));}catch{process.stdout.write(JSON.stringify({ok:false,category:'MEDIA_READ_REVIEW_FAILED',writes:false,privateValuesReturned:false}));process.exitCode=1;}`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    logLevel: 'silent',
  });
  const source = await new Promise((resolveResult, reject) => {
    const child = spawn(
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
        'C:/Users/lomjy3/.ssh/weiban_old.pem',
        'ubuntu@152.136.111.51',
        'sudo -n ionice -c 3 nice -n 15 node --input-type=module',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const timer = setTimeout(() => child.kill(), 300000);
    child.stdout.on('data', (data) => {
      output += data.toString();
      if (output.length > 4 * 1024 * 1024) child.kill();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('MEDIA_TRANSPORT_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(output);
        if (code !== 0) throw new Error();
        resolveResult(value);
      } catch {
        reject(new Error('MEDIA_READ_REVIEW_FAILED'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(compiled.outputFiles[0].text);
  });
  const { unresolved, ...summary } = source;
  if (!metadataOnly || !includeTarget) return summary;
  if (!Array.isArray(unresolved) || unresolved.length > 20000)
    throw new Error('MEDIA_REFERENCE_INVALID');
  const target = {};
  for (let i = 0; i < unresolved.length; i += 80) {
    const sql = mediaUnresolvedTargetSql(unresolved.slice(i, i + 80));
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
        'docker exec -i weiban-prod-postgres-1 psql -X -q -t -A -U weiban -d weiban -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate',
      ],
      { input: sql, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    if (response.status !== 0) {
      const state = response.stderr?.match(/ERROR:\s+([0-9A-Z]{5})\b/);
      const error = new Error(
        state ? 'MEDIA_TARGET_SQLSTATE_' + state[1] : 'MEDIA_TARGET_READ_FAILED',
      );
      error.diagnostics = {
        exitCode: Number.isInteger(response.status) ? response.status : null,
        timedOut: response.error?.code === 'ETIMEDOUT',
        maxBuffer: response.error?.code === 'ENOBUFS',
      };
      throw error;
    }
    for (const row of JSON.parse(response.stdout)) {
      if (
        !['missing', 'no_reference', 'path_rejected', 'external_not_fetched'].includes(row.category)
      )
        throw new Error('MEDIA_TARGET_READ_INVALID');
      const values = Object.entries(row).filter(([key]) => key !== 'category');
      if (
        values.some(
          ([key, v]) =>
            ![
              'source_rows',
              'existing_message',
              'message_wrong_owner',
              'target_media_ready',
              'media_wrong_owner',
              'existing_text_placeholder',
            ].includes(key) ||
            !Number.isSafeInteger(v) ||
            v < 0,
        )
      )
        throw new Error('MEDIA_TARGET_READ_INVALID');
      target[row.category] ??= Object.fromEntries(values.map(([k]) => [k, 0]));
      for (const [key, value] of values) target[row.category][key] += value;
    }
  }
  return {
    ...summary,
    targetUnresolved: target,
    targetReadBatches: Math.ceil(unresolved.length / 80),
    targetSnapshotConsistent: false,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (
      ![4, 5].includes(process.argv.length) ||
      (process.argv.length === 5 && process.argv[4] !== '--metadata-only') ||
      process.argv[2] !== '--read-only' ||
      process.argv[3] !== '--private-memory-authorized'
    )
      throw new Error();
    process.stdout.write(
      JSON.stringify(
        await collectMediaReadReview({ metadataOnly: process.argv[4] === '--metadata-only' }),
      ) + '\n',
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category:
          /^MEDIA_TARGET_SQLSTATE_[0-9A-Z]{5}$/.test(error.message) ||
          [
            'MEDIA_READ_REVIEW_FAILED',
            'MEDIA_REFERENCE_INVALID',
            'MEDIA_TARGET_READ_FAILED',
            'MEDIA_TARGET_READ_INVALID',
            'MEDIA_TRANSPORT_FAILED',
          ].includes(error.message)
            ? error.message
            : 'MEDIA_READ_REVIEW_FAILED',
        writes: false,
        privateValuesReturned: false,
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
