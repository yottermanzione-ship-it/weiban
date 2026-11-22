/**
 * Bounded read-only cache report. No chat reads, decryption, provider calls or database writes.
 * pnpm --filter @weiban/server exec tsx src/cli/cache-usage-report.ts --hours 24 --limit 10000
 * Production: node dist/cache-usage-report.js --hours 24 --purpose chat_reply
 */
import { Client } from 'pg';
import { loadConfig } from '../platform/config/config.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { SystemClock } from '../platform/clock/clock.js';
import {
  groupCacheUsage,
  summarizeCacheUsage,
  type CacheUsageReportRow,
} from '../modules/model-access/index.js';

const help = `Cache usage report (read-only, ratios are fractions from 0 to 1)
  --hours N       Last N hours, 1..168 (default 24)
  --limit N       Latest N finished text attempts, 1..50000 (default 10000)
  --purpose NAME Optional exact purpose, e.g. chat_reply, memory, simulation
  --model KEY    Optional exact internal model key
  --help         Show this help without connecting
Historical records without cacheUsage are notRecorded, not zero-cache reports.
Groups separate purpose/model/account/conversation kind/prompt template.
Input coverage uses the existing normalized input-token quantities.
No provider credentials, URLs, user IDs or prompt text are output.`;

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== '--');
  if (args.includes('--help')) {
    console.log(help);
    return;
  }
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (
      !['--hours', '--limit', '--purpose', '--model'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      options.has(key)
    )
      throw new Error('invalid_arguments');
    options.set(key, value);
  }
  const hours = Number(options.get('--hours') ?? 24);
  const limit = Number(options.get('--limit') ?? 10000);
  const purpose = options.get('--purpose') ?? null;
  const model = options.get('--model') ?? null;
  if (
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 168 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50000 ||
    (purpose !== null && !/^[a-z_]{1,80}$/.test(purpose)) ||
    (model !== null && model.length > 200)
  )
    throw new Error('invalid_arguments');
  loadLocalEnv();
  const config = loadConfig();
  const client = new Client({
    connectionString: config.database.url,
    application_name: 'cache-usage-readonly-report',
    connectionTimeoutMillis: 5000,
  });
  const until = new SystemClock().now();
  const since = new Date(until.getTime() - hours * 3600_000);
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only=on; SET statement_timeout='10s'");
    // The text gateway stores ceiling/route; media attempts use bounds/usage instead.
    // Select one attempt per usage record to avoid multiplying token totals on historical rows.
    const result = await client.query<CacheUsageReportRow>(
      `SELECT u.purpose,u.model_key AS "modelKey",u.upstream_id AS "upstreamId",
        u.upstream_model_id AS "upstreamModelId",u.conversation_kind AS "conversationKind",
        u.prompt_template_version AS "promptTemplateVersion",u.status,u.estimated,
        u.input_tokens AS "inputTokens",u.cached_input_tokens AS "cachedInputTokens",
        u.cache_write_5m_tokens AS "cacheWrite5mTokens",u.cache_write_1h_tokens AS "cacheWrite1hTokens",
        a.reported_usage->'cacheUsage' AS "cacheUsage",
        a.bound_snapshot->'promptCacheDiagnostic' AS "promptCacheDiagnostic"
       FROM model_access.usage_records u
       JOIN LATERAL (
         SELECT x.reported_usage,x.bound_snapshot FROM model_access.generation_attempts x
         WHERE x.usage_record_id=u.id AND x.phase='finished' AND x.bound_snapshot ? 'ceiling'
         ORDER BY x.finished_at DESC,x.id DESC LIMIT 1
       ) a ON true
       WHERE u.created_at >= $1 AND u.created_at < $2 AND u.status IN ('succeeded','failed')
         AND ($3::text IS NULL OR u.purpose=$3) AND ($4::text IS NULL OR u.model_key=$4)
       ORDER BY u.created_at DESC,u.id DESC LIMIT $5`,
      [since, until, purpose, model, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    console.log(
      JSON.stringify({
        scope: 'finished_text_attempts',
        since: since.toISOString(),
        until: until.toISOString(),
        limit,
        truncated: result.rows.length > limit,
        purpose,
        model,
        ratioUnit: 'fraction',
        readOnly: true,
        chatContentRead: false,
        total: summarizeCacheUsage(rows),
        groups: groupCacheUsage(rows),
      }),
    );
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  // Driver/config error text can contain connection details; only emit a fixed category.
  console.error(
    JSON.stringify({
      error:
        error instanceof Error && error.message === 'invalid_arguments'
          ? 'invalid_arguments'
          : 'cache_report_failed',
    }),
  );
  process.exitCode = 1;
});
