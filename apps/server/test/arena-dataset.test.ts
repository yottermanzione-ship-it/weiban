import { describe, expect, it, vi } from 'vitest';
import {
  fetchArenaDataset,
  bestArenaRanks,
  normalizeArenaName,
  relativeRanks,
} from '../src/modules/model-access/testing.js';

const raw = (index: number, category = 'other') => ({
  model_name: `Example Model ${index}`,
  organization: 'Example',
  rank: index + 1,
  rating: 1500,
  rating_lower: 1490,
  rating_upper: 1510,
  vote_count: 100,
  category,
  leaderboard_publish_date: '2026-10-20',
});
function page(offset: number, total: number, make = raw) {
  return {
    num_rows_total: total,
    num_rows_per_page: 100,
    partial: false,
    rows: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({
      row_idx: offset + i,
      row: make(offset + i),
      truncated_cells: [],
    })),
  };
}
function fixture(total = 201) {
  return vi.fn(async (url: string) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Response.json(
      page(offset, total, (index) => raw(index, index === 200 ? 'overall' : 'other')),
    );
  });
}
const noDelay = { pageIntervalMs: 0 };

describe('official Dataset Viewer adapter', () => {
  it('fetches the complete split before filtering overall, including a final short page', async () => {
    const fetcher = fixture();
    const result = await fetchArenaDataset(fetcher, noDelay);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.totalRows).toBe(201);
    expect(result.publishedAt).toBe('2026-10-20');
    expect(result.entries).toEqual([
      {
        name: 'Example Model 200',
        rank: 201,
        organization: 'Example',
        rating: 1500,
        ratingLower: 1490,
        ratingUpper: 1510,
        voteCount: 100,
        publishedAt: '2026-10-20',
      },
    ]);
    expect(result.sourceUrl).toBe('https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset');
    const init = fetcher.mock.calls[0];
    expect(init?.[0]).toContain('config=text_style_control&split=latest');
  });
  it('does not stop after finding overall in the first page', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return Response.json(page(offset, 101, (i) => raw(i, i === 0 ? 'overall' : 'other')));
    });
    expect((await fetchArenaDataset(fetcher, noDelay)).entries).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['partial', 'short', 'gap', 'truncated', 'changedTotal'])(
    'rejects %s pages atomically',
    async (failure) => {
      const fetcher = vi.fn(async (url: string) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        const value = page(offset, 101, (i) => raw(i, 'overall'));
        if (offset === 100) {
          if (failure === 'partial') value.partial = true;
          if (failure === 'short') value.rows = [];
          if (failure === 'gap') value.rows[0]!.row_idx = 99;
          if (failure === 'truncated')
            (value.rows[0]!.truncated_cells as unknown[]) = ['model_name'];
          if (failure === 'changedTotal') value.num_rows_total = 102;
        }
        return Response.json(value);
      });
      await expect(fetchArenaDataset(fetcher, noDelay)).rejects.toThrow();
    },
  );
  it('rejects a dataset revision change even if the row count stays constant', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return Response.json(
        page(offset, 101, (i) => raw(i, 'overall')),
        { headers: { 'x-revision': offset ? 'new' : 'old' } },
      );
    });
    await expect(fetchArenaDataset(fetcher, noDelay)).rejects.toThrow('版本');
  });
  it('rejects 429 without retrying or returning partial entries', async () => {
    const fetcher = vi.fn(async () => new Response('limited', { status: 429 }));
    await expect(
      fetchArenaDataset(fetcher, { ...noDelay, maxRateLimitRetries: 0 }),
    ).rejects.toThrow('限流');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses bounded Retry-After backoff before retrying a throttled page', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('limited', { status: 429, headers: { 'Retry-After': '0' } }),
        )
        .mockResolvedValueOnce(Response.json(page(0, 1, (i) => raw(i, 'overall'))));
      const pending = fetchArenaDataset(fetcher, noDelay);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).entries).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects a Retry-After exceeding the bounded refresh budget', async () => {
    const fetcher = vi.fn(
      async () => new Response('limited', { status: 429, headers: { 'Retry-After': '3600' } }),
    );
    await expect(fetchArenaDataset(fetcher, noDelay)).rejects.toThrow('限流');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([502, 503, 504])('bounds HTTP %i retries to 2s and 5s backoff', async (status) => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => new Response('transient', { status }));
      const pending = expect(fetchArenaDataset(fetcher, noDelay)).rejects.toThrow(`HTTP ${status}`);
      await vi.advanceTimersByTimeAsync(7_000);
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it('recovers from one transient HTTP 502 without changing the response', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response('transient', { status: 502 }))
        .mockResolvedValueOnce(Response.json(page(0, 1, (i) => raw(i, 'overall'))));
      const pending = fetchArenaDataset(fetcher, noDelay);
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pending).entries).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not retry other HTTP errors', async () => {
    const fetcher = vi.fn(async () => new Response('bad', { status: 403 }));
    await expect(fetchArenaDataset(fetcher, noDelay)).rejects.toThrow('HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled page using an abort signal', async () => {
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    await expect(fetchArenaDataset(fetcher, { ...noDelay, pageTimeoutMs: 10 })).rejects.toThrow(
      '超时',
    );
  });
  it('rejects an oversized response', async () => {
    await expect(
      fetchArenaDataset(async () => new Response('x'.repeat(2_000_001)), noDelay),
    ).rejects.toThrow('过大');
  });
  it('rejects missing overall, invalid numeric fields, mixed dates, and duplicate raw names', async () => {
    await expect(fetchArenaDataset(async () => Response.json(page(0, 1)), noDelay)).rejects.toThrow(
      'overall',
    );
    for (const row of [
      { ...raw(0, 'overall'), rating: null },
      { ...raw(0, 'overall'), vote_count: -1 },
      { ...raw(0, 'overall'), rating_lower: 1600 },
      { ...raw(0, 'overall'), leaderboard_publish_date: '2026-02-30' },
    ]) {
      await expect(
        fetchArenaDataset(
          async () =>
            Response.json({ ...page(0, 1), rows: [{ row_idx: 0, row, truncated_cells: [] }] }),
          noDelay,
        ),
      ).rejects.toThrow();
    }
    const mixed = page(0, 2, (i) => ({
      ...raw(i, 'overall'),
      leaderboard_publish_date: i ? '2026-10-21' : '2026-10-20',
    }));
    await expect(fetchArenaDataset(async () => Response.json(mixed), noDelay)).rejects.toThrow(
      '混合',
    );
    const duplicate = page(0, 2, () => raw(0, 'overall'));
    await expect(fetchArenaDataset(async () => Response.json(duplicate), noDelay)).rejects.toThrow(
      '重复',
    );
  });
});

describe('precise Arena matching and relative ranking', () => {
  it('folds explicit thinking levels and selects the best rank regardless of input order', () => {
    const entries = [
      { name: 'Gemini 4 Argon (High)', rank: 1 },
      { name: 'Gemini 4 Argon (Low)', rank: 40 },
      { name: 'Gemini 4 Argon (Medium)', rank: 5 },
    ];
    expect(bestArenaRanks(entries).get(normalizeArenaName('Gemini 4 Argon'))).toBe(1);
    expect(bestArenaRanks([...entries].reverse()).get(normalizeArenaName('Gemini 4 Argon'))).toBe(
      1,
    );
    expect(entries).toHaveLength(3); // Matching must not discard raw source variants.
    expect(normalizeArenaName(' Model-X-thinking-high ')).toBe('model-x');
    expect(normalizeArenaName('Model-X (reasoning: low)')).toBe('model-x');
  });
  it('folds explicit effort and thinking budget while preserving date/version tokens', () => {
    expect(normalizeArenaName('Claude Opus 4.5 (High, 32K, 20251101)')).toBe(
      'claude opus 4.5 (20251101)',
    );
    expect(normalizeArenaName('Claude Opus 4.1 (Thinking 16K, 20250805)')).toBe(
      'claude opus 4.1 (20250805)',
    );
    expect(normalizeArenaName('Grok 4.20 Beta (Reasoning, 0309)')).toBe('grok 4.20 beta (0309)');
    expect(normalizeArenaName('Gemini 2.5 Flash-Lite Preview (Non-Thinking, 09-2025)')).toBe(
      'gemini 2.5 flash-lite preview (09-2025)',
    );
    expect(normalizeArenaName('Qwen3-235B-A22B-Thinking (2507)')).toBe('qwen3-235b-a22b (2507)');
    expect(normalizeArenaName('Grok 4 Fast (Non-Reasoning)')).toBe(
      normalizeArenaName('Grok 4 Fast (Reasoning)'),
    );
    expect(normalizeArenaName('Model (32K)')).toBe('model (32k)');
    expect(normalizeArenaName('Model (High, 20260101)')).not.toBe(
      normalizeArenaName('Model (High, 20260102)'),
    );
  });
  it('does not mix different versions, Pro, Flash, dates, or unrelated suffixes', () => {
    for (const other of [
      'Gemini 4 Flash',
      'Gemini 4 Pro',
      'Gemini 3',
      'Gemini 4-20261020',
      'Gemini 4 (Preview)',
    ])
      expect(normalizeArenaName(other)).not.toBe(normalizeArenaName('Gemini 4'));
    expect(
      bestArenaRanks([{ name: 'Gemini 4 Pro (High)', rank: 1 }]).get(
        normalizeArenaName('Gemini 4 Flash'),
      ),
    ).toBeUndefined();
  });
  it('ranks only the configured visible set continuously and excludes unknown rows', () => {
    expect([
      ...relativeRanks([
        { key: 'known-b', rank: 70 },
        { key: 'missing', rank: null },
        { key: 'known-a', rank: 2 },
      ]),
    ]).toEqual([
      ['known-a', 1],
      ['known-b', 2],
    ]);
  });
});

it('preserves an empty organization supplied by the real official dataset without inventing one', async () => {
  const row = {
    ...raw(0, 'overall'),
    model_name: 'Trinity Large Preview',
    organization: '',
    rank: 191,
    rating: 1378.6057840901972,
    rating_lower: 1374.348359039513,
    rating_upper: 1382.8632091408813,
    vote_count: 31261,
  };
  const response = { ...page(0, 1), rows: [{ row_idx: 0, row, truncated_cells: [] }] };
  const result = await fetchArenaDataset(async () => Response.json(response), noDelay);
  expect(result.entries[0]).toMatchObject({
    name: 'Trinity Large Preview',
    organization: '',
    rank: 191,
  });
  await expect(
    fetchArenaDataset(
      async () =>
        Response.json({
          ...response,
          rows: [{ row_idx: 0, row: { ...row, organization: null }, truncated_cells: [] }],
        }),
      noDelay,
    ),
  ).rejects.toThrow('organization');
});
