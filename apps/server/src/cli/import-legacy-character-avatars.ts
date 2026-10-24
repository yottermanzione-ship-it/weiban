/**
 * 旧角色头像导入 CLI（operator-only）。
 *
 *   node dist/import-legacy-character-avatars.js --input /abs/avatars.json
 *   node dist/import-legacy-character-avatars.js --input /abs/avatars.json --apply \
 *     --operator-id <ACTIVE_ADMIN_UUID> --allow-host 152.136.111.51
 *
 * 输入 JSON：{ "version": 1, "allowHosts": ["..."], "avatars": { "<角色id>": "<绝对路径或URL>" } }
 *
 * 默认 --dry-run：只读库、只检查来源，不写库、不打开 KEK / 对象存储；--apply 才写。
 * 幂等：已有 avatar_media_id 的角色跳过；中途失败后重跑会跳过已导入的角色。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {
  LegacyAvatarManifest,
  allowedHostsOf,
  applyAvatarImports,
  planAvatarSources,
  readAvatarCharacters,
} from '../modules/characters/index.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import { createImportMediaService, type MediaService } from '../modules/media/index.js';
import { AuditLog } from '../platform/audit/audit-log.js';
import { SystemClock } from '../platform/clock/clock.js';
import { loadConfig, type AppConfig } from '../platform/config/config.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { Database } from '../platform/db/database.js';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_BATCH_SIZE = 50;
const LOCK_KEY = 'characters:legacy-avatar-import:v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

class ImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const fail = (code: string): never => {
  throw new ImportError(code);
};

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};
  const allowHosts: string[] = [];
  let apply = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--apply') {
      if (apply) fail('DUPLICATE_ARGUMENT');
      apply = true;
      continue;
    }
    if (arg === '--allow-host') {
      const host = argv[++i]?.trim().toLowerCase();
      if (!host || host.startsWith('--')) fail('ALLOW_HOST_REQUIRED');
      allowHosts.push(host as string);
      continue;
    }
    if (arg === '--help') {
      help = true;
      continue;
    }
    if (
      !['--input', '--operator-id', '--batch-size', '--report'].includes(arg) ||
      options[arg] ||
      !argv[i + 1] ||
      argv[i + 1]!.startsWith('--')
    )
      fail('ARGUMENT_INVALID');
    options[arg] = argv[++i]!;
  }
  if (help) return { help, apply: false, options, allowHosts, batchSize: DEFAULT_BATCH_SIZE };
  const file = options['--input'];
  if (!file) return fail('INPUT_REQUIRED');
  if (!path.isAbsolute(file)) fail('INPUT_MUST_BE_ABSOLUTE');
  const batchSize = Number.parseInt(options['--batch-size'] ?? String(DEFAULT_BATCH_SIZE), 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) fail('BATCH_SIZE_INVALID');
  if (apply && !options['--operator-id']) fail('OPERATOR_REQUIRED_FOR_APPLY');
  return { help, apply, options, file, batchSize, allowHosts };
}

function readManifest(file: string): LegacyAvatarManifest {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES)
    fail('INPUT_FILE_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('INPUT_JSON_INVALID');
  }
  const result = LegacyAvatarManifest.safeParse(parsed);
  if (!result.success) fail('INPUT_SHAPE_INVALID');
  return result.data!;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    output({
      usage:
        'node dist/import-legacy-character-avatars.js --input /absolute/avatars.json [--apply --operator-id ADMIN_UUID] [--allow-host HOST]... [--batch-size 50] [--report /absolute/report.json]',
      default: 'dry-run (DB read-only, no media/KEK writes)',
      input:
        '{ "version": 1, "allowHosts": ["..."], "avatars": { "<characterId>": "/abs/file.png | https://host/x.jpg" } }',
      notes:
        '仅接受 PNG/JPEG/WebP，≤5MB；本地路径拒绝符号链接/硬链接；URL 只允许白名单主机且不跟随跳转到白名单外。',
    });
    return;
  }
  const manifest = readManifest(parsed.file!);
  const config = loadConfig();
  const clock = new SystemClock();
  const db = new Database({ url: config.database.url, poolMax: 1 });
  let ring: ReturnType<typeof loadKekRing> = null;
  let locked = false;
  try {
    if (!parsed.apply) await db.query('SET default_transaction_read_only=on');
    const operatorId = parsed.options['--operator-id'];
    if (parsed.apply) {
      if (!operatorId || !(await isActiveMaintenanceAdmin(db, operatorId)))
        fail('ACTIVE_ADMIN_REQUIRED');
      const lock = await db.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('${LOCK_KEY}',0)) locked`,
      );
      if (!lock.rows[0]?.locked) fail('IMPORT_ALREADY_RUNNING');
      locked = true;
      ring = loadKekRing(config);
      if (!ring) fail('KEK_REQUIRED_FOR_APPLY');
    }
    const allowHosts = allowedHostsOf(manifest);
    for (const host of parsed.allowHosts) allowHosts.add(host);
    const validIds = Object.keys(manifest.avatars).filter((id) => UUID_RE.test(id));
    const existing = await readAvatarCharacters(db, validIds);
    const plan = await planAvatarSources(manifest.avatars, {
      allowHosts,
      lookup: (characterId) => existing.get(characterId) ?? null,
    });
    const { counts, issues, items: applyItems } = plan;
    for (const [index, entry] of plan.entries.entries()) {
      output({
        event: 'avatar',
        index: index + 1,
        total: plan.entries.length,
        characterId: entry.characterId,
        status: entry.status,
        ...(entry.detail ? { detail: entry.detail } : {}),
        ...(entry.mediaId ? { mediaId: entry.mediaId } : {}),
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
      });
    }
    const rejected =
      counts.characterMissing +
      counts.invalidCharacterId +
      counts.missingFile +
      counts.unsupportedFormat +
      counts.tooLarge +
      counts.invalidSource +
      counts.urlHostNotAllowed +
      counts.downloadFailed;
    // dry-run 不写库，读完即可清掉明文图片缓冲。
    if (!parsed.apply) for (const item of applyItems) item.inspection.buffer.fill(0);
    const report = {
      ok: counts.failed === 0 && rejected === 0,
      mode: parsed.apply ? 'apply' : 'dry-run',
      counts,
      issues,
    };
    if (parsed.apply) {
      const media = mediaService(db, config, clock, ring!, new AuditLog(db, clock));
      const audit = new AuditLog(db, clock);
      await audit.record({
        module: 'characters',
        action: 'legacy_avatar_import.started',
        actorType: 'admin',
        actorId: operatorId!,
        targetType: 'legacy_character_avatar_import',
        details: { total: counts.total, importable: counts.importable },
      });
      for (let offset = 0; offset < applyItems.length; offset += parsed.batchSize) {
        const batch = applyItems.slice(offset, offset + parsed.batchSize);
        await applyAvatarImports(db, media, batch, {
          now: clock.now(),
          counts,
          issues,
          offset,
          progress: output,
        });
        output({
          event: 'avatar_batch',
          done: Math.min(offset + batch.length, applyItems.length),
          total: applyItems.length,
          imported: counts.imported,
          failed: counts.failed,
        });
      }
      await audit.record({
        module: 'characters',
        action: 'legacy_avatar_import.finished',
        actorType: 'admin',
        actorId: operatorId!,
        targetType: 'legacy_character_avatar_import',
        details: { imported: counts.imported, failed: counts.failed },
      });
      report.ok = counts.failed === 0 && rejected === 0;
    }
    if (parsed.options['--report']) {
      const file = parsed.options['--report']!;
      if (!path.isAbsolute(file)) fail('REPORT_MUST_BE_ABSOLUTE');
      fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    }
    output(report);
    if (counts.failed) process.exitCode = 1;
  } finally {
    if (locked)
      await db
        .query(`SELECT pg_advisory_unlock(hashtextextended('${LOCK_KEY}',0))`)
        .catch(() => undefined);
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}

function mediaService(
  db: Database,
  config: AppConfig,
  clock: SystemClock,
  ring: NonNullable<ReturnType<typeof loadKekRing>>,
  audit: AuditLog,
): MediaService {
  const crypto = new EnvelopeCrypto(db, clock, ring);
  return createImportMediaService({ database: db, config, clock, crypto, audit, apply: true });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      code: error instanceof ImportError ? error.code : 'LEGACY_AVATAR_IMPORT_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
