/**
 * 实时语音 / Omni 通话模型（批 V）：用户在「语音通话」场景选到它时，整通电话由这一个端到端模型听和说，
 * 服务端 WebSocket 中转，不再走「识别 → 文字 → 合成」三段。
 *
 * - 目录标记：标签 `pipeline:rt`（11 字符，在契约 16 字符上限内）+ 场景 voice_call + 能力 voice_input & voice_output。
 * - 计费：每次回应按供应商报告的「文字输入 / 缓存文字输入 / 音频输入 / 文字输出 / 音频输出」token 分别计价；
 *   文字 token 用 input / cached_input / output 单价，音频 token 用 4.5 新增的 audio_input / audio_output 单价。
 * - 展示：约每分钟积分按 5 分钟参考通话的平均用量估算（只展示，不按分钟扣费）。
 */
import type { UsageQuantities, RouteBillingBounds } from '@weiban/contracts';
import type { RealtimeUsage } from '../infra/dashscope-realtime.js';
import { realtimeCloneProtocol } from '../infra/dashscope-voice-clone.js';

export const REALTIME_CALL_TAG = 'pipeline:rt';
/** model_access.settings：{ [modelKey]: 默认系统音色代号 }（没有角色专属音色时使用）。 */
export const REALTIME_CALL_VOICES_SETTING_KEY = 'realtime_call_voices';
/**
 * 按需复刻一个 Omni 实时音色的供应商成本（元）：官方 0.01 元 / 个、失败不计费
 * （https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning）。2026-11-07 售价恢复官方 0.01 元，
 * 售价登记在模型的 voice_clone 服务单价里（voice-catalog 写入）；这里的成本只用于审计与 --show 对账。
 */
export const REALTIME_VOICE_CLONE_COST_YUAN = 0.01;

/**
 * 各实时模型复刻一个音色的供应商成本（元）。Qwen Audio Realtime（voice-enrollment）官方「创建音色免费，使用时按目标模型
 * 计费」（https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide），记 0；Omni（qwen-voice-enrollment）0.01。
 */
export function realtimeVoiceCloneCostYuan(upstreamModelId: string): number {
  const protocol = realtimeCloneProtocol(upstreamModelId);
  return protocol === 'qwen-voice-enrollment' ? REALTIME_VOICE_CLONE_COST_YUAN : 0;
}

export interface RealtimeCatalogEntry {
  tags: readonly string[];
  scenarios: readonly string[];
  capabilities: readonly string[];
}

export function isRealtimeCallEntry(entry: RealtimeCatalogEntry | null | undefined): boolean {
  return (
    !!entry &&
    entry.tags.includes(REALTIME_CALL_TAG) &&
    entry.scenarios.includes('voice_call') &&
    entry.capabilities.includes('voice_input') &&
    entry.capabilities.includes('voice_output')
  );
}

/**
 * 「约每分钟积分」展示口径（2026-11-11 重做）：按一通 5 分钟参考通话的**平均**每分钟用量估算。
 * 实时模型每轮都把该次回应之前的全部语音作为音频上下文重新计费（官方上下文保留最近 300 秒），
 * 所以第 1 分钟便宜、第 5 分钟最贵；只报一个「每分钟」数字时必须取平均，否则会低估约 8 倍
 * （3.1 Plus 5 分钟实际约 10 元，旧口径只报 0.25 元/分钟）。
 * 口径：每分钟 5 轮、用户每轮 20 秒、角色每轮 14 秒、音频 25 token/秒（Omni 3.5/3.8 按官方 7 / 12.5）、
 * 文字输入每轮 1 万 token（2026-11 账单反推：3.1 Plus 约 723k 文字输入、约 72 轮），文字输出每轮 60 token。
 * 只用于展示，真实扣费按供应商每次回应报告的数字。
 */
export const REALTIME_REFERENCE_CALL_SECONDS = 300;
export const REALTIME_ROUNDS_PER_MINUTE = 5;
export const REALTIME_USER_SECONDS_PER_ROUND = 20;
export const REALTIME_ASSISTANT_SECONDS_PER_ROUND = 14;
export const REALTIME_AUDIO_CONTEXT_CAP_SECONDS = 300;
export const REALTIME_TEXT_INPUT_TOKENS_PER_ROUND = 10_000;
export const REALTIME_TEXT_OUTPUT_TOKENS_PER_ROUND = 60;

/** 各型号音频 token / 秒（官方口径；未知型号按 25）。 */
export interface RealtimeAudioTokenRates {
  inputPerSecond: number;
  outputPerSecond: number;
}
export function realtimeAudioTokenRates(model: string): RealtimeAudioTokenRates {
  return /^qwen3\.[58]-omni-.*-realtime/u.test(model)
    ? { inputPerSecond: 7, outputPerSecond: 12.5 }
    : { inputPerSecond: 25, outputPerSecond: 25 };
}

/** 一通参考通话的总用量（展示估算）：音频输入按每轮累积、封顶 300 秒。 */
export function realtimeCallUsage(
  seconds: number,
  rates: RealtimeAudioTokenRates,
): UsageQuantities {
  const rounds = Math.max(1, Math.round((seconds / 60) * REALTIME_ROUNDS_PER_MINUTE));
  const perRound = REALTIME_USER_SECONDS_PER_ROUND + REALTIME_ASSISTANT_SECONDS_PER_ROUND;
  let audioSeconds = 0;
  for (let i = 1; i <= rounds; i++)
    audioSeconds += Math.min(i * perRound, REALTIME_AUDIO_CONTEXT_CAP_SECONDS);
  return {
    inputTokens: rounds * REALTIME_TEXT_INPUT_TOKENS_PER_ROUND,
    outputTokens: rounds * REALTIME_TEXT_OUTPUT_TOKENS_PER_ROUND,
    audioInputTokens: Math.round(audioSeconds * rates.inputPerSecond),
    audioOutputTokens: Math.round(
      rounds * REALTIME_ASSISTANT_SECONDS_PER_ROUND * rates.outputPerSecond,
    ),
  };
}

/** 平均每分钟用量（按 5 分钟参考通话折算），用于「约每分钟积分」。 */
export function realtimeMinuteUsage(
  model = '',
  seconds = REALTIME_REFERENCE_CALL_SECONDS,
): UsageQuantities {
  const total = realtimeCallUsage(seconds, realtimeAudioTokenRates(model));
  const minutes = seconds / 60;
  return {
    inputTokens: Math.round((total.inputTokens ?? 0) / minutes),
    outputTokens: Math.round((total.outputTokens ?? 0) / minutes),
    audioInputTokens: Math.round((total.audioInputTokens ?? 0) / minutes),
    audioOutputTokens: Math.round((total.audioOutputTokens ?? 0) / minutes),
  };
}

/** 供应商分模态用量 → 平台计费数量。 */
export function realtimeUsageQuantities(u: RealtimeUsage): UsageQuantities {
  return {
    inputTokens: u.textInputTokens,
    cachedInputTokens: u.cachedTextInputTokens,
    audioInputTokens: u.audioInputTokens,
    outputTokens: u.textOutputTokens,
    audioOutputTokens: u.audioOutputTokens,
  };
}

/** 官方规则：3.5 Omni / Audio 3.x 有音频输出时不另收伴随文本；3.8 Omni 两者分别计费。 */
export function billableRealtimeUsage(model: string, actual: UsageQuantities): UsageQuantities {
  if (
    (actual.audioOutputTokens ?? 0) > 0 &&
    (/^qwen3\.5-omni-.*-realtime(?:-|$)/u.test(model) ||
      /^qwen-audio-3\.[01]-realtime-(?:plus|flash)(?:-|$)/u.test(model))
  )
    return { ...actual, outputTokens: 0 };
  return actual;
}

/** 一次回应的冻结估算：整段上下文按文字输入、一分钟用户语音、输出上限同时算文字和音频（宁多勿少，只用于拦截与日上限）。 */
export function realtimeResponseEstimate(
  bounds: NonNullable<RouteBillingBounds['realtime']>,
  instructionsChars: number,
): UsageQuantities {
  return {
    inputTokens: Math.min(bounds.contextTokens, Math.ceil(instructionsChars / 1.5) + 4000),
    audioInputTokens: 60 * 25,
    outputTokens: bounds.maxResponseOutputTokens,
    audioOutputTokens: bounds.maxResponseOutputTokens,
  };
}

/** 本地静音门：只把说话段（含 300ms 前置与 1.2 秒尾音，让供应商的断句能检测到说完）发给供应商，长静音不上传、不计费。 */
export class SpeechGate {
  static readonly FRAME_BYTES = 640; // 20ms @ 16kHz PCM16
  private static readonly SPEECH_RMS = 500;
  private static readonly PREROLL_FRAMES = 15;
  private static readonly HANGOVER_FRAMES = 60;
  private preroll: Uint8Array[] = [];
  private hangover = 0;
  private carry = new Uint8Array(0);

  /** 返回本次应转发给供应商的 PCM（可能为空）。 */
  accept(chunk: Uint8Array): Uint8Array {
    const data = new Uint8Array(this.carry.length + chunk.length);
    data.set(this.carry);
    data.set(chunk, this.carry.length);
    const whole = data.length - (data.length % SpeechGate.FRAME_BYTES);
    this.carry = data.slice(whole);
    const out: Uint8Array[] = [];
    for (let offset = 0; offset < whole; offset += SpeechGate.FRAME_BYTES) {
      const frame = data.subarray(offset, offset + SpeechGate.FRAME_BYTES);
      if (SpeechGate.rms(frame) >= SpeechGate.SPEECH_RMS) {
        if (this.hangover === 0) out.push(...this.preroll);
        this.preroll = [];
        this.hangover = SpeechGate.HANGOVER_FRAMES;
        out.push(frame);
      } else if (this.hangover > 0) {
        this.hangover--;
        out.push(frame);
      } else {
        this.preroll.push(frame.slice());
        if (this.preroll.length > SpeechGate.PREROLL_FRAMES) this.preroll.shift();
      }
    }
    const size = out.reduce((n, f) => n + f.length, 0);
    const merged = new Uint8Array(size);
    let at = 0;
    for (const frame of out) {
      merged.set(frame, at);
      at += frame.length;
    }
    return merged;
  }

  static rms(frame: Uint8Array): number {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const samples = frame.length / 2;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const v = view.getInt16(i * 2, true);
      sum += v * v;
    }
    return samples ? Math.sqrt(sum / samples) : 0;
  }
}
