import { describe, expect, it, vi } from 'vitest';
import { DisplayPricingService } from './display-pricing.js';
import { VOICE_CALL_MINUTE_USAGE } from './voice-call-composite.js';
import { realtimeMinuteUsage } from './realtime-call.js';
const pipeline = { asrModelKey: 'asr/x', textModelKey: 'text/x', ttsModelKey: 'tts/x' };
const textPrice = {
  inputPerMillionMicros: 2160000,
  cachedInputPerMillionMicros: 21600,
  outputPerMillionMicros: 8640000,
};
function service(quote?: unknown, priced = true, discount = false) {
  const value = Object.create(DisplayPricingService.prototype) as DisplayPricingService;
  Object.assign(value, {
    quotes: quote ? { quote } : undefined,
    prices: { textPrices: async () => new Map(priced ? [['text/x', textPrice]] : []) },
    rates: {
      getModelDiscounts: async () =>
        new Map(
          discount
            ? [
                [
                  'text/x',
                  { rate: 0.5, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
                ],
              ]
            : [],
        ),
    },
    clock: { nowMs: () => Date.parse('2026-10-26T00:00:00Z') },
  });
  return value;
}
describe('call minute estimate is not conservative freezing', () => {
  it('does not price cached tokens as uncached via the freezing quote API', async () => {
    const quote = vi.fn(async (key: string) => {
      if (key === 'text/x')
        throw new Error('Text freezing quote would fold cache and overstate cost');
      return { amountMicros: key === 'asr/x' ? 10833 : 9828 };
    });
    // 单轮ceil(6000×2.16 + 6500×0.0216 + 150×8.64)=14397微元；五轮加媒体=92646。
    expect(await service(quote).voiceCallPointsPerMinute(pipeline)).toBe(9.26);
    expect(quote.mock.calls).toEqual([
      ['asr/x', VOICE_CALL_MINUTE_USAGE.asr],
      ['tts/x', VOICE_CALL_MINUTE_USAGE.tts],
    ]);
  });
  it('applies the text discount once and retains already discounted media quotes', async () => {
    const quote = async (key: string) => ({ amountMicros: key === 'asr/x' ? 5417 : 4914 });
    expect(await service(quote, true, true).voiceCallPointsPerMinute(pipeline)).toBe(4.63);
  });
  it('does not invent zero or a text estimate if any required price is absent', async () => {
    expect(await service().voiceCallPointsPerMinute(pipeline)).toBeNull();
    expect(await service(async () => null).voiceCallPointsPerMinute(pipeline)).toBeNull();
    expect(
      await service(async () => ({ amountMicros: 1 }), false).voiceCallPointsPerMinute(pipeline),
    ).toBeNull();
    expect(
      await service(async () => {
        throw new Error('unpriced');
      }).voiceCallPointsPerMinute(pipeline),
    ).toBeNull();
  });
});

describe('批 V：实时语音 / Omni 约每分钟积分', () => {
  it('按 5 分钟参考通话的平均分钟用量报价（分模态 token），缓存 10 分钟；没价格不编数', async () => {
    const quote = vi.fn(async () => ({ amountMicros: 246_870 }));
    const s = service(quote);
    Object.assign(s, { mediaQuotes: new Map() });
    expect(await s.realtimePointsPerMinute('qwen/rt')).toBe(24.69);
    expect(await s.realtimePointsPerMinute('qwen/rt')).toBe(24.69);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote).toHaveBeenCalledWith('qwen/rt', realtimeMinuteUsage(''));
    const none = service(async () => null);
    Object.assign(none, { mediaQuotes: new Map() });
    expect(await none.realtimePointsPerMinute('qwen/rt')).toBeNull();
    expect(await service().realtimePointsPerMinute('qwen/rt')).toBeNull();
  });

  it('平均分钟用量对得上 5 分钟真实账：音频上下文封顶 300 秒、文字输入每轮 1 万', () => {
    // 25 轮：音频累计 min(34i,300) 秒 = 6324 秒；25 token/秒 → 158100 token，平均每分钟 31620。
    expect(realtimeMinuteUsage('qwen-audio-3.1-realtime-plus')).toMatchObject({
      inputTokens: 50_000,
      audioInputTokens: 31_620,
      audioOutputTokens: 1_750,
    });
    // Omni 按官方 7 / 12.5 token/秒。
    expect(realtimeMinuteUsage('qwen3.5-omni-plus-realtime')).toMatchObject({
      audioInputTokens: 8_854,
      audioOutputTokens: 875,
    });
  });
});
