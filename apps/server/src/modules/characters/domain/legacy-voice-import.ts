/**
 * 旧卡角色音色导入的纯逻辑：读旧库 characters_v2 的 voice_json / qwen_voice_id（以及可选的
 * character_voice_bindings），映射到新库 media.voices(provider_voice_key, model_key) +
 * characters.default_voices（每角色一个默认音色）。
 *
 * 这里不写库、不加密；只产出「哪个角色映射到哪个音色、哪些无法映射、为什么」。apply 由
 * legacy-voice-apply.ts 完成。无法映射的逐条进 issues，绝不静默跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const LegacyVoiceImportInput = z.object({
  version: z.literal(1).optional(),
  /** 旧库 characters_v2 整行（也接受驼峰字段）。 */
  characters: z.array(z.record(z.string(), z.unknown())).min(1),
  /** 可选：旧库 character_voice_bindings 整行；有它可补出 qwen_voice_id 为空但绑定已就绪的角色。 */
  bindings: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type LegacyVoiceImportInput = z.infer<typeof LegacyVoiceImportInput>;

export type LegacyVoiceSource = 'qwen_voice_id' | 'voice_json' | 'binding';

export interface LegacyVoiceBinding {
  characterId: string;
  provider: string;
  voiceId: string;
  model: string;
  status: string;
}

export interface LegacyVoiceCharacter {
  id: string;
  name: string;
  provider: string;
  primaryProvider: string;
  qwenVoiceId: string;
  voiceJson: Record<string, unknown> | null;
  samplePath: string;
  sampleUrl: string;
  bindings: LegacyVoiceBinding[];
}

export interface LegacyVoiceCandidate {
  key: string;
  modelKey: string;
  provider: 'qwen' | 'mimo';
  source: LegacyVoiceSource;
  /** 克隆音色需要旧站样本作为来源凭证；系统音色不需要。 */
  clone: boolean;
  samplePath: string;
  sampleUrl: string;
}

export type VoiceIssueCode =
  | 'row_invalid'
  | 'character_missing'
  | 'no_voice_key'
  | 'clone_sample_missing'
  | 'unsupported_provider'
  | 'provider_retired'
  | 'realtime_only'
  | 'existing_voice_disabled'
  | 'bind_conflict';

export interface VoiceImportIssue {
  characterId: string;
  name?: string;
  code: VoiceIssueCode;
  detail?: string;
}

export interface VoicePlanItem {
  characterId: string;
  name: string;
  status: 'mapped' | 'already_bound' | 'character_missing' | 'unmapped';
  candidate: LegacyVoiceCandidate | null;
  existingVoiceId: string | null;
  existingVoiceEnabled: boolean | null;
  issue: VoiceIssueCode | null;
  samplePresent: boolean | null;
  modelRegistered: boolean | null;
}

export interface VoiceImportCounts {
  total: number;
  mapped: number;
  alreadyBound: number;
  unmapped: number;
  wouldCreateVoices: number;
  reuseVoices: number;
  wouldBind: number;
  characterMissing: number;
  invalidRow: number;
  noKey: number;
  cloneSampleMissing: number;
  unsupportedProvider: number;
  providerRetired: number;
  realtimeOnly: number;
  existingVoiceDisabled: number;
}

export interface VoiceImportPlan {
  items: VoicePlanItem[];
  issues: VoiceImportIssue[];
  counts: VoiceImportCounts;
  /** 映射成功但新库 model_access.model_catalog 里没有/停用的 model_key。 */
  modelNotRegistered: string[];
}

export interface VoiceExisting {
  characterIds: ReadonlySet<string>;
  /** characterId → 已绑定的 media.voices.id。 */
  boundVoiceIds: ReadonlyMap<string, string>;
  /** `${modelKey}\u0000${providerVoiceKey}` → 音色。 */
  voicesByKey: ReadonlyMap<string, { id: string; enabled: boolean }>;
  /** 新库目录里 enabled 的 speech_synthesis model_key。 */
  registeredModels: ReadonlySet<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const QWEN_TTS_MODEL = 'qwen-audio-3.0-tts-plus';
const MIMO_TTS_MODEL = 'xiaomi/mimo-v2.5-tts';

export function voiceKeyId(modelKey: string, providerVoiceKey: string): string {
  return `${modelKey}\u0000${providerVoiceKey}`;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(record: Record<string, unknown> | null, keys: readonly string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = textOf(record[key]);
    if (value) return value;
  }
  return '';
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      return recordOf(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return recordOf(value);
}

/** 旧行 / 驼峰行都能读；bindings 可来自顶层数组或每行的 bindings / voiceBindings。 */
export function normalizeVoiceInput(input: LegacyVoiceImportInput): {
  characters: LegacyVoiceCharacter[];
  invalid: Array<{ index: number; id: string }>;
} {
  const globalBindings = (input.bindings ?? []).map(bindingOf).filter((row) => !!row.characterId);
  const characters: LegacyVoiceCharacter[] = [];
  const invalid: Array<{ index: number; id: string }> = [];
  for (const [index, row] of input.characters.entries()) {
    const id = firstText(row, ['id', 'character_id', 'characterId']);
    if (!UUID_RE.test(id)) {
      invalid.push({ index, id });
      continue;
    }
    const ownBindings = [
      ...(Array.isArray(row.bindings) ? row.bindings : []),
      ...(Array.isArray(row.voiceBindings) ? row.voiceBindings : []),
    ]
      .map((value) => {
        const binding = bindingOf(value);
        // 行内嵌的绑定常常省掉 character_id；以当前角色补上。
        return { ...binding, characterId: binding.characterId || id };
      })
      .filter((binding) => binding.characterId === id);
    const voiceJson = parseJsonRecord(row.voice_json ?? row.voiceJson ?? row.voice);
    characters.push({
      id,
      name: firstText(row, ['display_name', 'name', 'displayName']),
      provider:
        firstText(voiceJson, ['provider']) || firstText(row, ['voice_provider', 'voiceProvider']),
      primaryProvider:
        firstText(voiceJson, ['primary_provider', 'primaryProvider']) ||
        firstText(row, ['voice_primary_provider', 'voicePrimaryProvider']),
      qwenVoiceId: firstText(row, ['qwen_voice_id', 'qwenVoiceId']),
      voiceJson,
      samplePath: firstText(row, ['mimo_voice_sample_path', 'mimoVoiceSamplePath']),
      sampleUrl: firstText(row, ['mimo_voice_sample_url', 'mimoVoiceSampleUrl']),
      bindings: [...ownBindings, ...globalBindings.filter((binding) => binding.characterId === id)],
    });
  }
  return { characters, invalid };
}

function bindingOf(value: unknown): LegacyVoiceBinding {
  const row = recordOf(value) ?? {};
  return {
    characterId: firstText(row, ['character_id', 'characterId']),
    provider: firstText(row, ['provider']),
    voiceId: firstText(row, ['voice_id', 'voiceId']),
    model: firstText(row, ['model']),
    status: firstText(row, ['status']),
  };
}

type KeyKind =
  | { kind: 'qwen_tts'; modelKey: string; clone: boolean }
  | { kind: 'mimo_clone'; modelKey: string; clone: true }
  | { kind: 'retired' }
  | { kind: 'realtime' }
  | { kind: 'unknown' };

/** 音色键 → 新库 TTS 模型；旧站已退役的 flash、只能通话的 realtime/omni 不当作可用 TTS。 */
export function classifyVoiceKey(
  key: string,
  input: { provider?: string; model?: string } = {},
): KeyKind {
  const lower = key.trim().toLowerCase();
  if (!lower) return { kind: 'unknown' };
  const model = (input.model ?? '').toLowerCase();
  const provider = (input.provider ?? '').toLowerCase();
  if (model.includes('tts-flash') || lower.includes('tts-flash') || lower.includes('flash-wb'))
    return { kind: 'retired' };
  if (model.includes('tts-plus') || lower.startsWith('qwen-audio-3.0-tts-plus'))
    return {
      kind: 'qwen_tts',
      modelKey: QWEN_TTS_MODEL,
      clone: lower.includes('-wb-'),
    };
  if (
    model.includes('realtime') ||
    lower.startsWith('qwen-audio-3.0-realtime-plus') ||
    lower.startsWith('qwen-omni-vc-') ||
    lower.startsWith('qwen3.5-omni')
  )
    return { kind: 'realtime' };
  if (provider === 'mimo_voiceclone' || provider === 'mimo' || provider === 'xiaomi_mimo')
    return { kind: 'mimo_clone', modelKey: MIMO_TTS_MODEL, clone: true };
  // 旧站 qwen 里还有少量系统音色名（如 huangjingyu_male）；按 qwen TTS 登记，报告里会标未验证。
  if (/^[a-z0-9][a-z0-9._-]{1,119}$/u.test(lower) && (!provider || provider === 'qwen'))
    return { kind: 'qwen_tts', modelKey: QWEN_TTS_MODEL, clone: false };
  return { kind: 'unknown' };
}

/** 旧站样本的本地路径解析：先按原路径，再按 --sample-root 下的同名文件。 */
export function resolveSamplePath(
  character: Pick<LegacyVoiceCharacter, 'samplePath' | 'sampleUrl'>,
  sampleRoot: string | null,
  exists: (file: string) => boolean = (file) => fs.existsSync(file),
): string | null {
  const candidates: string[] = [];
  if (character.samplePath) candidates.push(character.samplePath);
  const urlPath = character.sampleUrl
    ? (() => {
        try {
          const parsed = new URL(character.sampleUrl, 'https://legacy.invalid');
          return decodeURIComponent(parsed.pathname);
        } catch {
          return '';
        }
      })()
    : '';
  if (sampleRoot && urlPath) candidates.push(path.join(sampleRoot, path.basename(urlPath)));
  if (sampleRoot && character.samplePath)
    candidates.push(path.join(sampleRoot, path.basename(character.samplePath)));
  for (const candidate of candidates) if (candidate && exists(candidate)) return candidate;
  return null;
}

/** 候选顺序：qwen_voice_id → voice_json 常见字段 → 已就绪的 qwen TTS 绑定。 */
export function voiceCandidatesOf(character: LegacyVoiceCharacter): LegacyVoiceCandidate[] {
  const out: LegacyVoiceCandidate[] = [];
  const seen = new Set<string>();
  const add = (rawKey: string, source: LegacyVoiceSource, binding?: LegacyVoiceBinding) => {
    const key = rawKey.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const kind = classifyVoiceKey(key, {
      provider: binding?.provider || character.provider,
      model: binding?.model,
    });
    if (kind.kind === 'qwen_tts' || kind.kind === 'mimo_clone')
      out.push({
        key,
        modelKey: kind.modelKey,
        provider: kind.kind === 'mimo_clone' ? 'mimo' : 'qwen',
        source,
        clone: kind.clone,
        samplePath: character.samplePath,
        sampleUrl: character.sampleUrl,
      });
  };
  add(character.qwenVoiceId, 'qwen_voice_id');
  if (character.provider === 'mimo_voiceclone' || character.provider === 'mimo') {
    add(firstText(character.voiceJson, ['voice_id', 'voiceId', 'id']), 'voice_json');
  } else {
    for (const key of ['qwen_voice_id', 'qwenVoiceId', 'voice_id', 'voiceId', 'id']) {
      const value = firstText(character.voiceJson, [key]);
      if (value) add(value, 'voice_json');
    }
    for (const key of ['provider_voice_id', 'providerVoiceId']) {
      const value = firstText(character.voiceJson, [key]);
      if (value) add(value, 'voice_json');
    }
  }
  for (const binding of character.bindings) {
    if (binding.provider !== 'qwen' || binding.status !== 'ready') continue;
    if (!binding.model.includes('tts-plus') || binding.model.includes('realtime')) continue;
    add(binding.voiceId, 'binding', binding);
  }
  return out;
}

/** 未被采用的候选原因汇总，用于给逐条报告一个准确的原因。 */
function rejectionOf(character: LegacyVoiceCharacter): VoiceIssueCode {
  const keys = [
    character.qwenVoiceId,
    ...['qwen_voice_id', 'qwenVoiceId', 'voice_id', 'voiceId', 'id'].map((key) =>
      firstText(character.voiceJson, [key]),
    ),
    ...character.bindings.filter((binding) => binding.provider === 'qwen').map((b) => b.voiceId),
  ].filter(Boolean);
  if (!keys.length) return 'no_voice_key';
  const kinds = keys.map((key) =>
    classifyVoiceKey(key, {
      provider: character.provider,
      model: character.bindings.find((binding) => binding.voiceId === key)?.model,
    }),
  );
  if (kinds.some((kind) => kind.kind === 'retired')) return 'provider_retired';
  if (kinds.some((kind) => kind.kind === 'realtime')) return 'realtime_only';
  return 'unsupported_provider';
}

export function planLegacyVoices(
  input: LegacyVoiceImportInput,
  existing: VoiceExisting,
  options: { sampleRoot?: string | null; sampleExists?: (file: string) => boolean } = {},
): VoiceImportPlan {
  const { characters, invalid } = normalizeVoiceInput(input);
  const issues: VoiceImportIssue[] = invalid.map((row) => ({
    characterId: row.id || `#${row.index + 1}`,
    code: 'row_invalid',
  }));
  const counts: VoiceImportCounts = {
    total: characters.length + invalid.length,
    mapped: 0,
    alreadyBound: 0,
    unmapped: 0,
    wouldCreateVoices: 0,
    reuseVoices: 0,
    wouldBind: 0,
    characterMissing: 0,
    invalidRow: invalid.length,
    noKey: 0,
    cloneSampleMissing: 0,
    unsupportedProvider: 0,
    providerRetired: 0,
    realtimeOnly: 0,
    existingVoiceDisabled: 0,
  };
  const items: VoicePlanItem[] = [];
  const modelNotRegistered = new Set<string>();
  const newVoiceKeys = new Set<string>();
  const reusedVoiceKeys = new Set<string>();
  const sampleExists = options.sampleExists ?? ((file: string) => fs.existsSync(file));

  for (const character of characters) {
    const base = {
      characterId: character.id,
      name: character.name,
      candidate: null,
      existingVoiceId: null,
      existingVoiceEnabled: null,
      issue: null,
      samplePresent: null,
      modelRegistered: null,
    } satisfies Omit<VoicePlanItem, 'status'>;
    if (!existing.characterIds.has(character.id)) {
      counts.characterMissing++;
      counts.unmapped++;
      issues.push({ characterId: character.id, name: character.name, code: 'character_missing' });
      items.push({ ...base, status: 'character_missing', issue: 'character_missing' });
      continue;
    }
    const bound = existing.boundVoiceIds.get(character.id);
    if (bound) {
      counts.alreadyBound++;
      items.push({ ...base, status: 'already_bound', existingVoiceId: bound });
      continue;
    }
    const candidates = voiceCandidatesOf(character);
    let chosen: LegacyVoiceCandidate | null = null;
    let samplePresent: boolean | null = null;
    let rejectedForSample = false;
    for (const candidate of candidates) {
      if (candidate.clone) {
        const resolved = resolveSamplePath(character, options.sampleRoot ?? null, sampleExists);
        samplePresent = !!resolved || !!candidate.sampleUrl;
        if (!samplePresent) {
          rejectedForSample = true;
          continue;
        }
      }
      chosen = candidate;
      break;
    }
    if (!chosen) {
      const code =
        candidates.length && rejectedForSample ? 'clone_sample_missing' : rejectionOf(character);
      counts.unmapped++;
      countIssue(counts, code);
      issues.push({ characterId: character.id, name: character.name, code });
      items.push({ ...base, status: 'unmapped', issue: code, samplePresent });
      continue;
    }
    const key = voiceKeyId(chosen.modelKey, chosen.key);
    const stored = existing.voicesByKey.get(key);
    if (stored && !stored.enabled) {
      counts.unmapped++;
      counts.existingVoiceDisabled++;
      issues.push({
        characterId: character.id,
        name: character.name,
        code: 'existing_voice_disabled',
        detail: stored.id,
      });
      items.push({
        ...base,
        status: 'unmapped',
        candidate: chosen,
        existingVoiceId: stored.id,
        existingVoiceEnabled: false,
        issue: 'existing_voice_disabled',
        samplePresent,
      });
      continue;
    }
    counts.mapped++;
    counts.wouldBind++;
    if (stored) reusedVoiceKeys.add(key);
    else newVoiceKeys.add(key);
    const modelRegistered = existing.registeredModels.has(chosen.modelKey);
    if (!modelRegistered) modelNotRegistered.add(chosen.modelKey);
    items.push({
      ...base,
      status: 'mapped',
      candidate: chosen,
      existingVoiceId: stored?.id ?? null,
      existingVoiceEnabled: stored?.enabled ?? null,
      samplePresent,
      modelRegistered,
    });
  }
  return {
    items,
    issues,
    counts: {
      ...counts,
      wouldCreateVoices: newVoiceKeys.size,
      reuseVoices: reusedVoiceKeys.size,
    },
    modelNotRegistered: [...modelNotRegistered].sort(),
  };
}

function countIssue(counts: VoiceImportCounts, code: VoiceIssueCode): void {
  switch (code) {
    case 'no_voice_key':
      counts.noKey++;
      break;
    case 'clone_sample_missing':
      counts.cloneSampleMissing++;
      break;
    case 'unsupported_provider':
      counts.unsupportedProvider++;
      break;
    case 'provider_retired':
      counts.providerRetired++;
      break;
    case 'realtime_only':
      counts.realtimeOnly++;
      break;
    default:
      break;
  }
}
