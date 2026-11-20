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
import { ProviderObservation } from './provider-observation.js';
import {
  completeJsonPrefix,
  estimateInputTokens,
  estimateTokens,
  isSafetyPolicyBlock,
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

/**
 * 批 EJ：后台整理任务保留思考。支持 effort 的新模型用自适应思考（由模型自己决定想多少，总上限已含思考预算）；
 * 旧模型用 budget_tokens（至少 1024，且必须小于 max_tokens；放不下就不开思考，保证正文额度）。
 */
export function anthropicThinkingOn(
  model: string,
  maxTokens: number,
  budget: number,
): Record<string, unknown> {
  // Opus 4.5 支持 effort 但还没有自适应思考，按旧方式给预算。
  if (supportsEffort(model) && !/claude-opus-4[-.]5(?!\d)/i.test(model))
    return { thinking: { type: 'adaptive' } };
  const tokens = Math.max(1024, Math.round(budget));
  return tokens < maxTokens ? { thinking: { type: 'enabled', budget_tokens: tokens } } : {};
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
  // 安全策略拦截（名单在 text-adapter.ts 唯一定义）：HTTP 错误体与流式 SSE 的 error 事件都走这里，
  // 先于 401/403 / permission_error 判断，不当成密钥失效（T-20261103j）。
  if (isSafetyPolicyBlock(error)) return { category: 'content_rejected', retryable: false };
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

/**
 * 2026-10-29 关思考：Claude Opus 5（老款，不含 5.5）接受 thinking disabled（档位须在 high 及以下，
 * 聊天已发 effort low，满足条件）；Opus 5.5 / Sonnet 5.5 / Fable 5 传 disabled 会报 400，故不进此分支。
 */
export function supportsThinkingDisabled(model: string): boolean {
  return /claude-opus-5(?![-.]\d)/i.test(model);
}

export class AnthropicTextAdapter implements TextAdapter {
  async generate(input: Parameters<TextAdapter['generate']>[0]): Promise<TextResult> {
    const request = toAnthropicRequest(input.messages);
    const body = {
      model: input.model,
      max_tokens: input.maxOutputTokens,
      ...(request.system.length ? { system: request.system } : {}),
      messages: request.messages,
      stream: true,
      ...(input.thinking === 'on'
        ? anthropicThinkingOn(input.model, input.maxOutputTokens, input.thinkingBudget ?? 0)
        : input.thinking !== 'default' && supportsThinkingDisabled(input.model)
          ? { thinking: { type: 'disabled' }, output_config: { effort: 'low' } }
          : input.thinking !== 'default' && supportsEffort(input.model)
            ? { output_config: { effort: 'low' } }
            : {}),
    };
    const inputEstimate = estimateInputTokens(input.messages);
    const obs = new ProviderObservation(input);
    try {
      // 每次 generate 恰好一次 HTTP；重试由网关另建 attempt 并预留风险。
      const response = await fetch(anthropicUrl(input.baseUrl, 'messages'), {
        method: 'POST',
        redirect: 'manual',
        signal: obs.controller.signal,
        headers: {
          ...anthropicHeaders(input.apiKey),
          Accept: 'text/event-stream',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      obs.headers(response);
      const read = await readLimited(response, obs);
      if (read === null)
        return {
          ok: false,
          category: 'provider_error',
          diagnostic: 'response_too_large',
          retryable: false,
        };
      const raw = read.raw;
      obs.diagnostic.stage = 'decode';
      if (!response.ok) {
        let error: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(raw) as { error?: Record<string, unknown> };
          error = parsed.error;
        } catch {
          /* 非 JSON 错误页：只看状态码 */
        }
        obs.error(error);
        return { ok: false, ...classifyAnthropicError(response.status, error) };
      }
      const parsed = read.stream ?? parseJson(raw);
      if (parsed.error) {
        obs.error(parsed.error);
        return { ok: false, ...classifyAnthropicError(0, parsed.error) };
      }
      if (parsed.malformed)
        return {
          ok: false,
          category: 'provider_error',
          diagnostic: 'response_parse_error',
          retryable: true,
        };
      if (read.stream && !parsed.done && !parsed.stopReason)
        return {
          ok: false,
          category: 'network_error',
          diagnostic: 'stream_incomplete',
          retryable: true,
        };
      obs.diagnostic.stage = 'complete';
      const rawText = parsed.text;
      if (!read.stream && (rawText.trim() || parsed.reasoning)) obs.progress();
      const usage = anthropicUsage(parsed.usage, inputEstimate, rawText);
      if (parsed.stopReason === 'refusal')
        return { ok: false, category: 'content_rejected', retryable: false, usage };
      const text = stripReasoning(rawText);
      if (!text) {
        obs.empty(rawText, parsed.reasoning === true || !!rawText.trim());
        if (parsed.stopReason === 'max_tokens' && parsed.reasoning)
          return {
            ok: false,
            category: 'truncated',
            truncation: 'reasoning',
            retryable: true,
            usage,
          };
        return { ok: false, category: 'empty_output', retryable: true, usage };
      }
      if (parsed.stopReason === 'max_tokens' && input.responseFormat !== 'json')
        return {
          ok: false,
          category: 'truncated',
          retryable: true,
          usage,
          partialText: rawText.trim() === text ? rawText : text,
        };
      if (parsed.stopReason === 'max_tokens' && input.responseFormat === 'json') {
        // 批 EJ：完整 JSON 之后只剩空白时按成功返回（同 OpenAI 兼容适配器）。
        const complete = completeJsonPrefix(stripJsonFence(text));
        if (complete !== null) return { ok: true, text: complete, usage };
        return {
          ok: false,
          category: 'truncated',
          retryable: true,
          usage,
          partialText: stripJsonFence(text),
        };
      }
      return {
        ok: true,
        text:
          input.responseFormat === 'json'
            ? stripJsonFence(text)
            : input.continuingText && rawText.trim() === text
              ? rawText
              : text,
        usage,
        ...(obs.diagnostic.firstProgressMs !== undefined
          ? { ttftMs: obs.diagnostic.firstProgressMs }
          : {}),
      };
    } catch {
      return { ok: false, category: 'network_error', diagnostic: obs.timeout, retryable: true };
    } finally {
      obs.close();
    }
  }
}

/** 读完响应（最多 2MB）；顺带记下第一段正文到达的时间（首字耗时）。 */
async function readLimited(
  response: Response,
  obs: ProviderObservation,
): Promise<{ raw: string; stream?: Parsed } | null> {
  if (!response.body) return { raw: '' };
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let isStream =
    response.ok && /text\/event-stream/i.test(response.headers.get('content-type') ?? '');
  let fragment = '',
    bytes = 0;
  const parsed: Parsed = { text: '', usage: {}, stopReason: null };
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        fragment += decoder.decode();
        if (isStream) readEvents(fragment.split('\n'), parsed, obs);
        break;
      }
      obs.data();
      bytes += part.value.length;
      fragment += decoder.decode(part.value, { stream: true });
      if (response.ok && !isStream && /^\s*(?:event:|data:|:)/.test(fragment)) isStream = true;
      if (isStream) {
        const lines = fragment.split('\n');
        fragment = lines.pop()!;
        readEvents(lines, parsed, obs);
      } else if (fragment.trimStart().startsWith('{')) obs.endProgress('non_streaming');
      if (
        bytes > (isStream ? 64_000_000 : MAX_RESPONSE_BYTES) ||
        fragment.length + parsed.text.length > MAX_RESPONSE_BYTES
      ) {
        await reader.cancel();
        return null;
      }
      if (parsed.done || parsed.error) {
        await reader.cancel();
        break;
      }
    }
    return { raw: fragment, ...(isStream ? { stream: parsed } : {}) };
  } finally {
    reader.releaseLock();
  }
}

interface Parsed {
  text: string;
  usage: Record<string, unknown>;
  stopReason: string | null;
  done?: boolean;
  reasoning?: boolean;
  malformed?: boolean;
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
      reasoning: content.some((b) => b.type === 'thinking'),
      malformed: !Array.isArray(message.content),
      text: content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join(''),
      usage: (message.usage as Record<string, unknown>) ?? {},
      stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
    };
  } catch {
    return { text: '', usage: {}, stopReason: null, malformed: true };
  }
}

/**
 * SSE：message_start（含输入用量）→ content_block_delta（text_delta 累积；thinking_delta 忽略）→
 * message_delta（stop_reason、输出用量）→ message_stop；error 事件按错误处理；ping 忽略。
 */
function readEvents(lines: string[], result: Parsed, obs?: ProviderObservation): void {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      result.done = true;
      obs?.endProgress('terminal_frame');
      break;
    }
    let event: Block;
    try {
      event = JSON.parse(data) as Block;
    } catch {
      result.malformed = true;
      continue;
    }
    if (!event || typeof event !== 'object') {
      result.malformed = true;
      continue;
    }
    const delta = event.delta as Block | undefined;
    switch (event.type) {
      case 'message_start':
        mergeUsage(result.usage, (event.message as Block | undefined)?.usage);
        break;
      case 'content_block_delta':
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          result.text += delta.text;
          if (delta.text.trim()) obs?.progress();
        }
        if (
          delta?.type === 'thinking_delta' &&
          typeof delta.thinking === 'string' &&
          delta.thinking.trim()
        ) {
          result.reasoning = true;
          obs?.progress();
        }
        break;
      case 'message_delta':
        if (typeof delta?.stop_reason === 'string') {
          result.stopReason = delta.stop_reason;
          obs?.endProgress('terminal_frame');
        }
        mergeUsage(result.usage, event.usage);
        break;
      case 'message_stop':
        result.done = true;
        obs?.endProgress('terminal_frame');
        break;
      case 'error':
        result.error = (event.error as Block) ?? { type: 'api_error' };
        obs?.endProgress('terminal_frame');
        break;
    }
    if (result.done || result.error) break;
  }
}
export function parseStream(raw: string): Parsed {
  if (!/^\s*data:/m.test(raw)) return parseJson(raw);
  const result: Parsed = { text: '', usage: {}, stopReason: null };
  readEvents(raw.split('\n'), result);
  return result;
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
