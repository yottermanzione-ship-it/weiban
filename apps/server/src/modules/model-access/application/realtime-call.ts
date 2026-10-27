/**
 * 实时语音 / Omni 通话模型（批 V）：用户在「语音通话」场景选到它时，整通电话由这一个端到端模型听和说，
 * 服务端 WebSocket 中转，不再走「识别 → 文字 → 合成」三段。
 *
 * - 目录标记：标签 `pipeline:rt`（11 字符，在契约 16 字符上限内）+ 场景 voice_call + 能力 voice_input & voice_output。
 * - 计费：每次回应按供应商报告的「文字输入 / 缓存文字输入 / 音频输入 / 文字输出 / 音频输出」token 分别计价；
 *   文字 token 用 input / cached_input / output 单价，音频 token 用 4.5 新增的 audio_input / audio_output 单价。
 * - 展示：约每分钟积分按下面的分钟用量假设估算（只展示，不按分钟扣费）。
 */
import type { UsageQuantities, RouteBillingBounds } from '@weiban/contracts';
import type { RealtimeUsage } from '../infra/dashscope-realtime.js';

export const REALTIME_CALL_TAG = 'pipeline:rt';
/** model_access.settings：{ [modelKey]: 默认系统音色代号 }（没有角色专属音色时使用）。 */
export const REALTIME_CALL_VOICES_SETTING_KEY = 'realtime_call_voices';

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
 * 每分钟用量假设（只用于「约每分钟积分」展示）：沿用级联通话的旧站实测口径（约 5 轮 / 分钟、角色约 54 字 ≈ 14 秒语音），
 * 用户约 20 秒语音；百炼音频约 25 token / 秒。每轮回应的文字输入（人设 + 记忆 + 通话转写）按约 3000 token，
 * 音频上下文随通话累积，按新增语音的 3 倍粗估。真实扣费只按供应商每次回应报告的数字。
 */
export const REALTIME_MINUTE_USAGE: UsageQuantities = {
  inputTokens: 5 * 3000,
  audioInputTokens: 20 * 25 * 3,
  outputTokens: 60,
  audioOutputTokens: 14 * 25,
};

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
