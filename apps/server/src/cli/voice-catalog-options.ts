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
 *
 * V2（2026-10-28）：实时通话全部走新站已有的公共百炼账号（不迁旧版私有 workspace）。实时 / Omni 不给
 * --realtime-upstream 时沿用千问 TTS 所在的百炼账号；Omni 显示名带版本（「千问 Omni 3.5 Plus 实时通话」）；
 * --fix-omni 只改现有 Omni 条目的显示名并补已核实的默认音色，不动价格与启用状态。
 *
 * V3（2026-10-28）：
 * - 新增 qwen-realtime-3.1（qwen-audio-3.1-realtime-plus）：官方北京价与 3.0 Plus 相同 5 / 40 / 40 / 150 元/百万，
 *   协议与 3.0 相同（只换 model 与音色），默认音色 longanqian_v3.1；默认停用、挂公共百炼账号。
 *   https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-realtime-plus
 *   https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides
 * - 3.0 Plus 默认音色改为官方 longanqian（3.0 只接受 longanqian 等 5 个音色，原先的 Cherry 不在其中）。
 * - Omni 复刻费由用户承担（契约 4.6 voice_clone）：成本 0.01 元/个、售价 0.013；Qwen Audio Realtime 官方
 *   「创建音色免费」，不登记复刻价（https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide）。
 *   --omni-clone-price 给现有 Omni 条目补登记复刻价（只改这一项服务单价）。
 * - --attach-workspace 把 Realtime Plus 条目改挂迁入的北京 workspace 上游（planWorkspaceAttach）。
 * - 已有条目重跑时沿用它当前的上游账号（不会把已改挂北京 workspace 的 3.0 挂回公共账号），除非显式给 --realtime-upstream。
 */
import { AdminModelWrite, type RouteBillingBounds } from '@weiban/contracts';
import type { z } from 'zod';

export const VOICE_CATALOG_ITEMS = [
  'telespeech',
  'mimo-asr',
  'qwen-tts-flash',
  'qwen-realtime',
  'qwen-realtime-3.1',
  'omni',
] as const;
export type VoiceCatalogItem = (typeof VOICE_CATALOG_ITEMS)[number];
/** 实时通话条目（上游账号必须是百炼）。 */
export const REALTIME_ITEMS: readonly VoiceCatalogItem[] = [
  'qwen-realtime',
  'qwen-realtime-3.1',
  'omni',
];

export const REALTIME_PLUS_MODEL_KEY = 'qwen/qwen-audio-3.0-realtime-plus';
export const REALTIME_PLUS_UPSTREAM_MODEL = 'qwen-audio-3.0-realtime-plus';
export const REALTIME_31_MODEL_KEY = 'qwen/qwen-audio-3.1-realtime-plus';
export const REALTIME_31_UPSTREAM_MODEL = 'qwen-audio-3.1-realtime-plus';
/**
 * 已按官方核实的 Qwen Audio Realtime 默认音色（没给 --realtime-voice / --realtime31-voice 时用）。
 * https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides ：3.0 默认 longanqian，3.1 默认 longanqian_v3.1。
 */
export const REALTIME_VERIFIED_DEFAULT_VOICES: Readonly<Record<string, string>> = {
  [REALTIME_PLUS_UPSTREAM_MODEL]: 'longanqian',
  [REALTIME_31_UPSTREAM_MODEL]: 'longanqian_v3.1',
};
/** 3.0 Plus 官方只接受这 5 个系统音色（同一页）。 */
export const REALTIME_30_VOICES: ReadonlySet<string> = new Set([
  'longanqian',
  'longanlingxin',
  'longanlingxi',
  'longanxiaoxin',
  'longanlufeng',
]);
/** Omni 声音复刻成本（元/个，官方 0.01、失败不计费）；售价 = × 1.3。 */
export const OMNI_CLONE_COST_YUAN = 0.01;
/** V3：旧服「DashScope Beijing Workspace」的主机名（迁入的上游必须是它，复刻音色只在这个 workspace 有效）。 */
export const BEIJING_WORKSPACE_HOST = 'ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com';
const MARKUP = 1.3;
const ASR_COST_PER_MINUTE = 0.008333;
const PRICING_SOURCE = 'https://help.aliyun.com/zh/model-studio/model-pricing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VOICE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

/**
 * 没有给出上游账号时，沿用这些已在生产启用的条目所在账号。V2：实时 / Omni 也沿用千问 TTS 所在的公共百炼账号
 * （生产 2fed2a60 Alibaba Bailian，旧站 174 条 Omni 复刻音色就在这个账号下）。
 */
export const UPSTREAM_REFERENCE: Partial<Record<VoiceCatalogItem, string>> = {
  telespeech: 'siliconflow/sensevoice-small',
  'mimo-asr': 'xiaomi/mimo-v2.5-tts',
  'qwen-tts-flash': 'qwen-audio-3.0-tts-plus',
  'qwen-realtime': 'qwen-audio-3.0-tts-plus',
  'qwen-realtime-3.1': 'qwen-audio-3.0-tts-plus',
  omni: 'qwen-audio-3.0-tts-plus',
};

/**
 * 已按官方音色列表核实的 Omni 实时默认音色（没给 --omni-voice 时用）。
 * https://help.aliyun.com/zh/model-studio/omni-voice-list ：Qwen3.5-Omni-Realtime 与 Qwen3.8-Omni 系列默认都是 Tina。
 */
export const OMNI_VERIFIED_DEFAULT_VOICES: Readonly<Record<string, string>> = {
  'qwen3.5-omni-plus-realtime': 'Tina',
  'qwen3.8-omni-flash-realtime': 'Tina',
};

/** Omni 实时显示名带版本与档位，例 qwen3.5-omni-plus-realtime → 「千问 Omni 3.5 Plus 实时通话」。 */
export function omniDisplayName(model: string): string {
  const m = /^qwen(\d+(?:\.\d+)?)-omni-([a-z]+)-realtime/u.exec(model.trim().toLowerCase());
  if (!m) return `千问 Omni 实时通话（${model}）`.slice(0, 60);
  const tier = m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1);
  return `千问 Omni ${m[1]} ${tier} 实时通话`;
}

/** 目录里的 Omni 实时条目键（qwen/<百炼型号>）→ 百炼型号；不是返回 null。 */
export function omniModelOfKey(modelKey: string): string | null {
  const m = /^qwen\/(qwen[\d.]+-omni-[a-z]+-realtime[a-z0-9._-]*)$/u.exec(modelKey);
  return m ? m[1]! : null;
}

export interface VoiceCatalogCommand {
  kind: 'show' | 'plan' | 'apply';
  /** V2：只修现有 Omni 条目的显示名与默认音色（不动价格、启用状态）。 */
  fixOmni: boolean;
  /** V3：给现有 Omni 条目补登记复刻价（只改 voice_clone 这一项服务单价）。 */
  omniClonePrice: boolean;
  /** V3：把 Realtime Plus 条目改挂迁入的北京 workspace 上游。 */
  attachWorkspace: { upstreamId: string; models: string[]; dropStaleClones: boolean } | null;
  operatorId: string | null;
  only: ReadonlySet<VoiceCatalogItem>;
  upstreams: Partial<Record<'siliconflow' | 'mimo' | 'dashscope' | 'realtime', string>>;
  enableRealtime: boolean;
  enableUnverified: boolean;
  ttsFlashCostPer10k: number;
  /** 3.0 Plus 默认音色（不给 = 官方已核实的 longanqian）。 */
  realtimeVoice: string;
  /** 3.1 Plus 默认音色（不给 = 官方已核实的 longanqian_v3.1）。 */
  realtime31Voice: string;
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
    'fix-omni',
    'realtime31-voice',
    'omni-clone-price',
    'attach-workspace',
    'workspace-models',
    'drop-stale-clones',
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
  const realtimeVoice =
    values.get('realtime-voice') ?? REALTIME_VERIFIED_DEFAULT_VOICES[REALTIME_PLUS_UPSTREAM_MODEL]!;
  if (!VOICE.test(realtimeVoice)) return fail('BAD_ARGUMENT', '--realtime-voice 不是合法音色代号');
  const realtime31Voice =
    values.get('realtime31-voice') ?? REALTIME_VERIFIED_DEFAULT_VOICES[REALTIME_31_UPSTREAM_MODEL]!;
  if (!VOICE.test(realtime31Voice))
    return fail('BAD_ARGUMENT', '--realtime31-voice 不是合法音色代号');
  const modes = [
    flags.has('fix-omni'),
    flags.has('omni-clone-price'),
    values.has('attach-workspace'),
  ];
  if (modes.filter(Boolean).length > 1)
    return fail(
      'BAD_ARGUMENT',
      '--fix-omni / --omni-clone-price / --attach-workspace 一次只能用一个',
    );
  if (flags.has('attach-workspace'))
    return fail('BAD_ARGUMENT', '--attach-workspace 后面要跟迁入的北京 workspace 上游账号 UUID');
  let attachWorkspace: VoiceCatalogCommand['attachWorkspace'] = null;
  const attachId = values.get('attach-workspace');
  if (attachId !== undefined) {
    if (!UUID.test(attachId))
      return fail('BAD_ARGUMENT', '--attach-workspace 必须是迁入的北京 workspace 上游账号 UUID');
    const models = (values.get('workspace-models') ?? REALTIME_PLUS_MODEL_KEY)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (
      !models.length ||
      models.some((m) => m !== REALTIME_PLUS_MODEL_KEY && m !== REALTIME_31_MODEL_KEY)
    )
      return fail(
        'BAD_ARGUMENT',
        `--workspace-models 只能是 ${REALTIME_PLUS_MODEL_KEY}、${REALTIME_31_MODEL_KEY}（逗号分隔）`,
      );
    attachWorkspace = {
      upstreamId: attachId.toLowerCase(),
      models: [...new Set(models)],
      dropStaleClones: flags.has('drop-stale-clones'),
    };
  } else if (values.has('workspace-models') || flags.has('drop-stale-clones'))
    return fail(
      'BAD_ARGUMENT',
      '--workspace-models / --drop-stale-clones 只配合 --attach-workspace',
    );
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
    const voice = values.get('omni-voice') ?? OMNI_VERIFIED_DEFAULT_VOICES[omniModel] ?? null;
    if (voice !== null && !VOICE.test(voice))
      return fail('BAD_ARGUMENT', '--omni-voice 不是合法音色代号');
    omni = { model: omniModel, cost: cost as [number, number, number, number], voice };
  }
  return {
    ok: true,
    command: {
      kind,
      fixOmni: flags.has('fix-omni'),
      omniClonePrice: flags.has('omni-clone-price'),
      attachWorkspace,
      operatorId,
      only,
      upstreams,
      enableRealtime: flags.has('enable-realtime'),
      enableUnverified: flags.has('enable-unverified'),
      ttsFlashCostPer10k,
      realtimeVoice,
      realtime31Voice,
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
  /** V3：复刻一个音色的成本（元/个）；不给 = 不登记复刻价（复刻不向用户收费）。 */
  cloneCost?: number;
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
      ...(input.cloneCost !== undefined ? [cloneRate(input.cloneCost)] : []),
    ],
  };
}

/** 契约 4.6：复刻费服务单价（元/个），售价 = 成本 × 1.3。 */
export function cloneRate(cost: number) {
  return { unit: 'voice_clone' as const, price: sell(cost), cost };
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
        displayName: '千问 Audio 3.0 Plus 实时通话',
        cost: [5, 40, 40, 150],
      }),
      enable: command.enableRealtime,
      upstream: { flag: 'realtime', reference: UPSTREAM_REFERENCE['qwen-realtime']! },
      defaultVoice: command.realtimeVoice,
      notes: [
        '缓存命中价未核实，按文字输入价计',
        'V3：路由改挂迁入的北京 workspace 用 --attach-workspace；已有条目重跑沿用当前上游',
        '复刻音色官方免费，不登记复刻价',
        command.enableRealtime
          ? '已按 --enable-realtime 启用'
          : '登记为停用：真实冒烟通过后在后台启用（或重跑加 --enable-realtime）',
      ],
    });
  if (want('qwen-realtime-3.1'))
    entries.push({
      item: 'qwen-realtime-3.1',
      modelKey: REALTIME_31_MODEL_KEY,
      write: realtimeWrite({
        modelKey: REALTIME_31_MODEL_KEY,
        upstreamModelId: REALTIME_31_UPSTREAM_MODEL,
        displayName: '千问 Audio 3.1 Plus 实时通话',
        // 官方北京价 文字入 5 / 音频入 40 / 文字出 40 / 音频出 150 元/百万（qwen-audio-3-1-realtime-plus 页）
        cost: [5, 40, 40, 150],
      }),
      enable: command.enableRealtime,
      upstream: { flag: 'realtime', reference: UPSTREAM_REFERENCE['qwen-realtime-3.1']! },
      defaultVoice: command.realtime31Voice,
      notes: [
        '官方页没写缓存命中价，按文字输入价计',
        '官方实时地址只写了 workspace 专属域名：公共百炼账号能否调用由真实冒烟确认，不行就 --attach-workspace 改挂北京 workspace',
        '复刻音色官方免费（target_model 必须是 3.1），不登记复刻价',
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
          displayName: omniDisplayName(command.omni.model),
          cost: command.omni.cost,
          cloneCost: OMNI_CLONE_COST_YUAN,
        }),
        enable: command.enableRealtime,
        upstream: { flag: 'realtime', reference: UPSTREAM_REFERENCE.omni! },
        defaultVoice: command.omni.voice,
        notes: [
          '价格来自 --omni-cost（运维核实）',
          '复刻费 0.01 元/个 × 1.3 = 0.013 元由打电话的用户承担（契约 4.6）',
          command.omni.voice ? '' : '没有给 --omni-voice：只有带专属音色的角色能接通',
        ].filter(Boolean),
      });
  }
  return { entries, skipped };
}

export interface OmniFix {
  modelKey: string;
  /** 要改的显示名（null = 已经带版本，不改）。 */
  rename: { from: string; to: string } | null;
  /** 要补的默认音色（null = 已有默认或没有已核实的值，不改）。 */
  defaultVoice: string | null;
}

/**
 * V2 --fix-omni：现有 Omni 实时条目（未删除）里，显示名不带版本的改成带版本；没有默认音色且有已核实值的补上。
 * 价格、启用状态、上游账号都不动。
 */
export function planOmniFix(
  models: ReadonlyArray<{ modelKey: string; displayName: string; deletedAt?: string | null }>,
  defaults: Readonly<Record<string, string>>,
): OmniFix[] {
  const fixes: OmniFix[] = [];
  for (const model of models) {
    if (model.deletedAt) continue;
    const omni = omniModelOfKey(model.modelKey);
    if (!omni) continue;
    const name = omniDisplayName(omni);
    const voice = defaults[model.modelKey] ? null : (OMNI_VERIFIED_DEFAULT_VOICES[omni] ?? null);
    const rename = model.displayName === name ? null : { from: model.displayName, to: name };
    if (rename || voice) fixes.push({ modelKey: model.modelKey, rename, defaultVoice: voice });
  }
  return fixes;
}

/**
 * V3 --omni-clone-price：现有 Omni 实时条目（未删除）里还没有复刻价（或复刻价与 0.013 / 0.01 不同）的，
 * 补登记 voice_clone 服务单价。只传这一项服务单价（其他单位与 token 价完整保留）。
 */
export function planOmniClonePrice(
  models: ReadonlyArray<{
    modelKey: string;
    deletedAt?: string | null;
    serviceRates?: ReadonlyArray<{ unit: string; price: number; cost?: number | null }>;
  }>,
): Array<{
  modelKey: string;
  from: { price: number; cost: number | null } | null;
  to: ReturnType<typeof cloneRate>;
}> {
  const to = cloneRate(OMNI_CLONE_COST_YUAN);
  const out = [];
  for (const model of models) {
    if (model.deletedAt || !omniModelOfKey(model.modelKey)) continue;
    const current = model.serviceRates?.find((r) => r.unit === 'voice_clone');
    if (current && current.price === to.price && (current.cost ?? current.price) === to.cost)
      continue;
    out.push({
      modelKey: model.modelKey,
      from: current ? { price: current.price, cost: current.cost ?? null } : null,
      to,
    });
  }
  return out;
}

export interface WorkspaceAttachModel {
  modelKey: string;
  displayName: string;
  upstreamId: string;
  upstreamModelId: string;
  tags: readonly string[];
  deletedAt?: string | null;
  billingBounds?: RouteBillingBounds | null;
  routes?: ReadonlyArray<{
    upstreamId: string;
    upstreamModelId: string;
    priority: number;
    enabled: boolean;
    billingBounds?: RouteBillingBounds | null;
  }>;
}

export interface WorkspaceAttachPlan {
  upstream: {
    upstreamId: string;
    name: string;
    /** 要改的协议 / 基址（null = 不改）。 */
    kind: { from: string; to: 'dashscope' } | null;
    baseUrl: { from: string; to: string } | null;
    enabled: boolean;
    status: string;
  };
  models: Array<{
    modelKey: string;
    displayName: string;
    fromUpstreamId: string;
    upstreamModelId: string;
    billingBounds: RouteBillingBounds;
    /** 当前绑定条数（按来源）；clone 条数要删（它们是在旧上游账号上复刻的）。 */
    staleClones: number;
    /** 要设的默认音色（null = 已是官方核实值或已手动设置为其他合法值，不改）。 */
    defaultVoice: { from: string | null; to: string } | null;
  }>;
  problems: string[];
}

/**
 * V3 --attach-workspace：把 Realtime Plus 条目（3.0，可选 3.1）的路由整体换成迁入的北京 workspace 上游。纯逻辑：
 * - 上游必须存在、未删除，主机名必须正好是旧服北京 workspace（复刻音色、213 条旧绑定只在这个 workspace 有效）；
 *   协议不是 dashscope 的改成 dashscope，基址是 `…/api` 的补成 `…/api/v1`（百炼原生接口基址），都经 UpstreamService 审计；
 * - 条目必须是实时通话条目（pipeline:rt）、上游型号是 qwen-audio-*-realtime-*，且已有 realtime 计费上限（沿用）；
 * - 条目下已有 source = clone 的绑定是在旧上游账号上复刻的，换账号后无效：不给 --drop-stale-clones 就拒绝；
 * - 默认音色不是官方核实值时改成官方值（3.0 只接受 longanqian 等 5 个，原先的 Cherry 无效）。
 */
export function planWorkspaceAttach(input: {
  upstream: {
    upstreamId: string;
    name: string;
    kind: string;
    baseUrl: string;
    enabled?: boolean;
    status: string;
  } | null;
  modelKeys: readonly string[];
  models: readonly WorkspaceAttachModel[];
  bindings: Readonly<Record<string, Readonly<Record<string, number>>>>;
  defaults: Readonly<Record<string, string>>;
  dropStaleClones: boolean;
}): WorkspaceAttachPlan | { problems: string[] } {
  const problems: string[] = [];
  const up = input.upstream;
  if (!up)
    return { problems: ['上游账号不存在或已删除（先按交接跑 import-legacy-upstreams --apply）'] };
  let url: URL | null;
  try {
    url = new URL(up.baseUrl);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || url.hostname.toLowerCase() !== BEIJING_WORKSPACE_HOST)
    return {
      problems: [
        `上游账号「${up.name}」不是旧服北京 workspace（主机名必须是 ${BEIJING_WORKSPACE_HOST}）`,
      ],
    };
  const path = url.pathname.replace(/\/+$/u, '');
  const target = path === '' || path === '/api' ? `${url.origin}/api/v1` : null;
  if (target === null && path !== '/api/v1')
    problems.push(`上游基址路径 ${path} 不是 /api 或 /api/v1，请人工核对`);
  const plan: WorkspaceAttachPlan = {
    upstream: {
      upstreamId: up.upstreamId,
      name: up.name,
      kind: up.kind === 'dashscope' ? null : { from: up.kind, to: 'dashscope' },
      baseUrl: target ? { from: up.baseUrl, to: target } : null,
      enabled: up.enabled !== false,
      status: up.status,
    },
    models: [],
    problems,
  };
  for (const key of input.modelKeys) {
    const model = input.models.find((m) => m.modelKey === key && !m.deletedAt);
    if (!model) {
      problems.push(`${key}：目录里没有这个条目（先跑 voice-catalog --apply 登记）`);
      continue;
    }
    if (
      !model.tags.includes('pipeline:rt') ||
      !/^qwen-audio-[\d.]+-realtime/u.test(model.upstreamModelId)
    ) {
      problems.push(`${key}：不是 Qwen Audio 实时通话条目`);
      continue;
    }
    const primary = model.routes?.length
      ? [...model.routes].sort((a, b) => a.priority - b.priority)[0]!
      : null;
    const bounds = primary?.billingBounds ?? model.billingBounds ?? null;
    if (!bounds?.realtime) {
      problems.push(`${key}：没有核准的 realtime 计费上限`);
      continue;
    }
    const staleClones = model.upstreamId === up.upstreamId ? 0 : (input.bindings[key]?.clone ?? 0);
    if (staleClones > 0 && !input.dropStaleClones)
      problems.push(
        `${key}：有 ${staleClones} 条按需复刻的音色是在旧上游账号上复刻的，换账号后无效；确认后加 --drop-stale-clones 删除`,
      );
    const verified = REALTIME_VERIFIED_DEFAULT_VOICES[model.upstreamModelId] ?? null;
    const current = input.defaults[key] ?? null;
    // 3.0 只接受官方 5 个音色；3.1 还接受 3.1 TTS 的音色（无法逐个核对），只在没有默认时补上。
    const valid =
      current !== null &&
      (model.upstreamModelId !== REALTIME_PLUS_UPSTREAM_MODEL || REALTIME_30_VOICES.has(current));
    plan.models.push({
      modelKey: key,
      displayName: model.displayName,
      fromUpstreamId: model.upstreamId,
      upstreamModelId: model.upstreamModelId,
      billingBounds: bounds,
      staleClones,
      defaultVoice: verified && !valid ? { from: current, to: verified } : null,
    });
  }
  return plan;
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

/**
 * V2（2026-10-28 生产实查）：旧库 402 条实时绑定分属三个账号。公共百炼供应商 8eed4824 下的
 * qwen3.5-omni-plus-realtime 端点（0975357a…，174 条）与新站公共百炼上游是同一账号，V2 已迁。
 * V3（总经理 10-28 下午拍板）：私有 workspace「DashScope Beijing Workspace」（供应商 cb9de005、端点
 * eb3630dd-bfbd-49ea-a460-b542a98eb354、qwen-audio-3.0-realtime-plus，213 条）也迁：账号经加密通道迁入后，
 * qwen/qwen-audio-3.0-realtime-plus 改挂这个上游（--attach-workspace），再迁这 213 条。
 * 「156语音」（供应商 8d1b5e3b、端点 6b29cca6…，15 条）不要，一律拒绝。
 */
export const LEGACY_PUBLIC_PROVIDER_PREFIX = '8eed4824';
export const LEGACY_OMNI_MODEL = 'qwen3.5-omni-plus-realtime';
export const LEGACY_OMNI_MODEL_KEY = `qwen/${LEGACY_OMNI_MODEL}`;
export const LEGACY_BEIJING_PROVIDER_PREFIX = 'cb9de005';
export const LEGACY_BEIJING_ENDPOINT_ID = 'eb3630dd-bfbd-49ea-a460-b542a98eb354';
/** 「156语音」私有 workspace 的供应商 ID / 端点 ID 前缀，以及最早约定不迁的 156 前缀。 */
export const FORBIDDEN_LEGACY_PREFIXES = ['8d1b5e3b', '6b29cca6', '156'];

/** 每个可迁端点只认它自己的供应商与型号（复刻音色只在创建它的账号 + 型号上有效）。 */
function legacySourceOf(endpoint: string): { providerPrefix: string; model: string } {
  return endpoint === LEGACY_BEIJING_ENDPOINT_ID
    ? { providerPrefix: LEGACY_BEIJING_PROVIDER_PREFIX, model: REALTIME_PLUS_UPSTREAM_MODEL }
    : { providerPrefix: LEGACY_PUBLIC_PROVIDER_PREFIX, model: LEGACY_OMNI_MODEL };
}

export function forbiddenLegacyId(id: string): boolean {
  const value = id.trim().toLowerCase();
  return FORBIDDEN_LEGACY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export interface LegacyRealtimeVoiceCommand {
  input: string;
  apply: boolean;
  operatorId: string | null;
  /** 只迁这一个旧端点（完整 ID，由 export-realtime-workspace.mjs discover 列出）下的绑定。 */
  endpointId: string;
  /** 旧型号 → 新目录模型键。默认只有 Omni 3.5 Plus。 */
  modelMap: ReadonlyMap<string, string>;
}

export function parseLegacyRealtimeVoiceCommand(
  argv: readonly string[],
): Parsed<LegacyRealtimeVoiceCommand> {
  const { flags, values, bad } = splitArgs(argv);
  if (bad) return fail('BAD_ARGUMENT', `无法识别的参数：${bad}`);
  const known = new Set(['input', 'apply', 'operator-id', 'endpoint-id', 'map']);
  for (const key of [...flags, ...values.keys()])
    if (!known.has(key)) return fail('BAD_ARGUMENT', `未知参数 --${key}`);
  const input = values.get('input');
  if (!input) return fail('BAD_ARGUMENT', '需要 --input <绑定导出 JSON 的绝对路径>');
  const apply = flags.has('apply');
  const operatorId = values.get('operator-id') ?? null;
  if (operatorId !== null && !UUID.test(operatorId))
    return fail('BAD_ARGUMENT', '--operator-id 必须是管理员用户 UUID');
  if (apply && !operatorId) return fail('OPERATOR_REQUIRED', '--apply 需要 --operator-id');
  const endpointId = (values.get('endpoint-id') ?? '').trim().toLowerCase();
  if (!/^[0-9a-z][0-9a-z_.:-]{7,127}$/u.test(endpointId))
    return fail(
      'BAD_ARGUMENT',
      '需要 --endpoint-id <旧端点完整 ID>（discover 输出里 allowed = true 的那条）',
    );
  if (forbiddenLegacyId(endpointId))
    return fail(
      'ENDPOINT_FORBIDDEN',
      '「156语音」私有 workspace（8d1b5e3b / 6b29cca6 / 156）的端点不迁移',
    );
  if (endpointId.startsWith('eb3630dd') && endpointId !== LEGACY_BEIJING_ENDPOINT_ID)
    return fail('ENDPOINT_FORBIDDEN', `北京 workspace 只迁端点 ${LEGACY_BEIJING_ENDPOINT_ID}`);
  const modelMap = new Map<string, string>([
    [LEGACY_OMNI_MODEL, LEGACY_OMNI_MODEL_KEY],
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
  return { ok: true, command: { input, apply, operatorId, endpointId, modelMap } };
}

export interface LegacyRealtimeBindingPlan {
  rows: Array<{ characterId: string; modelKey: string; providerVoiceKey: string }>;
  skipped: Record<
    | 'other_endpoint'
    | 'private_account'
    | 'not_realtime'
    | 'unmapped_model'
    | 'not_ready'
    | 'invalid'
    | 'duplicate',
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
 * 旧库 character_voice_bindings 行 → 新库 realtime_voice_bindings 行。只取：指定端点（完整 ID 相等）、
 * 不属于「156语音」、导出里带 provider_id 时必须是该端点对应的供应商（北京 workspace 端点 → cb9de005，
 * 其余 → 公共 8eed4824）、该端点的实时型号、状态 ready、音色代号合法、角色 ID 是 UUID；同一 (角色, 模型) 只取第一条。
 */
export function planLegacyRealtimeBindings(
  raw: unknown,
  command: Pick<LegacyRealtimeVoiceCommand, 'endpointId' | 'modelMap'>,
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
      private_account: 0,
      not_realtime: 0,
      unmapped_model: 0,
      not_ready: 0,
      invalid: 0,
      duplicate: 0,
    },
    byModel: {},
  };
  const seen = new Set<string>();
  const source = legacySourceOf(command.endpointId);
  for (const item of list) {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const endpoint = text(row, ['endpoint_id', 'endpointId']).toLowerCase();
    const provider = text(row, ['provider_id', 'providerId']).toLowerCase();
    const model = text(row, ['model']).toLowerCase();
    const characterId = text(row, ['character_id', 'characterId']).toLowerCase();
    const voice = text(row, ['voice_id', 'voiceId']);
    const status = text(row, ['status']).toLowerCase();
    if (
      forbiddenLegacyId(endpoint) ||
      forbiddenLegacyId(provider) ||
      (provider && !provider.startsWith(legacySourceOf(endpoint).providerPrefix))
    ) {
      plan.skipped.private_account++;
      continue;
    }
    if (endpoint !== command.endpointId) {
      plan.skipped.other_endpoint++;
      continue;
    }
    if (!/realtime/u.test(model)) {
      plan.skipped.not_realtime++;
      continue;
    }
    // 端点型号以外的行（例 北京 workspace 端点下混进 Omni 型号）不迁：复刻音色只在它的 target_model 上有效
    if (model !== source.model) {
      plan.skipped.unmapped_model++;
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
