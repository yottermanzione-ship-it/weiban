import { describe, expect, it, vi } from 'vitest';
import { DisplayPricingService } from './display-pricing.js';
import { VOICE_CALL_MINUTE_USAGE } from './voice-call-composite.js';
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
    expect(await service(quote).voiceCallPointsPerMinute(pipeline)).toBe(5.18);
    expect(quote.mock.calls).toEqual([
      ['asr/x', VOICE_CALL_MINUTE_USAGE.asr],
      ['tts/x', VOICE_CALL_MINUTE_USAGE.tts],
    ]);
  });
  it('applies the text discount once and retains already discounted media quotes', async () => {
    const quote = async (key: string) => ({ amountMicros: key === 'asr/x' ? 5417 : 4914 });
    expect(await service(quote, true, true).voiceCallPointsPerMinute(pipeline)).toBe(2.59);
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
