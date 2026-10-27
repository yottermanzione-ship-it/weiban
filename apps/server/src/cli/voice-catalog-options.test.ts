import { describe, expect, it } from 'vitest';
import {
  completeWrite,
  parseLegacyRealtimeVoiceCommand,
  parseVoiceCatalogCommand,
  planLegacyRealtimeBindings,
  planVoiceCatalog,
  REALTIME_PLUS_MODEL_KEY,
} from './voice-catalog-options.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const UP = '22222222-2222-4222-8222-222222222222';
const ROLE = '33333333-3333-4333-8333-333333333333';

function command(argv: string[]) {
  const parsed = parseVoiceCatalogCommand(argv);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.command;
}

describe('voice-catalog 参数', () => {
  it('默认预演；--apply 必须带管理员；未知参数拒绝', () => {
    expect(command([]).kind).toBe('plan');
    expect(command(['--show']).kind).toBe('show');
    expect(parseVoiceCatalogCommand(['--apply'])).toMatchObject({
      ok: false,
      code: 'OPERATOR_REQUIRED',
    });
    expect(parseVoiceCatalogCommand(['--apply', '--operator-id', ADMIN]).ok).toBe(true);
    expect(parseVoiceCatalogCommand(['--bogus'])).toMatchObject({ ok: false });
    expect(parseVoiceCatalogCommand(['--only', 'telespeech,nope'])).toMatchObject({ ok: false });
    expect(parseVoiceCatalogCommand(['--realtime-upstream', 'x'])).toMatchObject({ ok: false });
  });

  it('Omni 只有给出 4 个核实成本价才登记', () => {
    expect(parseVoiceCatalogCommand(['--omni-model', 'qwen3.5-omni-plus-realtime'])).toMatchObject({
      ok: false,
      code: 'OMNI_PRICE_REQUIRED',
    });
    expect(planVoiceCatalog(command([])).skipped).toEqual([
      { item: 'omni', reason: expect.stringContaining('未核实') },
    ]);
    const omni = planVoiceCatalog(
      command(['--omni-model', 'qwen3.5-omni-plus-realtime', '--omni-cost', '4,30,30,120']),
    ).entries.find((e) => e.item === 'omni');
    expect(omni?.modelKey).toBe('qwen/qwen3.5-omni-plus-realtime');
    expect(omni?.write.serviceRates).toEqual([
      { unit: 'audio_input_tokens_per_million', price: 39, cost: 30 },
      { unit: 'audio_output_tokens_per_million', price: 156, cost: 120 },
    ]);
  });
});

describe('voice-catalog 条目与价格（售价 = 成本 × 1.3）', () => {
  const { entries } = planVoiceCatalog(command([]));
  const byItem = new Map(entries.map((e) => [e.item, e]));

  it('两个新 ASR 按分钟 10,833 微元；MiMo ASR 默认停用', () => {
    for (const item of ['telespeech', 'mimo-asr'] as const) {
      const e = byItem.get(item)!;
      expect(e.write.serviceRates).toEqual([
        { unit: 'asr_minute', price: 0.010833, cost: 0.008333 },
      ]);
      expect(e.write.scenarios).toEqual(['speech_recognition']);
    }
    expect(byItem.get('telespeech')!.enable).toBe(true);
    expect(byItem.get('mimo-asr')!.enable).toBe(false);
    expect(byItem.get('telespeech')!.write.upstreamModelId).toBe('TeleAI/TeleSpeechASR');
  });

  it('3.1 TTS Flash 按万字符（默认参考 1.4 元 → 售 1.82）', () => {
    expect(byItem.get('qwen-tts-flash')!.write.serviceRates).toEqual([
      { unit: 'tts_10k_chars', price: 1.82, cost: 1.4 },
    ]);
  });

  it('实时语音：分模态 token 价、pipeline:rt 标签、实时计费上限；默认停用并带默认音色', () => {
    const e = byItem.get('qwen-realtime')!;
    expect(e.modelKey).toBe(REALTIME_PLUS_MODEL_KEY);
    expect(e.write.tags).toEqual(['pipeline:rt']);
    expect(e.write.rates).toEqual({ input: 6.5, output: 52, cache: 6.5 });
    expect(e.write.costRates).toEqual({ input: 5, output: 40, cache: 5 });
    expect(e.write.serviceRates).toEqual([
      { unit: 'audio_input_tokens_per_million', price: 52, cost: 40 },
      { unit: 'audio_output_tokens_per_million', price: 195, cost: 150 },
    ]);
    expect(e.write.billingBounds).toMatchObject({ realtime: { maxSessionSeconds: 3600 } });
    expect(e.enable).toBe(false);
    expect(e.defaultVoice).toBe('Cherry');
    expect(e.upstream.reference).toBeNull();
  });

  it('补全写入：通过契约校验；已启用的条目不会被关掉，保留排序', () => {
    const e = byItem.get('qwen-realtime')!;
    const fresh = completeWrite(e, { upstreamId: UP, existing: null });
    expect(fresh.enabled).toBe(false);
    expect(fresh.capabilities).toEqual(['voice_input', 'voice_output']);
    const kept = completeWrite(e, {
      upstreamId: UP,
      existing: { sortOrder: 7, leaderboardRank: null, enabled: true },
    });
    expect(kept).toMatchObject({ enabled: true, sortOrder: 7 });
  });
});

describe('旧站实时音色绑定', () => {
  it('只迁指定账号的实时 ready 绑定；拒绝 156 workspace', () => {
    expect(
      parseLegacyRealtimeVoiceCommand(['--input', '/x.json', '--endpoint-prefix', '156abcdef']),
    ).toMatchObject({ ok: false, code: 'ENDPOINT_FORBIDDEN' });
    expect(
      parseLegacyRealtimeVoiceCommand(['--input', '/x.json', '--endpoint-prefix', '8d1b']),
    ).toMatchObject({
      ok: false,
    });
    const parsed = parseLegacyRealtimeVoiceCommand([
      '--input',
      '/x.json',
      '--endpoint-prefix',
      '8d1b5e3b',
    ]);
    if (!parsed.ok) throw new Error(parsed.message);
    const plan = planLegacyRealtimeBindings(
      {
        bindings: [
          {
            character_id: ROLE,
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen-audio-3.0-realtime-plus',
            voice_id: 'qwen-audio-3.0-realtime-plus-vc-x',
            status: 'ready',
          },
          {
            character_id: ROLE,
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen-audio-3.0-realtime-plus',
            voice_id: 'dup',
            status: 'ready',
          },
          {
            character_id: ROLE,
            endpoint_id: '156ffff',
            model: 'qwen-audio-3.0-realtime-plus',
            voice_id: 'v',
            status: 'ready',
          },
          {
            character_id: ROLE,
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen-audio-3.0-tts-plus',
            voice_id: 'v',
            status: 'ready',
          },
          {
            character_id: ROLE,
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen3.5-omni-plus-realtime',
            voice_id: 'v',
            status: 'ready',
          },
          {
            character_id: ROLE,
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen-audio-3.0-realtime-plus',
            voice_id: 'v',
            status: 'pending',
          },
          {
            character_id: 'not-a-uuid',
            endpoint_id: '8d1b5e3b-aaaa',
            model: 'qwen-audio-3.0-realtime-plus',
            voice_id: 'v',
            status: 'ready',
          },
        ],
      },
      parsed.command,
    );
    expect(plan.rows).toEqual([
      {
        characterId: ROLE,
        modelKey: REALTIME_PLUS_MODEL_KEY,
        providerVoiceKey: 'qwen-audio-3.0-realtime-plus-vc-x',
      },
    ]);
    expect(plan.skipped).toEqual({
      other_endpoint: 1,
      not_realtime: 1,
      unmapped_model: 1,
      not_ready: 1,
      invalid: 1,
      duplicate: 1,
    });
  });
});
