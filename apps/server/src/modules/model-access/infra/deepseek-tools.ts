/** DeepSeek 官方 Search / Fetch JSON 协议（2026-10-21）。不在此打印响应、查询或密钥。 */
import { z } from 'zod';
import { WebSearchHit, WebPage } from '@weiban/contracts';
import { publicWebUrl } from '../domain/web-search.js';
import type { MediaAdapterResult, MediaTarget, SearchHit } from './media-adapter.js';

const RawHit = z.object({
  title: z.string(),
  url: z.string(),
  summary: z.string().optional(),
  snippet: z.string().optional(),
  site_name: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  content: z.string().optional(),
  authority: z.number().int().min(-1).max(4).optional(),
  rerank_score: z.number().min(0).max(3).optional(),
});
const Results = z.object({ results: z.array(z.unknown()).max(50) });
export type SearchRequestGate = (kind: 'search' | 'fetch', host?: string) => Promise<boolean>;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error('response too large');
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    reader.releaseLock();
  }
}

async function request(
  target: MediaTarget,
  kind: 'search' | 'fetch',
  body: unknown,
  gate?: SearchRequestGate,
  host?: string,
): Promise<MediaAdapterResult<unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (gate && !(await gate(kind, host)))
      return { ok: false, category: 'rate_limited', zeroCost: true, localRateLimit: true };
    let response: Response;
    try {
      response = await fetch(`${target.baseUrl.replace(/\/(?:v1)?\/?$/u, '')}/v1/tools/${kind}`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, category: 'network_error' };
    }
    if (response.status === 200) {
      try {
        return { ok: true, value: await readJson(response) };
      } catch {
        return { ok: false, category: 'provider_error' };
      }
    }
    await response.body?.cancel().catch(() => undefined);
    if (kind === 'fetch' && [403, 404].includes(response.status))
      return { ok: true, value: { title: '', content: '' } };
    if (
      attempt === 0 &&
      (response.status === 408 || response.status === 429 || response.status >= 500)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    return {
      ok: false,
      zeroCost: true,
      category:
        response.status === 401
          ? 'invalid_key'
          : response.status === 402
            ? 'quota_exhausted'
            : response.status === 429
              ? 'rate_limited'
              : response.status >= 500
                ? 'provider_error'
                : 'bad_request',
    };
  }
  return { ok: false, category: 'provider_error' };
}

export async function deepseekSearch(
  target: MediaTarget,
  input: {
    query: string;
    maxResults: number;
    needContent?: boolean;
    originalQuestion?: string;
  },
  gate?: SearchRequestGate,
): Promise<MediaAdapterResult<{ hits: SearchHit[]; billable: boolean }>> {
  const query = [...input.query.trim()].slice(0, 128).join('');
  if (!query) return { ok: false, category: 'bad_request' };
  const result = await request(
    target,
    'search',
    {
      query,
      count: Math.min(50, Math.max(1, Math.floor(input.maxResults))),
      need_content: input.needContent === true,
      ...(input.originalQuestion?.trim()
        ? { ori_question: [...input.originalQuestion.trim()].slice(0, 128).join('') }
        : {}),
    },
    gate,
  );
  if (!result.ok) return result;
  const body = Results.safeParse(result.value);
  if (!body.success) return { ok: false, category: 'provider_error' };
  const hits: SearchHit[] = [];
  for (const raw of body.data.results) {
    const item = RawHit.safeParse(raw);
    if (!item.success) continue;
    const value = item.data;
    const url = publicWebUrl(value.url);
    if (!url || url.length > 2000) continue;
    const hit = WebSearchHit.safeParse({
      title: value.title.slice(0, 300),
      url,
      snippet: (value.summary || value.snippet || '').slice(0, 1000),
      source: value.site_name?.slice(0, 200) ?? null,
      publishedAt: value.date?.slice(0, 40) ?? null,
      authority: value.authority,
      relevance: value.rerank_score,
      ...(input.needContent ? { content: value.content?.slice(0, 20000) ?? '' } : {}),
    });
    if (hit.success) hits.push(hit.data);
    if (hits.length >= input.maxResults) break;
  }
  // 供应商按原始 results 是否非空计费；本地丢弃不安全链接不改变真实成本。
  return { ok: true, value: { hits, billable: body.data.results.length > 0 } };
}

export async function deepseekFetch(
  target: MediaTarget,
  rawUrl: string,
  gate?: SearchRequestGate,
): Promise<MediaAdapterResult<{ title: string; content: string }>> {
  const url = publicWebUrl(rawUrl);
  if (!url || target.kind !== 'deepseek_search') return { ok: false, category: 'bad_request' };
  const result = await request(target, 'fetch', { url }, gate, new URL(url).hostname);
  if (!result.ok) return result;
  const page = z
    .object({ title: z.string().optional(), content: z.string() })
    .safeParse(result.value);
  if (!page.success) return { ok: false, category: 'provider_error' };
  return {
    ok: true,
    value: WebPage.parse({
      title: (page.data.title ?? '').slice(0, 300),
      content: page.data.content.slice(0, 20000),
    }),
  };
}
