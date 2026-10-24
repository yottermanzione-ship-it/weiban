/**
 * 3.27：后台模型列表契约的模型键容错（只读 SQL 在生产 `model_access.model_catalog` 查到的真实数据）。
 *
 * 生产目录里有两类键通不过公开的 `ModelKey` 正则，导致 `GET /admin/model/models` 整包解析失败、
 * 后台模型表一行都显示不出来：
 * 1. 软删除行：0117 删除时把键改成「原键#deleted:<随机>」，例 openai/gpt-6.1-sol#deleted:01a159b9；
 * 2. 早期没有厂商前缀的旧键，例 qwen-audio-3.0-tts-plus（没有 "/"）。
 * 后台读取（AdminModel / AdminCatalogEntry）必须能解析它们；写入契约仍只接受规范「厂商/模型名」。
 *
 * 3.27 第二次：后台「调用记录」同样放宽——`model_access.usage_records` 里仍有旧键，
 * 客户端对响应整包解析，一行不合格整页明细就空白（明细 / 导出 / 详情是同一个 AdminUsageRecord）。
 *
 * 3.27 第三次：`qwen-audio-3.0-tts-plus` 这一行在用户端也真实存在（enabled = true、scenarios 含
 * voice_message，用户要能读到并选它），所以公开 `ModelKey` 只额外承认这一条字面量；
 * 其它裸键、软删除键仍然不合法，后台新增 / 修改模型也仍必须规范「厂商/模型名」。
 */
import { describe, expect, it } from 'vitest';
import {
  AdminCatalogEntry,
  AdminCatalogEntryWrite,
  AdminModel,
  AdminModelWrite,
  AdminUsageRecord,
  CanonicalModelKey,
  ModelAccessAdminUsageEndpoints,
  ModelAccessEndpoints,
  ModelInfo,
  ModelKey,
  ModelRef,
  UpdateModelSelectionRequest,
  UpdateScenarioConfigRequest,
} from '../src/index.js';

const UPSTREAM_ID = '01920000-0000-7000-8000-000000000001';
const NOW = '2026-10-25T04:00:00.000Z';
/** 生产目录 / 用量里真实存在的旧键（没有厂商前缀；用户端现在也要能读、能选）。 */
const LEGACY_KEY = 'qwen-audio-3.0-tts-plus';

/** 一行合法的后台模型（目录 + 倍率）。 */
const adminModel = {
  modelKey: 'openai/gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  vendorName: 'OpenAI',
  upstreamId: UPSTREAM_ID,
  upstreamModelId: 'gpt-6.1-sol',
  capabilities: ['vision'],
  tags: [],
  leaderboardRank: null,
  sortOrder: 10,
  defaultFor: [],
  enabled: false,
  updatedAt: NOW,
  deletedAt: null,
  rates: null,
  costRates: null,
  hasTimeBands: false,
  pointsPerReply: null,
};

/** upsertModel / upsertCatalogEntry 的请求体（写入契约，键仍严格）。 */
const writeBody = {
  modelKey: 'openai/gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  vendorName: 'OpenAI',
  upstreamId: UPSTREAM_ID,
  upstreamModelId: 'gpt-6.1-sol',
  capabilities: ['vision'],
  tags: [],
  leaderboardRank: null,
  sortOrder: 10,
  defaultFor: [],
  enabled: false,
  rates: null,
};

const DELETED_KEYS = [
  'openai/gpt-6.1-sol#deleted:01a159b9',
  'deepseek/deepseek-v4.1-flash#deleted:01a159b9',
  'google/gemini-3.8-flash#deleted:01a159b9',
];

/** 用户端模型列表里的一行（ModelInfo）。 */
const modelInfo = {
  modelKey: 'openai/gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  vendorName: 'OpenAI',
  priceTier: 'cheap',
  capabilities: ['vision'],
  tags: [],
  leaderboardRank: null,
  available: true,
};

describe('3.27 后台模型列表接受真实存在的模型键', () => {
  it('带 #deleted 后缀的软删除键可以通过后台读取契约', () => {
    for (const modelKey of DELETED_KEYS) {
      const parsed = AdminModel.safeParse({ ...adminModel, modelKey, deletedAt: NOW });
      expect(parsed.success, modelKey).toBe(true);
      // 键按原样返回（后缀留给后台展示时去掉），删除状态由 deletedAt 表达
      if (parsed.success) {
        expect(parsed.data.modelKey).toBe(modelKey);
        expect(parsed.data.deletedAt).toBe(NOW);
      }
      expect(AdminCatalogEntry.safeParse({ ...adminModel, modelKey, deletedAt: NOW }).success).toBe(
        true,
      );
    }
  });

  it('没有厂商前缀的旧键可以通过后台读取契约', () => {
    const parsed = AdminModel.safeParse({ ...adminModel, modelKey: LEGACY_KEY });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.modelKey).toBe(LEGACY_KEY);
    expect(AdminCatalogEntry.safeParse({ ...adminModel, modelKey: LEGACY_KEY }).success).toBe(true);
  });

  it('明显非法的键仍被后台读取契约拒绝（含空格 / 超长 / 空后缀）', () => {
    const badKeys = [
      'openai/gpt 6.1-sol',
      'openai/ gpt-6.1-sol',
      `openai/${'x'.repeat(90)}`,
      'openai/gpt-6.1-sol#deleted:',
      `qwen ${'y'.repeat(90)}`,
    ];
    for (const modelKey of badKeys) {
      expect(AdminModel.safeParse({ ...adminModel, modelKey }).success, modelKey).toBe(false);
    }
  });

  it('软删除键仍被公开契约拒绝（宽校验不扩散）', () => {
    for (const modelKey of DELETED_KEYS) {
      expect(ModelKey.safeParse(modelKey).success, modelKey).toBe(false);
      expect(AdminModelWrite.safeParse({ ...writeBody, modelKey }).success, modelKey).toBe(false);
    }
    // 正常键照旧通过，放宽没有把明显非法的键也放过
    expect(ModelKey.safeParse('openai/gpt-6.1-sol').success).toBe(true);
    expect(AdminModelWrite.safeParse(writeBody).success).toBe(true);
    expect(AdminModel.safeParse(adminModel).success).toBe(true);
  });
});

/**
 * 3.27 第三次：生产 `qwen-audio-3.0-tts-plus` 这一行 enabled = true、未删除、scenarios 含 voice_message，
 * 所以用户端 `GET /model/models` 会返回它，「选模型」请求也会带它。公开 `ModelKey` 只额外承认这一条
 * 字面量：规范正则本身没变，其它裸键 / 软删除键仍然不合法；后台新增 / 修改模型仍只接受规范「厂商/模型名」。
 */
describe('3.27 公开模型键只额外兼容这一条真实历史键', () => {
  it('规范「厂商/模型名」规则没变，这条旧键本来不符合', () => {
    expect(CanonicalModelKey.safeParse(LEGACY_KEY).success).toBe(false);
    expect(CanonicalModelKey.safeParse('openai/gpt-6.1-sol').success).toBe(true);
  });

  it('公开读取（模型列表）能解析这一行', () => {
    expect(ModelKey.safeParse(LEGACY_KEY).success).toBe(true);
    expect(ModelInfo.safeParse({ ...modelInfo, modelKey: LEGACY_KEY }).success).toBe(true);
    // 客户端对模型列表整包解析：一行不合格整页都空，所以这里按整包响应验证。
    expect(
      ModelAccessEndpoints.listModels.response.safeParse({
        items: [modelInfo, { ...modelInfo, modelKey: LEGACY_KEY }],
      }).success,
    ).toBe(true);
  });

  it('模型选择请求对这一现存旧键可用（含语音消息场景）', () => {
    expect(ModelRef.safeParse({ modelKey: LEGACY_KEY }).success).toBe(true);
    // 全局选择（PATCH /model/selection）
    expect(
      UpdateModelSelectionRequest.safeParse({ background: { modelKey: LEGACY_KEY } }).success,
    ).toBe(true);
    expect(
      UpdateModelSelectionRequest.safeParse({
        chat: { modelKey: 'deepseek/deepseek-v4.1-flash' },
        adult: { modelKey: LEGACY_KEY },
      }).success,
    ).toBe(true);
    // 逐场景选择：voice_message 就是这个 TTS 模型
    expect(
      UpdateScenarioConfigRequest.safeParse({
        selections: { voice_message: { modelKey: LEGACY_KEY } },
      }).success,
    ).toBe(true);
  });

  it('其它裸键与软删除键仍被公开契约拒绝', () => {
    const badKeys = [
      'qwen-audio-3.1-tts-plus',
      'video-model-x',
      'deepseek-search',
      ...DELETED_KEYS,
    ];
    for (const modelKey of badKeys) {
      expect(ModelKey.safeParse(modelKey).success, modelKey).toBe(false);
      expect(ModelInfo.safeParse({ ...modelInfo, modelKey }).success, modelKey).toBe(false);
      expect(
        ModelAccessEndpoints.listModels.response.safeParse({
          items: [{ ...modelInfo, modelKey }],
        }).success,
        modelKey,
      ).toBe(false);
      expect(UpdateModelSelectionRequest.safeParse({ chat: { modelKey } }).success, modelKey).toBe(
        false,
      );
      expect(
        UpdateScenarioConfigRequest.safeParse({ selections: { voice_message: { modelKey } } })
          .success,
        modelKey,
      ).toBe(false);
    }
  });

  it('后台新增 / 修改模型仍必须规范厂商/型号', () => {
    for (const modelKey of [LEGACY_KEY, 'video-model-x', ...DELETED_KEYS]) {
      expect(AdminCatalogEntryWrite.safeParse({ ...writeBody, modelKey }).success, modelKey).toBe(
        false,
      );
      expect(AdminModelWrite.safeParse({ ...writeBody, modelKey }).success, modelKey).toBe(false);
    }
    expect(AdminCatalogEntryWrite.safeParse(writeBody).success).toBe(true);
    expect(AdminModelWrite.safeParse(writeBody).success).toBe(true);
  });
});

/** 一行合法的后台调用记录（ADM-08 明细；导出 / 详情用同一个类型）。 */
const usageRecord = {
  usageRecordId: '01920000-0000-7000-8000-0000000000c2',
  createdAt: NOW,
  userId: '01920000-0000-7000-8000-000000000002',
  nickname: null,
  username: null,
  characterId: null,
  conversationKind: null,
  purpose: 'voice',
  billingOwner: 'user',
  modelKey: 'openai/gpt-6.1-sol',
  upstreamId: UPSTREAM_ID,
  inputTokens: 1200,
  cachedInputTokens: 0,
  outputTokens: 300,
  estimated: false,
  latencyMs: 900,
  ttftMs: null,
  status: 'succeeded',
  errorCode: null,
  retryCount: 0,
  chargedMicros: 1000,
  costMicros: 500,
  absorbedCostMicros: 0,
  priceVersionId: null,
  safetyOverdraft: false,
};

describe('3.27 后台「调用记录」也接受真实存在的模型键', () => {
  it('旧键 / 软删除键能整包解析，含空格或超长的仍被拒绝', () => {
    // 生产 usage_records 里真实存在的键（旧键 qwen-audio-3.0-tts-plus + 软删除键），与正常行同页。
    const page = {
      items: [
        usageRecord,
        {
          ...usageRecord,
          usageRecordId: '01920000-0000-7000-8000-0000000000c3',
          modelKey: 'qwen-audio-3.0-tts-plus',
        },
        {
          ...usageRecord,
          usageRecordId: '01920000-0000-7000-8000-0000000000c4',
          modelKey: 'openai/gpt-6.1-sol#deleted:01a159b9',
        },
      ],
      nextCursor: null,
    };
    // 客户端整包解析：只要有一行不合格，整页明细就空白，所以这里必须整包通过。
    const parsed = ModelAccessAdminUsageEndpoints.listUsageRecords.response.parse(page);
    // 键按原样返回：界面显示名去后缀，副行 / 详情继续显示完整键。
    expect(parsed.items.map((i) => i.modelKey)).toEqual([
      'openai/gpt-6.1-sol',
      'qwen-audio-3.0-tts-plus',
      'openai/gpt-6.1-sol#deleted:01a159b9',
    ]);
    // 导出接口用同一个 AdminUsageRecord，同样要能解析。
    expect(
      ModelAccessAdminUsageEndpoints.exportUsageRecords.response.safeParse({
        items: page.items,
        truncated: false,
      }).success,
    ).toBe(true);

    // 宽校验没有放到「什么都能过」：含空格 / 超长 / 空 #deleted 后缀仍被拒。
    const badKeys = [
      'openai/gpt 6.1-sol',
      'openai/ gpt-6.1-sol',
      `openai/${'x'.repeat(90)}`,
      'openai/gpt-6.1-sol#deleted:',
      `qwen-audio-3.0-tts-plus ${'y'.repeat(90)}`,
    ];
    for (const modelKey of badKeys) {
      expect(AdminUsageRecord.safeParse({ ...usageRecord, modelKey }).success, modelKey).toBe(
        false,
      );
      expect(
        ModelAccessAdminUsageEndpoints.listUsageRecords.response.safeParse({
          items: [{ ...usageRecord, modelKey }],
          nextCursor: null,
        }).success,
        modelKey,
      ).toBe(false);
    }
  });
});

/**
 * 3.43：用量看板概览的「最近失败调用」也是后台只读历史，`recentErrors[].modelKey` 同样要放宽。
 * 概览是一次整包解析（合计、账号数、错误列表共用同一个响应），只要一条错误里的旧键不合格，
 * 看板所有数字都不显示。
 */
describe('3.43 后台用量看板接受真实存在的模型键', () => {
  const totals = {
    calls: 10,
    failedCalls: 1,
    inputTokens: 1200,
    cachedInputTokens: 0,
    outputTokens: 300,
    totalTokens: 1500,
    estimatedTokens: 0,
    chargedMicros: 1000,
    costMicros: 500,
    absorbedCostMicros: 0,
  };
  const overview = {
    totals,
    previousTotals: totals,
    accounts: { total: 2, available: 1, abnormal: 1, disabled: 0 },
    recentErrors: [
      {
        upstreamId: UPSTREAM_ID,
        modelKey: 'openai/gpt-6.1-sol',
        errorCode: 'upstream_timeout',
        count: 3,
        lastAt: NOW,
      },
      {
        upstreamId: UPSTREAM_ID,
        modelKey: 'qwen-audio-3.0-tts-plus',
        errorCode: 'upstream_error',
        count: 2,
        lastAt: NOW,
      },
      {
        upstreamId: UPSTREAM_ID,
        modelKey: 'openai/gpt-6.1-sol#deleted:01a159b9',
        errorCode: 'upstream_error',
        count: 1,
        lastAt: NOW,
      },
    ],
  };

  it('旧键 / 软删除键能整包解析，含空格或超长的仍被拒绝', () => {
    const parsed = ModelAccessAdminUsageEndpoints.usageOverview.response.parse(overview);
    // 键按原样返回：界面显示名去后缀，副行继续显示完整键。
    expect(parsed.recentErrors.map((e) => e.modelKey)).toEqual([
      'openai/gpt-6.1-sol',
      'qwen-audio-3.0-tts-plus',
      'openai/gpt-6.1-sol#deleted:01a159b9',
    ]);
    // 放宽只针对这一处读取：同一行的其它字段仍严格校验。
    expect(
      ModelAccessAdminUsageEndpoints.usageOverview.response.safeParse({
        ...overview,
        recentErrors: [{ ...overview.recentErrors[0], count: 0 }],
      }).success,
    ).toBe(false);

    const badKeys = [
      'openai/gpt 6.1-sol',
      'openai/ gpt-6.1-sol',
      `openai/${'x'.repeat(90)}`,
      'openai/gpt-6.1-sol#deleted:',
      `qwen-audio-3.0-tts-plus ${'y'.repeat(90)}`,
    ];
    for (const modelKey of badKeys) {
      expect(
        ModelAccessAdminUsageEndpoints.usageOverview.response.safeParse({
          ...overview,
          recentErrors: [{ ...overview.recentErrors[0], modelKey }],
        }).success,
        modelKey,
      ).toBe(false);
    }
  });
});
