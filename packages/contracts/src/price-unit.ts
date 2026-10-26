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
]);
export type PriceUnit = z.infer<typeof PriceUnit>;

export const ServicePriceUnit = PriceUnit.extract([
  'image',
  'tts_10k_chars',
  'asr_minute',
  'realtime_minute',
  'search_call',
]);
export type ServicePriceUnit = z.infer<typeof ServicePriceUnit>;
