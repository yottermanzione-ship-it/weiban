/** Operator-only maintenance CLI. No application bootstrap, workers, supplier probes or paid calls. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../platform/db/database.js';
import { loadConfig } from '../platform/config/config.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { SystemClock } from '../platform/clock/clock.js';
import { AuditLog } from '../platform/audit/audit-log.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  LegacyImportError,
  LegacyImportReceiver,
  LegacyUpstreamImportService,
} from '../modules/model-access/index.js';

function fail(code: string): never {
  throw new LegacyImportError(code);
}
async function main() {
  const args = process.argv.slice(2),
    options: Record<string, string> = {};
  const names = new Set([
    '--operator-id',
    '--secret-root',
    '--scope-file',
    '--batch-directory',
    '--packet',
    '--expected-sha256',
    '--backup-reference',
  ]);
  let action = '';
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (['--prepare', '--plan', '--apply'].includes(name)) {
      if (action) fail('ONE_ACTION_REQUIRED');
      action = name;
      continue;
    }
    if (!names.has(name) || options[name] || !args[i + 1] || args[i + 1]!.startsWith('--'))
      fail('ARGUMENT_INVALID');
    options[name] = args[++i]!;
  }
  const required = (name: string) => {
    const value = options[name];
    if (!value) return fail('ARGUMENT_REQUIRED');
    return value;
  };
  if (!action) fail('ONE_ACTION_REQUIRED');
  const operatorId = required('--operator-id');
  // This is an explicit operator attestation, not an automatic encrypted-backup validation.
  if (action !== '--plan' && !/^[A-Za-z0-9._-]{1,128}$/.test(required('--backup-reference')))
    fail('BACKUP_ATTESTATION_REQUIRED');
  const config = loadConfig(),
    ring = loadKekRing(config),
    clock = new SystemClock();
  const db = new Database({ url: config.database.url, poolMax: 1 });
  try {
    if (action === '--plan') await db.query('SET default_transaction_read_only=on');
    if (!(await isActiveMaintenanceAdmin(db, operatorId))) fail('ACTIVE_ADMIN_REQUIRED');
    const crypto = new EnvelopeCrypto(db, clock, ring),
      audit = new AuditLog(db, clock);
    const importer = new LegacyUpstreamImportService(db, clock, crypto, audit);
    const receiver = new LegacyImportReceiver(crypto, clock, importer);
    let result: unknown;
    if (action === '--prepare') {
      const file = required('--scope-file');
      if (!path.isAbsolute(file)) fail('SCOPE_FILE_INVALID');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
        fail('SCOPE_FILE_INVALID');
      let scope: unknown;
      try {
        scope = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        fail('SCOPE_FILE_INVALID');
      }
      const prepared = await receiver.prepare(required('--secret-root'), operatorId, scope);
      await audit.record({
        module: 'model_access',
        action: 'legacy_import.receiver_prepared',
        actorType: 'admin',
        actorId: operatorId,
        targetType: 'legacy_import_batch',
        targetId: prepared.batchId,
        details: {
          approvedAccounts: prepared.approvedAccounts,
          backupReference: options['--backup-reference'],
        },
      });
      result = prepared;
    } else {
      const input = {
        batchDirectory: required('--batch-directory'),
        packet: required('--packet'),
        expectedSha256: required('--expected-sha256'),
        operatorId,
      };
      result = action === '--plan' ? await receiver.plan(input) : await receiver.apply(input);
    }
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } finally {
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      code: error instanceof LegacyImportError ? error.code : 'LEGACY_IMPORT_FAILED',
    }) + '\n',
  );
  process.exitCode = 1;
});
