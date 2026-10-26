/** Controlled operator CLI. Default preview is DB-read-only and never opens KEK/storage credentials. */
import 'reflect-metadata';
import { Database } from '../platform/db/database.js';
import { loadConfig } from '../platform/config/config.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { SystemClock } from '../platform/clock/clock.js';
import { AuditLog } from '../platform/audit/audit-log.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  StickerAssetImporter,
  StickerImportError,
  createStickerAssetImporter,
  readStickerImportManifest,
  stickerImportErrorCode,
} from '../modules/media/index.js';

let importer: StickerAssetImporter | undefined;
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    output({
      usage:
        'node dist/import-sticker-assets.js --manifest /absolute/import.json --operator-id ADMIN_UUID [--apply --backup-reference BACKUP_ID]',
      default: 'read-only preview',
      formats: ['gif', 'jpg', 'jpeg', 'png', 'webp'],
      notes:
        'Actual per-item portrait review is required. No download, SVG, license inference, retry or production bootstrap.',
    });
    return;
  }
  const options: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--apply') {
      if (apply) throw new StickerImportError('DUPLICATE_ARGUMENT');
      apply = true;
    } else {
      if (
        !['--manifest', '--operator-id', '--backup-reference'].includes(arg) ||
        options[arg] ||
        !args[i + 1] ||
        args[i + 1]!.startsWith('--')
      )
        throw new StickerImportError('ARGUMENT_INVALID');
      options[arg] = args[++i]!;
    }
  }
  if (!options['--manifest'] || !options['--operator-id'])
    throw new StickerImportError('ARGUMENT_REQUIRED');
  if (apply && !/^[A-Za-z0-9._-]{1,128}$/.test(options['--backup-reference'] ?? ''))
    throw new StickerImportError('BACKUP_REFERENCE_REQUIRED');
  const manifestInput = await readStickerImportManifest(options['--manifest']);
  const config = loadConfig();
  const clock = new SystemClock();
  // One connection makes the preview read-only session and exclusive session lock cover all queries.
  const db = new Database({ url: config.database.url, poolMax: 1 });
  let ring: ReturnType<typeof loadKekRing> = null;
  let locked = false;
  try {
    if (!apply) await db.query('SET default_transaction_read_only=on');
    const adminId = options['--operator-id'];
    if (!(await isActiveMaintenanceAdmin(db, adminId)))
      throw new StickerImportError('ACTIVE_ADMIN_REQUIRED');
    if (apply) {
      const lock = await db.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('media:sticker-assets-import:v1',0)) AS locked",
      );
      if (!lock.rows[0]?.locked) throw new StickerImportError('IMPORT_ALREADY_RUNNING');
      locked = true;
      ring = loadKekRing(config);
      if (!ring) throw new StickerImportError('KEK_REQUIRED_FOR_APPLY');
    }
    const crypto = new EnvelopeCrypto(db, clock, ring);
    const audit = new AuditLog(db, clock);
    importer = createStickerAssetImporter({
      database: db,
      config,
      clock,
      crypto,
      audit,
      apply,
      activeAdmin: (id) => isActiveMaintenanceAdmin(db, id),
    });
    if (apply)
      await audit.record({
        module: 'media',
        action: 'sticker_import.started',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'sticker_import',
        targetId: manifestInput.manifest.namespace,
        details: {
          manifestSha256: manifestInput.manifestSha256,
          source: manifestInput.manifest.source,
          backupReference: options['--backup-reference'],
        },
      });
    const counts = await importer.run({
      ...manifestInput,
      adminId,
      apply,
      backupReference: options['--backup-reference'],
      progress: output,
    });
    if (apply)
      await audit.record({
        module: 'media',
        action: 'sticker_import.finished',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'sticker_import',
        targetId: manifestInput.manifest.namespace,
        details: { manifestSha256: manifestInput.manifestSha256, counts },
      });
    output({ ok: counts.rejected === 0, mode: apply ? 'apply' : 'preview', counts });
    if (counts.rejected) process.exitCode = 1;
  } finally {
    if (locked)
      await db
        .query("SELECT pg_advisory_unlock(hashtextextended('media:sticker-assets-import:v1',0))")
        .catch(() => undefined);
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: stickerImportErrorCode(error), counts: importer?.counts ?? null })}\n`,
  );
  process.exitCode = 1;
});
