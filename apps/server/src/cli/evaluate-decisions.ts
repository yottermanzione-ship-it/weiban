/** Run only inside the existing server container. No application boot, workers or database writes. */
import 'reflect-metadata';
import { Database } from '../platform/db/database.js';
import { loadConfig } from '../platform/config/config.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { SystemClock } from '../platform/clock/clock.js';
import { evaluateConfiguredDecisions } from '../modules/model-access/index.js';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--smoke', '--run-synthetic'].includes(arg)) ||
    !args.includes('--run-synthetic')
  ) {
    process.stderr.write(
      'Explicit --run-synthetic required; optional --smoke. Maximum 28 supplier requests.\n',
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const ring = loadKekRing(config);
  const db = new Database({ url: config.database.url, poolMax: 1 });
  try {
    // A single pooled connection, all subsequent SQL is read-only for this process.
    await db.query('SET default_transaction_read_only = on');
    const crypto = new EnvelopeCrypto(db, new SystemClock(), ring);
    await evaluateConfiguredDecisions(
      db,
      crypto,
      (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
      args.includes('--smoke'),
    );
  } finally {
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}
main().catch(() => {
  process.stderr.write('decision_evaluation_failed (details suppressed)\n');
  process.exitCode = 1;
});
