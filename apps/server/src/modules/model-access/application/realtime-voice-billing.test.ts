import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayMedia } from './media-gateway.js';

const USER = '00000000-0000-4000-8000-000000000001';
const ROLE = '00000000-0000-4000-8000-000000000002';
const OMNI = {
  modelKey: 'qwen/qwen3.5-omni-plus-realtime',
  upstreamId: '00000000-0000-4000-8000-000000000003',
  upstreamModelId: 'qwen3.5-omni-plus-realtime',
  fake: false,
  billingBounds: { realtime: { maxCallSeconds: 1800 } },
};
const AUDIO = {
  ...OMNI,
  modelKey: 'qwen/qwen-audio-3.0-realtime-plus',
  upstreamModelId: 'qwen-audio-3.0-realtime-plus',
};
const SAMPLE = {
  sampleMediaId: '00000000-0000-4000-8000-000000000004',
  bytes: new Uint8Array([1]),
  mimeType: 'audio/mpeg',
};

/**
 * 受控的内部端口：验证复刻费的冻结 / 结算 / 解冻接线（假供应商，不连百炼、不碰真实计费库）。
 * 计价本身（voice_clone × 售价）由 billing 规则测试覆盖。
 */
function setup(
  options: {
    model?: typeof OMNI;
    priceMicros?: number | null;
    reserve?: 'ok' | 'insufficient_balance';
    begin?: boolean;
    clone?: 'ok' | 'fail';
    defaultVoice?: string | null;
  } = {},
) {
  const model = options.model ?? OMNI;
  const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
  const charge = { holdId: 'hold', usageRecordId: 'usage', sent: false, model };
  const saveClone = vi.fn(async (input: { providerVoiceKey: string }) => input.providerVoiceKey);
  const reserve = vi.fn(async () =>
    (options.reserve ?? 'ok') === 'ok'
      ? { ok: true, value: charge }
      : { ok: false, error: 'insufficient_balance' },
  );
  const beginCharge = vi.fn(async () => {
    charge.sent = options.begin ?? true;
    return charge.sent;
  });
  const succeed = vi.fn(async () => ({
    ok: true,
    value: {
      modelKey: model.modelKey,
      chargedMicros: 13_000,
      latencyMs: 1,
      usageRecordId: 'usage',
    },
  }));
  const fail = vi.fn(async () => undefined);
  const cancelCharge = vi.fn(async () => undefined);
  const cloneRealtimeVoice = vi.fn(async () =>
    (options.clone ?? 'ok') === 'ok'
      ? { ok: true, value: { voice: 'qwen-tts-vc-wb_1' } }
      : { ok: false, category: 'provider_error' },
  );
  const getActiveServiceRates = vi.fn(async (keys: readonly string[]) => {
    const out = new Map();
    if (options.priceMicros !== null)
      out.set(keys[0], [
        { unit: 'voice_clone', priceMicros: options.priceMicros ?? 13_000, costMicros: 10_000 },
      ]);
    return out;
  });
  Object.assign(gateway, {
    clock: { nowMs: () => 1_000_000 },
    scenarios: { voiceCallPlan: async () => ({ kind: 'realtime', facts: {} }) },
    resolveRealtime: async () => ({ ok: true, value: model }),
    realtimeVoices: {
      binding: async () => null,
      defaults: async () =>
        options.defaultVoice === null ? {} : { [model.modelKey]: options.defaultVoice ?? 'Tina' },
      saveClone,
    },
    realtimeCloneSample: async () => SAMPLE,
    cloneRealtimeVoice,
    rates: { getActiveServiceRates },
    reserve,
    beginCharge,
    succeed,
    fail,
    cancelCharge,
  });
  const check = () =>
    gateway.realtimeCallVoiceCheck({ userId: USER, characterId: ROLE }) as Promise<unknown>;
  return {
    gateway,
    check,
    charge,
    saveClone,
    reserve,
    succeed,
    fail,
    cancelCharge,
    cloneRealtimeVoice,
  };
}

describe('V3 实时通话复刻费（契约 4.6）', () => {
  it('Omni 登记了 0.013 元复刻价：复刻前向打电话的用户冻结 1 个，成功按 1 个结算一次，审计记 user', async () => {
    const t = setup({ defaultVoice: null });
    expect(await t.check()).toEqual({ ok: true });
    expect(t.reserve).toHaveBeenCalledTimes(1);
    expect(t.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        characterId: ROLE,
        purpose: 'voice',
        billingOwner: 'user',
        idempotencyKey: expect.stringMatching(/^realtime-voice-clone:/),
      }),
      OMNI,
      { voiceClones: 1 },
      0,
    );
    expect(t.succeed).toHaveBeenCalledWith(t.charge, { voiceClones: 1 }, true);
    expect(t.fail).not.toHaveBeenCalled();
    expect(t.saveClone).toHaveBeenCalledWith(
      expect.objectContaining({
        modelKey: OMNI.modelKey,
        providerVoiceKey: 'qwen-tts-vc-wb_1',
        costYuan: 0.01,
        billedTo: 'user',
        chargedMicros: 13_000,
      }),
    );
  });

  it('复刻失败：按 0 个解冻、不扣费，也不把整条实时线路记成不可用', async () => {
    const t = setup({ clone: 'fail' });
    t.gateway.realtimeCallVoiceCheck({ userId: USER, characterId: ROLE });
    await vi.waitFor(() => expect(t.fail).toHaveBeenCalledTimes(1));
    expect(t.fail).toHaveBeenCalledWith(t.charge, 'provider_error', { voiceClones: 0 }, false);
    expect(t.succeed).not.toHaveBeenCalled();
    expect(t.saveClone).not.toHaveBeenCalled();
  });

  it('余额不足：不复刻，有默认音色照常放行（不阻断通话）', async () => {
    const t = setup({ reserve: 'insufficient_balance' });
    expect(await t.check()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.cloneRealtimeVoice).not.toHaveBeenCalled();
    expect(t.succeed).not.toHaveBeenCalled();
  });

  it('余额不足且模型没有默认音色：拨打前提示 insufficient_balance', async () => {
    const t = setup({ reserve: 'insufficient_balance', defaultVoice: null });
    expect(await t.check()).toEqual({ ok: false, reason: 'insufficient_balance' });
    expect(t.cloneRealtimeVoice).not.toHaveBeenCalled();
  });

  it('冻结后线路计费上限变了（beginCall 失败）：取消冻结、不复刻', async () => {
    const t = setup({ begin: false, defaultVoice: null });
    expect(await t.check()).toEqual({ ok: false, reason: 'insufficient_balance' });
    expect(t.cancelCharge).toHaveBeenCalledWith(t.charge);
    expect(t.cloneRealtimeVoice).not.toHaveBeenCalled();
  });

  it('没登记复刻价（Qwen Audio Realtime 官方创建音色免费）：不冻结、照常复刻，审计记 platform、成本 0', async () => {
    const t = setup({ model: AUDIO, priceMicros: null, defaultVoice: null });
    expect(await t.check()).toEqual({ ok: true });
    expect(t.reserve).not.toHaveBeenCalled();
    expect(t.saveClone).toHaveBeenCalledWith(
      expect.objectContaining({ billedTo: 'platform', chargedMicros: 0, costYuan: 0 }),
    );
  });

  it('接通时余额不足且没有默认音色：openRealtimeVoice 返回 insufficient_balance（不是「未开通」）', async () => {
    const t = setup({ reserve: 'insufficient_balance', defaultVoice: null });
    Object.assign(t.gateway, {
      precheck: async () => true,
      upstreams: { get: async () => ({ kind: 'dashscope' }) },
    });
    expect(
      await t.gateway.openRealtimeVoice({
        userId: USER,
        characterId: ROLE,
        purpose: 'voice',
        billingOwner: 'user',
        idempotencyKey: 'call:1:rt:1',
        instructions: '你好',
        sampleRate: 16000,
      }),
    ).toEqual({ ok: false, error: 'insufficient_balance' });
  });
});
