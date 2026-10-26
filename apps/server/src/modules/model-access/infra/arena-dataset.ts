/** Official Dataset Viewer adapter. Never scrape HTML or follow configured URLs. */
import { SystemClock, type Clock } from '../../../platform/index.js';
export const ARENA_DATASET_URL =
  'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text_style_control&split=latest';
export const ARENA_DATASET_SOURCE =
  'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset';
const PAGE_SIZE = 100;
const MAX_ROWS = 100_000;
const MAX_PAGE_BYTES = 2_000_000;
const PAGE_TIMEOUT_MS = 20_000;
const SYNC_TIMEOUT_MS = 480_000;

export interface ArenaDatasetEntry {
  name: string;
  rank: number;
  organization: string;
  rating: number;
  ratingLower: number;
  ratingUpper: number;
  voteCount: number;
  publishedAt: string;
}
export interface ArenaDataset {
  entries: ArenaDatasetEntry[];
  publishedAt: string;
  sourceUrl: string;
  totalRows: number;
}
export type DatasetFetch = (url: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Arena 数据结构无效');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 300)
    throw new Error(`Arena 字段无效：${field}`);
  return value;
}
function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Arena 字段无效：${field}`);
  return value;
}
function integer(value: unknown, field: string, min: number): number {
  const n = number(value, field);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`Arena 字段无效：${field}`);
  return n;
}
function entry(row: Record<string, unknown>): ArenaDatasetEntry {
  const publishedAt = text(row.leaderboard_publish_date, 'leaderboard_publish_date');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt
  )
    throw new Error('Arena 榜单发布日期无效');
  const result = {
    name: text(row.model_name, 'model_name'),
    rank: integer(row.rank, 'rank', 1),
    // 官方部分旧模型的厂商为空串；原样保留缺失，不虚构厂商，也不丢掉整份有效榜单。
    organization: text(row.organization, 'organization', true),
    rating: number(row.rating, 'rating'),
    ratingLower: number(row.rating_lower, 'rating_lower'),
    ratingUpper: number(row.rating_upper, 'rating_upper'),
    voteCount: integer(row.vote_count, 'vote_count', 0),
    publishedAt,
  };
  if (result.ratingLower > result.rating || result.rating > result.ratingUpper)
    throw new Error('Arena 评分区间无效');
  return result;
}
async function json(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Arena 响应为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error('Arena 分页响应过大');
      }
      body += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (ms === 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Sequential requests bound concurrency to one; 429 has bounded Retry-After backoff.
 * Fetch ALL rows before selecting overall: overall is not guaranteed to come first.
 * Reject partial pages, changed totals, gaps, truncation and mixed publish dates atomically.
 */
export async function fetchArenaDataset(
  fetchPage: DatasetFetch = fetch,
  options: {
    pageTimeoutMs?: number;
    syncTimeoutMs?: number;
    pageIntervalMs?: number;
    maxRateLimitRetries?: number;
    clock?: Pick<Clock, 'nowMs'>;
  } = {},
): Promise<ArenaDataset> {
  const clock = options.clock ?? new SystemClock();
  const deadline = AbortSignal.timeout(options.syncTimeoutMs ?? SYNC_TIMEOUT_MS);
  const rows: Record<string, unknown>[] = [];
  let total: number | null = null;
  let revision: string | null | undefined;
  for (let offset = 0; total === null || offset < total; offset += PAGE_SIZE) {
    // Official service is rate-limited: pace pages rather than burst through the split.
    if (offset > 0) await delay(options.pageIntervalMs ?? 2_500, deadline);
    let response: Response;
    let transientRetries = 0;
    let rateLimitRetries = 0;
    for (;;) {
      const signal = AbortSignal.any([
        deadline,
        AbortSignal.timeout(options.pageTimeoutMs ?? PAGE_TIMEOUT_MS),
      ]);
      try {
        response = await fetchPage(`${ARENA_DATASET_URL}&offset=${offset}&length=${PAGE_SIZE}`, {
          method: 'GET',
          redirect: 'error',
          signal,
          headers: { Accept: 'application/json', 'User-Agent': 'WeibanLeaderboard/2.0' },
        });
      } catch {
        throw new Error('Arena 数据集连接失败或同步超时');
      }
      if ([502, 503, 504].includes(response.status) && transientRetries < 2) {
        await response.body?.cancel();
        await delay(transientRetries++ === 0 ? 2_000 : 5_000, deadline);
        continue;
      }
      if (response.status !== 429) break;
      await response.body?.cancel();
      if (rateLimitRetries++ >= (options.maxRateLimitRetries ?? 2))
        throw new Error('Arena 数据集限流，请稍后刷新');
      const retry = response.headers.get('retry-after');
      const retryMs =
        retry === null
          ? 30_000
          : /^\d+$/.test(retry)
            ? Number(retry) * 1_000
            : Date.parse(retry) - clock.nowMs();
      // Respect Retry-After, but never hold a refresh indefinitely or retry in a burst.
      if (!Number.isFinite(retryMs) || retryMs > 60_000)
        throw new Error('Arena 数据集限流，请稍后刷新');
      await delay(Math.max(1_000, retryMs), deadline);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Arena 数据集返回 HTTP ${response.status}`);
    }
    const pageRevision = response.headers.get('x-revision');
    if (revision !== undefined && revision !== pageRevision) {
      await response.body?.cancel();
      throw new Error('Arena 同步期间数据集版本发生变化');
    }
    revision = pageRevision;
    const page = object(await json(response));
    const count = integer(page.num_rows_total, 'num_rows_total', 1);
    if (count > MAX_ROWS || page.partial !== false || (total !== null && total !== count))
      throw new Error('Arena 分页不完整或同步期间数据发生变化');
    total = count;
    if (!Array.isArray(page.rows) || page.rows.length !== Math.min(PAGE_SIZE, count - offset))
      throw new Error('Arena 分页缺失');
    for (let i = 0; i < page.rows.length; i++) {
      const wrapper = object(page.rows[i]);
      if (
        wrapper.row_idx !== offset + i ||
        !Array.isArray(wrapper.truncated_cells) ||
        wrapper.truncated_cells.length !== 0
      )
        throw new Error('Arena 行号缺失、重复或字段被截断');
      const row = object(wrapper.row);
      text(row.category, 'category');
      rows.push(row);
    }
  }
  // No filtering or early exit before the complete latest split has been validated.
  const entries = rows.filter((row) => row.category === 'overall').map(entry);
  if (!entries.length) throw new Error('Arena 完整数据中没有 overall 榜单');
  const dates = new Set(entries.map((item) => item.publishedAt));
  const names = new Set(entries.map((item) => item.name));
  if (dates.size !== 1 || names.size !== entries.length)
    throw new Error('Arena overall 存在混合发布日期或重复模型');
  entries.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return {
    entries,
    publishedAt: entries[0]!.publishedAt,
    sourceUrl: ARENA_DATASET_SOURCE,
    totalRows: total!,
  };
}
