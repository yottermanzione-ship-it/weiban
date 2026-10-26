import { describe, expect, it, vi } from 'vitest';
import { DisplayPricingService } from './display-pricing.js';
import { VOICE_CALL_MINUTE_USAGE } from './voice-call-composite.js';

const pipeline = { asrModelKey: 'asr/x', textModelKey: 'text/x', ttsModelKey: 'tts/x' };
function service(quote?: unknown) {
  const value = Object.create(DisplayPricingService.prototype) as DisplayPricingService;
  Object.assign(value, { quotes: quote ? { quote } : undefined });
  return value;
}
describe('call minute estimate, not settlement', () => {
  it('quotes all three real components with explicit usage and sums their current discounted amounts', async () => {
    const quote = vi.fn(async (key: string) => ({
      amountMicros: { 'asr/x': 5400, 'text/x': 11000, 'tts/x': 4914 }[key],
    }));
    expect(await service(quote).voiceCallPointsPerMinute(pipeline)).toBe(2.13);
    expect(quote.mock.calls).toEqual([
      ['asr/x', VOICE_CALL_MINUTE_USAGE.asr],
      ['text/x', VOICE_CALL_MINUTE_USAGE.text],
      ['tts/x', VOICE_CALL_MINUTE_USAGE.tts],
    ]);
    expect(VOICE_CALL_MINUTE_USAGE.asr.asrSeconds).toBe(60);
    expect(VOICE_CALL_MINUTE_USAGE.tts.ttsChars).toBe(54);
    expect(VOICE_CALL_MINUTE_USAGE.text.outputTokens).toBe(1000);
  });
  it('does not invent a zero price if quote support or one component price is missing', async () => {
    expect(await service().voiceCallPointsPerMinute(pipeline)).toBeNull();
    expect(await service(async () => null).voiceCallPointsPerMinute(pipeline)).toBeNull();
    expect(
      await service(async () => {
        throw new Error('not priced');
      }).voiceCallPointsPerMinute(pipeline),
    ).toBeNull();
  });
});
