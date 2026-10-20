/**
 * 3.24（试用反馈第二轮 F2）：Anthropic 原生 Messages 协议（Claude）。中转站给的 Claude 地址 + 密钥即可用。
 *
 * 为什么不只用 OpenAI 兼容通道：中转站把 OpenAI 格式转给 Claude 时，缓存控制（cache_control）与缓存写入用量
 * 常常丢失，Claude 的缓存命中率低、缓存写入看不到。原生协议能：
 * - 在 09 号 §6 的「稳定开头」末尾打缓存断点（网关在 AdapterMessage.cacheBreakpoint 标出）；
 * - 读回 input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens
 *   （含 cache_creation.ephemeral_5m_input_tokens / ephemeral_1h_input_tokens 分项），按「缓存读取 / 写入 5 分钟 / 写入 1 小时」分别计价。
 *
 * 请求转换：
 * - 开头连续的系统消息 → 顶层 system（文本块数组）；中间与结尾的系统消息 → 用户消息并注明「系统提示，不是用户说的话」
 *   （与 systemMessageMode = single_system 同样的写法；不是所有 Claude 模型都支持对话中插入 system）。
 *   相邻同角色消息不合并（接口会自行合并），这样每轮的开头逐字节相同，缓存才命中。
 * - 第一条必须是用户消息：开头是助手消息时补一条固定的「（对话开始）」；最后一条是助手消息时补「（请继续）」
 *   （新模型不支持助手预填）。
 * - 图片：data URL → base64 图片块（jpeg / png / gif / webp），https 地址 → url 图片块；放在文字前面。
 * - max_tokens 必填（= 网关算好的输出上限）；不发 temperature（新一代 Claude 不接受非默认采样参数）；
 *   thinking = off 时对支持 effort 的新模型发 output_config.effort = low（少想、少占输出额度），不发 thinking 字段。
 * - 流式（stream: true）读取 SSE，累积文字与用量；个别中转不支持流式而直接回 JSON 时也能解析。
 *
 * 安全：密钥只放在 x-api-key 头；不跟随重定向；任何错误只返回类别，不记录上游原文；响应最多读 2MB。
 */
import {
  estimateInputTokens,
  estimateTokens,
  stripReasoning,
  type AdapterMessage,
  type TextAdapter,
  type TextResult,
  type TextUsage,
} from './text-adapter.js';

/** Anthropic 接口版本头（官方要求固定值）。 */
export const ANTHROPIC_VERSION = '2023-06-01';
const NOTE_OPEN = '【系统提示，不是用户说的话】\n';
const MAX_RESPONSE_BYTES = 2_000_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

type Category = Extract<TextResult, { ok: false }>['category'];
type Block = Record<string, unknown>;
interface WireMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/** `{baseUrl}/v1/messages`（baseUrl 已以 /v1 结尾时不重复）。模型列表同理用 /v1/models。 */
export function anthropicUrl(baseUrl: string, path: 'messages' | 'models'): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/${path}` : `${base}/v1/${path}`;
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * 支持 output_config.effort 的模型（按模型名判断，判断不出就不发，避免旧模型或别家报 400）：
 * Opus 4.5 及以后、Sonnet 4.6 及以后、Haiku 5 及以后、Fable / Mythos 全系。
 */
export function supportsEffort(model: string): boolean {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/i.exec(model);
  if (!m) return false;
  const family = m[1]!.toLowerCase();
  const version = Number(m[2]) + (m[3] && m[3].length <= 2 ? Number(m[3]) / 10 : 0);
  if (family === 'fable' || family === 'mythos') return true;
  if (family === 'opus') return version >= 4.5;
  if (family === 'sonnet') return version >= 4.6;
  return version >= 5;
}

function imageBlock(url: string): Block | null {
  const data = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (data) {
    const mediaType = data[1]!.toLowerCase();
    if (!IMAGE_TYPES.has(mediaType)) return null;
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data[2] } };
  }
  if (/^https:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  return null;
}

function withBreakpoint(blocks: Block[], on: boolean | undefined): Block[] {
  if (!on || !blocks.length) return blocks;
  const last = blocks.length - 1;
  return blocks.map((b, i) => (i === last ? { ...b, cache_control: { type: 'ephemeral' } } : b));
}

/** 消息转换（纯函数，单独导出便于核对）。 */
export function toAnthropicRequest(messages: AdapterMessage[]): {
  system: Block[];
  messages: WireMessage[];
} {
  let start = 0;
  const system: Block[] = [];
  while (start < messages.length && messages[start]!.role === 'system') {
    const m = messages[start]!;
    if (m.content)
      system.push(...withBreakpoint([{ type: 'text', text: m.content }], m.cacheBreakpoint));
    start++;
  }
  const out: WireMessage[] = [];
  for (const m of messages.slice(start)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = m.role === 'system' ? `${NOTE_OPEN}${m.content}` : m.content;
    const blocks: Block[] = [];
    if (role === 'user')
      for (const url of m.images ?? []) {
        const image = imageBlock(url);
        if (image) blocks.push(image);
      }
    if (text) blocks.push({ type: 'text', text });
    if (!blocks.length) continue;
    out.push({ role, content: withBreakpoint(blocks, m.cacheBreakpoint) });
  }
  // 只有系统消息（例 一次性的整理任务）：最后一段系统内容改作用户消息
  if (!out.length && system.length) {
    const last = system.pop()!;
    out.push({ role: 'user', content: [last] });
  }
  if (out[0]?.role !== 'user')
    out.unshift({ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] });
  if (out.at(-1)?.role === 'assistant')
    out.push({ role: 'user', content: [{ type: 'text', text: '（请继续）' }] });
  return { system, messages: out };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** 合并 message_start 与 message_delta 里的用量（后来的非空值覆盖前面的）。 */
function mergeUsage(target: Record<string, unknown>, raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (k === 'cache_creation' && typeof v === 'object') {
      target.cache_creation = { ...((target.cache_creation as object) ?? {}), ...v };
    } else target[k] = v;
  }
}

export function anthropicUsage(
  raw: Record<string, unknown>,
  inputEstimate: number,
  output: string,
): TextUsage {
  const read = num(raw.cache_read_input_tokens) ?? 0;
  const creation = num(raw.cache_creation_input_tokens);
  const detail = (raw.cache_creation ?? {}) as Record<string, unknown>;
  const w5 = num(detail.ephemeral_5m_input_tokens);
  const w1 = num(detail.ephemeral_1h_input_tokens);
  const inputTokens = num(raw.input_tokens);
  const outputTokens = num(raw.output_tokens);
  // 分项齐全时用分项；只有总数时全部按 5 分钟（默认时长）
  const write5m = w5 !== null || w1 !== null ? (w5 ?? 0) : (creation ?? 0);
  const write1h = w5 !== null || w1 !== null ? (w1 ?? 0) : 0;
  const reported = {
    promptTokens: inputTokens === null ? null : inputTokens + read + write5m + write1h,
    cachedTokens: read,
    completionTokens: outputTokens,
    cacheWriteTokens: creation ?? write5m + write1h,
  };
  if (inputTokens !== null && outputTokens !== null)
    return {
      inputTokens,
      cachedInputTokens: read,
      ...(write5m ? { cacheWrite5mTokens: write5m } : {}),
      ...(write1h ? { cacheWrite1hTokens: write1h } : {}),
      outputTokens,
      estimated: false,
      reported,
    };
  return {
    inputTokens: Math.max(1, inputEstimate),
    cachedInputTokens: 0,
    outputTokens: estimateTokens(output),
    estimated: true,
    reported,
  };
}

/** HTTP 状态 + 错误体 → 失败类别。 */
export function classifyAnthropicError(
  status: number,
  error: { type?: unknown; code?: unknown; message?: unknown } | undefined,
): { category: Category; retryable: boolean } {
  const type = typeof error?.type === 'string' ? error.type : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message.slice(0, 500) : '';
  if (
    status === 402 ||
    type === 'billing_error' ||
    [
      'insufficient_quota',
      'insufficient_user_quota',
      'insufficient_balance',
      'quota_exhausted',
    ].includes(code) ||
    /credit balance|insufficient (?:balance|quota|credit)|余额不足|额度不足/i.test(message)
  )
    return { category: 'quota_exhausted', retryable: false };
  if (
    status === 401 ||
    status === 403 ||
    type === 'authentication_error' ||
    type === 'permission_error'
  )
    return { category: 'invalid_key', retryable: false };
  if (status === 429 || type === 'rate_limit_error')
    return { category: 'rate_limited', retryable: true };
  if (status >= 500 || type === 'overloaded_error' || type === 'api_error')
    return { category: 'provider_error', retryable: true };
  return { category: 'bad_request', retryable: false };
}

export class AnthropicTextAdapter implements TextAdapter {
  async generate(input: Parameters<TextAdapter['generate']>[0]): Promise<TextResult> {
    const startedAt = performance.now();
    const request = toAnthropicRequest(input.messages);
    const body = {
      model: input.model,
      max_tokens: input.maxOutputTokens,
      ...(request.system.length ? { system: request.system } : {}),
      messages: request.messages,
      stream: true,
      ...(input.thinking !== 'default' && supportsEffort(input.model)
        ? { output_config: { effort: 'low' } }
        : {}),
    };
    const inputEstimate = estimateInputTokens(input.messages);
    try {
      // 每次 generate 恰好一次 HTTP；重试由网关另建 attempt 并预留风险。
      const response = await fetch(anthropicUrl(input.baseUrl, 'messages'), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(input.timeoutMs),
        headers: {
          ...anthropicHeaders(input.apiKey),
          Accept: 'text/event-stream',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const read = await readLimited(response, startedAt);
      if (read === null) return { ok: false, category: 'provider_error', retryable: false };
      const raw = read.text;
      if (!response.ok) {
        let error: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(raw) as { error?: Record<string, unknown> };
          error = parsed.error;
        } catch {
          /* 非 JSON 错误页：只看状态码 */
        }
        return { ok: false, ...classifyAnthropicError(response.status, error) };
      }
      const contentType = response.headers.get('content-type') ?? '';
      const parsed = contentType.includes('application/json') ? parseJson(raw) : parseStream(raw);
      if (parsed.error) return { ok: false, ...classifyAnthropicError(0, parsed.error) };
      const rawText = parsed.text;
      const usage = anthropicUsage(parsed.usage, inputEstimate, rawText);
      if (parsed.stopReason === 'refusal')
        return { ok: false, category: 'content_rejected', retryable: false, usage };
      const text = stripReasoning(rawText);
      if (!text) return { ok: false, category: 'empty_output', retryable: true, usage };
      if (parsed.stopReason === 'max_tokens' && input.responseFormat === 'json')
        return { ok: false, category: 'truncated', retryable: true, usage };
      return {
        ok: true,
        text: input.responseFormat === 'json' ? stripJsonFence(text) : text,
        usage,
        ...(read.firstDeltaMs !== null ? { ttftMs: read.firstDeltaMs } : {}),
      };
    } catch {
      return { ok: false, category: 'network_error', retryable: true };
    }
  }
}

/** 读完响应（最多 2MB）；顺带记下第一段正文到达的时间（首字耗时）。 */
async function readLimited(
  response: Response,
  startedAt: number,
): Promise<{ text: string; firstDeltaMs: number | null } | null> {
  if (!response.body) return { text: '', firstDeltaMs: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let firstDeltaMs: number | null = null;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(part.value, { stream: true });
      if (firstDeltaMs === null && text.includes('"text_delta"'))
        firstDeltaMs = Math.round(performance.now() - startedAt);
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return { text, firstDeltaMs };
}

interface Parsed {
  text: string;
  usage: Record<string, unknown>;
  stopReason: string | null;
  error?: Record<string, unknown>;
}

/** 非流式响应（个别中转忽略 stream）。 */
function parseJson(raw: string): Parsed {
  try {
    const message = JSON.parse(raw) as Record<string, unknown>;
    if (message.type === 'error')
      return {
        text: '',
        usage: {},
        stopReason: null,
        error: (message.error as Record<string, unknown>) ?? { type: 'api_error' },
      };
    const content = Array.isArray(message.content) ? (message.content as Block[]) : [];
    return {
      text: content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join(''),
      usage: (message.usage as Record<string, unknown>) ?? {},
      stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
    };
  } catch {
    return { text: '', usage: {}, stopReason: null, error: { type: 'api_error' } };
  }
}

/**
 * SSE：message_start（含输入用量）→ content_block_delta（text_delta 累积；thinking_delta 忽略）→
 * message_delta（stop_reason、输出用量）→ message_stop；error 事件按错误处理；ping 忽略。
 */
export function parseStream(raw: string): Parsed {
  const usage: Record<string, unknown> = {};
  let text = '';
  let stopReason: string | null = null;
  let error: Record<string, unknown> | undefined;
  let sawEvent = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    sawEvent = true;
    switch (event.type) {
      case 'message_start':
        mergeUsage(usage, (event.message as Record<string, unknown> | undefined)?.usage);
        break;
      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') text += delta.text;
        break;
      }
      case 'message_delta': {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (typeof delta?.stop_reason === 'string') stopReason = delta.stop_reason;
        mergeUsage(usage, event.usage);
        break;
      }
      case 'error':
        error = (event.error as Record<string, unknown>) ?? { type: 'api_error' };
        break;
      default:
        break;
    }
  }
  if (!sawEvent) return parseJson(raw);
  return { text, usage, stopReason, ...(error ? { error } : {}) };
}

/** 要求 JSON 时去掉 ```json 围栏（Claude 没有 response_format，靠提示词约束格式）。 */
export function stripJsonFence(text: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim());
  return m ? m[1]!.trim() : text;
}

/** 连通测试 / 拉模型列表：GET {baseUrl}/v1/models（不产生费用）。 */
export async function fetchAnthropicModels(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<{ status: number; ids: string[] | null } | null> {
  let response: Response;
  try {
    response = await fetch(`${anthropicUrl(input.baseUrl, 'models')}?limit=1000`, {
      method: 'GET',
      headers: anthropicHeaders(input.apiKey),
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, ids: null };
  }
  try {
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id.slice(0, 200) : null))
      .filter((id): id is string => !!id)
      .slice(0, 500);
    return { status: response.status, ids: [...new Set(ids)].sort() };
  } catch {
    return { status: response.status, ids: null };
  }
}
