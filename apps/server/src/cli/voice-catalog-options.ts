/**
 * 批 V 语音目录补齐（voice-catalog.ts）与旧站实时音色迁入（import-legacy-realtime-voices.ts）的纯逻辑：
 * 参数解析、要登记的目录条目与价格、旧绑定过滤。不读库、不联网，便于单测。
 *
 * 价格口径（与 2026-10-23 语音内部价相同）：售价 = 参考成本 × 1.3；1 积分 = 0.01 元。金额单位：元。
 * - ASR：0.008333 元/分钟（MiMo 公开价 0.5 元/小时；硅基 TeleSpeech 当前免费，按同一可比付费参考成本）→ 售 0.010833。
 * - 千问 3.1 TTS Flash：官方按输入 / 输出 token 计费（1.5 / 12 元/百万），平台 TTS 仍按字符结算；
 *   默认按 3.0 TTS Plus 的 1.4 元/万字符作等价参考成本（偏保守），可用 --tts-flash-cost 改，首月按账单校准。
 * - 千问 Audio 3.0 Realtime Plus：官方分模态 token 成本 文字入 5 / 音频入 40 / 文字出 40 / 音频出 150 元/百万；
 *   缓存命中价未核实，按文字输入价计（不打折）。
 * - Omni 实时：价格未核实，必须由运维用 --omni-cost 明确给出四个成本价，否则不登记。
 */
import { AdminModelWrite, type RouteBillingBounds } from '@weiban/contracts';
import type { z } from 'zod';

export const VOICE_CATALOG_ITEMS = [
  'telespeech',
  'mimo-asr',
  'qwen-tts-flash',
  'qwen-realtime',
  'omni',
] as const;
export type VoiceCatalogItem = (typeof VOICE_CATALOG_ITEMS)[number];

export const REALTIME_PLUS_MODEL_KEY = 'qwen/qwen-audio-3.0-realtime-plus';
export const REALTIME_PLUS_UPSTREAM_MODEL = 'qwen-audio-3.0-realtime-plus';
const MARKUP = 1.3;
const ASR_COST_PER_MINUTE = 0.008333;
const PRICING_SOURCE = 'https://help.aliyun.com/zh/model-studio/model-pricing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VOICE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

/** 没有给出上游账号时，沿用这些已在生产启用的条目所在账号。实时 / Omni 必须显式给（私有 workspace 账号）。 */
export const UPSTREAM_REFERENCE: Partial<Record<VoiceCatalogItem, string>> = {
  telespeech: 'siliconflow/sensevoice-small',
  'mimo-asr': 'xiaomi/mimo-v2.5-tts',
  'qwen-tts-flash': 'qwen-audio-3.0-tts-plus',
};

export interface VoiceCatalogCommand {
  kind: 'show' | 'plan' | 'apply';
  operatorId: string | null;
  only: ReadonlySet<VoiceCatalogItem>;
  upstreams: Partial<Record<'siliconflow' | 'mimo' | 'dashscope' | 'realtime', string>>;
  enableRealtime: boolean;
  enableUnverified: boolean;
  ttsFlashCostPer10k: number;
  realtimeVoice: string;
  omni: { model: string; cost: [number, number, number, number]; voice: string | null } | null;
}

type Parsed<T> = { ok: true; command: T } | { ok: false; code: string; message: string };

function splitArgs(argv: readonly string[]): {
  flags: Set<string>;
  values: Map<string, string>;
  bad: string | null;
} {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) return { flags, values, bad: arg };
    const eq = arg.indexOf('=');
    if (eq > 0) values.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--'))
      values.set(arg.slice(2), argv[++i]!);
    else flags.add(arg.slice(2));
  }
  return { flags, values, bad: null };
}

const fail = <T>(code: string, message: string): Parsed<T> => ({ ok: false, code, message });

export function parseVoiceCatalogCommand(argv: readonly string[]): Parsed<VoiceCatalogCommand> {
  const { flags, values, bad } = splitArgs(argv);
  if (bad) return fail('BAD_ARGUMENT', `无法识别的参数：${bad}`);
  const known = new Set([
    'show',
    'apply',
    'operator-id',
    'only',
    'siliconflow-upstream',
    'mimo-upstream',
    'dashscope-upstream',
    'realtime-upstream',
    'enable-realtime',
    'enable-unverified',
    'tts-flash-cost',
    'realtime-voice',
    'omni-model',
    'omni-cost',
    'omni-voice',
  ]);
  for (const key of [...flags, ...values.keys()])
    if (!known.has(key)) return fail('BAD_ARGUMENT', `未知参数 --${key}`);
  const kind = flags.has('apply') ? 'apply' : flags.has('show') ? 'show' : 'plan';
  const operatorId = values.get('operator-id') ?? null;
  if (operatorId !== null && !UUID.test(operatorId))
    return fail('BAD_ARGUMENT', '--operator-id 必须是管理员用户 UUID');
  if (kind === 'apply' && !operatorId)
    return fail('OPERATOR_REQUIRED', '--apply 需要 --operator-id（写审计用）');
  const onlyRaw = values.get('only');
  const only = new Set<VoiceCatalogItem>();
  for (const item of onlyRaw ? onlyRaw.split(',') : VOICE_CATALOG_ITEMS) {
    const name = item.trim() as VoiceCatalogItem;
    if (!VOICE_CATALOG_ITEMS.includes(name))
      return fail('BAD_ARGUMENT', `--only 只能是 ${VOICE_CATALOG_ITEMS.join(', ')}`);
    only.add(name);
  }
  const upstreams: VoiceCatalogCommand['upstreams'] = {};
  for (const name of ['siliconflow', 'mimo', 'dashscope', 'realtime'] as const) {
    const id = values.get(`${name}-upstream`);
    if (id === undefined) continue;
    if (!UUID.test(id)) return fail('BAD_ARGUMENT', `--${name}-upstream 必须是上游账号 UUID`);
    upstreams[name] = id;
  }
  const ttsCostRaw = values.get('tts-flash-cost') ?? '1.4';
  const ttsFlashCostPer10k = Number(ttsCostRaw);
  if (!Number.isFinite(ttsFlashCostPer10k) || ttsFlashCostPer10k < 0 || ttsFlashCostPer10k > 100)
    return fail('BAD_ARGUMENT', '--tts-flash-cost 是 0～100 的元 / 万字符');
  const realtimeVoice = values.get('realtime-voice') ?? 'Cherry';
  if (!VOICE.test(realtimeVoice)) return fail('BAD_ARGUMENT', '--realtime-voice 不是合法音色代号');
  let omni: VoiceCatalogCommand['omni'] = null;
  const omniModel = values.get('omni-model');
  const omniCost = values.get('omni-cost');
  if (omniModel !== undefined || omniCost !== undefined) {
    if (
      !omniModel ||
      !MODEL_ID.test(omniModel) ||
      !/realtime/u.test(omniModel) ||
      !/omni/u.test(omniModel)
    )
      return fail('BAD_ARGUMENT', '--omni-model 必须是百炼 Omni 实时型号名（含 omni 与 realtime）');
    const cost = (omniCost ?? '').split(',').map((v) => Number(v.trim()));
    if (cost.length !== 4 || cost.some((v) => !Number.isFinite(v) || v < 0 || v > 10_000))
      return fail(
        'OMNI_PRICE_REQUIRED',
        '--omni-cost 必须给 4 个已核实的成本价：文字入,音频入,文字出,音频出（元 / 百万 token）',
      );
    const voice = values.get('omni-voice') ?? null;
    if (voice !== null && !VOICE.test(voice))
      return fail('BAD_ARGUMENT', '--omni-voice 不是合法音色代号');
    omni = { model: omniModel, cost: cost as [number, number, number, number], voice };
  }
  return {
    ok: true,
    command: {
      kind,
      operatorId,
      only,
      upstreams,
      enableRealtime: flags.has('enable-realtime'),
      enableUnverified: flags.has('enable-unverified'),
      ttsFlashCostPer10k,
      realtimeVoice,
      omni,
    },
  };
}

type Write = z.input<typeof AdminModelWrite>;

export interface PlannedEntry {
  item: VoiceCatalogItem;
  modelKey: string;
  /** 不含 upstreamId / 保留字段，由 CLI 结合现有条目补全。 */
  write: Omit<Write, 'upstreamId' | 'sortOrder' | 'leaderboardRank' | 'enabled'>;
  /** 本次是否打算启用（已启用的条目不会被关掉）。 */
  enable: boolean;
  upstream: { flag: keyof VoiceCatalogCommand['upstreams']; reference: string | null };
  /** 实时模型的默认系统音色（角色没有专属音色时用）。 */
  defaultVoice: string | null;
  notes: string[];
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const sell = (cost: number) => round6(cost * MARKUP);

function realtimeBounds(): RouteBillingBounds {
  return {
    format: 'billing-bounds-v1',
    sourceUrl: PRICING_SOURCE,
    realtime: { maxSessionSeconds: 3600, maxResponseOutputTokens: 2048, contextTokens: 32768 },
  };
}

function realtimeWrite(input: {
  modelKey: string;
  upstreamModelId: string;
  displayName: string;
  cost: [number, number, number, number];
}): PlannedEntry['write'] {
  const [textIn, audioIn, textOut, audioOut] = input.cost;
  return {
    modelKey: input.modelKey,
    displayName: input.displayName,
    vendorName: '阿里云百炼',
    upstreamModelId: input.upstreamModelId,
    capabilities: ['voice_input', 'voice_output'],
    tags: ['pipeline:rt'],
    defaultFor: [],
    scenarios: ['voice_call'],
    billingBounds: realtimeBounds(),
    rates: { input: sell(textIn), output: sell(textOut), cache: sell(textIn) },
    costRates: { input: textIn, output: textOut, cache: textIn },
    serviceRates: [
      { unit: 'audio_input_tokens_per_million', price: sell(audioIn), cost: audioIn },
      { unit: 'audio_output_tokens_per_million', price: sell(audioOut), cost: audioOut },
    ],
  };
}

function asrWrite(
  modelKey: string,
  upstreamModelId: string,
  displayName: string,
  vendorName: string,
) {
  return {
    modelKey,
    displayName,
    vendorName,
    upstreamModelId,
    capabilities: ['voice_input'],
    tags: [],
    defaultFor: [],
    scenarios: ['speech_recognition'],
    billingBounds: {
      format: 'billing-bounds-v1',
      asr: { maxSeconds: 600, billingStepSeconds: 1 },
    },
    rates: null,
    serviceRates: [
      { unit: 'asr_minute', price: sell(ASR_COST_PER_MINUTE), cost: ASR_COST_PER_MINUTE },
    ],
  } satisfies PlannedEntry['write'];
}

/** 本次要登记的目录条目（按 --only 过滤；Omni 没给价格时不登记）。 */
export function planVoiceCatalog(command: VoiceCatalogCommand): {
  entries: PlannedEntry[];
  skipped: Array<{ item: VoiceCatalogItem; reason: string }>;
} {
  const entries: PlannedEntry[] = [];
  const skipped: Array<{ item: VoiceCatalogItem; reason: string }> = [];
  const want = (item: VoiceCatalogItem) => command.only.has(item);
  if (want('telespeech'))
    entries.push({
      item: 'telespeech',
      modelKey: 'siliconflow/telespeech-asr',
      write: asrWrite(
        'siliconflow/telespeech-asr',
        'TeleAI/TeleSpeechASR',
        'TeleSpeech 语音识别',
        '硅基流动',
      ),
      enable: true,
      upstream: { flag: 'siliconflow', reference: UPSTREAM_REFERENCE.telespeech! },
      defaultVoice: null,
      notes: ['硅基流动当前免费；按可比付费参考成本 0.008333 元/分钟 × 1.3 售价'],
    });
  if (want('mimo-asr'))
    entries.push({
      item: 'mimo-asr',
      modelKey: 'xiaomi/mimo-v2.5-asr',
      write: asrWrite('xiaomi/mimo-v2.5-asr', 'mimo-v2.5-asr', 'MiMo 语音识别', '小米 MiMo'),
      enable: command.enableUnverified,
      upstream: { flag: 'mimo', reference: UPSTREAM_REFERENCE['mimo-asr']! },
      defaultVoice: null,
      notes: command.enableUnverified
        ? ['型号名未经真实账号核实，已按 --enable-unverified 启用']
        : [
            '型号名未经真实账号核实：登记为停用；后台「测试」通过后再启用（或加 --enable-unverified）',
          ],
    });
  if (want('qwen-tts-flash'))
    entries.push({
      item: 'qwen-tts-flash',
      modelKey: 'qwen/qwen-audio-3.1-tts-flash',
      write: {
        modelKey: 'qwen/qwen-audio-3.1-tts-flash',
        displayName: '千问 3.1 TTS Flash',
        vendorName: '阿里云百炼',
        upstreamModelId: 'qwen-audio-3.1-tts-flash',
        capabilities: ['voice_output'],
        tags: [],
        defaultFor: [],
        scenarios: ['voice_message'],
        billingBounds: {
          format: 'billing-bounds-v1',
          tts: { maxTextBytes: 8000, counting: 'codepoints' },
        },
        rates: null,
        serviceRates: [
          {
            unit: 'tts_10k_chars',
            price: sell(command.ttsFlashCostPer10k),
            cost: command.ttsFlashCostPer10k,
          },
        ],
      },
      enable: true,
      upstream: { flag: 'dashscope', reference: UPSTREAM_REFERENCE['qwen-tts-flash']! },
      defaultVoice: null,
      notes: [
        `官方按 token 计费（1.5 / 12 元/百万）；平台按字符结算，等价参考成本 ${command.ttsFlashCostPer10k} 元/万字符，需按首月账单校准`,
      ],
    });
  if (want('qwen-realtime'))
    entries.push({
      item: 'qwen-realtime',
      modelKey: REALTIME_PLUS_MODEL_KEY,
      write: realtimeWrite({
        modelKey: REALTIME_PLUS_MODEL_KEY,
        upstreamModelId: REALTIME_PLUS_UPSTREAM_MODEL,
        displayName: '千问实时语音通话',
        cost: [5, 40, 40, 150],
      }),
      enable: command.enableRealtime,
      upstream: { flag: 'realtime', reference: null },
      defaultVoice: command.realtimeVoice,
      notes: [
        '缓存命中价未核实，按文字输入价计',
        command.enableRealtime
          ? '已按 --enable-realtime 启用'
          : '登记为停用：真实冒烟通过后在后台启用（或重跑加 --enable-realtime）',
      ],
    });
  if (want('omni')) {
    if (!command.omni)
      skipped.push({
        item: 'omni',
        reason: 'Omni 实时价格未核实：给出 --omni-model 与 --omni-cost 后才登记',
      });
    else
      entries.push({
        item: 'omni',
        modelKey: `qwen/${command.omni.model}`,
        write: realtimeWrite({
          modelKey: `qwen/${command.omni.model}`,
          upstreamModelId: command.omni.model,
          displayName: '千问 Omni 实时通话',
          cost: command.omni.cost,
        }),
        enable: command.enableRealtime,
        upstream: { flag: 'realtime', reference: null },
        defaultVoice: command.omni.voice,
        notes: [
          '价格来自 --omni-cost（运维核实）',
          command.omni.voice ? '' : '没有给 --omni-voice：只有带专属音色的角色能接通',
        ].filter(Boolean),
      });
  }
  return { entries, skipped };
}

/** 补全为可提交的 AdminModelWrite（保留现有条目的排序、名次；已启用的不关掉）。 */
export function completeWrite(
  planned: PlannedEntry,
  input: {
    upstreamId: string;
    existing: {
      sortOrder: number;
      leaderboardRank: number | null;
      enabled: boolean;
    } | null;
  },
): z.output<typeof AdminModelWrite> {
  return AdminModelWrite.parse({
    ...planned.write,
    upstreamId: input.upstreamId,
    sortOrder: input.existing?.sortOrder ?? 900,
    leaderboardRank: input.existing?.leaderboardRank ?? null,
    enabled: (input.existing?.enabled ?? false) || planned.enable,
  });
}

// ---------- 旧站实时音色绑定迁入 ----------

export interface LegacyRealtimeVoiceCommand {
  input: string;
  apply: boolean;
  operatorId: string | null;
  /** 只迁这个旧账号（端点 ID 前缀，至少 8 位）下的绑定；复刻音色只在登记它的 workspace 有效。 */
  endpointPrefix: string;
  /** 旧型号 → 新目录模型键。 */
  modelMap: ReadonlyMap<string, string>;
}

/** 不迁移的另一个私有 workspace（总负责人明确不用）。 */
export const FORBIDDEN_ENDPOINT_PREFIX = '156';

export function parseLegacyRealtimeVoiceCommand(
  argv: readonly string[],
): Parsed<LegacyRealtimeVoiceCommand> {
  const { flags, values, bad } = splitArgs(argv);
  if (bad) return fail('BAD_ARGUMENT', `无法识别的参数：${bad}`);
  const known = new Set(['input', 'apply', 'operator-id', 'endpoint-prefix', 'map']);
  for (const key of [...flags, ...values.keys()])
    if (!known.has(key)) return fail('BAD_ARGUMENT', `未知参数 --${key}`);
  const input = values.get('input');
  if (!input) return fail('BAD_ARGUMENT', '需要 --input <绑定导出 JSON 的绝对路径>');
  const apply = flags.has('apply');
  const operatorId = values.get('operator-id') ?? null;
  if (operatorId !== null && !UUID.test(operatorId))
    return fail('BAD_ARGUMENT', '--operator-id 必须是管理员用户 UUID');
  if (apply && !operatorId) return fail('OPERATOR_REQUIRED', '--apply 需要 --operator-id');
  const endpointPrefix = (values.get('endpoint-prefix') ?? '').toLowerCase();
  if (!/^[0-9a-z-]{8,64}$/u.test(endpointPrefix))
    return fail('BAD_ARGUMENT', '--endpoint-prefix 至少 8 位（例 8d1b5e3b）');
  if (endpointPrefix.startsWith(FORBIDDEN_ENDPOINT_PREFIX))
    return fail('ENDPOINT_FORBIDDEN', '156 开头的私有 workspace 不迁移');
  const modelMap = new Map<string, string>([
    [REALTIME_PLUS_UPSTREAM_MODEL, REALTIME_PLUS_MODEL_KEY],
  ]);
  const map = values.get('map');
  if (map)
    for (const pair of map.split(',')) {
      const [from, to] = pair.split('=').map((s) => s?.trim() ?? '');
      if (
        !from ||
        !to ||
        !MODEL_ID.test(from) ||
        !/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:-]+$/u.test(to)
      )
        return fail('BAD_ARGUMENT', '--map 形如 旧型号=新模型键[,旧型号=新模型键]');
      modelMap.set(from, to);
    }
  return { ok: true, command: { input, apply, operatorId, endpointPrefix, modelMap } };
}

export interface LegacyRealtimeBindingPlan {
  rows: Array<{ characterId: string; modelKey: string; providerVoiceKey: string }>;
  skipped: Record<
    'other_endpoint' | 'not_realtime' | 'unmapped_model' | 'not_ready' | 'invalid' | 'duplicate',
    number
  >;
  byModel: Record<string, number>;
}

const text = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * 旧库 character_voice_bindings 行 → 新库 realtime_voice_bindings 行。只取：指定账号、实时型号、
 * 状态 ready、音色代号合法、角色 ID 是 UUID；同一 (角色, 模型) 只取第一条。
 */
export function planLegacyRealtimeBindings(
  raw: unknown,
  command: Pick<LegacyRealtimeVoiceCommand, 'endpointPrefix' | 'modelMap'>,
): LegacyRealtimeBindingPlan {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { bindings?: unknown } | null)?.bindings)
      ? (raw as { bindings: unknown[] }).bindings
      : [];
  const plan: LegacyRealtimeBindingPlan = {
    rows: [],
    skipped: {
      other_endpoint: 0,
      not_realtime: 0,
      unmapped_model: 0,
      not_ready: 0,
      invalid: 0,
      duplicate: 0,
    },
    byModel: {},
  };
  const seen = new Set<string>();
  for (const item of list) {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const endpoint = text(row, ['endpoint_id', 'endpointId']).toLowerCase();
    const model = text(row, ['model']).toLowerCase();
    const characterId = text(row, ['character_id', 'characterId']).toLowerCase();
    const voice = text(row, ['voice_id', 'voiceId']);
    const status = text(row, ['status']).toLowerCase();
    if (!endpoint.startsWith(command.endpointPrefix)) {
      plan.skipped.other_endpoint++;
      continue;
    }
    if (!/realtime/u.test(model)) {
      plan.skipped.not_realtime++;
      continue;
    }
    const modelKey = command.modelMap.get(model);
    if (!modelKey) {
      plan.skipped.unmapped_model++;
      continue;
    }
    if (status !== 'ready') {
      plan.skipped.not_ready++;
      continue;
    }
    if (!UUID.test(characterId) || !VOICE.test(voice)) {
      plan.skipped.invalid++;
      continue;
    }
    const key = `${characterId}|${modelKey}`;
    if (seen.has(key)) {
      plan.skipped.duplicate++;
      continue;
    }
    seen.add(key);
    plan.rows.push({ characterId, modelKey, providerVoiceKey: voice });
    plan.byModel[modelKey] = (plan.byModel[modelKey] ?? 0) + 1;
  }
  return plan;
}
