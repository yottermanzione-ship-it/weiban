/**
 * Bounded read-only cache report. No chat reads, decryption, provider calls or database writes.
 * pnpm --filter @weiban/server exec tsx src/cli/cache-usage-report.ts --hours 24 --limit 10000
 * Production: node dist/cache-usage-report.js --hours 24 --purpose chat_reply
 */
import { Database } from '../platform/index.js';
import { loadConfig } from '../platform/config/config.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { SystemClock } from '../platform/clock/clock.js';
import {
  groupCacheUsage,
  readCacheUsageReportRows,
  summarizeCacheUsage,
} from '../modules/model-access/index.js';

const help = `Cache usage report (read-only, ratios are fractions from 0 to 1)
  --hours N       Last N hours, 1..168 (default 24)
  --limit N       Latest N finished text attempts, 1..50000 (default 10000)
  --purpose NAME Optional exact purpose, e.g. chat_reply, memory, simulation
  --model KEY    Optional exact internal model key
  --help         Show this help without connecting
Historical records use preserved OpenAI-compatible receipt fields if available.
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
  const database = new Database({ url: config.database.url, poolMax: 1 });
  const until = new SystemClock().now();
  const since = new Date(until.getTime() - hours * 3600_000);
  try {
    const result = await database.transaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      await tx.query("SET LOCAL statement_timeout='10s'");
      return readCacheUsageReportRows(tx.db, { since, until, purpose, model, limit: limit + 1 });
    });
    const rows = result.slice(0, limit);
    console.log(
      JSON.stringify({
        scope: 'finished_text_attempts',
        since: since.toISOString(),
        until: until.toISOString(),
        limit,
        truncated: result.length > limit,
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
    await database.close();
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
