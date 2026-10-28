import { z } from 'zod';

/** 计价单位的无依赖公共定义，避免 billing / model-access HTTP schema 循环引用。 */
export const PriceUnit = z.enum([
  'input_tokens_per_million',
  'cached_input_tokens_per_million',
  'output_tokens_per_million',
  'cache_write_5m_tokens_per_million',
  'cache_write_1h_tokens_per_million',
  'image',
  'tts_10k_chars',
  'asr_minute',
  'realtime_minute',
  'search_call',
  // 4.5：实时语音 / Omni 通话的音频 token（元 / 百万 token）；同一通话的文字 token 仍按 input / output 单位计。
  'audio_input_tokens_per_million',
  'audio_output_tokens_per_million',
  // 4.6：实时通话按需复刻音色（元 / 个；只对成功的复刻计费）。
  'voice_clone',
]);
export type PriceUnit = z.infer<typeof PriceUnit>;

export const ServicePriceUnit = PriceUnit.extract([
  'image',
  'tts_10k_chars',
  'asr_minute',
  'realtime_minute',
  'search_call',
  'audio_input_tokens_per_million',
  'audio_output_tokens_per_million',
  'voice_clone',
]);
export type ServicePriceUnit = z.infer<typeof ServicePriceUnit>;
