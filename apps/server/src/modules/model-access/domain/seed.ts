/** model-catalog.md v0.3 的初始目录；未配置密钥/未评测前全部停用。 */
import type { AdminPriceItem } from '@weiban/contracts';
import type { z } from 'zod';
export const INITIAL_MODELS = [
  {
    modelKey: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    provider: 'deepseek',
    upstreamModelId: 'deepseek-v4-pro',
    capabilities: [],
    defaultFor: ['chat'],
    input: 9,
    cached: 0.3,
    output: 27,
    offPeak: true,
  },
  {
    modelKey: 'deepseek/deepseek-flash',
    name: 'DeepSeek Flash',
    vendor: 'DeepSeek',
    provider: 'deepseek',
    upstreamModelId: 'deepseek-flash',
    capabilities: [],
    defaultFor: ['background'],
    input: 2,
    cached: 0.04,
    output: 8,
    offPeak: true,
  },
  {
    modelKey: 'qwen/qwen3.7-plus',
    name: '通义千问 3.7 Plus',
    vendor: '阿里云',
    provider: 'bailian',
    upstreamModelId: 'qwen3.7-plus',
    capabilities: [],
    defaultFor: [],
    input: 2,
    cached: 2,
    output: 8,
  },
  {
    modelKey: 'qwen/qwen3.8-flash',
    name: '通义千问 3.8 Flash',
    vendor: '阿里云',
    provider: 'bailian',
    upstreamModelId: 'qwen3.8-flash',
    capabilities: [],
    defaultFor: [],
    input: 0.8,
    cached: 0.8,
    output: 2.7,
  },
  {
    modelKey: 'qwen/qwen3.8-max',
    name: '通义千问 3.8 Max',
    vendor: '阿里云',
    provider: 'bailian',
    upstreamModelId: 'qwen3.8-max',
    capabilities: [],
    defaultFor: [],
    input: 12,
    cached: 12,
    output: 36,
  },
  {
    modelKey: 'qwen/qwen-vl-plus',
    name: '通义千问 VL Plus',
    vendor: '阿里云',
    provider: 'bailian',
    upstreamModelId: 'qwen-vl-plus',
    capabilities: ['vision'],
    defaultFor: ['vision'],
    input: 0.8,
    output: 2,
  },
  {
    modelKey: 'dolphin/dolphin-mistral-24b-venice',
    name: 'Dolphin Mistral 24B',
    vendor: 'OpenRouter',
    provider: 'openrouter',
    upstreamModelId: 'cognitivecomputations/dolphin-mistral-24b-venice-edition',
    capabilities: ['adult_content'],
    defaultFor: [],
    input: 1.52,
    output: 6.84,
  },
  {
    modelKey: 'sao10k/l3.3-euryale-70b',
    name: 'Euryale 70B',
    vendor: 'OpenRouter',
    provider: 'openrouter',
    upstreamModelId: 'sao10k/l3.3-euryale-70b',
    capabilities: ['adult_content'],
    defaultFor: [],
    input: 4.94,
    output: 5.7,
  },
] as const;

/** 默认录入高峰上界，避免契约无法表示法定节假日时错用低价。分时确认后由管理员发布新版。 */
export function initialPriceItems(): z.infer<typeof AdminPriceItem>[] {
  return INITIAL_MODELS.flatMap((m) => {
    const prices: z.infer<typeof AdminPriceItem>[] = [
      {
        modelKey: m.modelKey,
        unit: 'input_tokens_per_million',
        priceMicros: Math.round(m.input * 1000000),
        costMicros: Math.round(m.input * 1000000),
        band: null,
      },
      {
        modelKey: m.modelKey,
        unit: 'output_tokens_per_million',
        priceMicros: Math.round(m.output * 1000000),
        costMicros: Math.round(m.output * 1000000),
        band: null,
      },
    ];
    if ('cached' in m)
      prices.push({
        modelKey: m.modelKey,
        unit: 'cached_input_tokens_per_million',
        priceMicros: Math.round(m.cached * 1000000),
        costMicros: Math.round(m.cached * 1000000),
        band: null,
      });
    return prices;
  });
}
