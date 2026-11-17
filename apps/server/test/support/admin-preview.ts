/** 本机后台预览。只连接专用示例库；上游为回环夹具。 */
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/main.js';
import {
  DATABASE,
  createLogger,
  loadConfig,
  newId,
  type Database,
} from '../../src/platform/index.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import { SettingsService } from '../../src/modules/identity/testing.js';
import { BillingAdminService, PriceService } from '../../src/modules/billing/testing.js';
import { CatalogService, UpstreamService } from '../../src/modules/model-access/testing.js';
import { AdminAlertService } from '../../src/modules/push/testing.js';
import type {
  AdminCatalogEntryWrite,
  BillingOwner,
  ModelPurpose,
  PriceUnit,
} from '@weiban/contracts';
import type { z } from 'zod';
import { requireTestDatabaseUrl, resetTestDatabase } from './db-admin.js';
import { FlowUpstream } from './server-flow-fixture.js';

const databaseUrl = requireTestDatabaseUrl();
const database = new URL(databaseUrl);
if (database.hostname !== '127.0.0.1' || database.pathname !== '/weiban_admin_preview') {
  throw new Error('预览只可使用本机 weiban_admin_preview 专用数据库');
}
await resetTestDatabase();

const app = await createApp({
  config: loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    MEDIA_PUBLIC_BASE_URL: 'http://127.0.0.1:5184',
    ALLOW_LOCAL_HTTP: '1',
  }),
  kekRing: { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
  logger: createLogger({ level: 'error' }),
  background: false,
});
await app.init();

const upstream = new FlowUpstream();
const localUrl = await upstream.start();
const identity = app.get(IdentityCommands);
const settings = app.get(SettingsService);
const billing = app.get(BillingAdminService);
const password = 'weiban-preview-local';
const admin = await identity.createAdmin('preview_admin', password);
const users: string[] = [];
for (const [index, nickname] of [
  '林小满',
  '周舟',
  '许橙',
  '晚风',
  '阿序',
  '苏遥',
  '小北',
].entries()) {
  const login = `demo_user_${index + 1}`;
  const userId = await identity.createAdmin(login, password);
  await identity.setRole(login, 'user');
  await settings.updateProfile(userId, { nickname });
  await billing.adjust(admin, userId, {
    direction: 'grant',
    amountMicros: 20_000_000 + index * 3_000_000,
    reason: '本机预览示例余额',
    idempotencyKey: newId(),
  });
  users.push(userId);
}
const upstreams = app.get(UpstreamService);
const primary = await upstreams.create(admin, {
  name: '模型主线路',
  provider: 'deepseek',
  kind: 'openai_compatible',
  baseUrl: localUrl,
  apiKey: 'preview-local-primary',
});
const alternate = await upstreams.create(admin, {
  name: '模型备用线路',
  provider: 'openai_compatible',
  kind: 'openai_compatible',
  baseUrl: localUrl,
  apiKey: 'preview-local-alternate',
});
const voice = await upstreams.create(admin, {
  name: '小米语音',
  provider: 'xiaomi_mimo',
  kind: 'openai_compatible',
  baseUrl: localUrl,
  apiKey: 'preview-local-voice',
});
await upstreams.reportStatus(alternate.upstreamId, 'unavailable', 'gateway', 'provider_error');

type FixtureModel = {
  key: string;
  displayName: string;
  vendorName: string;
  upstreamId: string;
  type: 'text' | 'tts' | 'asr';
};
const models: FixtureModel[] = [
  {
    key: 'deepseek/deepseek-v4.1-flash',
    displayName: 'DeepSeek Flash',
    vendorName: 'DeepSeek',
    upstreamId: primary.upstreamId,
    type: 'text',
  },
  {
    key: 'alibaba/qwen-flash',
    displayName: 'Qwen Flash',
    vendorName: 'Alibaba Cloud',
    upstreamId: alternate.upstreamId,
    type: 'text',
  },
  {
    key: 'xiaomi/mimo-v2.6-flash',
    displayName: 'MiMo Flash',
    vendorName: 'Xiaomi',
    upstreamId: primary.upstreamId,
    type: 'text',
  },
  {
    key: 'xiaomi/mimo-v2.5-tts',
    displayName: 'MiMo TTS',
    vendorName: 'Xiaomi',
    upstreamId: voice.upstreamId,
    type: 'tts',
  },
  {
    key: 'xiaomi/mimo-v2.5-tts-voiceclone',
    displayName: 'MiMo Voice Clone',
    vendorName: 'Xiaomi',
    upstreamId: voice.upstreamId,
    type: 'tts',
  },
  {
    key: 'xiaomi/mimo-v2.5-asr',
    displayName: 'MiMo ASR',
    vendorName: 'Xiaomi',
    upstreamId: voice.upstreamId,
    type: 'asr',
  },
];
const price = (modelKey: string, unit: PriceUnit, priceMicros: number, costMicros: number) => ({
  modelKey,
  unit,
  priceMicros,
  costMicros,
  band: null,
});
const prices = app.get(PriceService);
const items = models.flatMap((m) =>
  m.type === 'tts'
    ? [price(m.key, 'tts_10k_chars', 1_820_000, 0)]
    : m.type === 'asr'
      ? [price(m.key, 'asr_minute', 10_833, 8_333)]
      : [
          price(m.key, 'input_tokens_per_million', 2_000_000, 1_000_000),
          price(m.key, 'cached_input_tokens_per_million', 200_000, 100_000),
          price(m.key, 'output_tokens_per_million', 4_000_000, 2_000_000),
        ],
);
const oldVersion = await prices.createDraft(admin, {
  versionLabel: 'preview-rates-before',
  note: '本机示例 · 调整前的 MiMo 语音合成成本',
  items: items.map((item) =>
    item.unit === 'tts_10k_chars' ? { ...item, costMicros: 1_400_000 } : item,
  ),
});
await prices.activate(admin, oldVersion.priceVersionId, null);
const version = await prices.createDraft(admin, {
  versionLabel: 'preview-rates-current',
  note: '本机示例 · MiMo TTS / Voice Clone 上游成本为 0，平台售价单列',
  items,
});
await prices.activate(admin, version.priceVersionId, null);

const catalog = app.get(CatalogService);
type CatalogConfig = z.infer<typeof AdminCatalogEntryWrite>;
for (const [index, m] of models.entries()) {
  const capabilities: CatalogConfig['capabilities'] =
    m.type === 'tts' ? ['voice_output'] : m.type === 'asr' ? ['voice_input'] : ['vision'];
  const scenarios: CatalogConfig['scenarios'] =
    m.type === 'tts' ? ['voice_message'] : m.type === 'asr' ? ['speech_recognition'] : ['chat'];
  await catalog.upsert(admin, m.key, {
    modelKey: m.key,
    displayName: m.displayName,
    vendorName: m.vendorName,
    upstreamId: m.upstreamId,
    upstreamModelId: m.key.split('/')[1]!,
    capabilities,
    tags: [],
    leaderboardRank: null,
    sortOrder: index,
    defaultFor: [],
    scenarios,
    billingBounds: {
      format: 'billing-bounds-v1',
      ...(m.type === 'tts'
        ? { tts: { maxTextBytes: 8000, counting: 'codepoints' } }
        : m.type === 'asr'
          ? { asr: { maxSeconds: 120, billingStepSeconds: 1 } }
          : {
              text: {
                contextTokens: 128_000,
                maxOutputTokens: 16_000,
                totalOutputIncludesReasoning: true,
                outputParameter: 'max_tokens',
                maxImages: 4,
              },
            }),
    },
    enabled: true,
  });
}

const db = app.get<Database>(DATABASE);
const alertService = app.get(AdminAlertService);
const now = Date.now();
const beijingDate = (offset: number) =>
  new Date(now + offset * 86_400_000).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
const sinceBeijingMidnight = (now + 28_800_000) % 86_400_000;
const purposes: ModelPurpose[] = [
  'chat_reply',
  'chat_reply',
  'memory',
  'behavior_planning',
  'proactive',
];
await db.transaction(async (tx) => {
  for (let day = 0; day < 8; day++) {
    const rows = 26 + ((day * 7) % 26);
    for (let index = 0; index < rows; index++) {
      const m = models[(index * 5 + Math.floor(index / 7) + day) % models.length]!;
      const failed = index % 13 === 4;
      const unknown = failed && index % 3 === 1;
      const text = m.type === 'text';
      const purpose = text ? purposes[(index + day) % purposes.length]! : 'voice';
      const userId = users[(index + day * 3) % users.length]!;
      const when = new Date(
        now - day * 86_400_000 - ((index + 1) * (sinceBeijingMidnight || 1)) / (rows + 2),
      );
      const inputTokens = text ? 1350 + index * 96 : 0;
      const cachedTokens = text ? (index % 4) * 820 : 0;
      const outputTokens = text && !failed ? 82 + index * 11 : 0;
      const units = m.type === 'asr' ? 18 + index * 3 : 38 + index * 8;
      const cost =
        m.type === 'tts'
          ? 0
          : m.type === 'asr'
            ? Math.ceil((8333 * units) / 60)
            : Math.ceil(inputTokens + cachedTokens * 0.1 + outputTokens * 2);
      const charge = failed
        ? 0
        : m.type === 'tts'
          ? 182 * units
          : m.type === 'asr'
            ? Math.ceil((10_833 * units) / 60)
            : cost * 2;
      const owner: BillingOwner = purpose === 'behavior_planning' ? 'platform' : 'user';
      await tx.query(
        `INSERT INTO model_access.usage_records (
          id, created_at, completed_at, user_id, purpose, billing_owner, model_role, model_key,
          upstream_id, upstream_model_id, idempotency_key, status, error_code, retry_count,
          input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, estimated, latency_ms,
          ttft_ms, safety_priority, counts_as_background, price_version_id, charged_micros,
          cost_micros, cost_known, uncertain_cost_micros, absorbed_cost_micros,
          safety_overdraft, snapshot_at, media_units, conversation_kind
        ) VALUES (
          $1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$1::uuid::text,$10,$11,0,$12,$13,$14,$15,$16,$17,
          $18,false,$19,$20,$21,$22,$23,$24,$25,false,$2,$26,$27
        )`,
        [
          newId(),
          when,
          userId,
          purpose,
          owner,
          purpose === 'chat_reply' ? 'chat' : 'background',
          m.key,
          m.upstreamId,
          m.key.split('/')[1],
          failed ? 'failed' : 'succeeded',
          failed ? (unknown ? 'network_error' : 'rate_limited') : null,
          inputTokens,
          cachedTokens,
          outputTokens,
          outputTokens ? Math.floor(outputTokens / 3) : null,
          m.type === 'tts' || (text && index % 9 === 2),
          590 + index * 74,
          text && !failed ? 340 + index * 22 : null,
          purpose !== 'chat_reply',
          version.priceVersionId,
          charge,
          unknown ? 0 : cost,
          !unknown,
          unknown ? 15_000 : 0,
          failed && !unknown ? cost : 0,
          text ? null : { [m.type === 'tts' ? 'ttsChars' : 'asrSeconds']: units },
          purpose === 'chat_reply' ? 'direct' : null,
        ],
      );
    }
  }
  for (let offset = 1; offset <= 5; offset++) {
    const date = beijingDate(-offset);
    const unknown = offset === 1 ? 2 : 0;
    const differences =
      offset === 2
        ? [
            {
              upstreamId: primary.upstreamId,
              periodStart: date,
              periodEnd: date,
              billedMicros: 82_000,
              computedCostMicros: 81_600,
              diffRatio: 0.0049,
              flagged: false,
            },
          ]
        : [];
    await tx.query(
      `INSERT INTO billing.reconciliation_runs (
        id, run_date, ledger_consistent, stale_holds, usage_without_charge, charge_without_usage,
        usage_reconciled_at, upstream_diffs, absorbed_micros, details, diff_ratio_threshold, created_at
      ) VALUES ($1,$2,true,0,0,0,$3,$4,1900,$5,0.05,$3)`,
      [
        newId(),
        date,
        new Date(now - offset * 86_400_000),
        JSON.stringify(differences),
        {
          unknownCostCalls: unknown,
          uncertainCostMicros: unknown * 15_000,
          estimatedUsageCalls: 4 + offset,
          estimatedChargedMicros: 1400 + offset * 80,
        },
      ],
    );
  }
  await alertService.raise(tx, {
    kind: 'reconciliation_flagged',
    severity: 'critical',
    dedupeKey: 'preview-reconciliation',
    summary: `${beijingDate(-1)} 对账：2 笔成本待核。`,
    refs: { day: beijingDate(-1) },
  });
  await alertService.raise(tx, {
    kind: 'upstream_unavailable',
    severity: 'warning',
    dedupeKey: 'preview-upstream',
    summary: '模型备用线路连接失败，主线路正常。',
    refs: { upstreamId: alternate.upstreamId },
  });
  await alertService.raise(tx, {
    kind: 'upstream_usage_missing',
    severity: 'info',
    dedupeKey: 'preview-estimated-usage',
    summary: '线路「qwen-flash」连续 3 次未提供用量。已按本地估算记录。',
    refs: { upstreamId: alternate.upstreamId },
  });
});
await app.listen(3084, '127.0.0.1');
console.log('本机示例 API 已启动 http://127.0.0.1:3084');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void upstream.close());
