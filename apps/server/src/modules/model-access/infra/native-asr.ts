import type { MediaAdapterResult, MediaFailure, MediaTarget } from './media-adapter.js';

/**
 * V05: synchronous Qwen3-ASR-Flash, using DashScope MultiModalConversation.
 * Official protocol/limits: https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
 * Billing: https://help.aliyun.com/zh/model-studio/model-pricing
 *
 * Only explicitly verified seconds-priced models are enabled. Qwen-Audio-3.1 token
 * billing, asynchronous filetrans and realtime/WS are NOT supported. MiMo ASR is
 * intercepted but disabled until its complete request/usage contract is verified.
 * Qwen native execution requires kind=dashscope. Family interception also rejects
 * unverified compatible deployments: Chat-Completions compatibility is not proof
 * of multipart /audio/transcriptions support. MiMo must not fall back either.
 */
const MODELS = new Set([
  'qwen3-asr-flash',
  'qwen3-asr-flash-2025-09-08',
  'qwen3-asr-flash-2026-02-10',
]);
const TIMEOUT_MS = 30_000;
// Data URI (including Base64 expansion) stays below the documented 10 MB limit.
const MAX_INPUT_BYTES = 7_000_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 4000;
const MAX_AUDIO_SECONDS = 300;
const MAX_IN_FLIGHT = 2;
let inFlight = 0;

export interface NativeAsrValue {
  text: string;
  /** Actual provider usage only; absent means unknown, never a duration estimate. */
  asrSeconds?: number;
}

/** Discriminator, NOT an allowlist: unsupported family members must fail closed. */
export function isNativeAsrModel(model: string): boolean {
  return (
    /^qwen[^/\s]*-asr(?:-|$)/iu.test(model.trim()) ||
    /^mimo-[^/\s]*-asr(?:-|$)/iu.test(model.trim())
  );
}

function endpoint(baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.port ||
      base.search ||
      base.hash ||
      base.pathname.replace(/\/+$/u, '') !== '/api/v1'
    )
      return null;
    // No arbitrary relay, HTTP, tenant suffix lookalikes, or unverified regions.
    if (
      !['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(base.hostname) &&
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/u.test(
        base.hostname,
      )
    )
      return null;
    return `${base.origin}/api/v1/services/aigc/multimodal-generation/generation`;
  } catch {
    return null;
  }
}

/** A deliberately narrow, container-only allowlist, not a decoder or resampler. */
function audioMime(bytes: Uint8Array, mime: string): string | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prefix = (value: string) => view.subarray(0, value.length).equals(Buffer.from(value));
  switch (mime.trim().toLowerCase()) {
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return bytes.length >= 44 &&
        prefix('RIFF') &&
        view.subarray(8, 12).equals(Buffer.from('WAVE'))
        ? 'audio/wav'
        : null;
    case 'audio/mpeg':
    case 'audio/mp3':
      return bytes.length >= 4 &&
        (prefix('ID3') || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
        ? 'audio/mpeg'
        : null;
    case 'audio/ogg':
    case 'audio/ogg;codecs=opus':
    case 'audio/ogg; codecs=opus':
      return bytes.length >= 27 && prefix('OggS') && bytes[4] === 0 ? 'audio/ogg' : null;
    case 'audio/flac':
    case 'audio/x-flac':
      return bytes.length >= 42 && prefix('fLaC') ? 'audio/flac' : null;
    default:
      // Raw PCM lacks sample rate/channel metadata; video and ambiguous binary are not enabled.
      return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function failure(status: number, payload: Record<string, unknown> | null): MediaFailure {
  const nested = record(payload?.error);
  const code = String(payload?.code ?? nested?.code ?? '').toLowerCase();
  if (
    status === 402 ||
    ['arrearage', 'insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(code)
  )
    return 'quota_exhausted';
  if (
    /datainspectionfailed|data_inspection_failed|content_filter|content_policy_violation/u.test(
      code,
    )
  )
    return 'content_rejected';
  if (status === 401 || status === 403 || code === 'invalidapikey') return 'invalid_key';
  if (status === 429 || code.startsWith('throttling')) return 'rate_limited';
  if (status >= 500 || (status >= 300 && status < 400)) return 'provider_error';
  return status >= 400 ? 'bad_request' : 'provider_error';
}

/** Bound the complete body read, including a server that sends headers then stalls. */
async function readJson(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  let completed = false;
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('NATIVE_ASR_ABORTED'));
  });
  signal.addEventListener('abort', rejectAbort, { once: true });
  try {
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) return null;
      chunks.push(part.value);
    }
    completed = true;
    try {
      return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      return null;
    }
  } finally {
    signal.removeEventListener('abort', rejectAbort);
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** No retries, redirects, input URLs, remote downloads, or compatibility fallback. */
export async function nativeAsr(
  t: MediaTarget,
  input: { bytes: Uint8Array; mimeType: string },
  callerSignal?: AbortSignal,
): Promise<MediaAdapterResult<NativeAsrValue>> {
  const rejected = { ok: false, category: 'bad_request', zeroCost: true } as const;
  const url = endpoint(t.baseUrl);
  if (
    t.kind !== 'dashscope' ||
    !MODELS.has(t.model) ||
    !url ||
    !t.apiKey ||
    /[\r\n]/u.test(t.apiKey) ||
    callerSignal?.aborted ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_INPUT_BYTES ||
    typeof input.mimeType !== 'string'
  )
    return rejected;
  const mime = audioMime(input.bytes, input.mimeType);
  if (!mime) return rejected;
  if (inFlight >= MAX_IN_FLIGHT)
    return { ok: false, category: 'rate_limited', zeroCost: true, localRateLimit: true };
  inFlight++;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: t.model,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { audio: `data:${mime};base64,${Buffer.from(input.bytes).toString('base64')}` },
              ],
            },
          ],
        },
        parameters: { asr_options: { enable_itn: false } },
      }),
    });
    const payload = await readJson(response, signal);
    if (!response.ok) return { ok: false, category: failure(response.status, payload) };
    if (!payload) return { ok: false, category: 'provider_error' };
    if (payload.code || record(payload.error))
      return { ok: false, category: failure(400, payload) };
    const choices = record(payload.output)?.choices;
    const first = Array.isArray(choices) ? record(choices[0]) : null;
    const content = record(first?.message)?.content;
    // Never accept the top-level OpenAI shape as a silent protocol fallback.
    if (!Array.isArray(content) || content.length !== 1)
      return { ok: false, category: 'provider_error' };
    const text = record(content[0])?.text;
    if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)
      return { ok: false, category: 'provider_error' };
    const seconds = record(payload.usage)?.seconds;
    const knownSeconds =
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= MAX_AUDIO_SECONDS;
    return {
      ok: true,
      value: { text, ...(knownSeconds ? { asrSeconds: seconds } : {}) },
    };
  } catch {
    // The POST may already be billable, even on cancellation or an unreadable response.
    return { ok: false, category: 'network_error' };
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}
