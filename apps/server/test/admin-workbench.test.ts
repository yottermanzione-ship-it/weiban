import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AdminCatalogEntryWrite } from '@weiban/contracts';
import type { z } from 'zod';
import { createApp } from '../src/main.js';
import { Database, DATABASE, TestClock, newId } from '../src/platform/index.js';
import {
  RewardedAdsService,
  BillingTestQueries,
  BillingLifecycle,
  PriceService,
} from '../src/modules/billing/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  ModelAdminService,
  CatalogService,
  UpstreamService,
  LeaderboardService,
} from '../src/modules/model-access/testing.js';
import { ModelDeletionService } from '../src/modules/model-access/index.js';
import { FlowUpstream } from './support/server-flow-fixture.js';
import { describeDb, resetTestDatabase, roundTripMigration } from './support/db.js';
import { testConfig, captureLogger, testKekRing } from './support/fixtures.js';

describeDb('后台目录与签到的跨模块回归', () => {
  let app: INestApplication,
    db: Database,
    rewards: RewardedAdsService,
    admin: string,
    alice: string,
    bob: string;
  const fixtureUpstream = new FlowUpstream();
  let upstreamUrl: string;
  const clock = new TestClock('2026-11-18T02:00:00Z');
  beforeAll(async () => {
    await resetTestDatabase();
    await roundTripMigration('0165_rewarded_ads');
    upstreamUrl = await fixtureUpstream.start();
    app = await createApp({
      config: testConfig({ REWARDED_ADS_DEMO: '1', ALLOW_LOCAL_HTTP: '1' }),
      clock,
      logger: captureLogger().logger,
      kekRing: testKekRing().ring,
      background: false,
    });
    await app.init();
    db = app.get(DATABASE);
    rewards = app.get(RewardedAdsService);
    const identity = app.get(IdentityCommands);
    admin = await identity.createAdmin('workbench_admin', 'local test password');
    alice = await identity.createAdmin('workbench_alice', 'local test password');
    await identity.setRole('workbench_alice', 'user');
    bob = await identity.createAdmin('workbench_bob', 'local test password');
    await identity.setRole('workbench_bob', 'user');
  });
  afterAll(async () => {
    await app?.close();
    await fixtureUpstream.close();
  });
  it('并发签到、取消、跨账号、提前回执与多次配送仅发一次赠分，收入必须有独立报表', async () => {
    const q = new BillingTestQueries(db);
    const before = Number((await q.account(alice))?.bonus_balance_micros ?? 0);
    await expect(rewards.startAd(alice)).rejects.toMatchObject({ code: 'bad_request' });
    await Promise.all(Array.from({ length: 5 }, () => rewards.checkIn(alice)));
    const intents = await Promise.all([rewards.startAd(alice), rewards.startAd(alice)]);
    expect(intents[0].intentId).toBe(intents[1].intentId);
    await expect(rewards.finishDemo(alice, intents[0].intentId)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(rewards.finishDemo(bob, intents[0].intentId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await rewards.cancelAd(alice, intents[0].intentId);
    clock.advance(6001);
    await expect(rewards.finishDemo(alice, intents[0].intentId)).rejects.toMatchObject({
      code: 'not_found',
    });
    const next = await rewards.startAd(alice);
    clock.advance(6001);
    await Promise.all(Array.from({ length: 5 }, () => rewards.finishDemo(alice, next.intentId)));
    expect(
      (await q.ledgerOf(alice)).filter(
        (r) => r.purpose === 'rewarded_ad' || r.purpose === 'daily_checkin',
      ),
    ).toHaveLength(2);
    expect(Number((await q.account(alice))?.bonus_balance_micros) - before).toBe(30000);
    expect(await rewards.revenue(7)).toMatchObject({
      reports: [],
      rewards: [{ checkins: 1, completions: 1, points: 3 }],
    });
    const row = {
      day: '2026-11-18',
      provider: '本机平台',
      estimatedMicros: 40000,
      settledMicros: null,
      revision: 0,
    };
    const saved = await rewards.saveReport(admin, row);
    await expect(rewards.saveReport(admin, row)).rejects.toMatchObject({ code: 'conflict' });
    const attempts = await Promise.allSettled([
      rewards.saveReport(admin, { ...saved, settledMicros: 0 }),
      rewards.saveReport(admin, { ...saved, settledMicros: 0 }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await rewards.revenue(7)).reports[0]?.settledMicros).toBe(0);
    clock.set('2026-11-18T15:59:59Z');
    await rewards.checkIn(bob);
    const old = await rewards.startAd(bob);
    clock.advance(7000);
    await expect(rewards.finishDemo(bob, old.intentId)).rejects.toMatchObject({ code: 'conflict' });
    expect((await rewards.status(bob)).checkedIn).toBe(false);
    const existing = (await rewards.revenue(7)).rewards;
    await app.get(BillingLifecycle).purgeUser(alice);
    expect((await rewards.revenue(7)).rewards).toEqual(existing);
    expect((await rewards.status(alice)).checkedIn).toBe(false);
  });
  it('排行榜按场景匹配，删除保护共享与新建模型，路由和价目一起清理', async () => {
    const up = app.get(UpstreamService),
      catalog = app.get(CatalogService),
      del = app.get(ModelDeletionService),
      price = app.get(PriceService);
    async function account(name: string) {
      return (
        await up.create(admin, {
          name,
          provider: 'openai_compatible',
          kind: 'openai_compatible',
          baseUrl: upstreamUrl,
          apiKey: 'local-test-only',
        })
      ).upstreamId;
    }
    const primary = await account('共享测试线路'),
      exclusive = await account('独立测试线路'),
      other = await account('无关线路');
    const keys = ['lab/text', 'lab/audio', 'lab/other'];
    const draft = await price.createDraft(admin, {
      versionLabel: 'workbench-test',
      note: '本地测试',
      items: keys.map((modelKey) => ({
        modelKey,
        unit: 'input_tokens_per_million',
        band: null,
        priceMicros: 1000000,
        costMicros: 700000,
      })),
    });
    await price.activate(admin, draft.priceVersionId, null);
    function entry(i: number): z.infer<typeof AdminCatalogEntryWrite> {
      return {
        modelKey: keys[i]!,
        displayName: i === 0 ? 'Qwen Chat' : i === 1 ? 'Qwen Voice' : 'Archive Model',
        vendorName: 'Test',
        upstreamId: i === 2 ? other : primary,
        upstreamModelId: i === 1 ? 'Qwen Chat' : keys[i]!,
        capabilities: [],
        tags: [],
        leaderboardRank: null,
        defaultFor: [],
        scenarios: i === 1 ? ['speech_recognition'] : ['chat'],
        enabled: i !== 2,
        sortOrder: i,
      };
    }
    for (const i of [0, 1, 2]) await catalog.upsert(admin, keys[i]!, entry(i));
    const routes = [
      { upstreamId: exclusive, upstreamModelId: 'demo', priority: 1, weight: 1, enabled: true },
    ];
    await catalog.replaceRoutes(admin, keys[0]!, routes);
    const ranking = app.get(LeaderboardService);
    const ranked = await ranking.importText(admin, 'rank,model\n2,Qwen Chat');
    expect(ranked.matched.map((m) => m.modelKey)).toContain(keys[0]);
    expect(
      [...ranked.matched, ...ranked.unmatched].some(
        (m) => m.modelKey === keys[1] || m.modelKey === keys[2],
      ),
    ).toBe(false);
    await expect(ranking.updateArenaName(admin, keys[1]!, 'Qwen Chat')).rejects.toMatchObject({
      code: 'conflict',
    });
    await db.query(
      "INSERT INTO ai_runtime.ecology_config(id,config,updated_at) VALUES('default',$1,now()) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config",
      [{ decisionModelKey: keys[0], testMarker: '其他字段保留' }],
    );
    const modelAdmin = app.get(ModelAdminService);
    const opened = (await catalog.adminList()).find((m) => m.modelKey === keys[0]!)!;
    expect(opened.catalogRevision).toEqual(expect.any(String));
    const edit = {
      ...entry(0),
      rates: { input: 17, output: 29, cache: 5 },
      expectedRevision: opened.catalogRevision,
    };
    const previousPrice = (
      await db.query<{ id: string }>("SELECT id FROM billing.price_versions WHERE status='active'")
    ).rows[0]!.id;
    await expect(
      modelAdmin.upsert(admin, keys[0]!, { ...edit, upstreamId: newId() }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(
      (
        await db.query<{ id: string }>(
          "SELECT id FROM billing.price_versions WHERE status='active'",
        )
      ).rows[0]!.id,
    ).toBe(previousPrice);
    const preview = await del.preview([keys[0]!]);
    expect(preview.ecologyDecision).toBe(true);
    expect(preview.upstreamAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ upstreamId: primary, shared: true }),
        expect.objectContaining({ upstreamId: exclusive, shared: false }),
      ]),
    );
    for (const id of [primary, other])
      await expect(
        del.delete(admin, [keys[0]!], {
          expectedRevision: preview.revision,
          removeUpstreamIds: [id],
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
    await del.delete(admin, [keys[0]!], {
      expectedRevision: preview.revision,
      removeUpstreamIds: [exclusive],
    });
    expect(
      (
        await db.query<{ config: { decisionModelKey: string | null; testMarker: string } }>(
          "SELECT config FROM ai_runtime.ecology_config WHERE id='default'",
        )
      ).rows[0]?.config,
    ).toEqual({ decisionModelKey: null, testMarker: '其他字段保留' });
    const rows = await up.list();
    expect(rows.find((r) => r.upstreamId === primary)?.deletedAt).toBeNull();
    expect(rows.find((r) => r.upstreamId === exclusive)?.deletedAt).toBeTruthy();
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT octet_length(secret_ciphertext) n FROM model_access.upstreams WHERE id=$1',
          [exclusive],
        )
      ).rows[0]?.n,
    ).toBe(0);
    await expect(catalog.replaceRoutes(admin, keys[0]!, routes)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(modelAdmin.upsert(admin, keys[0]!, edit)).rejects.toMatchObject({
      code: 'conflict',
    });
    await catalog.upsert(admin, keys[0]!, { ...entry(0), enabled: false });
    await expect(modelAdmin.upsert(admin, keys[0]!, edit)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      del.delete(admin, [keys[0]!], { expectedRevision: preview.revision }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await del.delete(admin, [keys[0]!]);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*)::int n FROM model_access.model_catalog WHERE original_model_key=$1',
          [keys[0]],
        )
      ).rows[0]?.n,
    ).toBe(2);
  });
});
