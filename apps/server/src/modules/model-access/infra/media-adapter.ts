/**
 * 多媒体上游适配器（T-071）：语音合成、语音识别、图片生成、联网搜索。
 *
 * - OpenAiCompatibleMediaAdapter：OpenAI 兼容协议（`/audio/speech`、`/audio/transcriptions`、`/images/generations`），
 *   国内多数供应商（阿里云百炼兼容模式、硅基流动、火山等）都提供；联网搜索走博查（bocha_search）`/web-search`。
 *   真实供应商「待配置后验证」。
 * - FakeMediaAdapter：开发 / 测试环境的假上游（目录里 upstreamModelId 以 `fake-` 开头时使用，生产环境不启用）。
 *   计费照常：冻结、结算、用量记录与真实上游完全一样，只是不发网络请求。
 *
 * 安全：密钥只放在 Authorization 头；不跟随重定向；不记录上游原文；响应大小有上限。
 */

import type { WebSearchResultItem } from '@weiban/contracts';
import { jevDecide } from './jev-adapter.js';
import { deepseekSearch, deepseekFetch, type SearchRequestGate } from './deepseek-tools.js';

export type MediaFailure =
  | 'network_error'
  | 'provider_error'
  | 'rate_limited'
  | 'invalid_key'
  | 'quota_exhausted'
  | 'content_rejected'
  | 'bad_request';

export type MediaAdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; category: MediaFailure; zeroCost?: boolean; localRateLimit?: boolean };

export interface MediaTarget {
  kind: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type SearchHit = WebSearchResultItem;

/** T-090（CR-18）：Jev 风格的类型化决策问题。 */
export interface DecideAdapterQuestion {
  questionId: string;
  kind: 'yes_no' | 'choice' | 'scale';
  prompt: string;
  options: string[];
}
export interface DecideAdapterAnswer {
  questionId: string;
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface MediaAdapter {
  /** 行为规划决策（Jev，CR-18）。真实接口字段「待配置后验证」。 */
  decide(
    t: MediaTarget,
    input: {
      state: Record<string, unknown>;
      questions: DecideAdapterQuestion[];
      timeoutMs?: number;
    },
  ): Promise<
    MediaAdapterResult<{
      answers: DecideAdapterAnswer[];
      inputTokens: number;
      inputTokensEstimated?: boolean;
    }>
  >;
  synthesize(
    t: MediaTarget,
    input: { text: string; voice: string; format: 'ogg_opus' | 'pcm16_24k' | 'wav' },
  ): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string; durationMs: number }>>;
  /** 流式合成：逐块返回 PCM16LE 24kHz 单声道。signal 用于打断。 */
  synthesizeStream(
    t: MediaTarget,
    input: { text: string; voice: string },
    signal: AbortSignal,
  ): Promise<MediaAdapterResult<AsyncIterable<Uint8Array>>>;
  transcribe(
    t: MediaTarget,
    input: { bytes: Uint8Array; mimeType: string },
  ): Promise<MediaAdapterResult<{ text: string }>>;
  generateImage(
    t: MediaTarget,
    input: { prompt: string; size: string },
  ): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string }>>;
  search(
    t: MediaTarget,
    input: { query: string; maxResults: number; needContent?: boolean; originalQuestion?: string },
  ): Promise<MediaAdapterResult<{ hits: SearchHit[]; billable?: boolean }>>;
  fetchPage?(
    t: MediaTarget,
    input: { url: string },
  ): Promise<MediaAdapterResult<{ title: string; content: string }>>;
}

const MAX_RESPONSE_BYTES = 12_000_000;
const TIMEOUT_MS = 30_000;

function classify(status: number, code: string): MediaFailure | null {
  if (status >= 200 && status < 300) return null;
  if (
    ['insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(code) ||
    status === 402
  )
    return 'quota_exhausted';
  if (
    [
      'content_filter',
      'content_policy_violation',
      'moderation_blocked',
      'data_inspection_failed',
    ].includes(code)
  )
    return 'content_rejected';
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return 'bad_request';
}

async function readLimited(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function errorOf(response: Response): Promise<MediaFailure> {
  let code = '';
  try {
    const bytes = await readLimited(response);
    const payload = bytes
      ? (JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>)
      : {};
    const err = payload.error as { code?: unknown } | undefined;
    if (typeof err?.code === 'string') code = err.code;
  } catch {
    // 正文不是 JSON：只按状态码分类。
  }
  return classify(response.status, code) ?? 'provider_error';
}

function url(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** 中文约每秒 4 字；用于估算没有时长信息的合成音频时长。 */
export function estimateSpeechMs(text: string): number {
  return Math.max(800, Math.min(300_000, Math.round([...text].length * 250)));
}

/** 生成 PCM16LE 单声道 WAV 文件头 + 数据。 */
export function wavFromPcm(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

export class OpenAiCompatibleMediaAdapter implements MediaAdapter {
  constructor(private readonly searchGate?: SearchRequestGate) {}
  fetchPage(t: MediaTarget, input: { url: string }) {
    return deepseekFetch(t, input.url, this.searchGate);
  }
  /** Verified System One / Decisions request; shared relay accounts keep their existing protocol. */
  decide(
    t: MediaTarget,
    input: {
      state: Record<string, unknown>;
      questions: DecideAdapterQuestion[];
      timeoutMs?: number;
    },
  ) {
    return jevDecide(t, input);
  }
  async synthesize(
    t: MediaTarget,
    input: { text: string; voice: string; format: 'ogg_opus' | 'pcm16_24k' | 'wav' },
  ): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string; durationMs: number }>> {
    try {
      const responseFormat =
        input.format === 'ogg_opus' ? 'opus' : input.format === 'wav' ? 'wav' : 'pcm';
      const response = await fetch(url(t.baseUrl, '/audio/speech'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: t.model,
          input: input.text,
          voice: input.voice,
          response_format: responseFormat,
        }),
      });
      if (!response.ok) return { ok: false, category: await errorOf(response) };
      const bytes = await readLimited(response);
      if (!bytes || bytes.length < 16) return { ok: false, category: 'provider_error' };
      if (input.format === 'pcm16_24k')
        return {
          ok: true,
          value: { bytes, mimeType: 'audio/L16', durationMs: Math.round(bytes.length / 48) },
        };
      return {
        ok: true,
        value: {
          bytes,
          mimeType: input.format === 'wav' ? 'audio/wav' : 'audio/ogg',
          durationMs: estimateSpeechMs(input.text),
        },
      };
    } catch {
      return { ok: false, category: 'network_error' };
    }
  }

  async synthesizeStream(
    t: MediaTarget,
    input: { text: string; voice: string },
    signal: AbortSignal,
  ): Promise<MediaAdapterResult<AsyncIterable<Uint8Array>>> {
    try {
      const response = await fetch(url(t.baseUrl, '/audio/speech'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS * 4)]),
        headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: t.model,
          input: input.text,
          voice: input.voice,
          response_format: 'pcm',
          stream: true,
        }),
      });
      if (!response.ok) return { ok: false, category: await errorOf(response) };
      const body = response.body;
      if (!body) return { ok: false, category: 'provider_error' };
      async function* chunks(): AsyncIterable<Uint8Array> {
        const reader = body!.getReader();
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) return;
            yield part.value;
          }
        } catch {
          return;
        } finally {
          reader.releaseLock();
        }
      }
      return { ok: true, value: chunks() };
    } catch {
      return { ok: false, category: signal.aborted ? 'bad_request' : 'network_error' };
    }
  }

  async transcribe(
    t: MediaTarget,
    input: { bytes: Uint8Array; mimeType: string },
  ): Promise<MediaAdapterResult<{ text: string }>> {
    try {
      const form = new FormData();
      const ext = input.mimeType.split('/')[1]?.split(';')[0] ?? 'ogg';
      form.append(
        'file',
        new Blob([Buffer.from(input.bytes)], { type: input.mimeType }),
        `audio.${ext}`,
      );
      form.append('model', t.model);
      form.append('response_format', 'json');
      const response = await fetch(url(t.baseUrl, '/audio/transcriptions'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${t.apiKey}` },
        body: form,
      });
      if (!response.ok) return { ok: false, category: await errorOf(response) };
      const bytes = await readLimited(response);
      if (!bytes) return { ok: false, category: 'provider_error' };
      const payload = JSON.parse(Buffer.from(bytes).toString('utf8')) as { text?: unknown };
      if (typeof payload.text !== 'string') return { ok: false, category: 'provider_error' };
      return { ok: true, value: { text: payload.text.slice(0, 4000) } };
    } catch {
      return { ok: false, category: 'network_error' };
    }
  }

  async generateImage(
    t: MediaTarget,
    input: { prompt: string; size: string },
  ): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string }>> {
    try {
      const response = await fetch(url(t.baseUrl, '/images/generations'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS * 4),
        headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: t.model,
          prompt: input.prompt,
          size: input.size,
          n: 1,
          quality: 'standard',
          response_format: 'b64_json',
        }),
      });
      if (!response.ok) return { ok: false, category: await errorOf(response) };
      const bytes = await readLimited(response);
      if (!bytes) return { ok: false, category: 'provider_error' };
      const payload = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        data?: Array<{ b64_json?: unknown }>;
      };
      const b64 = payload.data?.[0]?.b64_json;
      if (typeof b64 !== 'string') return { ok: false, category: 'provider_error' };
      const image = Buffer.from(b64, 'base64');
      const mimeType =
        image[0] === 0x89 ? 'image/png' : image[0] === 0xff ? 'image/jpeg' : 'image/webp';
      return { ok: true, value: { bytes: new Uint8Array(image), mimeType } };
    } catch {
      return { ok: false, category: 'network_error' };
    }
  }

  async search(
    t: MediaTarget,
    input: { query: string; maxResults: number; needContent?: boolean; originalQuestion?: string },
  ): Promise<MediaAdapterResult<{ hits: SearchHit[]; billable?: boolean }>> {
    if (t.kind === 'deepseek_search') return deepseekSearch(t, input, this.searchGate);
    if (t.kind !== 'bocha_search') return { ok: false, category: 'bad_request', zeroCost: true };
    try {
      const response = await fetch(url(t.baseUrl, '/web-search'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input.query, count: input.maxResults, summary: true }),
      });
      if (!response.ok) return { ok: false, category: await errorOf(response) };
      const bytes = await readLimited(response);
      if (!bytes) return { ok: false, category: 'provider_error' };
      const payload = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        data?: { webPages?: { value?: Array<Record<string, unknown>> } };
      };
      const hits: SearchHit[] = [];
      for (const v of payload.data?.webPages?.value ?? []) {
        const link = typeof v.url === 'string' ? v.url : '';
        if (!/^https?:\/\//i.test(link)) continue;
        hits.push({
          title: String(v.name ?? '').slice(0, 300),
          url: link.slice(0, 2000),
          snippet: String(v.summary ?? v.snippet ?? '').slice(0, 1000),
          source: typeof v.siteName === 'string' ? v.siteName.slice(0, 200) : null,
          publishedAt: typeof v.datePublished === 'string' ? v.datePublished.slice(0, 40) : null,
        });
        if (hits.length >= input.maxResults) break;
      }
      return { ok: true, value: { hits } };
    } catch {
      return { ok: false, category: 'network_error' };
    }
  }
}

/** 开发 / 测试用假上游：确定性输出，不发网络请求。 */
export class FakeMediaAdapter implements MediaAdapter {
  /** 假 Jev：确定性地给第一个选项 0.7，其余平分。 */
  async decide(
    _t: MediaTarget,
    input: {
      state: Record<string, unknown>;
      questions: DecideAdapterQuestion[];
      timeoutMs?: number;
    },
  ): Promise<
    MediaAdapterResult<{
      answers: DecideAdapterAnswer[];
      inputTokens: number;
      inputTokensEstimated?: boolean;
    }>
  > {
    const answers = input.questions.map((q) => {
      const opts = q.options.length ? q.options : ['yes', 'no'];
      const probabilities: Record<string, number> = {};
      opts.forEach((o, i) => {
        probabilities[o] = i === 0 ? (opts.length === 1 ? 1 : 0.7) : 0.3 / (opts.length - 1);
      });
      const second = opts.length > 1 ? 0.3 / (opts.length - 1) : 0;
      return {
        questionId: q.questionId,
        choice: opts[0]!,
        probabilities,
        confidence: (probabilities[opts[0]!] ?? 0) - second,
      };
    });
    return {
      ok: true,
      value: {
        answers,
        inputTokens: Math.ceil(JSON.stringify(input.state).length / 2),
        inputTokensEstimated: true,
      },
    };
  }

  async synthesize(
    _t: MediaTarget,
    input: { text: string; voice: string; format: 'ogg_opus' | 'pcm16_24k' | 'wav' },
  ): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string; durationMs: number }>> {
    const durationMs = Math.min(estimateSpeechMs(input.text), 60_000);
    if (input.format === 'pcm16_24k')
      return {
        ok: true,
        value: {
          bytes: new Uint8Array(Math.round(durationMs * 48)),
          mimeType: 'audio/L16',
          durationMs,
        },
      };
    // 8 kHz 静音 WAV（假上游不输出真实语音）。
    const pcm = new Uint8Array(Math.round((durationMs / 1000) * 8000) * 2);
    return { ok: true, value: { bytes: wavFromPcm(pcm, 8000), mimeType: 'audio/wav', durationMs } };
  }

  async synthesizeStream(
    _t: MediaTarget,
    input: { text: string; voice: string },
    signal: AbortSignal,
  ): Promise<MediaAdapterResult<AsyncIterable<Uint8Array>>> {
    const total = Math.round(estimateSpeechMs(input.text) * 48);
    async function* chunks(): AsyncIterable<Uint8Array> {
      for (let sent = 0; sent < total && !signal.aborted; sent += 9600) {
        await new Promise<void>((r) => setTimeout(r, 100));
        yield new Uint8Array(Math.min(9600, total - sent));
      }
    }
    return { ok: true, value: chunks() };
  }

  async transcribe(
    _t: MediaTarget,
    input: { bytes: Uint8Array; mimeType: string },
  ): Promise<MediaAdapterResult<{ text: string }>> {
    return {
      ok: true,
      value: {
        text: `（假识别）一段约 ${Math.max(1, Math.round(input.bytes.length / 4000))} 秒的语音`,
      },
    };
  }

  async generateImage(): Promise<MediaAdapterResult<{ bytes: Uint8Array; mimeType: string }>> {
    // 1×1 PNG。
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    return { ok: true, value: { bytes: new Uint8Array(png), mimeType: 'image/png' } };
  }

  async search(): Promise<MediaAdapterResult<{ hits: SearchHit[] }>> {
    // 假上游搜不到结果：调用方按「搜不到就不说具体信息」处理。
    return { ok: true, value: { hits: [] } };
  }
}

/** 开发 / 测试环境下，目录模型的 upstreamModelId 以 fake- 开头时走假上游。 */
export function isFakeModel(upstreamModelId: string, production: boolean): boolean {
  return !production && upstreamModelId.startsWith('fake-');
}
