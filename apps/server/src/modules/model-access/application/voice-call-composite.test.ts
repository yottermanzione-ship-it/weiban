import { describe, expect, it, vi } from 'vitest';
import type { ModelFacts } from './catalog.js';
import { CatalogService } from './catalog.js';
import {
  checkVoiceCallComponents,
  DEFAULT_DISPLAY_BASE_MODEL_KEY,
  isVoiceCallComposite,
  readVoiceCallPipelineValue,
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_SETTING_KEY,
  VOICE_CALL_PIPELINE_TAG,
  voiceCallDisplayMultiplier,
  voiceCallFailureDetail,
  voiceCallFailureError,
  voiceCallMinuteMicros,
} from './voice-call-composite.js';

const pipeline = {
  asrModelKey: 'asr/sensevoice',
  textModelKey: 'text/deepseek-v4.1-flash',
  ttsModelKey: 'tts/mimo',
};

const textPrices = {
  inputPerMillionMicros: 1_000_000,
  cachedInputPerMillionMicros: 200_000,
  outputPerMillionMicros: 4_000_000,
};
const basePrices = {
  inputPerMillionMicros: 8_000_000,
  cachedInputPerMillionMicros: 1_000_000,
  outputPerMillionMicros: 32_000_000,
};

function facts(modelKey: string, options: { enabled?: boolean; status?: string | null } = {}) {
  return {
    modelKey,
    entry: {
      modelKey,
      displayName: modelKey,
      vendorName: 'vendor',
      upstreamId: `upstream-${modelKey}`,
      upstreamModelId: `fake-${modelKey}`,
      capabilities: [],
      tags: [],
      scenarios: ['voice_call', 'voice_message', 'speech_recognition'],
      enabled: options.enabled ?? true,
    },
    upstreamStatus: options.status === undefined ? 'active' : options.status,
  } as unknown as ModelFacts;
}

describe('voice-call composite catalog identity', () => {
  it('requires both the fixed model key and the pipeline tag', () => {
    expect(
      isVoiceCallComposite({
        modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
        tags: [VOICE_CALL_PIPELINE_TAG],
      }),
    ).toBe(true);
    expect(isVoiceCallComposite({ modelKey: VOICE_CALL_CASCADE_MODEL_KEY, tags: [] })).toBe(false);
    expect(isVoiceCallComposite({ modelKey: 'text/other', tags: [VOICE_CALL_PIPELINE_TAG] })).toBe(
      false,
    );
    expect(isVoiceCallComposite(null)).toBe(false);
  });

  it('detects the composite entry in the catalog only with the tag', async () => {
    const catalog = Object.create(CatalogService.prototype) as CatalogService;
    const entry = {
      modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      entry: {
        modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
        tags: [VOICE_CALL_PIPELINE_TAG],
        enabled: true,
      },
      upstreamStatus: 'active',
    } as unknown as ModelFacts;
    Object.assign(catalog, { fact: async () => entry });
    await expect(catalog.voiceCallCompositeFact()).resolves.toBe(entry);
    Object.assign(catalog, {
      fact: async () => ({ ...entry, entry: { ...entry.entry!, tags: [] } }),
    });
    await expect(catalog.voiceCallCompositeFact()).resolves.toBeNull();
  });
});

describe('voice-call component availability', () => {
  it('accepts three enabled components on healthy upstreams', () => {
    const checked = checkVoiceCallComponents(pipeline, {
      asr: facts(pipeline.asrModelKey),
      text: facts(pipeline.textModelKey),
      tts: facts(pipeline.ttsModelKey),
    });
    expect(checked.ok).toBe(true);
  });

  it.each(['asr', 'text', 'tts'] as const)(
    'marks the whole pipeline unavailable with the failed %s component',
    (component) => {
      const checked = checkVoiceCallComponents(pipeline, {
        asr: facts(pipeline.asrModelKey, { enabled: component !== 'asr' }),
        text: facts(pipeline.textModelKey, { enabled: component !== 'text' }),
        tts: facts(pipeline.ttsModelKey, { enabled: component !== 'tts' }),
      });
      expect(checked.ok).toBe(false);
      if (checked.ok) return;
      expect(checked.failure).toMatchObject({
        reason: 'component_unavailable',
        component,
        detail: 'model_removed',
      });
      expect(checked.failure.modelKey).toBe(
        { asr: pipeline.asrModelKey, text: pipeline.textModelKey, tts: pipeline.ttsModelKey }[
          component
        ],
      );
    },
  );

  it('reports a deleted component as model_removed and a broken upstream as provider_unavailable', () => {
    const deleted = checkVoiceCallComponents(pipeline, {
      asr: facts(pipeline.asrModelKey),
      text: facts(pipeline.textModelKey),
      tts: { modelKey: pipeline.ttsModelKey, entry: null, upstreamStatus: null },
    });
    expect(!deleted.ok && deleted.failure).toMatchObject({
      component: 'tts',
      modelKey: pipeline.ttsModelKey,
      detail: 'model_removed',
    });
    const broken = checkVoiceCallComponents(pipeline, {
      asr: facts(pipeline.asrModelKey, { status: 'invalid' }),
      text: facts(pipeline.textModelKey),
      tts: facts(pipeline.ttsModelKey),
    });
    expect(!broken.ok && broken.failure).toMatchObject({
      component: 'asr',
      detail: 'provider_unavailable',
      upstreamStatus: 'invalid',
    });
    expect(broken.ok ? null : voiceCallFailureError(broken.failure)).toBe('provider_unavailable');
    expect(broken.ok ? null : voiceCallFailureDetail(broken.failure)).toBe('upstream_invalid_key');
  });

  it('maps unconfigured and disabled composites to explicit existing errors/details', () => {
    expect(voiceCallFailureError({ reason: 'pipeline_unconfigured' })).toBe('not_configured');
    expect(voiceCallFailureError({ reason: 'composite_disabled' })).toBe('model_unavailable');
    expect(voiceCallFailureDetail({ reason: 'pipeline_unconfigured' })).toBe('no_route');
    expect(voiceCallFailureDetail({ reason: 'composite_disabled' })).toBe('model_removed');
  });
});

describe('voice-call minute blend display multiplier', () => {
  it('prices one minute as ASR 1 min + 68 TTS chars + 6 text turns, relative to the base model', () => {
    const prices = {
      asrPerMinuteMicros: 10_800,
      ttsPer10kCharsMicros: 1_820_000,
      text: textPrices,
      base: basePrices,
    };
    // 10,800 + 1,820,000×68/10,000 + 6×4,400 = 49,576 micros ≈ 4.96 积分 / 分钟
    expect(voiceCallMinuteMicros(prices)).toBe(49_576);
    // 基准模型 6 轮标准回复 = 6×30,400 = 182,400 micros
    expect(voiceCallDisplayMultiplier(prices)).toBe(0.27);
  });

  it('returns null instead of inventing a multiplier when any price is missing', () => {
    const complete = {
      asrPerMinuteMicros: 10_800,
      ttsPer10kCharsMicros: 1_820_000,
      text: textPrices,
      base: basePrices,
    };
    expect(voiceCallDisplayMultiplier({ ...complete, asrPerMinuteMicros: null })).toBeNull();
    expect(voiceCallDisplayMultiplier({ ...complete, ttsPer10kCharsMicros: null })).toBeNull();
    expect(voiceCallDisplayMultiplier({ ...complete, text: null })).toBeNull();
    expect(voiceCallDisplayMultiplier({ ...complete, base: null })).toBeNull();
  });
});

describe('voice_call_pipeline setting read/write', () => {
  function catalogWithValue(value: unknown) {
    const catalog = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(catalog, {
      database: {
        db: {
          select: () => ({ from: () => ({ where: async () => [{ value }] }) }),
        },
      },
    });
    return catalog;
  }

  it('treats a missing or invalid stored value as unconfigured', async () => {
    expect(await catalogWithValue(undefined).voiceCallPipeline()).toBeNull();
    expect(
      await catalogWithValue({ asrModelKey: 'asr/x', textModelKey: 'text/x' }).voiceCallPipeline(),
    ).toBeNull();
    expect(await catalogWithValue({ ...pipeline, extra: 'nope' }).voiceCallPipeline()).toBeNull();
    expect(
      await catalogWithValue({
        ...pipeline,
        ttsModelKey: pipeline.textModelKey,
      }).voiceCallPipeline(),
    ).toBeNull();
    expect(readVoiceCallPipelineValue(pipeline)).toEqual(pipeline);
  });

  it('persists a valid pipeline with an audit entry', async () => {
    const writes: unknown[] = [];
    const audits: unknown[] = [];
    const catalog = catalogWithValue(undefined);
    Object.assign(catalog, {
      clock: { now: () => new Date('2026-10-24T00:00:00.000Z') },
      audit: { record: async (entry: unknown) => void audits.push(entry) },
      database: {
        db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
        transaction: async (fn: (tx: unknown) => Promise<void>) =>
          fn({
            db: {
              insert: () => ({
                values: (value: unknown) => ({
                  onConflictDoUpdate: async () => void writes.push(value),
                }),
              }),
            },
          }),
      },
    });
    await expect(catalog.setVoiceCallPipeline('admin', pipeline)).resolves.toEqual(pipeline);
    expect(writes[0]).toMatchObject({
      key: VOICE_CALL_PIPELINE_SETTING_KEY,
      value: pipeline,
      updatedBy: 'admin',
    });
    expect(audits[0]).toMatchObject({
      action: 'voice_call_pipeline.updated',
      actorId: 'admin',
      details: { before: null, after: pipeline },
    });
  });

  it('rejects invalid or self-referencing writes before touching storage', async () => {
    const transaction = vi.fn();
    const catalog = catalogWithValue(undefined);
    Object.assign(catalog, { database: { db: { select: () => ({}) }, transaction } });
    await expect(
      catalog.setVoiceCallPipeline('admin', { ...pipeline, textModelKey: pipeline.asrModelKey }),
    ).rejects.toMatchObject({ code: 'bad_request', status: 422 });
    await expect(
      catalog.setVoiceCallPipeline('admin', {
        ...pipeline,
        ttsModelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      }),
    ).rejects.toMatchObject({ code: 'bad_request', status: 422 });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('catalog composite display multiplier', () => {
  it('uses the default base openai/gpt-6.1-sol and returns null when a component price is missing', async () => {
    const catalog = Object.create(CatalogService.prototype) as CatalogService;
    const serviceRates = new Map([
      [
        pipeline.asrModelKey,
        [{ unit: 'asr_minute', priceMicros: 10_800, costMicros: 10_800, hasTimeBands: false }],
      ],
      [
        pipeline.ttsModelKey,
        [
          {
            unit: 'tts_10k_chars',
            priceMicros: 1_820_000,
            costMicros: 1_820_000,
            hasTimeBands: false,
          },
        ],
      ],
    ]);
    const prices = new Map([
      [pipeline.textModelKey, textPrices],
      [DEFAULT_DISPLAY_BASE_MODEL_KEY, basePrices],
    ]);
    Object.assign(catalog, {
      voiceCallPipeline: async () => pipeline,
      display: { getSettings: async () => ({ baseModelKey: null }) },
      rates: { getActiveServiceRates: async () => serviceRates },
      prices: { textPrices: async () => prices },
    });
    await expect(catalog.voiceCallCompositeDisplayMultiplier()).resolves.toBe(0.27);

    Object.assign(catalog, {
      rates: { getActiveServiceRates: async () => new Map([...serviceRates].slice(0, 1)) },
    });
    await expect(catalog.voiceCallCompositeDisplayMultiplier()).resolves.toBeNull();
  });
});
