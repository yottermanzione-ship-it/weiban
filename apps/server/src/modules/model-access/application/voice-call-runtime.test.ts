import { describe, expect, it, vi } from 'vitest';
import type { ModelFacts } from './catalog.js';
import { ModelGatewayMedia } from './media-gateway.js';
import { ScenarioService } from './scenarios.js';
import {
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_TAG,
  type VoiceCallComponentFacts,
  type VoiceCallPlan,
} from './voice-call-composite.js';

const userId = '00000000-0000-4000-8000-000000000001';
const characterId = '00000000-0000-4000-8000-000000000002';
const ASR = 'asr/sensevoice';
const TEXT = 'text/deepseek-v4.1-flash';
const TTS = 'tts/mimo';
const pipeline = { asrModelKey: ASR, textModelKey: TEXT, ttsModelKey: TTS };

function facts(
  modelKey: string,
  options: { enabled?: boolean; status?: string | null; tags?: string[] } = {},
): ModelFacts {
  return {
    modelKey,
    entry: {
      modelKey,
      displayName: modelKey,
      vendorName: 'vendor',
      upstreamId: `upstream-${modelKey}`,
      upstreamModelId: `fake-${modelKey}`,
      capabilities: [],
      tags: options.tags ?? [],
      scenarios: ['voice_call', 'voice_message', 'speech_recognition'],
      enabled: options.enabled ?? true,
    },
    upstreamStatus: options.status === undefined ? 'active' : options.status,
  } as unknown as ModelFacts;
}

const composite = facts(VOICE_CALL_CASCADE_MODEL_KEY, { tags: [VOICE_CALL_PIPELINE_TAG] });

function components(): VoiceCallComponentFacts {
  return { asr: facts(ASR), text: facts(TEXT), tts: facts(TTS) };
}

function compositePlan(): VoiceCallPlan {
  return { kind: 'composite', source: 'user', pipeline, components: components() };
}

type RawMap = Map<string, string>;

/** 只替换 ScenarioService 的数据来源（真实 pick / voiceCallPlan 逻辑照跑）。 */
function scenarioService(options: {
  user?: string;
  override?: string;
  pipeline: typeof pipeline | null;
  entries?: ModelFacts[];
}) {
  const entries = new Map((options.entries ?? []).map((f) => [f.modelKey, f]));
  const lookup = (key: string): ModelFacts =>
    entries.get(key) ?? { modelKey: key, entry: null, upstreamStatus: null };
  const svc = Object.create(ScenarioService.prototype) as ScenarioService;
  Object.assign(svc, {
    raw: async (): Promise<RawMap> => new Map(options.user ? [['voice_call', options.user]] : []),
    rawOverrides: async (): Promise<RawMap> =>
      new Map(options.override ? [['voice_call', options.override]] : []),
    catalog: {
      fact: async (key: string) => lookup(key),
      facts: async (keys: readonly string[]) =>
        new Map(keys.map((key) => [key, lookup(key)] as const)),
      voiceCallPipeline: async () => options.pipeline,
      modelUses: async () => ({ recommended: {}, internal: {} }),
    },
  });
  return svc;
}

describe('voice_call scenario resolves through the composite pipeline', () => {
  it('routes text to textModelKey while reporting the composite selection as usable', async () => {
    const svc = scenarioService({
      user: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline,
      entries: [composite, ...Object.values(components())],
    });
    const plan = await svc.voiceCallPlan(userId, null);
    expect(plan).toMatchObject({ kind: 'composite', pipeline });
    const picked = await svc.pick(userId, 'voice_call', null);
    expect(picked).toMatchObject({ source: 'user', facts: { modelKey: TEXT } });
    const config = await svc.getConfig(userId);
    expect(config.scenarios.find((s) => s.scenario === 'voice_call')?.selection).toEqual({
      modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      available: true,
      unavailableReason: null,
      unavailableDetail: null,
    });
  });

  it('prefers a character override and keeps the composite selection source', async () => {
    const svc = scenarioService({
      user: TEXT,
      override: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline,
      entries: [composite, ...Object.values(components()), facts(TEXT)],
    });
    await expect(svc.pick(userId, 'voice_call', characterId)).resolves.toMatchObject({
      source: 'override',
      facts: { modelKey: TEXT },
    });
  });

  it('never falls back to another model when a component is disabled or deleted', async () => {
    const broken = { ...components(), tts: facts(TTS, { enabled: false }) };
    const svc = scenarioService({
      user: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline,
      entries: [composite, broken.asr, broken.text, broken.tts],
    });
    const plan = await svc.voiceCallPlan(userId, null);
    expect(plan).toMatchObject({
      kind: 'unavailable',
      failure: {
        reason: 'component_unavailable',
        component: 'tts',
        modelKey: TTS,
        detail: 'model_removed',
      },
    });
    // 解析方拿到的是不可用的事实（entry = null → model_unavailable），不会换模型。
    const picked = await svc.pick(userId, 'voice_call', null);
    expect(picked?.facts.modelKey).toBe(VOICE_CALL_CASCADE_MODEL_KEY);
    expect(picked?.facts.entry).toBeNull();
    const config = await svc.getConfig(userId);
    expect(config.scenarios.find((s) => s.scenario === 'voice_call')?.selection).toMatchObject({
      available: false,
      unavailableReason: 'model_removed',
      unavailableDetail: 'model_removed',
    });
  });

  it('reports the upstream status of a broken component without silently switching', async () => {
    const svc = scenarioService({
      user: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline,
      entries: [composite, facts(ASR, { status: 'quota_exhausted' }), facts(TEXT), facts(TTS)],
    });
    const plan = await svc.voiceCallPlan(userId, null);
    expect(plan).toMatchObject({
      kind: 'unavailable',
      failure: {
        reason: 'component_unavailable',
        component: 'asr',
        detail: 'provider_unavailable',
        upstreamStatus: 'quota_exhausted',
      },
    });
    expect((await svc.pick(userId, 'voice_call', null))?.facts.entry).toBeNull();
  });

  it('treats a missing pipeline setting as not configured, not as another model', async () => {
    const svc = scenarioService({
      user: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline: null,
      entries: [composite],
    });
    await expect(svc.voiceCallPlan(userId, null)).resolves.toMatchObject({
      kind: 'unavailable',
      failure: { reason: 'pipeline_unconfigured' },
    });
    await expect(svc.pick(userId, 'voice_call', null)).resolves.toBeNull();
  });

  it('keeps the ordinary single-model path when the selection is not the composite', async () => {
    const textOnly = facts(TEXT);
    const svc = scenarioService({ user: TEXT, pipeline, entries: [textOnly] });
    await expect(svc.voiceCallPlan(userId, null)).resolves.toEqual({ kind: 'not_composite' });
    await expect(svc.pick(userId, 'voice_call', null)).resolves.toMatchObject({
      facts: { modelKey: TEXT },
    });
  });

  it('treats a disabled composite entry itself as unavailable', async () => {
    const disabled = facts(VOICE_CALL_CASCADE_MODEL_KEY, {
      enabled: false,
      tags: [VOICE_CALL_PIPELINE_TAG],
    });
    const svc = scenarioService({
      user: VOICE_CALL_CASCADE_MODEL_KEY,
      pipeline,
      entries: [disabled],
    });
    await expect(svc.voiceCallPlan(userId, null)).resolves.toMatchObject({
      kind: 'unavailable',
      failure: { reason: 'composite_disabled' },
    });
    expect((await svc.pick(userId, 'voice_call', null))?.facts.entry).toBeNull();
  });
});

describe('media gateway call paths use composite components', () => {
  function mediaGateway(plan: VoiceCallPlan, fallback: ModelFacts | null = null) {
    const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
    const reserve = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        usageRecordId: 'usage',
        holdId: 'hold',
        model: {},
        startedAt: new Date(0),
        wallStart: 0,
        attemptId: 'attempt',
        sent: false,
      },
    });
    const pick = vi.fn().mockResolvedValue(fallback ? { facts: fallback, source: 'user' } : null);
    Object.assign(gateway, {
      precheck: async () => true,
      scenarios: { voiceCallPlan: async () => plan, pick },
      catalog: { internalModel: vi.fn(), recommendedModel: vi.fn(), fact: vi.fn() },
      config: { nodeEnv: 'test' },
      bounds: {
        get: async (modelKey: string) =>
          modelKey === ASR
            ? { asr: { maxSeconds: 15, billingStepSeconds: 1 } }
            : modelKey === TTS
              ? { tts: { maxTextBytes: 8000, counting: 'codepoints' } }
              : null,
      },
      reserve,
    });
    return { gateway, reserve, pick };
  }

  const base = {
    userId,
    characterId,
    purpose: 'voice' as const,
    billingOwner: 'user' as const,
    idempotencyKey: 'voice-call-composite',
  };

  type ResolveCall = (
    service: string,
    preferredModelKey: string | null,
    call: unknown,
    component?: 'asr' | 'tts',
  ) => Promise<{ ok: boolean; value?: { modelKey: string }; error?: string }>;
  const resolveOf = (gateway: ModelGatewayMedia) =>
    (gateway as unknown as { resolve: ResolveCall }).resolve.bind(gateway);

  it('opens realtime ASR on the asrModelKey component', async () => {
    const { gateway, reserve, pick } = mediaGateway(compositePlan());
    const opened = await gateway.openRealtimeAsr({ ...base, sampleRate: 16000 });
    expect(opened.ok).toBe(true);
    expect(reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelKey: ASR }),
      { asrSeconds: 15 },
      0,
    );
    expect(pick).not.toHaveBeenCalled();
  });

  it('resolves streamed TTS on the ttsModelKey component and rejects a mismatched voice', async () => {
    const { gateway } = mediaGateway(compositePlan());
    const resolve = resolveOf(gateway);
    await expect(resolve('speech_synthesis', TTS, base, 'tts')).resolves.toMatchObject({
      ok: true,
      value: { modelKey: TTS },
    });
    await expect(resolve('speech_synthesis', TEXT, base, 'tts')).resolves.toEqual({
      ok: false,
      error: 'model_unavailable',
    });
  });

  it('fails explicitly when a component is unavailable instead of using the ordinary scenario', async () => {
    const { gateway, reserve, pick } = mediaGateway({
      kind: 'unavailable',
      source: 'user',
      modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      failure: {
        reason: 'component_unavailable',
        component: 'asr',
        modelKey: ASR,
        detail: 'model_removed',
        upstreamStatus: null,
      },
    });
    await expect(gateway.openRealtimeAsr({ ...base, sampleRate: 16000 })).resolves.toEqual({
      ok: false,
      error: 'model_unavailable',
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
  });

  it('reports an unconfigured pipeline as not_configured', async () => {
    const { gateway, reserve } = mediaGateway({
      kind: 'unavailable',
      source: 'user',
      modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      failure: { reason: 'pipeline_unconfigured' },
    });
    await expect(gateway.openRealtimeAsr({ ...base, sampleRate: 16000 })).resolves.toEqual({
      ok: false,
      error: 'not_configured',
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('keeps the ordinary speech scenario path when the call model is not composite', async () => {
    const { gateway, reserve, pick } = mediaGateway({ kind: 'not_composite' }, facts(ASR));
    const opened = await gateway.openRealtimeAsr({ ...base, sampleRate: 16000 });
    expect(opened.ok).toBe(true);
    expect(pick).toHaveBeenCalledWith(userId, 'speech_recognition', characterId);
    expect(reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelKey: ASR }),
      expect.anything(),
      0,
    );
  });
});
