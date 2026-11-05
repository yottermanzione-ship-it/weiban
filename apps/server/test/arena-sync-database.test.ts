import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  CatalogService,
  LeaderboardService,
  type ArenaDataset,
  type LeaderboardSnapshot,
} from '../src/modules/model-access/testing.js';
import { AuditLog, Database, TestClock } from '../src/platform/index.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase, withClient } from './support/db.js';

const dataset: ArenaDataset = {
  entries: [
    {
      name: 'Synthetic Model',
      rank: 1,
      organization: 'Test',
      rating: 100,
      ratingLower: 90,
      ratingUpper: 110,
      voteCount: 20,
      publishedAt: '2026-11-05',
    },
  ],
  publishedAt: '2026-11-05',
  sourceUrl: 'https://example.invalid/arena-fixture',
  totalRows: 1,
};
const old: LeaderboardSnapshot = {
  fetchedAt: '2026-11-04T00:00:00Z',
  method: 'fetch',
  sourceUrl: dataset.sourceUrl,
  entries: [{ name: 'Old Synthetic Model', rank: 1 }],
  publishedAt: '2026-11-04',
  totalRows: 1,
  previousEntries: [],
  lastAttemptAt: '2026-11-04T00:00:00Z',
  lastError: null,
};

describeDb('Arena refresh with real database transactions', () => {
  let db: Database;
  let clock: TestClock;
  let catalog: CatalogService;
  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl(), poolMax: 3 });
    catalog = Object.assign(Object.create(CatalogService.prototype), { database: db });
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    clock = new TestClock('2026-11-05T12:00:00Z');
    await db.query('DELETE FROM model_access.settings');
    await db.query('DELETE FROM platform.audit_log');
    await db.query('INSERT INTO model_access.settings(key,value,updated_at) VALUES ($1,$2,$3)', [
      'leaderboard_snapshot',
      JSON.stringify(old),
      clock.now(),
    ]);
  });
  function service(fetcher: () => Promise<ArenaDataset>) {
    return new LeaderboardService(
      db,
      clock,
      new AuditLog(db, clock),
      {} as never,
      catalog,
      fetcher,
    );
  }
  function deferredFetch() {
    let finish!: (value: ArenaDataset) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn(
      () =>
        new Promise<ArenaDataset>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    return { fetcher, entered, finish: () => finish(dataset) };
  }
  it('does not hold an idle transaction while waiting for the external dataset', async () => {
    const fetch = deferredFetch();
    const refresh = service(fetch.fetcher).refresh(null);
    try {
      await fetch.entered;
      const idle = await withClient(
        async (client) =>
          (
            await client.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name='weiban-server' AND state='idle in transaction'",
            )
          ).rows[0]!.count,
      );
      expect(idle).toBe(0);
    } finally {
      fetch.finish();
      await refresh;
    }
    expect((await catalog.leaderboardSnapshot())?.entries).toEqual(dataset.entries);
  });

  it('can refresh and import with a single connection because reads share the transaction', async () => {
    const single = new Database({ url: requireTestDatabaseUrl(), poolMax: 1 });
    const scopedCatalog: CatalogService = Object.assign(Object.create(CatalogService.prototype), {
      database: single,
    });
    const refresh = new LeaderboardService(
      single,
      clock,
      new AuditLog(single, clock),
      {} as never,
      scopedCatalog,
      async () => dataset,
    );
    try {
      await refresh.refresh(null);
      expect((await scopedCatalog.leaderboardSnapshot())?.entries).toEqual(dataset.entries);
      await refresh.importText(
        '00000000-0000-4000-8000-000000000001',
        'rank,model\n1,Imported Model',
      );
      expect((await scopedCatalog.leaderboardSnapshot())?.method).toBe('paste');
    } finally {
      await single.close();
    }
  });

  it('excludes another instance and manual import for the entire external fetch', async () => {
    const fetch = deferredFetch();
    const refresh = service(fetch.fetcher).refresh(null);
    const otherFetch = vi.fn(async () => dataset);
    try {
      await fetch.entered;
      await expect(service(otherFetch).refresh(null)).rejects.toThrow('正在刷新');
      await expect(
        service(otherFetch).importText(
          '00000000-0000-4000-8000-000000000001',
          'rank,model\n1,Imported Model',
        ),
      ).rejects.toThrow('正在刷新');
      expect(otherFetch).not.toHaveBeenCalled();
    } finally {
      fetch.finish();
      await refresh;
    }
    expect((await catalog.leaderboardSnapshot())?.entries).toEqual(dataset.entries);
  });

  it('fences a late worker after another instance takes over an expired lease', async () => {
    const first = deferredFetch();
    const second = deferredFetch();
    const oldRefresh = service(first.fetcher).refresh(null);
    await first.entered;
    clock.advance(11 * 60_000);
    const newRefresh = service(second.fetcher).refresh(null);
    try {
      await second.entered;
      first.finish();
      await expect(oldRefresh).rejects.toThrow('已过期');
      // 旧任务的清理不得删除新任务的租约。
      await expect(service(async () => dataset).refresh(null)).rejects.toThrow('正在刷新');
    } finally {
      first.finish();
      second.finish();
      await oldRefresh.catch(() => undefined);
      await newRefresh;
    }
    expect((await catalog.leaderboardSnapshot())?.entries).toEqual(dataset.entries);
    const audit = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM platform.audit_log',
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('does not overwrite manual import when the old fetch returns after lease expiry', async () => {
    const fetch = deferredFetch();
    const refresh = service(fetch.fetcher).refresh(null);
    try {
      await fetch.entered;
      clock.advance(11 * 60_000);
      await service(async () => dataset).importText(
        '00000000-0000-4000-8000-000000000001',
        'rank,model\n1,Imported Model',
      );
      fetch.finish();
      await expect(refresh).rejects.toThrow('已过期');
    } finally {
      fetch.finish();
      await refresh.catch(() => undefined);
    }
    expect(await catalog.leaderboardSnapshot()).toMatchObject({
      method: 'paste',
      entries: [{ name: 'Imported Model', rank: 1 }],
    });
  });

  it('persists failure and cooldown while retaining the complete last valid snapshot', async () => {
    await service(async () => {
      throw new Error('Synthetic provider timeout');
    }).refresh(null);
    expect(await catalog.leaderboardSnapshot()).toMatchObject({
      ...old,
      lastAttemptAt: clock.now().toISOString(),
      lastError: 'Synthetic provider timeout',
    });
    const fetcher = vi.fn(async () => dataset);
    await service(fetcher).refresh(null);
    expect(fetcher).not.toHaveBeenCalled();
    clock.advance(60_001);
    await service(fetcher).refresh(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await catalog.leaderboardSnapshot()).toMatchObject({
      entries: dataset.entries,
      lastError: null,
    });
  });
});
