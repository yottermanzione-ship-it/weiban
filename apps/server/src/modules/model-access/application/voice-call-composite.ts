/**
 * 组合通话模型（ADR-20261024-voice-cascade-composite-model）：用户只选一个「语音通话模型」，
 * 后台仍按识别分钟、文本 token、合成字符三次真实计费。
 *
 * - 目录里 `modelKey = voice/cascade-call` 且标签含 `pipeline:call` 的条目是组合模型；
 *   它自身不调用任何上游、不要求自己的 token 单价。
 * - 组合关系存在 `model_access.settings.voice_call_pipeline`（读时严格校验，非法 = 未配置）；
 *   运行时拆成识别 / 文本 / 合成三个组件，任一组件停用、删除或上游不可用 → 整通电话不可用并给出原因，
 *   不静默换成别的模型。
 * - 展示倍率按旧版实测的每分钟用量折算（识别 1 分钟 + 合成约 54 字 + 文本约 5 轮），
 *   与基准模型的同一分钟口径相比；任何一项价格缺失都返回 null，不编造。
 */
import type {
  ActiveModelServiceRate,
  GenerateError,
  ModelUnavailableDetail,
  UpstreamStatus,
} from '@weiban/contracts';
import { parseVoiceCallPipeline, type VoiceCallPipeline } from '../domain/voice-call-pipeline.js';
import {
  DEFAULT_REPLY_ASSUMPTION,
  defaultReplyMicros,
  type ModelTextPrices,
} from '../domain/rules.js';
import type { ModelFacts } from './catalog.js';

/** 组合模型在目录里的固定模型键。 */
export const VOICE_CALL_CASCADE_MODEL_KEY = 'voice/cascade-call';
/** 目录条目的组合标记；只有带这个标签的 `voice/cascade-call` 才按组合模型解析。13 字符，在后台契约 tags 上限（16）内。 */
export const VOICE_CALL_PIPELINE_TAG = 'pipeline:call';
/** `model_access.settings` 里的组合关系键。 */
export const VOICE_CALL_PIPELINE_SETTING_KEY = 'voice_call_pipeline';
/** 展示倍率的默认基准模型（后台另设 display_multiplier_base 时以后台为准）。 */
export const DEFAULT_DISPLAY_BASE_MODEL_KEY = 'openai/gpt-6.1-sol';

/**
 * 2026-10-26旧库只读汇总：91通级联通话、17278秒，角色1424轮/15489字，
 * 每分钟4.945轮/53.787字，取约5轮/54字。ASR保守按整分钟；文本token没有旧站实测，
 * 仍明确采用现有默认回复用量假设。只用于展示，不参与实际结算。
 */
export const VOICE_CALL_MINUTE_BLEND = {
  asrMinutes: 1,
  ttsChars: 54,
  textTurns: 5,
} as const;

/** 报价端口用量；缓存与未缓存输入分开，不将旧站通话次数当成已扣积分。 */
export const VOICE_CALL_MINUTE_USAGE = {
  asr: { asrSeconds: 60 * VOICE_CALL_MINUTE_BLEND.asrMinutes },
  tts: { ttsChars: VOICE_CALL_MINUTE_BLEND.ttsChars },
  text: {
    inputTokens: DEFAULT_REPLY_ASSUMPTION.inputTokens * VOICE_CALL_MINUTE_BLEND.textTurns,
    cachedInputTokens:
      DEFAULT_REPLY_ASSUMPTION.cachedInputTokens * VOICE_CALL_MINUTE_BLEND.textTurns,
    outputTokens: DEFAULT_REPLY_ASSUMPTION.outputTokens * VOICE_CALL_MINUTE_BLEND.textTurns,
  },
} as const;

export type VoiceCallComponent = 'asr' | 'text' | 'tts';
/** 检查顺序：先确认有没有识别能力，再确认文本，最后合成。 */
export const VOICE_CALL_COMPONENTS: readonly VoiceCallComponent[] = ['asr', 'text', 'tts'];

/** 目录里识别组合模型只需要这两个字段（其他字段与组合判断无关）。 */
export interface VoiceCallCatalogEntry {
  modelKey: string;
  tags: readonly string[];
}

/** 是不是「语音通话」组合模型：固定模型键 + `pipeline:call` 标签，两者缺一不可。 */
export function isVoiceCallComposite(entry: VoiceCallCatalogEntry | null | undefined): boolean {
  return (
    entry?.modelKey === VOICE_CALL_CASCADE_MODEL_KEY && entry.tags.includes(VOICE_CALL_PIPELINE_TAG)
  );
}

/** 组合关系里某个组件对应的模型键。 */
export function voiceCallComponentModelKey(
  pipeline: VoiceCallPipeline,
  component: VoiceCallComponent,
): string {
  return component === 'asr'
    ? pipeline.asrModelKey
    : component === 'text'
      ? pipeline.textModelKey
      : pipeline.ttsModelKey;
}

export interface VoiceCallComponentFacts {
  asr: ModelFacts;
  text: ModelFacts;
  tts: ModelFacts;
}

/** 某个组件不可用的具体原因（上游状态保留下来，便于映射到后台的不可用明细）。 */
export interface VoiceCallComponentFailure {
  reason: 'component_unavailable';
  component: VoiceCallComponent;
  modelKey: string;
  detail: 'model_removed' | 'provider_unavailable';
  upstreamStatus: UpstreamStatus | null;
}

export type VoiceCallCheck =
  { ok: true; value: VoiceCallComponentFacts } | { ok: false; failure: VoiceCallComponentFailure };

/**
 * 三个组件必须都存在、启用且上游正常；返回第一个不满足的组件。
 * 组件键缺失（目录里没有这一行）= 已删除；enabled = false = 被停用。
 */
export function checkVoiceCallComponents(
  pipeline: VoiceCallPipeline,
  facts: Partial<Record<VoiceCallComponent, ModelFacts>>,
): VoiceCallCheck {
  for (const component of VOICE_CALL_COMPONENTS) {
    const modelKey = voiceCallComponentModelKey(pipeline, component);
    const found = facts[component];
    if (!found?.entry || !found.entry.enabled)
      return {
        ok: false,
        failure: {
          reason: 'component_unavailable',
          component,
          modelKey,
          detail: 'model_removed',
          upstreamStatus: found?.upstreamStatus ?? null,
        },
      };
    if (found.upstreamStatus !== 'active')
      return {
        ok: false,
        failure: {
          reason: 'component_unavailable',
          component,
          modelKey,
          detail: 'provider_unavailable',
          upstreamStatus: found.upstreamStatus,
        },
      };
  }
  return { ok: true, value: facts as VoiceCallComponentFacts };
}

/** 组合模型整体不可用的原因。 */
export type VoiceCallFailure =
  | { reason: 'pipeline_unconfigured' }
  | { reason: 'composite_disabled' }
  | VoiceCallComponentFailure;

export type VoiceCallPlanSource = 'user' | 'override';

/** `voice_call` 场景的解析结果：没选组合模型 / 选到了组合模型 / 组合模型不可用。 */
export type VoiceCallPlan =
  | { kind: 'not_composite' }
  | {
      kind: 'composite';
      source: VoiceCallPlanSource;
      pipeline: VoiceCallPipeline;
      components: VoiceCallComponentFacts;
    }
  | {
      kind: 'unavailable';
      source: VoiceCallPlanSource;
      modelKey: string;
      failure: VoiceCallFailure;
    };

/** 平台级可用性（不依赖某个用户是否选了它），用于模型列表与场景设置的状态显示。 */
export type VoiceCallAvailability =
  | { available: true; pipeline: VoiceCallPipeline }
  | { available: false; failure: VoiceCallFailure };

/** 组合模型不可用 → 现有契约里的 GenerateError（不新增契约取值）。 */
export function voiceCallFailureError(failure: VoiceCallFailure): GenerateError {
  if (failure.reason === 'pipeline_unconfigured') return 'not_configured';
  if (failure.reason === 'composite_disabled') return 'model_unavailable';
  return failure.detail === 'model_removed' ? 'model_unavailable' : 'provider_unavailable';
}

/** 组合模型不可用 → 后台不可用明细（用户端接口按 3.25 不再展示明细）。 */
export function voiceCallFailureDetail(failure: VoiceCallFailure): ModelUnavailableDetail {
  if (failure.reason === 'pipeline_unconfigured') return 'no_route';
  if (failure.reason === 'composite_disabled') return 'model_removed';
  if (failure.detail === 'model_removed') return 'model_removed';
  if (failure.upstreamStatus === 'invalid') return 'upstream_invalid_key';
  if (failure.upstreamStatus === 'quota_exhausted') return 'upstream_quota_exhausted';
  if (failure.upstreamStatus === 'unavailable') return 'upstream_unavailable';
  return 'no_route';
}

/** 读设置：严格按 parseVoiceCallPipeline 校验，非法（含未知字段 / 重复组件）一律视为未配置。 */
export function readVoiceCallPipelineValue(raw: unknown): VoiceCallPipeline | null {
  const parsed = parseVoiceCallPipeline(raw);
  return parsed.ok ? parsed.value : null;
}

/** 展示倍率口径：三组件各自当前生效售价（微元）；null / undefined = 价目表里没有价格。 */
export interface VoiceCallBlendPrices {
  asrPerMinuteMicros: number | null | undefined;
  ttsPer10kCharsMicros: number | null | undefined;
  text: ModelTextPrices | null | undefined;
  base: ModelTextPrices | null | undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 一分钟通话的混合成本（微元）：识别 1 分钟 + 合成 54 字 + 文本 5 轮（按标准回复假设）。
 * 任一项价格缺失返回 null。
 */
export function voiceCallMinuteMicros(prices: VoiceCallBlendPrices): number | null {
  const { asrPerMinuteMicros, ttsPer10kCharsMicros, text } = prices;
  if (asrPerMinuteMicros == null || ttsPer10kCharsMicros == null || !text) return null;
  const asr = asrPerMinuteMicros * VOICE_CALL_MINUTE_BLEND.asrMinutes;
  const tts = (ttsPer10kCharsMicros * VOICE_CALL_MINUTE_BLEND.ttsChars) / 10_000;
  const textMicros = VOICE_CALL_MINUTE_BLEND.textTurns * defaultReplyMicros(text);
  return Math.ceil(asr + tts + textMicros);
}

/**
 * 相对基准模型的展示倍率：组合模型一分钟混合成本 ÷ 基准模型同样 5 轮回复的成本。
 * 任一价格缺失（含基准模型）返回 null，不写死、不外推。
 */
export function voiceCallDisplayMultiplier(prices: VoiceCallBlendPrices): number | null {
  const minuteMicros = voiceCallMinuteMicros(prices);
  if (minuteMicros === null) return null;
  const baseMicros = prices.base
    ? VOICE_CALL_MINUTE_BLEND.textTurns * defaultReplyMicros(prices.base)
    : 0;
  return baseMicros > 0 ? round2(minuteMicros / baseMicros) : null;
}

/**
 * 从 `getActiveServiceRates` 的结果里取某组件某计价单位的售价。
 * 只用于本模块的展示倍率查询。
 */
export function serviceRatePrice(
  rates: ReadonlyMap<string, readonly ActiveModelServiceRate[]> | null | undefined,
  modelKey: string,
  unit: 'asr_minute' | 'tts_10k_chars',
): number | null {
  const rows = rates?.get(modelKey);
  return rows?.find((row) => row.unit === unit)?.priceMicros ?? null;
}
