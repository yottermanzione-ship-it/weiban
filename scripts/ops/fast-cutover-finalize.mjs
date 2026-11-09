/** Explicit maintenance-only final steps; no framework or application workers are started. */
import '../../apps/server/node_modules/reflect-metadata/Reflect.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { Outbox } from '../../apps/server/src/platform/events/outbox.ts';
import { Ledger } from '../../apps/server/src/modules/billing/application/ledger.ts';
import { inspectFastTarget } from './fast-cutover-execution.mjs';
import { restoreDesignatedAnnualBalance } from './restore-designated-annual-balance-20261109.mjs';
import { setFastCutoverPublicPolicy } from './fast-cutover-public-policy.mjs';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };

async function main() {
  const args = new Map();
  let execute = false;
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--execute') {
      execute = true;
      continue;
    }
    if (key === '--plan') continue;
    if (
      ![
        '--step',
        '--expected-database',
        '--expected-oid',
        '--confirm-maintenance',
        '--public-entry',
      ].includes(key) ||
      !process.argv[i + 1]
    )
      throw new Error('FAST_FINALIZE_ARGUMENT_INVALID');
    args.set(key, process.argv[++i]);
  }
  const step = args.get('--step');
  if (!['annual-balance', 'public-entry'].includes(step))
    throw new Error('FAST_FINALIZE_STEP_REQUIRED');
  if (execute && !/^[A-Za-z0-9_-]{6,80}$/.test(args.get('--confirm-maintenance') ?? ''))
    throw new Error('FAST_FINALIZE_MAINTENANCE_REQUIRED');
  const config = loadConfig();
  const database = new Database({ url: config.database.url, poolMax: 1, onError: () => {} });
  database.pool.options.application_name = 'fast-cutover-20261109';
  try {
    const identity = await inspectFastTarget(database);
    if (
      identity.name !== args.get('--expected-database') ||
      identity.oid !== args.get('--expected-oid')
    )
      throw new Error('FAST_FINALIZE_TARGET_MISMATCH');
    if (execute) {
      const row = (
        await database.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()",
        )
      ).rows[0];
      if (row.n !== 0) throw new Error('FAST_FINALIZE_TARGET_NOT_STOPPED');
    }
    let result;
    if (step === 'annual-balance') {
      const clock = new SystemClock();
      result = await restoreDesignatedAnnualBalance({
        database,
        ledger: new Ledger(new Outbox(clock), clock),
        confirmedIdentityDigest: policy.userIdSha256[0],
        execute,
      });
    } else {
      const entry = JSON.parse(readFileSync(args.get('--public-entry'), 'utf8'));
      result = await database.transaction(async (tx) => {
        if (!execute) await tx.query('SET TRANSACTION READ ONLY');
        return setFastCutoverPublicPolicy(tx, entry, { execute });
      });
    }
    process.stdout.write(
      JSON.stringify({ ok: true, step, ...result, privateValuesReturned: false }) + '\n',
    );
  } finally {
    await database.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const category = /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message ?? '')
      ? error.message
      : 'FAST_FINALIZE_FAILED';
    process.stdout.write(
      JSON.stringify({ ok: false, category, privateValuesReturned: false }) + '\n',
    );
    process.exitCode = 1;
  }
}
