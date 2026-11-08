/** Requires explicit scoped approval before --inspect. No app bootstrap, model calls or writes.
 * Only the two pre-diagnostic cancelled jobs' cached successful results are classified in memory.
 * stdout is a closed vocabulary of categories/counts. No text, issue messages, values or IDs.
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../../../apps/server/src/platform/config/config.js';
import { loadKekRing } from '../../../apps/server/src/platform/crypto/kek-ring.js';
import { EnvelopeCrypto, aesGcmSeal } from '../../../apps/server/src/platform/crypto/envelope.js';
import { SystemClock } from '../../../apps/server/src/platform/clock/clock.js';
import type { Database } from '../../../apps/server/src/platform/db/database.js';
import {
  ExtractedMemory,
  healthPrivate,
} from '../../../apps/server/src/modules/ai-runtime/domain/memory.js';
import {
  parseCallMemoryResult,
  CallMemoryRejected,
} from '../../../apps/server/src/modules/ai-runtime/domain/call-memory-result.js';

const Result = ExtractedMemory.extend({ episode: ExtractedMemory.shape.summary.unwrap().max(120) });
const fields = new Set([
  'action',
  'memoryId',
  'content',
  'category',
  'importance',
  'dueAt',
  'sourceMessageIds',
  'sharingClass',
]);
const codes = new Set([
  'invalid_type',
  'too_big',
  'too_small',
  'invalid_format',
  'invalid_value',
  'unrecognized_keys',
]);
type Counts = Record<string, number>;
const add = (out: Counts, key: string) => {
  out[key] = (out[key] ?? 0) + 1;
};

export function classify(value: unknown, sources: readonly string[], out: Counts) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('ok' in value) ||
    value.ok !== true ||
    !('value' in value)
  ) {
    add(out, 'cached_envelope_invalid');
    return;
  }
  const inner = value.value;
  if (!inner || typeof inner !== 'object' || !('text' in inner) || typeof inner.text !== 'string') {
    add(out, 'cached_text_missing');
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(inner.text);
  } catch {
    add(out, 'invalid_result_json');
    return;
  }
  if (sources.length === 1) {
    try {
      const repaired = parseCallMemoryResult(raw, sources[0]!);
      add(
        out,
        repaired.ignoredOperations
          ? repaired.operations.length || repaired.episode
            ? 'repair_valid_parts'
            : 'repair_no_valid_parts'
          : 'repair_all_valid',
      );
      if (repaired.ignoredOperations)
        out.repair_ignored_operations =
          (out.repair_ignored_operations ?? 0) + repaired.ignoredOperations;
      out.repair_valid_operations = (out.repair_valid_operations ?? 0) + repaired.operations.length;
      if (repaired.episode) add(out, 'repair_valid_episode');
    } catch (error) {
      add(
        out,
        error instanceof CallMemoryRejected ? `repair_${error.reason}` : 'repair_invalid_envelope',
      );
    }
  }
  const parsed = Result.safeParse(raw);
  if (!parsed.success) {
    add(out, 'invalid_result_schema');
    for (const issue of parsed.error.issues) {
      const root = issue.path[0];
      const field =
        root === 'operations'
          ? typeof issue.path[2] === 'string' && fields.has(issue.path[2])
            ? `operations.${issue.path[2]}`
            : 'operations'
          : root === 'episode' || root === 'summary'
            ? root
            : 'root';
      add(out, `${field}.${codes.has(issue.code) ? issue.code : 'other'}`);
    }
    // Null optional IDs and omitted no-op payloads are distinguishable without revealing values.
    if (raw && typeof raw === 'object' && 'operations' in raw && Array.isArray(raw.operations)) {
      for (const item of raw.operations)
        if (item && typeof item === 'object') {
          if (
            typeof item.action === 'string' &&
            ['ADD', 'UPDATE', 'MARK_PAST', 'NOOP'].includes(item.action.trim().toUpperCase()) &&
            item.action !== item.action.trim().toUpperCase()
          )
            add(out, 'action_case_or_whitespace_only');
          else if (!['ADD', 'UPDATE', 'MARK_PAST', 'NOOP'].includes(item.action)) {
            add(out, 'action_unsupported');
            if (
              typeof item.action === 'string' &&
              ['NONE', 'NO_OP', 'NO-OP', 'KEEP', 'SKIP'].includes(item.action.trim().toUpperCase())
            )
              add(out, 'action_no_change_alias');
            else add(out, 'action_not_no_change_alias');
          }
          if (item.memoryId === null) add(out, 'optional_memory_id_null');
          if (item.sharingClass === null) add(out, 'optional_sharing_class_null');
          if (item.action === 'NOOP') add(out, 'noop_in_invalid_result');
        }
    }
    return;
  }
  add(out, 'schema_valid');
  if (parsed.data.operations.some((op) => op.sourceMessageIds.some((id) => !sources.includes(id))))
    add(out, 'invalid_source_reference');
  else if (
    parsed.data.operations.some((op) => healthPrivate(op.content)) ||
    healthPrivate(parsed.data.episode)
  )
    add(out, 'restricted_content');
  else add(out, 'result_valid_for_source');
}

async function inspect() {
  const require = createRequire('/app/package.json');
  const { Client } =
    require('pg') as typeof import('../../../apps/server/node_modules/pg/lib/index.js');
  const config = loadConfig();
  const ring = loadKekRing(config);
  if (!ring) throw new Error('configuration_unavailable');
  const client = new Client({ connectionString: config.database.url });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='10s'");
    const rows = await client.query<{
      owner: string;
      generation_id: string;
      ciphertext: Buffer;
      sources: string[];
    }>(`WITH keys AS (
      SELECT j.id,j.user_id,j.conversation_id,'call-memory:'||j.id::text||s.suffix AS logical_key
      FROM ai_runtime.call_memory_jobs j CROSS JOIN (
        SELECT '' AS suffix UNION ALL SELECT ':'||n::text FROM generate_series(0,192000,12000) n
      ) s WHERE j.status='cancelled' AND j.created_at<'2026-11-08T03:40:02Z'
    )
    SELECT k.user_id AS owner,g.id AS generation_id,g.ciphertext,
      ARRAY(SELECT m.id::text FROM chat.messages m WHERE m.conversation_id=k.conversation_id
        AND m.content_type='call_record' AND m.client_msg_id IN(k.id::text,'call:'||k.id::text)) AS sources
    FROM keys k JOIN model_access.usage_records u ON u.user_id=k.user_id
      AND u.created_at>='2026-11-07T11:22:25Z' AND u.created_at<'2026-11-08T03:40:02Z'
      AND u.status='succeeded' AND u.purpose='memory' AND u.prompt_template_version='call-memory-v1'
    JOIN model_access.generation_results g ON g.usage_record_id=u.id
      AND g.key_hash=encode(sha256(convert_to(k.user_id::text,'UTF8')||decode('00','hex')||convert_to('chatfallback:'||k.logical_key||':'||u.model_key,'UTF8')),'hex')
    LIMIT 3`);
    if (rows.rows.length !== 2 || rows.rows.some((row) => !row.ciphertext))
      throw new Error('expected_scope_changed');
    const crypto = new EnvelopeCrypto(
      { query: client.query.bind(client) } as unknown as Database,
      new SystemClock(),
      ring,
    );
    const counts: Counts = { inspected: 0 };
    for (const row of rows.rows) {
      const plain = await crypto.open(row.owner, `generation:${row.generation_id}`, row.ciphertext);
      try {
        classify(JSON.parse(plain.toString('utf8')), row.sources, counts);
        counts.inspected!++;
      } finally {
        plain.fill(0);
      }
    }
    await client.query('ROLLBACK');
    process.stdout.write(JSON.stringify(counts) + '\n');
  } finally {
    await client.end().catch(() => undefined);
    for (const key of ring.keys.values()) key.fill(0);
  }
}

async function selfTest() {
  const owner = '00000000-0000-4000-8000-000000000001';
  const generation = '00000000-0000-4000-8000-000000000002';
  const source = '00000000-0000-4000-8000-000000000003';
  const kek = randomBytes(32);
  const dek = randomBytes(32);
  const wrapped = aesGcmSeal(kek, `weiban:dek:${owner}:v1`, dek);
  const crypto = new EnvelopeCrypto(
    {
      query: async () => ({ rows: [{ wrapped_dek: wrapped, kek_version: 1 }] }),
    } as unknown as Database,
    new SystemClock(),
    { currentVersion: 1, keys: new Map([[1, kek]]) },
  );
  const outputs = [
    JSON.stringify({ operations: [], episode: '' }),
    JSON.stringify({
      operations: [
        {
          action: 'ADD',
          content: 'PRIVATE_CANARY',
          category: 'status',
          importance: 5,
          sourceMessageIds: [source],
          memoryId: null,
        },
      ],
      episode: '',
    }),
    JSON.stringify({ operations: [], episode: 'PRIVATE_CANARY'.repeat(20) }),
    'PRIVATE_CANARY invalid JSON',
  ];
  const counts: Counts = {};
  try {
    for (const text of outputs) {
      const sealed = aesGcmSeal(
        dek,
        `weiban:data:${owner}:generation:${generation}`,
        Buffer.from(JSON.stringify({ ok: true, value: { text } })),
      );
      const plain = await crypto.open(owner, `generation:${generation}`, sealed);
      try {
        classify(JSON.parse(plain.toString('utf8')), [source], counts);
      } finally {
        plain.fill(0);
      }
    }
    const out = JSON.stringify(counts);
    if (
      out.includes('PRIVATE_CANARY') ||
      counts.schema_valid !== 1 ||
      counts.invalid_result_schema !== 2 ||
      counts.invalid_result_json !== 1 ||
      counts.optional_memory_id_null !== 1 ||
      counts['episode.too_big'] !== 1
    )
      throw new Error('self_test_failed');
    process.stdout.write(
      JSON.stringify({ selfTest: 'passed', cases: 4, plaintextExposed: false }) + '\n',
    );
  } finally {
    kek.fill(0);
    dek.fill(0);
  }
}

const mode = process.argv.at(-1);
(mode === '--self-test'
  ? selfTest()
  : mode === '--inspect'
    ? inspect()
    : Promise.reject(new Error('mode_required'))
).catch(() => {
  process.stderr.write('Shape-only diagnostic failed; raw details suppressed\n');
  process.exitCode = 1;
});
