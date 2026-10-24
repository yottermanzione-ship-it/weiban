/**
 * 旧角色音色导入 CLI（operator-only）。
 *
 *   node dist/import-legacy-character-voices.js --input /abs/voices.json
 *   node dist/import-legacy-character-voices.js --input /abs/voices.json --apply \
 *     --operator-id <ACTIVE_ADMIN_UUID> --sample-root /srv/weiban/import/voice-samples
 *
 * 输入 JSON：{ "version": 1, "characters": [characters_v2 整行...], "bindings": [character_voice_bindings 整行...] }
 * 映射：旧 voice_json / qwen_voice_id（以及绑定已就绪的 qwen TTS 音色）→ media.voices(provider_voice_key,
 * model_key) → characters.default_voices。同 provider+key 已存在时复用；每角色只写一条默认音色。
 *
 * 默认 --dry-run：只读库、只出报告；--apply 才写 media.voices / characters.default_voices。
 * 无法映射的（缺 key、供应商已退役、只有 realtime、克隆样本缺失、已有音色被停用）逐条报告。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {
  LegacyVoiceImportInput,
  bindDefaultVoice,
  normalizeVoiceInput,
  planLegacyVoices,
  readVoiceExisting,
  type VoicePlanItem,
} from '../modules/characters/index.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import { createMediaVoiceImportService } from '../modules/media/index.js';
import { listVoiceMessageModelKeys } from '../modules/model-access/index.js';
import { AuditLog } from '../platform/audit/audit-log.js';
import { SystemClock } from '../platform/clock/clock.js';
import { loadConfig } from '../platform/config/config.js';
import { Database } from '../platform/db/database.js';

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const LOCK_KEY = 'characters:legacy-voice-import:v1';

class ImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface VoiceApplyTotals {
  createdVoices: number;
  reusedVoices: number;
  bound: number;
  conflicts: number;
  failed: number;
}

const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const fail = (code: string): never => {
  throw new ImportError(code);
};

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
      !['--input', '--operator-id', '--sample-root', '--report'].includes(arg) ||
      options[arg] ||
      !argv[i + 1] ||
      argv[i + 1]!.startsWith('--')
    )
      fail('ARGUMENT_INVALID');
    options[arg] = argv[++i]!;
  }
  if (help) return { help, apply: false, options };
  const file = options['--input'];
  if (!file) return fail('INPUT_REQUIRED');
  if (!path.isAbsolute(file)) fail('INPUT_MUST_BE_ABSOLUTE');
  if (options['--sample-root'] && !path.isAbsolute(options['--sample-root']!))
    fail('SAMPLE_ROOT_MUST_BE_ABSOLUTE');
  if (apply && !options['--operator-id']) fail('OPERATOR_REQUIRED_FOR_APPLY');
  return { help, apply, options, file };
}

function readInput(file: string): LegacyVoiceImportInput {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES)
    fail('INPUT_FILE_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('INPUT_JSON_INVALID');
  }
  const result = LegacyVoiceImportInput.safeParse(parsed);
  if (!result.success) fail('INPUT_SHAPE_INVALID');
  return result.data!;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    output({
      usage:
        'node dist/import-legacy-character-voices.js --input /absolute/voices.json [--apply --operator-id ADMIN_UUID] [--sample-root /absolute/dir] [--report /absolute/report.json]',
      default: 'dry-run (DB read-only, no writes)',
      input:
        '{ "version": 1, "characters": [characters_v2 rows], "bindings": [character_voice_bindings rows] }',
      mapping:
        'voice_json / qwen_voice_id / 已就绪 qwen TTS 绑定 → media.voices(provider_voice_key, model_key)，再写 characters.default_voices。',
      notes:
        '旧站 qwen 克隆音色使用 qwen-audio-3.0-tts-plus 模型；新库目录里没有该模型时仍会登记，但报告 modelNotRegistered，导入后不会出声。',
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
    const operatorId = parsed.options['--operator-id'];
    if (parsed.apply) {
      if (!operatorId || !(await isActiveMaintenanceAdmin(db, operatorId)))
        fail('ACTIVE_ADMIN_REQUIRED');
      const lock = await db.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('${LOCK_KEY}',0)) locked`,
      );
      if (!lock.rows[0]?.locked) fail('IMPORT_ALREADY_RUNNING');
      locked = true;
    }
    const normalized = normalizeVoiceInput(input);
    const voiceMedia = createMediaVoiceImportService(db, clock);
    const registeredModels = await listVoiceMessageModelKeys(db);
    const existing = await readVoiceExisting(
      db,
      normalized.characters.map((character) => character.id),
      await voiceMedia.listVoices(),
      registeredModels,
    );
    const plan = planLegacyVoices(input, existing, {
      sampleRoot: parsed.options['--sample-root'] ?? null,
    });
    for (const item of plan.items) {
      output({
        event: 'voice',
        characterId: item.characterId,
        name: item.name || undefined,
        status: item.status,
        issue: item.issue ?? undefined,
        voiceKey: item.candidate?.key,
        modelKey: item.candidate?.modelKey,
        source: item.candidate?.source,
        samplePresent: item.samplePresent ?? undefined,
        modelRegistered: item.modelRegistered ?? undefined,
      });
    }
    const mapped = plan.items.filter(
      (item): item is VoicePlanItem & { candidate: NonNullable<VoicePlanItem['candidate']> } =>
        item.status === 'mapped' && !!item.candidate,
    );
    let applied: VoiceApplyTotals | null = null;
    if (parsed.apply) {
      await audit.record({
        module: 'characters',
        action: 'legacy_voice_import.started',
        actorType: 'admin',
        actorId: operatorId!,
        targetType: 'legacy_character_voice_import',
        details: {
          total: plan.counts.total,
          mapped: plan.counts.mapped,
          wouldCreateVoices: plan.counts.wouldCreateVoices,
        },
      });
      applied = { createdVoices: 0, reusedVoices: 0, bound: 0, conflicts: 0, failed: 0 };
      for (const [index, item] of mapped.entries()) {
        try {
          const registered = await voiceMedia.ensureVoice({
            modelKey: item.candidate.modelKey,
            providerVoiceKey: item.candidate.key,
            name: `旧卡音色 ${item.candidate.key.slice(-12)}`,
            tags: item.candidate.clone ? ['legacy', 'clone'] : ['legacy'],
            enabled: true,
          });
          if (!registered.enabled)
            throw Object.assign(new Error('VOICE_DISABLED'), { code: 'VOICE_DISABLED' });
          const binding = await bindDefaultVoice(db, item.characterId, registered.id, clock.now());
          if (registered.created) applied.createdVoices++;
          else applied.reusedVoices++;
          if (binding.bound) applied.bound++;
          output({
            event: 'voice',
            index: index + 1,
            total: mapped.length,
            characterId: item.characterId,
            voiceId: registered.id,
            status: binding.bound ? 'bound' : 'already_bound',
            createdVoice: registered.created,
          });
        } catch (error) {
          const code = (error as { code?: string }).code ?? 'WRITE_FAILED';
          applied.failed++;
          if (code === 'BIND_CONFLICT') applied.conflicts++;
          output({
            event: 'voice',
            index: index + 1,
            total: mapped.length,
            characterId: item.characterId,
            status: 'failed',
            code,
          });
        }
      }
      await audit.record({
        module: 'characters',
        action: 'legacy_voice_import.finished',
        actorType: 'admin',
        actorId: operatorId!,
        targetType: 'legacy_character_voice_import',
        details: { ...applied },
      });
    }
    const report = {
      ok: (applied?.failed ?? 0) === 0,
      mode: parsed.apply ? 'apply' : 'dry-run',
      counts: plan.counts,
      modelNotRegistered: plan.modelNotRegistered,
      issues: plan.issues,
      ...(applied ? { apply: applied } : {}),
    };
    if (parsed.options['--report']) {
      const file = parsed.options['--report']!;
      if (!path.isAbsolute(file)) fail('REPORT_MUST_BE_ABSOLUTE');
      fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    }
    output(report);
    if ((applied?.failed ?? 0) > 0) process.exitCode = 1;
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
      code: error instanceof ImportError ? error.code : 'LEGACY_VOICE_IMPORT_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
