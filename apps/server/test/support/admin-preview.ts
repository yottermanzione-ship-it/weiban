/** 本机后台预览。只连接专用示例库；上游为回环夹具。 */
import { readFile } from 'node:fs/promises';
import { MediaService } from '../../src/modules/media/testing.js';
import { ModelDeletionService } from '../../src/modules/model-access/index.js';
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/main.js';
import {
  DATABASE,
  SESSION_VERIFIER,
  AppError,
  type SessionVerifier,
  createLogger,
  loadConfig,
  newId,
  type Database,
} from '../../src/platform/index.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import { SettingsService } from '../../src/modules/identity/testing.js';
import {
  BillingAdminService,
  PriceService,
  RewardedAdsService,
} from '../../src/modules/billing/testing.js';
import {
  CatalogService,
  UpstreamService,
  LeaderboardService,
} from '../../src/modules/model-access/testing.js';
import { CHAT_ADMIN_PORT, CHAT_USER_PORT } from '../../src/modules/chat/index.js';
import type { ChatAdminPort, ChatUserPort } from '@weiban/contracts';
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
if (database.hostname !== '127.0.0.1' || database.pathname !== '/weiban_admin_workbench_preview') {
  throw new Error('预览只可使用本机 weiban_admin_workbench_preview 专用数据库');
}
await resetTestDatabase();

const app = await createApp({
  config: loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    MEDIA_PUBLIC_BASE_URL: 'http://127.0.0.1:5184',
    ALLOW_LOCAL_HTTP: '1',
    REWARDED_ADS_DEMO: '1',
  }),
  kekRing: { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
  logger: createLogger({ level: 'error' }),
  background: false,
});
const rewards = app.get(RewardedAdsService);
const verifier = app.get<SessionVerifier>(SESSION_VERIFIER);
const express = app.getHttpAdapter().getInstance() as Express;
// 模拟凭证只存在于这个监听回环地址的测试程序中。
express.post('/api/v1/preview/rewards/:intentId/receipt', async (request, response) => {
  try {
    const auth = request.headers.authorization?.match(/^Bearer (.+)$/i);
    const me = auth ? await verifier.verify(auth[1]!, 'user') : null;
    if (!me || me.adminSession) {
      response.sendStatus(401);
      return;
    }
    const id = String(request.params.intentId);
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      response.sendStatus(400);
      return;
    }
    response.json(await rewards.finishDemo(me.userId, id));
  } catch (error) {
    response.sendStatus(error instanceof AppError ? error.status : 500);
  }
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

const asr = await upstreams.create(admin, {
  name: '小米识别专线',
  provider: 'xiaomi_mimo',
  kind: 'openai_compatible',
  baseUrl: localUrl,
  apiKey: 'preview-asr-only',
});
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
    upstreamId: asr.upstreamId,
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

const archiveKey = 'preview/retired-text';
await catalog.upsert(admin, archiveKey, {
  modelKey: archiveKey,
  displayName: 'Retired Preview',
  vendorName: 'Local Preview',
  upstreamId: primary.upstreamId,
  upstreamModelId: 'retired-text',
  capabilities: [],
  tags: [],
  leaderboardRank: null,
  sortOrder: 99,
  defaultFor: [],
  scenarios: ['chat'],
  enabled: false,
});
await app.get(ModelDeletionService).delete(admin, [archiveKey]);
const avatarIds: string[] = [];
for (const file of ['mail.png', 'group.webp', 'discover_moments.png', 'profile_service.webp']) {
  const buffer = await readFile(
    new URL('../../../web/public/assets/old-ui/icons/wechat/' + file, import.meta.url),
  );
  const media = await app
    .get(MediaService)
    .upload(
      admin,
      'character_avatar',
      { buffer, mimetype: file.endsWith('.png') ? 'image/png' : 'image/webp' },
      { admin: true },
    );
  avatarIds.push(media.mediaId);
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
// 与现网相近的条目数量，所有名称、正文和流水均由本机生成。
await db.transaction(async (tx) => {
  await tx.query(
    `WITH added AS (
    INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at)
    SELECT gen_random_uuid(),'sample_'||lpad(n::text,4,'0'),u.password_hash,'user','active',
      now()-n*interval '1 minute',now() FROM generate_series(1,627) n,identity.users u WHERE u.id=$1 RETURNING id,username
    ) INSERT INTO identity.profiles(user_id,nickname,gender,time_zone,updated_at)
      SELECT id,'体验用户 '||right(username,4),'undisclosed','Asia/Shanghai',now() FROM added`,
    [users[0]],
  );
  await tx.query(`INSERT INTO billing.accounts(id,kind,user_id,balance_micros,held_micros,low_balance_threshold_micros,background_daily_limit_micros,time_zone,created_at,updated_at,version)
    SELECT gen_random_uuid(),'user',id,0,0,1000000,10000000,'Asia/Shanghai',now(),now(),1 FROM identity.users WHERE username LIKE 'sample_%'`);
  await tx.query(
    `WITH demo AS (SELECT n,(ARRAY['海风邮局','星桥书屋','白鹭车站','山茶花店','青禾画室','长街咖啡'])[1+(n-1)%6]||' · '||lpad(n::text,3,'0') AS name FROM generate_series(1,700) n)
    INSERT INTO characters.characters(id,kind,status,name,search_text,basis,age_setting,child_appearance,child_features_detected,published_child_features_detected,checks,legacy_card,avatar_media_id,created_at,updated_at)
    SELECT gen_random_uuid(),'preset',CASE WHEN n%7=0 THEN 'draft' ELSE 'published' END,name,name,'original','adult',false,false,false,'{}',
      jsonb_build_object('display_name',name,'signature','周末的城市散步','core_persona',repeat('城市文化志愿者，喜欢给远行的人写信。',28),
      'opening_messages_json',jsonb_build_array('你好，今天从哪条街走起？')),($1::uuid[])[1+(n-1)%4],now()-n*interval '1 minute',now()-n*interval '1 minute' FROM demo`,
    [avatarIds],
  );
  await tx.query(
    `INSERT INTO support.tickets(id,user_id,client_request_id,kind,text,created_at,updated_at)
    SELECT gen_random_uuid(),$1,gen_random_uuid(),'feedback',t,now(),now() FROM unnest($2::text[]) t`,
    [users[2], ['希望能看到昨天的赠送积分', '找到了角色编辑入口，想补一个标签']],
  );
  await tx.query(
    `INSERT INTO play.daily_questions(id,text,tags,listed,created_by,created_at,updated_at)
    SELECT gen_random_uuid(),q,ARRAY['light'],true,$1,now(),now() FROM unnest($2::text[]) q`,
    [admin, ['今天遇到了什么好事？', '最想一起散步去哪里？', '想留给明天哪一句话？']],
  );
  await tx.query(`INSERT INTO proactive.holidays(id,name,date_type,date_value,enabled,created_at,updated_at)
    VALUES(gen_random_uuid(),'秋日读书会','annual','11-21',true,now(),now()),(gen_random_uuid(),'冬日来信','annual','12-08',false,now(),now())`);
});
for (let offset = 0; offset < 5; offset++)
  await rewards.saveReport(admin, {
    day: beijingDate(-offset),
    provider: '本机示例平台',
    estimatedMicros: (18 + offset) * 500000,
    settledMicros: offset < 2 ? null : offset === 4 ? 0 : (18 + offset) * 480000,
    revision: 0,
  });
for (const user of users.slice(1, 4)) await rewards.checkIn(user);
const intent = await rewards.startAd(users[1]!);
await db.query('UPDATE billing.reward_days SET ready_at=now() WHERE intent_id=$1', [
  intent.intentId,
]);
await rewards.finishDemo(users[1]!, intent.intentId);
await app.get(LeaderboardService).importText(admin, 'rank,model\n1,Qwen Flash\n2,DeepSeek Flash');
const character = (
  await db.query<{ id: string }>(
    "SELECT id FROM characters.characters WHERE kind='preset' ORDER BY updated_at DESC LIMIT 1",
  )
).rows[0]!;
const conversation = await db.transaction((tx) =>
  app
    .get<ChatAdminPort>(CHAT_ADMIN_PORT)
    .ensureDirectConversation(tx, {
      userId: users[0]!,
      characterId: character.id,
      restoreHistory: true,
    }),
);
const chat = app.get<ChatUserPort>(CHAT_USER_PORT);
let quote: string | undefined;
for (let i = 0; i < 54; i++) {
  const ack = await chat.sendMessage(users[0]!, conversation.conversationId, {
    clientMsgId: newId(),
    content: { type: 'text', text: '本机示例消息 ' + (i + 1) + '：记下一条散步见闻。' },
    ...(quote && i % 4 === 0 ? { quoteMessageId: quote } : {}),
  });
  quote = ack.message.messageId;
}
await app.listen(3084, '127.0.0.1');
console.log('本机示例 API 已启动 http://127.0.0.1:3084');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void upstream.close());
