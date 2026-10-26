/**
 * 旧角色卡导入 CLI（operator-only）。
 *
 *   node dist/import-legacy-characters.js --input /abs/legacy.json
 *   node dist/import-legacy-characters.js --input /abs/legacy.json --apply --operator-id <ADMIN_UUID>
 *
 * 输入 JSON：{ "characters": [...], "lorebook": [...], "examples": [...] }
 *   - characters 是旧库 characters_v2 的整行；原样进 characters.legacy_card，不转新卡；
 *   - lorebook / examples 是旧库两张附属表的整行，原样进 legacy_lorebook_entries / legacy_example_dialogues。
 *
 * 默认 --dry-run：只读库、只输出报告，不写任何行；--apply 才写。
 * 幂等：按旧 id 去重；中途失败后重跑会跳过已导入的批次，继续导入剩余行。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyLegacyImportPlan,
  buildLegacyImportPlan,
  legacyImportReport,
  readLegacyImportExisting,
  type LegacyImportInput,
} from '../modules/characters/index.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import { AuditLog } from '../platform/audit/audit-log.js';
import { SystemClock } from '../platform/clock/clock.js';
import { loadConfig } from '../platform/config/config.js';
import { Database } from '../platform/db/database.js';

const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const DEFAULT_BATCH_SIZE = 200;
const LOCK_KEY = 'characters:legacy-import:v1';

class ImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string): never {
  throw new ImportError(code);
}

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};
  let apply = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--apply') {
      if (apply) fail('DUPLICATE_ARGUMENT');
      apply = true;
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
  if (help) return { help, apply: false, options };
  const file = options['--input'];
  if (!file) fail('INPUT_REQUIRED');
  if (!path.isAbsolute(file)) fail('INPUT_MUST_BE_ABSOLUTE');
  const batchSize = Number.parseInt(options['--batch-size'] ?? String(DEFAULT_BATCH_SIZE), 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) fail('BATCH_SIZE_INVALID');
  if (apply && !options['--operator-id']) fail('OPERATOR_REQUIRED_FOR_APPLY');
  return { help, apply, options, file, batchSize };
}

function readInput(file: string): LegacyImportInput {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES)
    fail('INPUT_FILE_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('INPUT_JSON_INVALID');
  }
  const record =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) fail('INPUT_SHAPE_INVALID');
  const arrays = ['characters', 'lorebook', 'examples'] as const;
  for (const key of arrays)
    if (!Array.isArray(record[key])) fail(`INPUT_${key.toUpperCase()}_INVALID`);
  return {
    characters: record.characters as unknown[],
    lorebook: record.lorebook as unknown[],
    examples: record.examples as unknown[],
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    output({
      usage:
        'node dist/import-legacy-characters.js --input /absolute/legacy.json [--apply --operator-id ADMIN_UUID] [--batch-size 200] [--report /absolute/report.json]',
      default: 'dry-run (DB read-only, no writes)',
      input: '{ "characters": [...], "lorebook": [...], "examples": [...] }',
      notes:
        'characters_v2 整行原样进 legacy_card；世界书 / 示例整行进附属表；按旧 id 幂等，可中断后重跑。',
    });
    return;
  }
  const input = readInput(parsed.file!);
  const config = loadConfig();
  const clock = new SystemClock();
  const db = new Database({ url: config.database.url, poolMax: 1 });
  const audit = new AuditLog(db, clock);
  let locked = false;
  try {
    if (!parsed.apply) await db.query('SET default_transaction_read_only=on');
    if (parsed.apply) {
      const operatorId = parsed.options['--operator-id']!;
      if (!(await isActiveMaintenanceAdmin(db, operatorId))) fail('ACTIVE_ADMIN_REQUIRED');
      const lock = await db.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('${LOCK_KEY}',0)) locked`,
      );
      if (!lock.rows[0]?.locked) fail('IMPORT_ALREADY_RUNNING');
      locked = true;
      await audit.record({
        module: 'characters',
        action: 'legacy_import.started',
        actorType: 'admin',
        actorId: operatorId,
        targetType: 'legacy_character_import',
        details: {
          characters: input.characters.length,
          lorebook: input.lorebook.length,
          examples: input.examples.length,
        },
      });
    }
    const existing = await readLegacyImportExisting(db);
    const plan = buildLegacyImportPlan(input, existing);
    const report = legacyImportReport(plan);
    if (parsed.apply)
      await applyLegacyImportPlan(db, plan, {
        batchSize: parsed.batchSize!,
        now: clock.now(),
        progress: output,
      });
    const result = { ok: true, mode: parsed.apply ? 'apply' : 'dry-run', report };
    if (parsed.options['--report']) {
      const file = parsed.options['--report']!;
      if (!path.isAbsolute(file)) fail('REPORT_MUST_BE_ABSOLUTE');
      fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    }
    if (parsed.apply) {
      await audit.record({
        module: 'characters',
        action: 'legacy_import.finished',
        actorType: 'admin',
        actorId: parsed.options['--operator-id']!,
        targetType: 'legacy_character_import',
        details: {
          createdCharacters: plan.characters.toCreate.length,
          createdLorebook: plan.lorebook.toCreate.length,
          createdExamples: plan.examples.toCreate.length,
        },
      });
    }
    output(result);
  } finally {
    if (locked)
      await db
        .query(`SELECT pg_advisory_unlock(hashtextextended('${LOCK_KEY}',0))`)
        .catch(() => undefined);
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      code: error instanceof ImportError ? error.code : 'LEGACY_CHARACTER_IMPORT_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
