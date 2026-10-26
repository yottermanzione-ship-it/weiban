import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

const input = {
  userId: '00000000-0000-4000-8000-000000000001',
  voiceId: '00000000-0000-4000-8000-000000000002',
  text: '你好，微伴。',
  purpose: 'voice' as const,
  billingOwner: 'user' as const,
  idempotencyKey: 'reported-tts-usage',
};

/** Controlled internal ports: verifies route/settlement plumbing, not real billing DB acceptance. */
function setup(reported: number | undefined = 10) {
  const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
  const model = {
    modelKey: 'qwen',
    upstreamModelId: 'qwen-audio-3.0-tts-plus',
    billingBounds: {
      tts: { maxTextBytes: 8000, counting: 'codepoints' },
    },
  };
  const charge = { holdId: 'hold', usageRecordId: 'usage' };
  const receipt = { modelKey: 'qwen', chargedMicros: 10, latencyMs: 1, usageRecordId: 'usage' };
  const reportedUsage = reported === undefined ? undefined : { ttsChars: reported };
  const synthesize = vi.fn().mockResolvedValue({
    ok: true,
    reportedUsage,
    value: {
      bytes: new Uint8Array([1, 2]),
      mimeType: 'audio/ogg',
      durationMs: 1,
    },
  });
  const synthesizeStream = vi.fn().mockResolvedValue({
    ok: true,
    reportedUsage,
    value: (async function* () {
      yield new Uint8Array([1, 2]);
    })(),
  });
  const putObject = vi.fn().mockResolvedValue({ mediaId: 'media' });
  const reserve = vi.fn().mockResolvedValue({ ok: true, value: charge });
  const succeed = vi.fn().mockResolvedValue({ ok: true, value: receipt });
  const fail = vi.fn().mockResolvedValue(undefined);
  Object.assign(gateway, {
    activeGenerations: new WeakMap(),
    cached: async (_kind: string, _base: unknown, task: () => Promise<unknown>) => task(),
    precheck: async () => true,
    resolve: async () => ({ ok: true, value: model }),
    assets: {
      getVoice: async () => ({ enabled: true, modelKey: 'qwen', providerVoiceKey: 'system' }),
    },
    media: { putObject },
    reserve,
    succeed,
    fail,
    beginCharge: async () => true,
    withTarget: async (
      _model: unknown,
      call: (target: object, adapter: object) => Promise<unknown>,
    ) => call({}, { synthesize, synthesizeStream }),
  });
  return {
    gateway,
    charge,
    model,
    synthesize,
    synthesizeStream,
    putObject,
    reserve,
    succeed,
    fail,
  };
}

describe('supplier-reported TTS characters survive storage, playback and local failures', () => {
  it('reserves a conservative input ceiling but settles the reported ten units, not six codepoints or eighteen bytes', async () => {
    const { gateway, charge, model, reserve, succeed } = setup();
    expect((await gateway.synthesizeSpeech({ ...input, format: 'ogg_opus' })).ok).toBe(true);
    expect(reserve).toHaveBeenCalledWith(expect.anything(), model, { ttsChars: 18 }, 0);
    expect(succeed).toHaveBeenCalledWith(charge, { ttsChars: 10 }, true);
  });

  it('marks missing supplier quantity as estimated instead of reported', async () => {
    const state = setup();
    state.synthesize.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([1, 2]), mimeType: 'audio/ogg', durationMs: 1 },
    });
    await state.gateway.synthesizeSpeech({ ...input, format: 'ogg_opus' });
    expect(state.succeed).toHaveBeenCalledWith(state.charge, { ttsChars: 6 }, false);
  });

  it.each(['download', 'media_save'])(
    'preserves already billable supplier quantity when %s fails',
    async (failure) => {
      const state = setup();
      if (failure === 'download')
        state.synthesize.mockResolvedValue({
          ok: false,
          category: 'provider_error',
          reportedUsage: { ttsChars: 10 },
        });
      else state.putObject.mockRejectedValue(new Error('local save failure'));
      expect(await state.gateway.synthesizeSpeech({ ...input, format: 'ogg_opus' })).toEqual({
        ok: false,
        error: 'provider_unavailable',
      });
      expect(state.fail).toHaveBeenCalledWith(
        state.charge,
        'provider_error',
        { ttsChars: 10 },
        true,
      );
      expect(state.succeed).not.toHaveBeenCalled();
    },
  );

  it('playback abort does not erase known whole-utterance usage already spent at the supplier', async () => {
    const state = setup();
    const stream = await state.gateway.streamSpeech({ ...input, format: 'pcm16_24k' });
    expect(state.reserve).toHaveBeenCalledWith(expect.anything(), state.model, { ttsChars: 18 }, 0);
    if (!stream.ok) throw new Error(stream.error);
    stream.value.abort();
    await stream.value.done;
    expect(state.succeed).toHaveBeenCalledWith(state.charge, { ttsChars: 10 }, true);
  });

  it('stream setup failure retains supplier quantity rather than claiming unknown/free cost', async () => {
    const state = setup();
    state.synthesizeStream.mockResolvedValue({
      ok: false,
      category: 'provider_error',
      reportedUsage: { ttsChars: 10 },
    });
    expect(await state.gateway.streamSpeech({ ...input, format: 'pcm16_24k' })).toEqual({
      ok: false,
      error: 'provider_unavailable',
    });
    expect(state.fail).toHaveBeenCalledWith(state.charge, 'provider_error', { ttsChars: 10 });
  });
});
