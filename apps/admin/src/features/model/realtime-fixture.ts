/**
 * 测试夹具：服务端 `GET /api/v1/admin/model/models` 里四个实时通话模型的真实返回形状
 * （按 apps/server models.ts toAdminModel 的输出逐字段照抄，含服务器盖章的 checkedAt、systemMessageMode、
 * availability、usageMissing、cacheWrite* 等只读字段）。只给测试用，不进页面代码。
 */
const PUBLIC_UPSTREAM = '2fed2a60-eaaf-5571-9a59-7253830e76bf';
const WORKSPACE_UPSTREAM = '5b0c7a9e-1d2f-4e3a-9b8c-7d6e5f4a3b2c';
const CHECKED_AT = '2026-10-28T07:18:31.749Z';

const bounds = {
  format: 'billing-bounds-v1',
  sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
  realtime: { maxSessionSeconds: 3600, maxResponseOutputTokens: 2048, contextTokens: 32768 },
  checkedAt: CHECKED_AT,
};

function row(input: {
  modelKey: string;
  displayName: string;
  upstreamId: string;
  upstreamModelId: string;
  enabled: boolean;
  text: [number, number];
  audio: [number, number];
  extraRates?: Array<{ unit: string; price: number; cost: number }>;
}) {
  const [textIn, textOut] = input.text;
  const [audioIn, audioOut] = input.audio;
  const sell = (n: number) => Math.round(n * 1.3 * 1e6) / 1e6;
  return {
    modelKey: input.modelKey,
    displayName: input.displayName,
    vendorName: '阿里云百炼',
    upstreamId: input.upstreamId,
    upstreamModelId: input.upstreamModelId,
    capabilities: ['voice_input', 'voice_output'],
    tags: ['pipeline:rt'],
    leaderboardRank: null,
    sortOrder: 900,
    defaultFor: [],
    enabled: input.enabled,
    scenarios: ['voice_call'],
    billingBounds: bounds,
    systemMessageMode: 'multi',
    arenaModelName: null,
    updatedAt: CHECKED_AT,
    deletedAt: null,
    serviceRates: [
      {
        unit: 'audio_input_tokens_per_million',
        price: sell(audioIn),
        cost: audioIn,
        hasTimeBands: false,
      },
      {
        unit: 'audio_output_tokens_per_million',
        price: sell(audioOut),
        cost: audioOut,
        hasTimeBands: false,
      },
      ...(input.extraRates ?? []).map((r) => ({ ...r, hasTimeBands: false })),
    ],
    availability: input.enabled
      ? { available: true, detail: null }
      : { available: false, detail: 'model_removed' },
    usageMissing: [],
    discount: null,
    discountActive: false,
    displayMultiplierManual: null,
    displayMultiplier: null,
    rates: {
      input: sell(textIn),
      output: sell(textOut),
      cache: sell(textIn),
      cacheWrite5m: null,
      cacheWrite1h: null,
    },
    costRates: {
      input: textIn,
      output: textOut,
      cache: textIn,
      cacheWrite5m: null,
      cacheWrite1h: null,
    },
    hasTimeBands: false,
    pointsPerReply: 5.98,
    routes: [
      {
        upstreamId: input.upstreamId,
        upstreamModelId: input.upstreamModelId,
        billingBounds: bounds,
        priority: 1,
        weight: 100,
        enabled: true,
      },
    ],
  };
}

/** 4.6 复刻价：成本 0.01 元/个 × 1.3。 */
const CLONE = { unit: 'voice_clone', price: 0.013, cost: 0.01 };

/** V3 上线后四个实时通话模型（3.0 已改挂北京 workspace；Omni 带复刻价）。 */
export const REALTIME_ROWS = [
  row({
    modelKey: 'qwen/qwen-audio-3.0-realtime-plus',
    displayName: '千问 Audio 3.0 Plus 实时通话',
    upstreamId: WORKSPACE_UPSTREAM,
    upstreamModelId: 'qwen-audio-3.0-realtime-plus',
    enabled: false,
    text: [5, 40],
    audio: [40, 150],
  }),
  row({
    modelKey: 'qwen/qwen-audio-3.1-realtime-plus',
    displayName: '千问 Audio 3.1 Plus 实时通话',
    upstreamId: PUBLIC_UPSTREAM,
    upstreamModelId: 'qwen-audio-3.1-realtime-plus',
    enabled: false,
    text: [5, 40],
    audio: [40, 150],
  }),
  row({
    modelKey: 'qwen/qwen3.5-omni-plus-realtime',
    displayName: '千问 Omni 3.5 Plus 实时通话',
    upstreamId: PUBLIC_UPSTREAM,
    upstreamModelId: 'qwen3.5-omni-plus-realtime',
    enabled: true,
    text: [10, 60],
    audio: [80, 300],
    extraRates: [CLONE],
  }),
  row({
    modelKey: 'qwen/qwen3.8-omni-flash-realtime',
    displayName: '千问 Omni 3.8 Flash 实时通话',
    upstreamId: PUBLIC_UPSTREAM,
    upstreamModelId: 'qwen3.8-omni-flash-realtime',
    enabled: true,
    text: [2, 8],
    audio: [16, 64],
    extraRates: [CLONE],
  }),
];

/** 服务器比页面更新：多了一个页面还不认识的计价单位（模拟下一次契约新增单位、标签页没刷新）。 */
export const ROW_WITH_FUTURE_UNIT = row({
  modelKey: 'qwen/qwen3.5-omni-plus-realtime',
  displayName: '千问 Omni 3.5 Plus 实时通话',
  upstreamId: PUBLIC_UPSTREAM,
  upstreamModelId: 'qwen3.5-omni-plus-realtime',
  enabled: false,
  text: [10, 60],
  audio: [80, 300],
  extraRates: [CLONE, { unit: 'voice_design', price: 0.26, cost: 0.2 }],
});
