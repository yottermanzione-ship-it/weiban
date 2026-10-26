import { describe, expect, it, vi } from 'vitest';
import {
  LeaderboardService,
  REFRESH_LEADERBOARD_JOB,
} from '../src/modules/model-access/testing.js';
import type { LeaderboardSnapshot } from '../src/modules/model-access/testing.js';
import type { ArenaDataset } from '../src/modules/model-access/testing.js';

const dataset: ArenaDataset = {
  entries: [
    {
      name: 'Model (High)',
      rank: 7,
      organization: 'Org',
      rating: 1500,
      ratingLower: 1490,
      ratingUpper: 1510,
      voteCount: 20,
      publishedAt: '2026-10-20',
    },
  ],
  publishedAt: '2026-10-20',
  sourceUrl: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset',
  totalRows: 11066,
};
function harness(
  fetcher: (url: string) => Promise<ArenaDataset>,
  initial: LeaderboardSnapshot | null = null,
) {
  let snapshot = initial;
  let locked = true;
  const saved: LeaderboardSnapshot[] = [];
  const tx = {
    query: vi.fn(async () => ({ rows: [{ locked }] })),
    db: {
      insert: () => ({
        values: (row: { value: LeaderboardSnapshot }) => ({
          onConflictDoUpdate: async () => {
            snapshot = row.value;
            saved.push(row.value);
          },
        }),
      }),
    },
  };
  const database = { transaction: async (work: (t: typeof tx) => Promise<void>) => work(tx) };
  const clock = {
    now: () => new Date('2026-10-22T10:00:00Z'),
    nowMs: () => Date.parse('2026-10-22T10:00:00Z'),
  };
  const jobs = {
    send: vi.fn(async () => 'queued-job'),
    work: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
  };
  const catalog = {
    leaderboardSnapshot: async () => snapshot,
    leaderboardSource: async () => ({
      label: 'Arena',
      url: 'https://arena.ai/leaderboard/chat/text',
      asOf: null,
    }),
  };
  const service = new LeaderboardService(
    database as never,
    clock as never,
    { record: vi.fn(async () => undefined) } as never,
    jobs as never,
    catalog as never,
    fetcher,
  );
  vi.spyOn(service, 'status').mockResolvedValue({} as never);
  return {
    service,
    saved,
    jobs,
    setLocked: (value: boolean) => {
      locked = value;
    },
  };
}
const old: LeaderboardSnapshot = {
  fetchedAt: '2026-10-21T10:00:00Z',
  method: 'fetch',
  sourceUrl: dataset.sourceUrl,
  entries: [{ name: 'Old Model', rank: 1 }],
  publishedAt: '2026-10-19',
  totalRows: 10000,
  previousEntries: [],
  lastAttemptAt: '2026-10-21T10:00:00Z',
  lastError: null,
};

describe('Arena snapshot refresh coordinator', () => {
  it('registers the existing job on a six-hour schedule', async () => {
    const h = harness(async () => dataset);
    await h.service.onModuleInit();
    expect(h.jobs.schedule).toHaveBeenCalledWith(REFRESH_LEADERBOARD_JOB, '20 */6 * * *', {
      tz: 'Asia/Shanghai',
    });
  });
  it('keeps the entire last valid snapshot on rate-limit/network failure', async () => {
    const h = harness(async () => {
      throw new Error('HTTP 429');
    }, old);
    await h.service.refresh(null);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({
      entries: old.entries,
      fetchedAt: old.fetchedAt,
      publishedAt: old.publishedAt,
      sourceUrl: old.sourceUrl,
      totalRows: old.totalRows,
      lastError: 'HTTP 429',
      lastAttemptAt: '2026-10-22T10:00:00.000Z',
    });
  });
  it('merges concurrent manual and scheduled refreshes into one request', async () => {
    let finish!: (value: ArenaDataset) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<ArenaDataset>((resolve) => {
          finish = resolve;
        }),
    );
    const h = harness(fetcher, old);
    const first = h.service.refresh(null);
    const second = h.service.refresh('admin');
    expect(second).toBe(first);
    // Let source, lock, and snapshot promises reach the fetcher.
    for (let i = 0; i < 10 && !fetcher.mock.calls.length; i++) await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(dataset);
    await first;
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]?.entries).toEqual(dataset.entries);
    expect(h.saved[0]?.previousEntries).toEqual(old.entries);
  });
  it('does not fetch or overwrite when another instance owns the advisory lock', async () => {
    const fetcher = vi.fn(async () => dataset);
    const h = harness(fetcher, old);
    h.setLocked(false);
    await expect(h.service.refresh(null)).rejects.toThrow('正在刷新');
    expect(fetcher).not.toHaveBeenCalled();
    expect(h.saved).toHaveLength(0);
  });
  it('respects the refresh cooldown including after failures', async () => {
    const fetcher = vi.fn(async () => dataset);
    const h = harness(fetcher, { ...old, lastAttemptAt: '2026-10-22T09:59:30Z', lastError: '429' });
    await h.service.refresh(null);
    expect(fetcher).not.toHaveBeenCalled();
    expect(h.saved).toHaveLength(0);
  });
  it('rejects a stale official publication without destroying a newer snapshot', async () => {
    const h = harness(async () => dataset, { ...old, publishedAt: '2026-10-21' });
    await h.service.refresh(null);
    expect(h.saved[0]?.publishedAt).toBe('2026-10-21');
    expect(h.saved[0]?.entries).toEqual(old.entries);
    expect(h.saved[0]?.lastError).toContain('早于');
  });
});

it('queues manual refresh durably without waiting on the third-party fetch', async () => {
  const fetcher = vi.fn(async () => dataset);
  const h = harness(fetcher, old);
  await h.service.requestRefresh('admin');
  expect(h.jobs.send).toHaveBeenCalledWith(
    REFRESH_LEADERBOARD_JOB,
    { adminId: 'admin' },
    { singletonKey: 'official-arena', retryLimit: 0 },
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it('limits immediate duplicate manual refreshes without queueing extra work', async () => {
  const h = harness(async () => dataset, { ...old, lastAttemptAt: '2026-10-22T09:59:30Z' });
  await expect(h.service.requestRefresh('admin')).rejects.toThrow('一分钟');
  expect(h.jobs.send).not.toHaveBeenCalled();
});
it('marks manual import explicitly and does not invent movement across source methods', async () => {
  const h = harness(async () => dataset, old);
  await h.service.importText(
    'admin',
    'rank,model\n5,Imported Model (High)\n9,Imported Model (Low)',
  );
  expect(h.saved[0]).toMatchObject({ method: 'paste', publishedAt: null, previousEntries: [] });
  expect(h.saved[0]?.entries).toHaveLength(2);
});
