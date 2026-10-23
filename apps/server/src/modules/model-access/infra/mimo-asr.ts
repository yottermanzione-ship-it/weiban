import type { MediaAdapterResult, MediaFailure, MediaTarget } from './media-adapter.js';

/**
 * MiMo 语音识别（旧版协议）：`POST {base}/chat/completions`，音频以
 * `input_audio.data` 的 data URL 内联在聊天消息里，不是 OpenAI 的 multipart
 * `/audio/transcriptions`。旧项目参考 `server/lib/voice_transcription.js` 第 180–210 行。
 *
 * 只在模型匹配 `^mimo-[^/]*-asr` 时由 media-adapter 分流进来；其他模型（含
 * SiliconFlow 两条）保持原有路径。响应只接受文本，不下载任何 URL、不重试、
 * 不跟随重定向，密钥只放鉴权头。MiMo ASR 尚未用真实账号复验，以下限制来自
 * 本批明确要求，不是供应商声明。
 */
const CHAT_PATH = '/chat/completions';
const TIMEOUT_MS = 30_000;
// 输入音频（未编码字节）上限；Base64 后的 data URL 会更大。
const MAX_INPUT_BYTES = 12_000_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_AUDIO_SECONDS = 300;

/** 只负责 MiMo ASR 家族；是否为受支持型号仍由调用方路由与供应商决定。 */
export function isMimoAsrModel(model: string): boolean {
  return /^mimo-[^/]*-asr/u.test(model.trim());
}

const rejected = { ok: false, category: 'bad_request', zeroCost: true } as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 与现有媒体适配器相同的 MediaFailure 分类，额外兼容 OpenAI 风格的错误码。 */
function failure(status: number, payload: Record<string, unknown> | null): MediaFailure {
  const nested = record(payload?.error);
  const code = String(payload?.code ?? nested?.code ?? nested?.type ?? '').toLowerCase();
  if (
    status === 402 ||
    ['arrearage', 'insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(code)
  )
    return 'quota_exhausted';
  if (
    [
      'data_inspection_failed',
      'datainspectionfailed',
      'content_filter',
      'content_policy_violation',
      'moderation_blocked',
    ].includes(code)
  )
    return 'content_rejected';
  if (
    status === 401 ||
    status === 403 ||
    ['invalid_api_key', 'invalidapikey', 'authentication_error'].includes(code)
  )
    return 'invalid_key';
  if (status === 429 || code.startsWith('throttling') || code === 'rate_limit_exceeded')
    return 'rate_limited';
  if (status >= 500 || (status >= 300 && status < 400)) return 'provider_error';
  return status >= 400 ? 'bad_request' : 'provider_error';
}

/**
 * 旧版 MiMo 的基础地址来自供应商配置（官方为 https://token-plan-cn.xiaomimimo.com/v1）。
 * 这里只拒绝带凭据/查询/片段的地址与不可解析地址，不强制供应商域名，避免把可配置的
 * 中转线路写死；线上地址仍由目录配置审批控制。
 */
function endpoint(baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    if (
      !['https:', 'http:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return null;
    return `${baseUrl.replace(/\/+$/u, '')}${CHAT_PATH}`;
  } catch {
    return null;
  }
}

/** 媒体库只保存音频；这里也不接受任意 MIME 或带参数的 data URL。 */
function audioMime(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase();
  return /^audio\/[a-z0-9][a-z0-9.+-]*$/u.test(normalized) ? normalized : null;
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
    rejectAbort = () => reject(new Error('MIMO_ASR_ABORTED'));
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

/** 旧版 `extractTranscript`：兼容顶层文本与 chat completions 的 message.content。 */
function transcriptOf(payload: Record<string, unknown>): string | null {
  const direct = payload.text ?? payload.transcript ?? payload.result;
  if (typeof direct === 'string') return direct;
  const data = record(payload.data);
  const nested = data?.text ?? data?.transcript;
  if (typeof nested === 'string') return nested;
  const choices = payload.choices;
  const first = Array.isArray(choices) ? record(choices[0]) : null;
  const content = record(first?.message)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      const item = record(part);
      const piece = item?.text ?? item?.transcript ?? item?.content;
      if (typeof piece !== 'string') return null;
      text += piece;
    }
    return text;
  }
  return null;
}

/** 无重试、无重定向、无音频 URL、不回落 multipart。 */
export async function mimoAsr(
  t: MediaTarget,
  input: { bytes: Uint8Array; mimeType: string },
): Promise<MediaAdapterResult<{ text: string; asrSeconds?: number }>> {
  const url = endpoint(t.baseUrl);
  if (
    !url ||
    !t.apiKey ||
    /[\r\n]/u.test(t.apiKey) ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_INPUT_BYTES ||
    typeof input.mimeType !== 'string'
  )
    return rejected;
  const mime = audioMime(input.mimeType);
  if (!mime) return rejected;
  const dataUrl = `data:${mime};base64,${Buffer.from(input.bytes).toString('base64')}`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: timeout.signal,
      headers: {
        'api-key': t.apiKey,
        Authorization: `Bearer ${t.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: t.model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: dataUrl } }],
          },
        ],
        asr_options: { language: null },
      }),
    });
    const payload = await readJson(response, timeout.signal);
    if (!response.ok) return { ok: false, category: failure(response.status, payload) };
    if (!payload) return { ok: false, category: 'provider_error' };
    if (payload.code || record(payload.error))
      return { ok: false, category: failure(400, payload) };
    const extracted = transcriptOf(payload);
    if (extracted === null) return { ok: false, category: 'provider_error' };
    const seconds = record(payload.usage)?.seconds;
    const knownSeconds =
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= MAX_AUDIO_SECONDS;
    return {
      ok: true,
      value: {
        text: extracted.trim(),
        ...(knownSeconds ? { asrSeconds: seconds } : {}),
      },
    };
  } catch {
    // The POST may already be billable, even on cancellation or an unreadable response.
    return { ok: false, category: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
