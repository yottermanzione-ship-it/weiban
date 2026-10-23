import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

const userId = '00000000-0000-4000-8000-000000000001';
const characterId = '00000000-0000-4000-8000-000000000002';
const voiceId = '00000000-0000-4000-8000-000000000003';
const base = {
  userId,
  characterId,
  voiceId,
  text: '你好',
  purpose: 'voice' as const,
  billingOwner: 'user' as const,
  idempotencyKey: 'voice-selection-test',
};

/** Unit-level route checks: cache/precheck replaced, never a real DB/provider acceptance. */
function setup(voiceModel: string | null, selected: string | null = 'user-picked') {
  const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
  const pick = vi.fn().mockResolvedValue(
    selected
      ? {
          facts: {
            modelKey: selected,
            upstreamStatus: 'active',
            entry: {
              modelKey: selected,
              upstreamId: 'u1',
              upstreamModelId: 'tts-system',
              enabled: true,
            },
          },
        }
      : null,
  );
  const fact = vi.fn();
  const run = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const reserve = vi.fn().mockResolvedValue({ ok: false, error: 'insufficient_balance' });
  Object.assign(gateway, {
    scenarios: { pick },
    catalog: { fact, recommendedModel: vi.fn() },
    assets: {
      getVoice: async () => ({ enabled: true, modelKey: voiceModel, providerVoiceKey: 'system' }),
    },
    config: { nodeEnv: 'test' },
    bounds: { get: async () => ({ tts: { maxTextBytes: 8000, counting: 'codepoints' } }) },
    cached: async (_kind: string, _input: unknown, task: () => Promise<unknown>) => task(),
    precheck: async () => true,
    run,
    reserve,
  });
  return { gateway, pick, fact, run, reserve };
}

describe('voice binding cannot override selected scenario/character model', () => {
  it.each(['another-provider-model', null])(
    'refuses incompatible or unscoped voice (%s) before billing or network',
    async (voiceModel) => {
      const { gateway, pick, fact, run, reserve } = setup(voiceModel);
      expect(await gateway.synthesizeSpeech({ ...base, format: 'ogg_opus' })).toEqual({
        ok: false,
        error: 'model_unavailable',
      });
      expect(await gateway.streamSpeech({ ...base, format: 'pcm16_24k' })).toEqual({
        ok: false,
        error: 'model_unavailable',
      });
      expect(pick).toHaveBeenCalledWith(userId, 'voice_message', characterId);
      expect(fact).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
    },
  );

  it('does not pick the voice model when the user has not selected a scenario', async () => {
    const { gateway, run } = setup('voice-model', null);
    expect(await gateway.synthesizeSpeech({ ...base, format: 'ogg_opus' })).toEqual({
      ok: false,
      error: 'not_configured',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps a compatible selected model for both message and call synthesis', async () => {
    const { gateway, run, reserve, fact } = setup('user-picked');
    await gateway.synthesizeSpeech({ ...base, format: 'ogg_opus' });
    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelKey: 'user-picked' }),
      expect.objectContaining({ ttsChars: 2 }),
      expect.any(Function),
    );
    await gateway.streamSpeech({ ...base, format: 'pcm16_24k' });
    expect(reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelKey: 'user-picked' }),
      { ttsChars: 2 },
      0,
    );
    expect(fact).not.toHaveBeenCalled();
  });
});
