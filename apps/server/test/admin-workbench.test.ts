import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AdminCatalogEntryWrite } from '@weiban/contracts';
import type { z } from 'zod';
import { createApp } from '../src/main.js';
import { Database, DATABASE, TestClock, newId } from '../src/platform/index.js';
import { PriceService } from '../src/modules/billing/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  ModelAdminService,
  CatalogService,
  UpstreamService,
  LeaderboardService,
} from '../src/modules/model-access/testing.js';
import { ModelDeletionService } from '../src/modules/model-access/index.js';
import { FlowUpstream } from './support/server-flow-fixture.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, captureLogger, testKekRing } from './support/fixtures.js';

describeDb('后台模型目录、上游账号与文本榜回归', () => {
  let app: INestApplication, db: Database, admin: string;
  const fixtureUpstream = new FlowUpstream();
  let upstreamUrl: string;
  const clock = new TestClock('2026-11-18T02:00:00Z');
  beforeAll(async () => {
    await resetTestDatabase();
    upstreamUrl = await fixtureUpstream.start();
    app = await createApp({
      config: testConfig({ ALLOW_LOCAL_HTTP: '1' }),
      clock,
      logger: captureLogger().logger,
      kekRing: testKekRing().ring,
      background: false,
    });
    await app.init();
    db = app.get(DATABASE);
    const identity = app.get(IdentityCommands);
    admin = await identity.createAdmin('workbench_admin', 'local test password');
  });
  afterAll(async () => {
    await app?.close();
    await fixtureUpstream.close();
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
    await del.delete(admin, [keys[0]!], { expectedRevision: preview.revision });
    expect(
      (
        await db.query<{ config: { decisionModelKey: string | null; testMarker: string } }>(
          "SELECT config FROM ai_runtime.ecology_config WHERE id='default'",
        )
      ).rows[0]?.config,
    ).toEqual({ decisionModelKey: null, testMarker: '其他字段保留' });
    const rows = await up.list();
    expect(rows.find((r) => r.upstreamId === primary)?.deletedAt).toBeNull();
    expect(rows.find((r) => r.upstreamId === exclusive)?.deletedAt).toBeNull();
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT octet_length(secret_ciphertext) n FROM model_access.upstreams WHERE id=$1',
          [exclusive],
        )
      ).rows[0]?.n,
    ).toBeGreaterThan(0);
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
