import { describe, expect, it } from 'vitest';
import {
  BEIJING_WORKSPACE_HOST,
  completeWrite,
  LEGACY_BEIJING_ENDPOINT_ID,
  LEGACY_OMNI_MODEL_KEY,
  omniDisplayName,
  parseLegacyRealtimeVoiceCommand,
  parseVoiceCatalogCommand,
  planLegacyRealtimeBindings,
  planOmniClonePrice,
  planOmniFix,
  planVoiceCatalog,
  planWorkspaceAttach,
  REALTIME_31_MODEL_KEY,
  REALTIME_PLUS_MODEL_KEY,
  UPSTREAM_REFERENCE,
  type WorkspaceAttachModel,
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
      // V3：复刻费 0.01 元/个 × 1.3
      { unit: 'voice_clone', price: 0.013, cost: 0.01 },
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
    // V3：官方 3.0 默认音色 longanqian（3.0 不接受 Cherry）
    expect(e.defaultVoice).toBe('longanqian');
    expect(e.upstream.reference).toBe(UPSTREAM_REFERENCE['qwen-tts-flash']);
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

describe('V2：Omni 显示名带版本、默认音色、--fix-omni', () => {
  it('登记 Omni 时显示名带版本，已核实默认音色 Tina；实时 / Omni 默认用公共百炼账号', () => {
    expect(omniDisplayName('qwen3.5-omni-plus-realtime')).toBe('千问 Omni 3.5 Plus 实时通话');
    expect(omniDisplayName('qwen3.8-omni-flash-realtime')).toBe('千问 Omni 3.8 Flash 实时通话');
    const { entries } = planVoiceCatalog(
      command(['--omni-model', 'qwen3.8-omni-flash-realtime', '--omni-cost', '1,2,3,4']),
    );
    const omni = entries.find((e) => e.item === 'omni')!;
    expect(omni.write.displayName).toBe('千问 Omni 3.8 Flash 实时通话');
    expect(omni.defaultVoice).toBe('Tina');
    expect(omni.upstream.reference).toBe(UPSTREAM_REFERENCE['qwen-tts-flash']);
    const rt = entries.find((e) => e.item === 'qwen-realtime')!;
    expect(rt.upstream.reference).toBe(UPSTREAM_REFERENCE['qwen-tts-flash']);
    expect(rt.notes.join('\n')).toContain('--attach-workspace');
    expect(
      planVoiceCatalog(
        command([
          '--omni-model',
          'qwen3.5-omni-plus-realtime',
          '--omni-cost',
          '1,2,3,4',
          '--omni-voice',
          'Cindy',
        ]),
      ).entries.find((e) => e.item === 'omni')!.defaultVoice,
    ).toBe('Cindy');
  });

  it('--fix-omni 只改不带版本的 Omni 显示名、只补没有的默认音色', () => {
    expect(command(['--fix-omni']).fixOmni).toBe(true);
    const fixes = planOmniFix(
      [
        { modelKey: 'qwen/qwen3.5-omni-plus-realtime', displayName: '千问 Omni 实时通话' },
        { modelKey: 'qwen/qwen3.8-omni-flash-realtime', displayName: '千问 Omni 实时通话' },
        { modelKey: REALTIME_PLUS_MODEL_KEY, displayName: '千问实时语音通话' },
        {
          modelKey: 'qwen/qwen3.5-omni-flash-realtime',
          displayName: '千问 Omni 3.5 Flash 实时通话',
        },
        {
          modelKey: 'qwen/qwen3.5-omni-plus-realtime#deleted:x',
          displayName: 'x',
          deletedAt: '2026-10-28T00:00:00Z',
        },
      ],
      { 'qwen/qwen3.8-omni-flash-realtime': 'Tina' },
    );
    expect(fixes).toEqual([
      {
        modelKey: 'qwen/qwen3.5-omni-plus-realtime',
        rename: { from: '千问 Omni 实时通话', to: '千问 Omni 3.5 Plus 实时通话' },
        defaultVoice: 'Tina',
      },
      {
        modelKey: 'qwen/qwen3.8-omni-flash-realtime',
        rename: { from: '千问 Omni 实时通话', to: '千问 Omni 3.8 Flash 实时通话' },
        defaultVoice: null,
      },
    ]);
  });
});

describe('旧站实时音色绑定（V2 公共 Omni；V3 北京 workspace，156语音不迁）', () => {
  const PUBLIC_ENDPOINT = '0975357a-1111-4111-8111-111111111111';
  const PUBLIC_PROVIDER = '8eed4824-2222-4222-8222-222222222222';

  it('必须给完整端点 ID；156语音的供应商 / 端点、156、北京 workspace 的其他端点一律拒绝', () => {
    for (const id of ['8d1b5e3b-aaaa', 'eb3630dd-aaaa', '6b29cca6-aaaa', '156abcdef'])
      expect(
        parseLegacyRealtimeVoiceCommand(['--input', '/x.json', '--endpoint-id', id]),
      ).toMatchObject({ ok: false, code: 'ENDPOINT_FORBIDDEN' });
    expect(
      parseLegacyRealtimeVoiceCommand(['--input', '/x.json', '--endpoint-prefix', '0975357a']),
    ).toMatchObject({ ok: false });
    expect(
      parseLegacyRealtimeVoiceCommand(['--input', '/x.json', '--endpoint-id', '0975']),
    ).toMatchObject({ ok: false });
  });

  it('174 条这类绑定默认映射到 qwen/qwen3.5-omni-plus-realtime；越界行逐条跳过', () => {
    const parsed = parseLegacyRealtimeVoiceCommand([
      '--input',
      '/x.json',
      '--endpoint-id',
      PUBLIC_ENDPOINT,
    ]);
    if (!parsed.ok) throw new Error(parsed.message);
    const row = {
      character_id: ROLE,
      endpoint_id: PUBLIC_ENDPOINT,
      provider_id: PUBLIC_PROVIDER,
      model: 'qwen3.5-omni-plus-realtime',
      voice_id: 'qwen-tts-vc-wb_abc-voice-2025',
      status: 'ready',
    };
    const plan = planLegacyRealtimeBindings(
      {
        version: 2,
        bindings: [
          row,
          { ...row, voice_id: 'dup' },
          { ...row, endpoint_id: '6b29cca6-aaaa', provider_id: '8d1b5e3b-aaaa' },
          { ...row, provider_id: 'cb9de005-aaaa' },
          { ...row, provider_id: '99999999-aaaa' },
          { ...row, endpoint_id: '0975357a-other' },
          { ...row, model: 'qwen-audio-3.0-tts-plus' },
          { ...row, model: 'qwen-audio-3.0-realtime-plus' },
          { ...row, status: 'pending' },
          { ...row, character_id: 'not-a-uuid' },
        ],
      },
      parsed.command,
    );
    expect(plan.rows).toEqual([
      {
        characterId: ROLE,
        modelKey: LEGACY_OMNI_MODEL_KEY,
        providerVoiceKey: 'qwen-tts-vc-wb_abc-voice-2025',
      },
    ]);
    expect(LEGACY_OMNI_MODEL_KEY).toBe('qwen/qwen3.5-omni-plus-realtime');
    expect(plan.byModel).toEqual({ [LEGACY_OMNI_MODEL_KEY]: 1 });
    expect(plan.skipped).toEqual({
      other_endpoint: 1,
      private_account: 3,
      not_realtime: 1,
      unmapped_model: 1,
      not_ready: 1,
      invalid: 1,
      duplicate: 1,
    });
  });

  it('V3：北京 workspace 端点的 qwen-audio-3.0-realtime-plus 绑定映射到 qwen/qwen-audio-3.0-realtime-plus', () => {
    const parsed = parseLegacyRealtimeVoiceCommand([
      '--input',
      '/x.json',
      '--endpoint-id',
      LEGACY_BEIJING_ENDPOINT_ID,
    ]);
    if (!parsed.ok) throw new Error(parsed.message);
    const row = {
      character_id: ROLE,
      endpoint_id: LEGACY_BEIJING_ENDPOINT_ID,
      provider_id: 'cb9de005-1111-4111-8111-111111111111',
      model: 'qwen-audio-3.0-realtime-plus',
      voice_id: 'qwen-audio-3.0-realtime-plus-wbabc-voice-1',
      status: 'ready',
    };
    const plan = planLegacyRealtimeBindings(
      {
        version: 3,
        bindings: [
          row,
          { ...row, provider_id: PUBLIC_PROVIDER },
          { ...row, provider_id: '8d1b5e3b-aaaa' },
          { ...row, model: 'qwen3.5-omni-plus-realtime' },
          { ...row, endpoint_id: '6b29cca6-aaaa' },
        ],
      },
      parsed.command,
    );
    expect(plan.rows).toEqual([
      {
        characterId: ROLE,
        modelKey: REALTIME_PLUS_MODEL_KEY,
        providerVoiceKey: 'qwen-audio-3.0-realtime-plus-wbabc-voice-1',
      },
    ]);
    expect(plan.skipped).toMatchObject({ private_account: 3, unmapped_model: 1 });
  });
});

describe('V3：Realtime 3.1 Plus、Omni 复刻价', () => {
  it('3.1 Plus：官方北京价 5/40/40/150 × 1.3、默认音色 longanqian_v3.1、默认停用、公共百炼账号、无复刻价', () => {
    const e = planVoiceCatalog(command([])).entries.find((x) => x.item === 'qwen-realtime-3.1')!;
    expect(e.modelKey).toBe(REALTIME_31_MODEL_KEY);
    expect(e.write.upstreamModelId).toBe('qwen-audio-3.1-realtime-plus');
    expect(e.write.displayName).toBe('千问 Audio 3.1 Plus 实时通话');
    expect(e.write.rates).toEqual({ input: 6.5, output: 52, cache: 6.5 });
    expect(e.write.serviceRates).toEqual([
      { unit: 'audio_input_tokens_per_million', price: 52, cost: 40 },
      { unit: 'audio_output_tokens_per_million', price: 195, cost: 150 },
    ]);
    expect(e.defaultVoice).toBe('longanqian_v3.1');
    expect(e.enable).toBe(false);
    expect(e.upstream.reference).toBe(UPSTREAM_REFERENCE['qwen-tts-flash']);
    const enabled = planVoiceCatalog(command(['--enable-realtime'])).entries.find(
      (x) => x.item === 'qwen-realtime-3.1',
    )!;
    expect(enabled.enable).toBe(true);
    expect(completeWrite(e, { upstreamId: UP, existing: null }).scenarios).toEqual(['voice_call']);
  });

  it('--omni-clone-price 只给还没有 0.013 复刻价的 Omni 条目补登记', () => {
    expect(command(['--omni-clone-price']).omniClonePrice).toBe(true);
    expect(
      planOmniClonePrice([
        { modelKey: 'qwen/qwen3.5-omni-plus-realtime', serviceRates: [] },
        {
          modelKey: 'qwen/qwen3.8-omni-flash-realtime',
          serviceRates: [{ unit: 'voice_clone', price: 0.013, cost: 0.01 }],
        },
        { modelKey: REALTIME_PLUS_MODEL_KEY, serviceRates: [] },
        { modelKey: 'qwen/qwen3.5-omni-flash-realtime', deletedAt: '2026-10-28T00:00:00Z' },
      ]),
    ).toEqual([
      {
        modelKey: 'qwen/qwen3.5-omni-plus-realtime',
        from: null,
        to: { unit: 'voice_clone', price: 0.013, cost: 0.01 },
      },
    ]);
  });
});

describe('V3：--attach-workspace 改挂北京 workspace', () => {
  const PUBLIC_UP = '44444444-4444-4444-8444-444444444444';
  const bounds = {
    format: 'billing-bounds-v1' as const,
    realtime: { maxSessionSeconds: 3600, maxResponseOutputTokens: 2048, contextTokens: 32768 },
  };
  const realtime30: WorkspaceAttachModel = {
    modelKey: REALTIME_PLUS_MODEL_KEY,
    displayName: '千问实时语音通话',
    upstreamId: PUBLIC_UP,
    upstreamModelId: 'qwen-audio-3.0-realtime-plus',
    tags: ['pipeline:rt'],
    billingBounds: bounds,
    routes: [
      {
        upstreamId: PUBLIC_UP,
        upstreamModelId: 'qwen-audio-3.0-realtime-plus',
        priority: 0,
        enabled: true,
        billingBounds: bounds,
      },
    ],
  };
  const workspace = {
    upstreamId: UP,
    name: '旧版待核-dashscope-1-abcd1234',
    kind: 'dashscope',
    baseUrl: `https://${BEIJING_WORKSPACE_HOST}/api`,
    enabled: false,
    status: 'unavailable',
  };
  const plan = (over: Partial<Parameters<typeof planWorkspaceAttach>[0]> = {}) =>
    planWorkspaceAttach({
      upstream: workspace,
      modelKeys: [REALTIME_PLUS_MODEL_KEY],
      models: [realtime30],
      bindings: {},
      defaults: { [REALTIME_PLUS_MODEL_KEY]: 'Cherry' },
      dropStaleClones: false,
      ...over,
    });

  it('参数：必须给上游 UUID；只接受 3.0 / 3.1 Plus 条目；默认只改 3.0；不能与其他模式混用', () => {
    expect(parseVoiceCatalogCommand(['--attach-workspace'])).toMatchObject({ ok: false });
    expect(parseVoiceCatalogCommand(['--attach-workspace', 'x'])).toMatchObject({ ok: false });
    expect(command(['--attach-workspace', UP]).attachWorkspace).toEqual({
      upstreamId: UP,
      models: [REALTIME_PLUS_MODEL_KEY],
      dropStaleClones: false,
    });
    expect(
      command([
        '--attach-workspace',
        UP,
        '--workspace-models',
        `${REALTIME_PLUS_MODEL_KEY},${REALTIME_31_MODEL_KEY}`,
        '--drop-stale-clones',
      ]).attachWorkspace,
    ).toEqual({
      upstreamId: UP,
      models: [REALTIME_PLUS_MODEL_KEY, REALTIME_31_MODEL_KEY],
      dropStaleClones: true,
    });
    expect(
      parseVoiceCatalogCommand([
        '--attach-workspace',
        UP,
        '--workspace-models',
        LEGACY_OMNI_MODEL_KEY,
      ]),
    ).toMatchObject({ ok: false });
    expect(parseVoiceCatalogCommand(['--drop-stale-clones'])).toMatchObject({ ok: false });
    expect(parseVoiceCatalogCommand(['--attach-workspace', UP, '--fix-omni'])).toMatchObject({
      ok: false,
    });
  });

  it('基址 /api 补成 /api/v1；沿用计费上限；默认音色 Cherry 改成官方 longanqian', () => {
    const result = plan();
    if (!('upstream' in result)) throw new Error(result.problems.join());
    expect(result.problems).toEqual([]);
    expect(result.upstream.baseUrl).toEqual({
      from: workspace.baseUrl,
      to: `https://${BEIJING_WORKSPACE_HOST}/api/v1`,
    });
    expect(result.upstream.kind).toBeNull();
    expect(result.models).toEqual([
      expect.objectContaining({
        modelKey: REALTIME_PLUS_MODEL_KEY,
        fromUpstreamId: PUBLIC_UP,
        billingBounds: bounds,
        staleClones: 0,
        defaultVoice: { from: 'Cherry', to: 'longanqian' },
      }),
    ]);
  });

  it('协议不是 dashscope 的改成 dashscope；已是合法 3.0 音色不改', () => {
    const result = plan({
      upstream: {
        ...workspace,
        kind: 'openai_compatible',
        baseUrl: `https://${BEIJING_WORKSPACE_HOST}/api/v1/`,
      },
      defaults: { [REALTIME_PLUS_MODEL_KEY]: 'longanlingxin' },
    });
    if (!('upstream' in result)) throw new Error(result.problems.join());
    expect(result.upstream.kind).toEqual({ from: 'openai_compatible', to: 'dashscope' });
    expect(result.upstream.baseUrl).toBeNull();
    expect(result.models[0]!.defaultVoice).toBeNull();
  });

  it('不是北京 workspace 主机、条目不存在、旧账号上复刻过的音色未确认删除 → 拒绝', () => {
    expect(
      plan({ upstream: { ...workspace, baseUrl: 'https://example.com/api/v1' } }).problems,
    ).toEqual([expect.stringContaining(BEIJING_WORKSPACE_HOST)]);
    expect(plan({ upstream: null }).problems).toHaveLength(1);
    expect(plan({ models: [] }).problems).toEqual([expect.stringContaining('目录里没有')]);
    expect(plan({ bindings: { [REALTIME_PLUS_MODEL_KEY]: { clone: 2 } } }).problems).toEqual([
      expect.stringContaining('--drop-stale-clones'),
    ]);
    const dropped = plan({
      bindings: { [REALTIME_PLUS_MODEL_KEY]: { clone: 2, legacy: 5 } },
      dropStaleClones: true,
    });
    expect(dropped.problems).toEqual([]);
    expect('upstream' in dropped && dropped.models[0]!.staleClones).toBe(2);
  });
});
