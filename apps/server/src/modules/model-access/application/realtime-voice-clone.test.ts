import { describe, expect, it, vi } from 'vitest';
import type { MediaAdapterResult } from '../infra/media-adapter.js';
import {
  CLONE_RETRY_AFTER_MS,
  RealtimeVoiceCloner,
  type RealtimeCloneSample,
  type RealtimeVoiceClonerDeps,
} from './realtime-voice-clone.js';

const ROLE = '33333333-3333-4333-8333-333333333333';
const MODEL = { modelKey: 'qwen/qwen3.5-omni-plus-realtime' };
const PAYER = 'user-1';
const SAMPLE: RealtimeCloneSample = {
  sampleMediaId: '44444444-4444-4444-8444-444444444444',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'audio/mpeg',
};

type Clone = MediaAdapterResult<{ voice: string }>;

/** 假依赖：内存里的绑定表；复刻结果由测试决定，可挂起以模拟慢复刻。 */
function setup(
  options: {
    defaultVoice?: string | null;
    sample?: RealtimeCloneSample | null;
    clone?: () => Promise<Clone>;
    waitMs?: number;
    /** V3：复刻费冻结结果；不传 = 不提供计费依赖（平台承担）。 */
    charge?: 'free' | 'charged' | 'unpaid' | 'throws';
  } = {},
) {
  const bindings = new Map<string, string>();
  let now = 1_000_000;
  const clone = vi.fn(
    options.clone ??
      (async (): Promise<Clone> => ({ ok: true, value: { voice: 'qwen-tts-vc-wb_1' } })),
  );
  const save = vi.fn(async (characterId: string, model: typeof MODEL, voice: string) => {
    const key = `${characterId}|${model.modelKey}`;
    const existing = bindings.get(key);
    if (existing) return existing;
    bindings.set(key, voice);
    return voice;
  });
  const authorize = vi.fn(async (_model: typeof MODEL, payer: string) => {
    if (options.charge === 'throws') throw new Error('db down');
    return options.charge === 'charged'
      ? { kind: 'charged' as const, ticket: `hold:${payer}` }
      : { kind: (options.charge ?? 'free') as 'free' | 'unpaid' };
  });
  const settle = vi.fn(async () => 13_000);
  const refund = vi.fn(async () => undefined);
  const deps: RealtimeVoiceClonerDeps<typeof MODEL, string, string> = {
    ...(options.charge ? { authorize, settle, refund } : {}),
    binding: async (characterId, modelKey) => bindings.get(`${characterId}|${modelKey}`) ?? null,
    defaultVoice: async () => (options.defaultVoice === undefined ? 'Tina' : options.defaultVoice),
    sample: async () => (options.sample === undefined ? SAMPLE : options.sample),
    clone,
    save,
    nowMs: () => now,
    waitMs: options.waitMs ?? 50,
  };
  return {
    cloner: new RealtimeVoiceCloner(deps),
    clone,
    save,
    authorize,
    settle,
    refund,
    bindings,
    advance: (ms: number) => (now += ms),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('实时通话音色按需复刻', () => {
  it('没有绑定 → 当场复刻并写入；之后直接复用，不再复刻', async () => {
    const t = setup();
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'qwen-tts-vc-wb_1',
      source: 'cloned',
    });
    expect(t.save).toHaveBeenCalledWith(ROLE, MODEL, 'qwen-tts-vc-wb_1', SAMPLE, {
      billedTo: 'platform',
      chargedMicros: 0,
    });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'qwen-tts-vc-wb_1',
      source: 'binding',
    });
    expect(t.clone).toHaveBeenCalledTimes(1);
  });

  it('同一角色 + 模型并发 5 通，只复刻一次', async () => {
    const gate = deferred<Clone>();
    const t = setup({ clone: () => gate.promise, waitMs: 5_000 });
    const calls = Array.from({ length: 5 }, () => t.cloner.choose(ROLE, MODEL, 'call', PAYER));
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve({ ok: true, value: { voice: 'qwen-tts-vc-wb_1' } });
    const results = await Promise.all(calls);
    expect(results.every((r) => r.voice === 'qwen-tts-vc-wb_1')).toBe(true);
    expect(t.clone).toHaveBeenCalledTimes(1);
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it('复刻失败 → 用默认音色；10 分钟内不重试，过后再试', async () => {
    const t = setup({ clone: async () => ({ ok: false, category: 'provider_error' }) });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    expect(t.clone).toHaveBeenCalledTimes(1);
    t.advance(CLONE_RETRY_AFTER_MS + 1);
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(t.clone).toHaveBeenCalledTimes(2);
  });

  it('本机转码忙不算失败，不进入冷却', async () => {
    const t = setup({
      clone: async () => ({ ok: false, category: 'rate_limited', localRateLimit: true }),
    });
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(t.clone).toHaveBeenCalledTimes(2);
  });

  it('复刻失败且没有默认音色 → 不接通（clone_failed）；供应商返回的代号不合法也算失败', async () => {
    const failed = setup({
      defaultVoice: null,
      clone: async () => ({ ok: false, category: 'invalid_key' }),
    });
    expect(await failed.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: null,
      reason: 'clone_failed',
    });
    const bad = setup({
      defaultVoice: null,
      clone: async () => ({ ok: true, value: { voice: 'bad voice' } }),
    });
    expect(await bad.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: null,
      reason: 'clone_failed',
    });
    expect(bad.save).not.toHaveBeenCalled();
  });

  it('角色没有声音样本 → 不调供应商；有默认用默认，没默认 no_voice', async () => {
    const withDefault = setup({ sample: null });
    expect(await withDefault.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    const none = setup({ sample: null, defaultVoice: null });
    expect(await none.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: null,
      reason: 'no_voice',
    });
    expect(withDefault.clone).not.toHaveBeenCalled();
    expect(none.clone).not.toHaveBeenCalled();
  });

  it('复刻超时 → 先用默认音色接通，复刻在后台完成后下一通直接用', async () => {
    const gate = deferred<Clone>();
    const t = setup({ clone: () => gate.promise, waitMs: 10 });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    gate.resolve({ ok: true, value: { voice: 'qwen-tts-vc-wb_late' } });
    await vi.waitFor(() => expect(t.save).toHaveBeenCalledTimes(1));
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'qwen-tts-vc-wb_late',
      source: 'binding',
    });
  });

  it('超时且没有默认音色 → 在等待上限内返回 clone_failed，不无限等待', async () => {
    const t = setup({ defaultVoice: null, clone: () => new Promise<Clone>(() => {}), waitMs: 10 });
    const started = Date.now();
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: null,
      reason: 'clone_failed',
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('拨打前检查：有默认音色立即放行（不等复刻），复刻在后台进行', async () => {
    const gate = deferred<Clone>();
    const t = setup({ clone: () => gate.promise, waitMs: 60_000 });
    expect(await t.cloner.choose(ROLE, MODEL, 'precheck', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    await vi.waitFor(() => expect(t.clone).toHaveBeenCalledTimes(1));
    gate.resolve({ ok: true, value: { voice: 'qwen-tts-vc-wb_1' } });
    await vi.waitFor(() => expect(t.bindings.size).toBe(1));
  });

  it('另一实例已写入绑定时，以先写入的为准', async () => {
    const t = setup();
    t.save.mockImplementationOnce(async () => 'qwen-tts-vc-wb_other');
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'qwen-tts-vc-wb_other',
      source: 'cloned',
    });
  });
});

describe('V3：复刻费由用户承担（契约 4.6 voice_clone）', () => {
  it('复刻成功 → 冻结一次、按 1 个结算一次，审计记 billedTo = user 与实际扣费', async () => {
    const t = setup({ charge: 'charged' });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'qwen-tts-vc-wb_1',
      source: 'cloned',
    });
    expect(t.authorize).toHaveBeenCalledTimes(1);
    expect(t.authorize).toHaveBeenCalledWith(MODEL, PAYER);
    expect(t.settle).toHaveBeenCalledTimes(1);
    expect(t.settle).toHaveBeenCalledWith('hold:user-1');
    expect(t.refund).not.toHaveBeenCalled();
    expect(t.save).toHaveBeenCalledWith(ROLE, MODEL, 'qwen-tts-vc-wb_1', SAMPLE, {
      billedTo: 'user',
      chargedMicros: 13_000,
    });
    // 之后复用绑定，不再冻结、不再扣费
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(t.authorize).toHaveBeenCalledTimes(1);
    expect(t.settle).toHaveBeenCalledTimes(1);
  });

  it('并发 5 通只扣发起复刻的那一次', async () => {
    const gate = deferred<Clone>();
    const t = setup({ charge: 'charged', clone: () => gate.promise, waitMs: 5_000 });
    const calls = Array.from({ length: 5 }, (_, i) =>
      t.cloner.choose(ROLE, MODEL, 'call', `user-${i + 1}`),
    );
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve({ ok: true, value: { voice: 'qwen-tts-vc-wb_1' } });
    await Promise.all(calls);
    expect(t.authorize).toHaveBeenCalledTimes(1);
    expect(t.settle).toHaveBeenCalledTimes(1);
  });

  it('复刻失败 / 返回代号不合法 → 取消冻结、不扣费，用默认音色', async () => {
    const failed = setup({
      charge: 'charged',
      clone: async () => ({ ok: false, category: 'provider_error' }),
    });
    expect(await failed.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    expect(failed.refund).toHaveBeenCalledWith('hold:user-1');
    expect(failed.settle).not.toHaveBeenCalled();
    expect(failed.save).not.toHaveBeenCalled();
    const bad = setup({
      charge: 'charged',
      clone: async () => ({ ok: true, value: { voice: 'bad voice' } }),
    });
    await bad.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(bad.refund).toHaveBeenCalledTimes(1);
    expect(bad.settle).not.toHaveBeenCalled();
  });

  it('余额不足（冻结失败）→ 不调供应商、不进冷却，用默认音色接通', async () => {
    const t = setup({ charge: 'unpaid' });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    expect(t.clone).not.toHaveBeenCalled();
    expect(t.settle).not.toHaveBeenCalled();
    // 不进失败冷却：充值后下一通立刻再试
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(t.authorize).toHaveBeenCalledTimes(2);
  });

  it('余额不足且没有默认音色 → insufficient_balance（由调用方提示充值）；计费异常按不复刻处理', async () => {
    const t = setup({ charge: 'unpaid', defaultVoice: null });
    expect(await t.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: null,
      reason: 'insufficient_balance',
    });
    const broken = setup({ charge: 'throws' });
    expect(await broken.cloner.choose(ROLE, MODEL, 'call', PAYER)).toEqual({
      voice: 'Tina',
      source: 'default',
    });
    expect(broken.clone).not.toHaveBeenCalled();
  });

  it('模型没登记复刻价 → 不收费照常复刻，审计记 billedTo = platform', async () => {
    const t = setup({ charge: 'free' });
    await t.cloner.choose(ROLE, MODEL, 'call', PAYER);
    expect(t.clone).toHaveBeenCalledTimes(1);
    expect(t.settle).not.toHaveBeenCalled();
    expect(t.save).toHaveBeenCalledWith(ROLE, MODEL, 'qwen-tts-vc-wb_1', SAMPLE, {
      billedTo: 'platform',
      chargedMicros: 0,
    });
  });
});
