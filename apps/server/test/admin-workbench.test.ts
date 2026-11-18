import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  AdminModelLabel,
  type AdminCatalogEntryWrite,
  type ModelQuotePort,
} from '@weiban/contracts';
import type { z } from 'zod';
import { createApp } from '../src/main.js';
import { Database, DATABASE, TestClock, newId } from '../src/platform/index.js';
import { PriceService } from '../src/modules/billing/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  ModelAdminService,
  CatalogService,
  BillingBoundsService,
  UpstreamService,
  UsageRecorder,
  LeaderboardService,
} from '../src/modules/model-access/testing.js';
import { ModelDeletionService, MODEL_QUOTE_PORT } from '../src/modules/model-access/index.js';
import { EcologySettingsService } from '../src/modules/ai-runtime/testing.js';
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
  it('按模型、账号与上游模型隔离回执，账号改名和调序保留同一线路记录', async () => {
    const up = app.get(UpstreamService);
    const catalog = app.get(CatalogService);
    const bounds = app.get(BillingBoundsService);
    const ids: string[] = [];
    for (const name of ['线路甲', '线路乙', '线路丙']) {
      ids.push(
        (
          await up.create(admin, {
            name,
            provider: 'openai_compatible',
            kind: 'openai_compatible',
            baseUrl: upstreamUrl,
            apiKey: 'fixture-local-key',
          })
        ).upstreamId,
      );
    }
    const keys = ['fixture/first', 'fixture/second'];
    const prices = app.get(PriceService);
    const version = await prices.createDraft(admin, {
      versionLabel: 'fixture-route-rates',
      note: '本地测试',
      items: keys.map((modelKey) => ({
        modelKey,
        unit: 'input_tokens_per_million',
        band: null,
        priceMicros: 1000000,
        costMicros: 1000000,
      })),
    });
    await prices.activate(admin, version.priceVersionId, null);

    const routes = ids.map((upstreamId, index) => ({
      upstreamId,
      upstreamModelId: 'shared-wire',
      priority: index + 1,
      weight: 100,
      enabled: true,
    }));
    for (const modelKey of keys) {
      await catalog.upsert(admin, modelKey, {
        modelKey,
        displayName: modelKey,
        vendorName: 'Fixture',
        upstreamId: modelKey === keys[0] ? ids[0]! : ids[1]!,
        upstreamModelId: 'shared-wire',
        capabilities: [],
        tags: [],
        leaderboardRank: null,
        defaultFor: [],
        scenarios: ['chat'],
        enabled: true,
        sortOrder: 1,
      });
      await catalog.replaceRoutes(admin, modelKey, modelKey === keys[0] ? routes : [routes[1]!]);
    }
    const target = routes[1]!;
    for (let i = 0; i < 5; i++) await bounds.recordUsage(keys[0]!, target, 'missing');
    await bounds.recordUsage(keys[1]!, target, 'reported');
    await up.update(admin, target.upstreamId, { name: '线路乙改名' });
    const updated = routes.map((r) => ({ ...r, priority: 4 - r.priority }));
    await catalog.replaceRoutes(admin, keys[0]!, updated);
    expect((await up.list()).find((u) => u.upstreamId === target.upstreamId)?.name).toBe(
      '线路乙改名',
    );
    const missing = await catalog.usageMissing(keys);
    expect(missing.get(keys[0]!)).toEqual([
      expect.objectContaining({ upstreamId: target.upstreamId, streak: 5 }),
    ]);
    expect(missing.has(keys[1]!)).toBe(false);
    expect((await catalog.routes(keys)).get(keys[0]!)?.map((r) => r.upstreamId)).toEqual(
      [...ids].reverse(),
    );
    const preview = await app.get(ModelDeletionService).preview([keys[0]!]);
    expect(preview.upstreamAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          upstreamId: target.upstreamId,
          name: '线路乙改名',
          shared: true,
        }),
        expect.objectContaining({ upstreamId: ids[0], shared: false }),
        expect.objectContaining({ upstreamId: ids[2], shared: false }),
      ]),
    );
    await catalog.replaceRoutes(
      admin,
      keys[0]!,
      updated.map((r) =>
        r.upstreamId === target.upstreamId ? { ...r, upstreamModelId: 'replacement' } : r,
      ),
    );
    expect((await catalog.usageMissing(keys)).size).toBe(0);
    const migration = (suffix: string) =>
      readFileSync(
        new URL(`../drizzle/0166_correct_network_usage_streaks${suffix}.sql`, import.meta.url),
        'utf8',
      );
    await db.transaction(async (tx) => {
      const modelKey = keys[0]!;
      await tx.query(
        'UPDATE model_access.model_routes SET usage_missing_streak=1, usage_missing_since=now() WHERE model_key=$1',
        [modelKey],
      );
      const attempt = async (
        upstreamId: string,
        wire: string,
        errorCode: string | null,
        options: {
          offset?: number;
          state?: 'unknown' | 'reported' | 'estimated';
          key?: string;
        } = {},
      ) =>
        tx.query(
          `INSERT INTO model_access.generation_attempts
          (id,generation_id,user_id,ordinal,model_key,upstream_id,upstream_model_id,phase,bound_snapshot,usage_state,error_code,created_at,finished_at)
         VALUES ($1,$2,$3,1,$4,$5,$6,'finished','{}',$9,$7,now() + $8 * interval '1 second',now() + $8 * interval '1 second')`,
          [
            newId(),
            newId(),
            admin,
            options.key ?? modelKey,
            upstreamId,
            wire,
            errorCode,
            options.offset ?? -1,
            options.state ?? 'estimated',
          ],
        );
      const streaks = async () =>
        (
          await tx.query<{ n: number }>(
            'SELECT usage_missing_streak AS n FROM model_access.model_routes WHERE model_key=$1 ORDER BY priority DESC',
            [modelKey],
          )
        ).rows.map((r) => r.n);
      await attempt(ids[0]!, 'shared-wire', 'network_error');
      await attempt(ids[1]!, 'replacement', 'network_error', { offset: -2 });
      await attempt(ids[1]!, 'replacement', null, { state: 'unknown', offset: 0 });
      await attempt(ids[2]!, 'shared-wire', 'network_error', { offset: -2 });
      await attempt(ids[2]!, 'shared-wire', null, { state: 'reported', key: keys[1]! });
      await attempt(ids[2]!, 'shared-wire', null, { state: 'unknown', offset: 0 });
      await tx.query(migration(''));
      expect(await streaks()).toEqual([0, 1, 1]); // 成功无回执与共用线路混合更新都不能认定为网络误报。
      await tx.query(migration('.down'));
      expect(await streaks()).toEqual([1, 1, 1]);
      await tx.query(migration(''));
      await attempt(ids[0]!, 'shared-wire', null, { state: 'reported', key: keys[1]!, offset: 1 });
      await tx.query(migration('.down'));
      // 不恢复校正后已经有新回执的线路。
      expect(await streaks()).toEqual([0, 1, 1]);
    });
  });
  it('删除持锁时固定模型和生态保存等待，提交后均拒绝已删除键', async () => {
    const modelKey = 'fixture/config-race';
    const catalog = app.get(CatalogService),
      ecology = app.get(EcologySettingsService);
    const prices = app.get(PriceService);
    const draft = await prices.createDraft(admin, {
      versionLabel: 'config-race',
      note: null,
      items: [
        {
          modelKey,
          unit: 'input_tokens_per_million',
          band: null,
          priceMicros: 1000000,
          costMicros: 1000000,
        },
      ],
    });
    await prices.activate(admin, draft.priceVersionId, null);
    const account = await app.get(UpstreamService).create(admin, {
      name: '并发设置测试',
      kind: 'openai_compatible',
      baseUrl: upstreamUrl,
      apiKey: 'local-test-only',
    });
    await catalog.upsert(admin, modelKey, {
      modelKey,
      displayName: '配置测试',
      vendorName: 'Test',
      upstreamId: account.upstreamId,
      upstreamModelId: 'config-fixture',
      capabilities: [],
      tags: [],
      leaderboardRank: null,
      defaultFor: [],
      scenarios: ['chat', 'private'],
      enabled: true,
      sortOrder: 1,
    });
    await Promise.all([
      catalog.setModelUses(admin, { recommended: { chat: modelKey }, internal: {} }),
      catalog.setModelUses(admin, { recommended: {}, internal: { safety: modelKey } }),
    ]);
    expect(await catalog.modelUses()).toMatchObject({
      recommended: { chat: modelKey },
      internal: { safety: modelKey },
    });
    const config = { ...(await ecology.config()), decisionModelKey: modelKey };
    await db.query(
      "INSERT INTO ai_runtime.ecology_config(id,config,updated_at) VALUES('default',$1,now()) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
      [{ ...config, retained: 'fixture' }],
    );
    let entered!: () => void;
    let resume!: () => void;
    const deleting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const clear = ecology.clearDeletedDecision.bind(ecology);
    const paused = vi
      .spyOn(ecology, 'clearDeletedDecision')
      .mockImplementationOnce(async (tx, keys, operator) => {
        const result = await clear(tx, keys, operator);
        entered();
        await release;
        return result;
      });
    const decision = vi.spyOn(ecology, 'decisionProblem').mockResolvedValueOnce(null);
    const quote = vi
      .spyOn(app.get<ModelQuotePort>(MODEL_QUOTE_PORT), 'quote')
      .mockResolvedValueOnce({
        ok: true,
        value: { modelKey, amountMicros: 0, priceVersionId: draft.priceVersionId },
      });
    const deleted = app.get(ModelDeletionService).delete(admin, [modelKey]);
    try {
      await Promise.race([
        deleting,
        deleted.then(() => {
          throw Error('删除未进入预期事务');
        }),
      ]);
      const writes = Promise.allSettled([
        catalog.setModelUses(admin, {
          recommended: {},
          internal: {},
          fixed: { private: modelKey },
        }),
        ecology.updateConfig(admin, config),
      ]);
      try {
        await vi.waitFor(
          async () => {
            const result = await db.query<{ n: number }>(
              `SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
            );
            expect(result.rows[0]?.n).toBe(2);
          },
          { timeout: 3000, interval: 25 },
        );
      } finally {
        resume();
      }
      await deleted;
      expect(await writes).toEqual([
        { status: 'rejected', reason: expect.objectContaining({ code: 'bad_request' }) },
        { status: 'rejected', reason: expect.objectContaining({ code: 'conflict' }) },
      ]);
      expect((await catalog.modelUses()).fixed?.private).toBeFalsy();
      expect(
        (
          await db.query<{ config: object }>(
            "SELECT config FROM ai_runtime.ecology_config WHERE id='default'",
          )
        ).rows[0]?.config,
      ).toMatchObject({ decisionModelKey: null, retained: 'fixture' });
    } finally {
      resume();
      await deleted;
      paused.mockRestore();
      decision.mockRestore();
      quote.mockRestore();
    }
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
    expect(await catalog.upstreamModelReferences([exclusive])).toEqual([
      expect.objectContaining({
        upstreamId: exclusive,
        modelKey: keys[0],
        upstreamModelId: 'demo',
      }),
    ]);
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
    const page = await modelAdmin.page({ page: 1, pageSize: 1, sort: 'name_asc', q: 'lab/' });
    expect(page.total).toBe(3);
    expect(page.items.map((m) => m.modelKey)).toEqual([keys[2]]);
    const second = await modelAdmin.page({ page: 2, pageSize: 1, sort: 'name_asc', q: 'lab/' });
    expect(second.items.map((m) => m.modelKey)).toEqual([keys[0]]);
    expect(
      (
        await modelAdmin.page({
          page: 1,
          pageSize: 20,
          sort: 'priority',
          q: 'QWEN',
          scenario: 'chat',
        })
      ).items.map((m) => m.modelKey),
    ).toEqual([keys[0]]);
    expect((await modelAdmin.detail(keys[0]!)).routes).toEqual(
      expect.arrayContaining(routes.map((route) => expect.objectContaining(route))),
    );
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
    const usage = app.get(UsageRecorder);
    const { record } = await usage.start({
      input: {
        userId: admin,
        purpose: 'admin_eval',
        billingOwner: 'platform',
        modelRole: 'chat',
        idempotencyKey: 'test-history-survives-deletion',
      },
      modelKey: keys[0]!,
      upstreamId: exclusive,
      upstreamModelId: 'demo',
      countsAsBackground: false,
    });
    await usage.finish(record.id, {
      status: 'succeeded',
      inputTokens: 320,
      cachedInputTokens: 80,
      outputTokens: 45,
      estimated: false,
      latencyMs: 1200,
      retryCount: 0,
    });
    await usage.writeSettleSnapshot(record.id, {
      ledgerEntryId: newId(),
      amountMicros: 750,
      costMicros: 430,
      costKnown: true,
    });
    const historicalUsage = await usage.byId(record.id);
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
    expect(await usage.byId(record.id)).toEqual(historicalUsage);
    expect(
      (await modelAdmin.page({ page: 1, pageSize: 20, sort: 'priority', q: 'lab/' })).items.map(
        (m) => m.modelKey,
      ),
    ).toEqual(keys.slice(1));
    expect((await catalog.adminSelection({ q: 'lab/' })).map((m) => m.modelKey)).toEqual(
      keys.slice(1),
    );
    expect(await catalog.upstreamModelReferences([exclusive])).toEqual([]);
    expect(await catalog.upstreamModelReferences([other])).toEqual([
      expect.objectContaining({ upstreamId: other, modelKey: keys[2] }),
    ]);
    expect(
      (await catalog.adminList(true))
        .map((m) => m.modelKey)
        .filter((key) => key.startsWith('lab/')),
    ).toEqual(keys.slice(1));
    await expect(modelAdmin.detail(keys[0]!)).rejects.toMatchObject({ code: 'not_found' });
    const labels = AdminModelLabel.array().parse(await catalog.adminLabels());
    const archived = labels.filter((item) => item.modelKey === keys[0]);
    expect(archived).toHaveLength(2);
    expect(archived.every((item) => item.deletedAt && item.archiveId)).toBe(true);
    expect(archived[0]?.displayName).toBe('Qwen Chat');
    expect(
      (await db.query('SELECT 1 FROM billing.price_versions WHERE id=$1', [previousPrice])).rows,
    ).toHaveLength(1);
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
