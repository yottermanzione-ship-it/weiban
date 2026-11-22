/**
 * 文本协议适配器：OpenAI 兼容（本文件）与 Anthropic 原生 Messages（anthropic-adapter.ts，3.24），
 * RoutingTextAdapter 按上游账号的协议选用。不记录响应原文、不跟随重定向、不持有密钥。
 */
import { ProviderObservation, type ProviderDiagnostic } from './provider-observation.js';
import { openAiCacheUsage, type CacheUsageDiagnostic } from './cache-usage.js';
import { Logger } from '@nestjs/common';
import type { GenerateTextInput, UsageQuantities } from '@weiban/contracts';

const NETWORK_LOG = new Logger('TextAdapter');

export interface TextUsage {
  /** Independent of billing's estimated flag; persisted in the existing attempt JSON. */
  cacheUsage?: CacheUsageDiagnostic;
  reported?: {
    promptTokens: number | null;
    cachedTokens: number | null;
    completionTokens: number | null;
    /** 3.24：上游报告的缓存写入 token（Anthropic cache_creation_input_tokens）。 */
    cacheWriteTokens?: number | null;
  };
  /** 未命中缓存、也不是缓存写入的输入 token。 */
  inputTokens: number;
  /** 命中缓存（缓存读取）的输入 token。 */
  cachedInputTokens: number;
  /** 3.24：缓存写入的输入 token（5 分钟 / 1 小时两档；只有 Anthropic 原生协议报告）。 */
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  outputTokens: number;
  /**
   * 批 EJ：outputTokens 中的思考 token（上游 completion_tokens_details.reasoning_tokens；没报时按思考内容长度估算）。
   * 只用于分开计量与诊断，计费仍按 outputTokens 全额（思考照常由付费方承担）。undefined = 未知 / 没有思考。
   */
  reasoningTokens?: number;
  estimated: boolean;
}

/**
 * 上游安全策略拦截（服务商自己的内容审核）的错误码与错误类型。**全项目只在这里定义**：
 * OpenAI 兼容适配器（本文件，非流式）、Anthropic 原生适配器（流式 SSE 的 error 事件与 HTTP 错误体）、
 * 媒体适配器都用 {@link isSafetyPolicyBlock} 判断。命中即归为 `content_rejected`，不管 HTTP 是 400、401 还是 403：
 * 这是服务商拒绝了这条内容，不是密钥失效，不能把上游标成不可用、也不进冷却。
 * 2026-11-03（T-20261103j）：Abliteration 对某条消息回 403
 * `{"error":{"code":"policy_violation","type":"policy_error"}}`，原先落到 401/403 → invalid_key，整个上游被标不可用。
 */
export const SAFETY_POLICY_CODES: readonly string[] = [
  'content_filter',
  'content_policy_violation',
  'moderation_blocked',
  'policy_violation',
];
export const SAFETY_POLICY_TYPES: readonly string[] = ['policy_error'];

/** 上游错误体（`error` 对象）是否为安全策略拦截：`code` 或 `type` 在上面的名单里（不区分大小写）。 */
export function isSafetyPolicyBlock(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  return (
    (typeof code === 'string' && SAFETY_POLICY_CODES.includes(code.toLowerCase())) ||
    (typeof type === 'string' && SAFETY_POLICY_TYPES.includes(type.toLowerCase()))
  );
}

/** 3.24：网关交给计费的用量（只取计价字段，去掉 estimated / reported 等说明字段）。 */
export function billableUsage(usage: TextUsage): UsageQuantities {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheWrite5mTokens ? { cacheWrite5mTokens: usage.cacheWrite5mTokens } : {}),
    ...(usage.cacheWrite1hTokens ? { cacheWrite1hTokens: usage.cacheWrite1hTokens } : {}),
  };
}

/** 3.24：上游协议（文本）。 */
export type TextProtocol = 'openai_compatible' | 'anthropic';
export function textProtocolOf(kind: string | null | undefined): TextProtocol {
  return kind === 'anthropic' ? 'anthropic' : 'openai_compatible';
}

export type TextResult =
  | { ok: true; text: string; usage: TextUsage; ttftMs?: number; finishReason?: string }
  | {
      ok: false;
      category:
        | 'network_error'
        | 'provider_error'
        | 'rate_limited'
        | 'invalid_key'
        | 'quota_exhausted'
        | 'content_rejected'
        | 'bad_request'
        /** 正文为空（常见原因：推理模型的思考吃光了输出额度）。 */
        | 'empty_output'
        /** 输出额度用完，JSON 未完成或文本生成消耗了思考 token。 */
        | 'truncated';
      retryable: boolean;
      diagnostic?:
        | 'timeout_idle'
        | 'timeout_progress'
        | 'timeout_deadline'
        | 'stream_incomplete'
        | 'response_parse_error'
        | 'response_too_large'
        | 'permission_denied'
        | 'auth_check_unavailable'
        | 'permission_unconfirmed';
      usage?: TextUsage;
      finishReason?: string;
      /**
       * 批 EJ：截断原因（只做诊断，写进用量记录的 errorCode，不含正文）：
       * reasoning = 上游报告了思考 token / 返回了思考内容（思考吃掉输出额度）；
       * whitespace = 正文结尾是大段空白（JSON 模式空白刷屏）；repeat = 正文后半段高度重复（输出跑飞）。
       */
      truncation?: 'reasoning' | 'whitespace' | 'repeat';
      /** 批 EJ：JSON 正文没写完时已写出的部分（不落日志；只在调用方要求抢救时由网关交回）。 */
      partialText?: string;
    };
export interface AdapterMessage {
  role: GenerateTextInput['messages'][number]['role'];
  content: string;
  images?: string[];
  /**
   * 3.24：缓存断点。网关按 09 号 §6 的「稳定开头」标出（开头系统消息、稳定开头的最后一条消息）；
   * Anthropic 协议在这里打 cache_control，OpenAI 兼容协议忽略（上游自动前缀缓存）。
   */
  cacheBreakpoint?: boolean;
}

function wireMessages(messages: AdapterMessage[]): unknown[] {
  return messages.map((m) =>
    m.images?.length
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.images.map((u) => ({ type: 'image_url', image_url: { url: u } })),
          ],
        }
      : { role: m.role, content: m.content },
  );
}

export interface TextAdapter {
  generate(input: {
    /** 3.24：上游协议；不传 = OpenAI 兼容。 */
    protocol?: TextProtocol;
    continuingText?: boolean;
    onDiagnostic?: (value: ProviderDiagnostic) => void;
    /** Observes the final JSON once fetch has started. Authorization headers are excluded. */
    onRequestDispatched?: (value: {
      protocol: 'openai' | 'anthropic';
      body: Readonly<Record<string, unknown>>;
    }) => void;
    baseUrl: string;
    apiKey: string;
    model: string;
    /** T-071：images 为已读取的图片 data URL（网关经 MediaSystemPort 读取），按 OpenAI 多模态格式发送。 */
    messages: AdapterMessage[];
    maxOutputTokens: number;
    outputParameter?: 'max_tokens' | 'max_completion_tokens';
    temperature?: number;
    responseFormat?: 'text' | 'json';
    idempotencyKey: string;
    /** 私密会话的缓存路由标识，仅由已确认支持的直连适配器发送。 */
    promptCacheKey?: string;
    timeoutMs: number;
    /** 流式读取的总时限；timeoutMs 仍用于检测无数据的间隔。 */
    deadlineMs?: number;
    /** 有可用备用线路时，限制流式请求连续没有正文或思考进度的时间。 */
    failover?: { progressTimeoutMs: number; backupAvailable: () => boolean };
    /**
     * 思考开关：off = 按厂商发关闭思考的字段（默认）；default = 不发，用模型默认；
     * on = 批 EJ 后台任务保留思考，并按 thinkingBudget 单独给思考预算（maxOutputTokens 已是正文 + 思考的总额）。
     */
    thinking?: 'off' | 'default' | 'on';
    /** thinking = on 时的思考预算（token）；支持原生预算参数的上游照发，不支持的只靠放大总上限。 */
    thinkingBudget?: number;
  }): Promise<TextResult>;
}

/**
 * 厂商思考开关的写法（docs/refactor/03 第 2.2 B 节）。按上游地址优先判断（同一模型在不同平台字段不同），
 * 再按模型名限定支持项；判断不出时不发任何字段，避免别家报 400。
 */
export type ThinkingControl = 'deepseek' | 'qwen' | 'openrouter' | 'reasoning_none' | 'none';
export function thinkingControlFor(baseUrl: string, model: string): ThinkingControl {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'none';
  }
  const id = model.toLowerCase();
  if (host === 'openrouter.ai') return 'openrouter';
  if (host === 'api.deepseek.com') return 'deepseek';
  if (/^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(host) && /^(?:qwen|qwq)/.test(id))
    return 'qwen';
  // 只对确认支持的官方域名发“关思考”字段；中转站/兼容站不猜，避免不支持却硬发 400。
  if (host === 'api.openai.com' && /^gpt-5\.6(-|$)/.test(id)) return 'reasoning_none';
  if (
    host === 'api.abliteration.ai' &&
    id.startsWith('abliterated-model') &&
    !id.includes('large-v2')
  )
    return 'reasoning_none';
  return 'none';
}
export function thinkingOffFields(control: ThinkingControl): Record<string, unknown> {
  switch (control) {
    case 'deepseek':
      return { thinking: { type: 'disabled' } };
    case 'qwen':
      return { enable_thinking: false };
    case 'openrouter':
      return { reasoning: { enabled: false } };
    case 'reasoning_none':
      return { reasoning_effort: 'none' };
    default:
      return {};
  }
}

/**
 * 批 EJ：要求 JSON 却因额度截断时，若正文开头已是一个完整的 JSON 对象、后面只剩空白，返回该对象文本；否则 null。
 * 只做括号与字符串配对扫描，不记录、不外传正文。
 */
export function completeJsonPrefix(text: string): string | null {
  const start = text.search(/\S/);
  if (start < 0 || text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        if (text.slice(i + 1).trim()) return null;
        const candidate = text.slice(start, i + 1);
        try {
          const parsed: unknown = JSON.parse(candidate);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? candidate : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 批 EJ：截断诊断（只看长度与结构特征，不保存正文）。 */
export function truncationKind(
  rawText: string,
  rawUsage: unknown,
  message?: unknown,
): 'reasoning' | 'whitespace' | 'repeat' | undefined {
  const usage =
    rawUsage && typeof rawUsage === 'object' ? (rawUsage as Record<string, unknown>) : {};
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = details?.reasoning_tokens;
  const m = message && typeof message === 'object' ? (message as Record<string, unknown>) : {};
  const reasoningText = m.reasoning_content ?? m.reasoning;
  if (
    (typeof reasoningTokens === 'number' && reasoningTokens > 0) ||
    (typeof reasoningText === 'string' && reasoningText.length > 0) ||
    new RegExp(`<(?:${REASONING_TAGS})>`, 'i').test(rawText)
  )
    return 'reasoning';
  const tail = rawText.slice(-400);
  if (tail.length >= 200 && !tail.trim()) return 'whitespace';
  if (rawText.length >= 400) {
    const last = rawText.slice(-120);
    const before = rawText.slice(0, -120);
    if (last.trim().length >= 40 && before.includes(last.slice(0, 60))) return 'repeat';
  }
  return undefined;
}

/**
 * 批 EJ：保留思考时的厂商字段。有原生预算参数的照发（Qwen thinking_budget、OpenRouter reasoning.max_tokens）；
 * DeepSeek 与认不出的中转没有预算参数：不发任何字段（不再关思考），只靠网关放大总输出上限。
 * Anthropic 原生协议在 anthropic-adapter.ts 用 thinking.budget_tokens。
 */
export function thinkingOnFields(
  control: ThinkingControl,
  budget: number,
): Record<string, unknown> {
  const tokens = Math.max(1, Math.round(budget));
  switch (control) {
    case 'qwen':
      return { enable_thinking: true, thinking_budget: tokens };
    case 'openrouter':
      return { reasoning: { max_tokens: tokens } };
    default:
      return {};
  }
}

const REASONING_TAGS = 'think|thinking|reasoning';
/** 去掉开头一行思考标题；有明确的空行分隔才把空行前全当思考，没有空行只删标题，不能把后文一起吃掉。 */
function stripLeadingReasoningLabel(text: string, label: RegExp): string {
  const match = label.exec(text);
  if (!match) return text;
  const rest = text.slice(match[0].length);
  const blank = /\r?\n[ \t]*\r?\n/.exec(rest);
  if (blank) return rest.slice(blank.index + blank[0].length).trim();
  return rest.trim();
}
/**
 * 剥掉混进正文的思考内容（旧版 reply_content.js 的做法）：成对的 <think>…</think>、
 * 只有结束标记时去掉它之前的全部内容、结尾未闭合的开始标记、开头明确标出的思考段。
 */
export function stripReasoning(text: string): string {
  let out = text.replace(new RegExp(`<(${REASONING_TAGS})>[\\s\\S]*?</\\1>`, 'gi'), '');
  const close = new RegExp(`</(?:${REASONING_TAGS})>`, 'i').exec(out);
  if (close) out = out.slice(close.index + close[0].length);
  out = out.replace(new RegExp(`<(?:${REASONING_TAGS})>[\\s\\S]*$`, 'i'), '');
  out = stripLeadingReasoningLabel(
    out,
    /^\s*(?:思考过程|推理过程|内心思考)\s*[:：][ \t]*(?:\r?\n)?/,
  );
  out = stripLeadingReasoningLabel(
    out,
    /^\s*(?:thinking(?: process)?|reasoning)\s*[:：][ \t]*(?:\r?\n)?/i,
  );
  return out.trim();
}

/** runtime-overview 2.5：中文字符×0.7，英文单词×1.3；符号计入保守的额外项。 */
export function estimateTokens(text: string): number {
  const chinese = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words =
    text
      .replace(/\p{Script=Han}/gu, ' ')
      .match(/[\p{L}\p{N}_]+/gu)
      ?.filter((v) => !/\p{Script=Han}/u.test(v)).length ?? 0;
  const other = text.replace(/\p{Script=Han}|[\p{L}\p{N}_\s]/gu, '').length;
  return Math.max(1, Math.ceil(chinese * 0.7 + words * 1.3 + other / 4));
}

/** 3.26（G3-2）：估算时每张图片按 1000 token、每条消息额外 4 token（角色、分隔符）计，宁多勿少。 */
export const ESTIMATED_IMAGE_TOKENS = 1000;
const ESTIMATED_MESSAGE_OVERHEAD = 4;

/** 3.26：上游没报用量时，按本地分词规则估算这次请求的输入 token（文字 + 图片 + 每条消息开销）。 */
export function estimateInputTokens(
  messages: ReadonlyArray<{ content: string; images?: readonly string[] }>,
): number {
  return messages.reduce(
    (sum, m) =>
      sum +
      estimateTokens(m.content) +
      ESTIMATED_MESSAGE_OVERHEAD +
      (m.images?.length ?? 0) * ESTIMATED_IMAGE_TOKENS,
    0,
  );
}

/** 批 EJ：上游报告的思考 token；没报时按返回的思考内容估算；都没有返回 undefined。 */
export function reasoningTokensOf(raw: unknown, reasoningText?: unknown): number | undefined {
  const object = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const details = object.completion_tokens_details as Record<string, unknown> | undefined;
  const reported = details?.reasoning_tokens;
  if (typeof reported === 'number' && Number.isSafeInteger(reported) && reported >= 0)
    return reported;
  if (typeof reasoningText === 'string' && reasoningText.length)
    return estimateTokens(reasoningText);
  return undefined;
}

/** 把 OpenAI 兼容 SSE 的 data 帧压成最终 message；只保留正文/思考/结束原因/usage。 */
interface OpenAiStream {
  content: string;
  reasoning: string;
  done: boolean;
  refusal: boolean;
  malformed: boolean;
  finishReason?: string;
  error?: unknown;
  usage?: unknown;
}

function readOpenAiFrames(lines: string[], stream: OpenAiStream): boolean {
  let progress = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') {
      stream.done = true;
      break;
    }
    if (!data) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      stream.malformed = true;
      continue;
    }
    if (!event || typeof event !== 'object') {
      stream.malformed = true;
      continue;
    }
    if (event.error) stream.error = event.error;
    if (event.usage && typeof event.usage === 'object' && Object.keys(event.usage).length)
      stream.usage = event.usage;
    if (!Array.isArray(event.choices)) continue;
    const choice = event.choices[0] as Record<string, unknown> | undefined;
    const delta = (choice?.delta ?? choice?.message) as Record<string, unknown> | undefined;
    if (typeof delta?.content === 'string') {
      stream.content += delta.content;
      if (/\S/u.test(delta.content)) progress = true;
    }
    if (delta?.content != null && typeof delta.content !== 'string') stream.malformed = true;
    const think = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof think === 'string') {
      stream.reasoning += think;
      if (/\S/u.test(think)) progress = true;
    }
    if (delta?.refusal) stream.refusal = true;
    if (typeof choice?.finish_reason === 'string') stream.finishReason = choice.finish_reason;
  }
  return progress;
}

function usageOf(
  raw: unknown,
  messages: AdapterMessage[],
  output: string,
  reasoningText?: unknown,
): TextUsage {
  const object = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const details = object.prompt_tokens_details as Record<string, unknown> | undefined;
  const numberOrNull = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const cache = object.prompt_cache_hit_tokens ?? details?.cached_tokens;
  const reported = {
    promptTokens: numberOrNull(object.prompt_tokens),
    cachedTokens: numberOrNull(cache),
    completionTokens: numberOrNull(object.completion_tokens),
  };
  const totalInput = reported.promptTokens ?? Math.max(1, estimateInputTokens(messages));
  const cacheValid =
    cache == null || (reported.cachedTokens !== null && reported.cachedTokens <= totalInput);
  const cachedInputTokens = cacheValid ? (reported.cachedTokens ?? 0) : 0;
  const reasoningTokens = reasoningTokensOf(raw, reasoningText);
  const outputTokens =
    reported.completionTokens ?? (output ? estimateTokens(output) : 0) + (reasoningTokens ?? 0);
  return {
    inputTokens: totalInput - cachedInputTokens,
    cachedInputTokens,
    outputTokens,
    ...(reasoningTokens === undefined
      ? {}
      : { reasoningTokens: Math.min(reasoningTokens, outputTokens) }),
    estimated: reported.promptTokens === null || reported.completionTokens === null || !cacheValid,
    reported,
    cacheUsage: openAiCacheUsage(raw),
  };
}

/** 3.24：按上游账号的协议选择适配器（TEXT_ADAPTER 的默认实现）。 */
export class RoutingTextAdapter implements TextAdapter {
  constructor(
    private readonly openai: TextAdapter,
    private readonly anthropic: TextAdapter,
  ) {}
  generate(input: Parameters<TextAdapter['generate']>[0]): Promise<TextResult> {
    return input.protocol === 'anthropic'
      ? this.anthropic.generate(input)
      : this.openai.generate(input);
  }
}

export class OpenAiTextAdapter implements TextAdapter {
  async generate(input: Parameters<TextAdapter['generate']>[0]): Promise<TextResult> {
    const control = thinkingControlFor(input.baseUrl, input.model);
    // DeepSeek 不发送 thinking/关思考字段：中转站和官方都没有这个标准参数，直接让它按默认思考跑。
    const extra =
      control === 'deepseek'
        ? {}
        : input.thinking === 'default'
          ? {}
          : input.thinking === 'on'
            ? thinkingOnFields(control, input.thinkingBudget ?? 0)
            : thinkingOffFields(control);
    // 每次generate恰好一次HTTP；所有重试必须由网关另建attempt并预留风险。
    return this.once(input, extra);
  }
  private async once(
    input: Parameters<TextAdapter['generate']>[0],
    extra: Record<string, unknown>,
  ): Promise<TextResult> {
    const officialAbliteration = /^https:\/\/api\.abliteration\.ai\/v1\/*$/i.test(input.baseUrl);
    const stream = !officialAbliteration;
    const obs = new ProviderObservation(input, stream);
    try {
      const officialOpenAi = new URL(input.baseUrl).origin === 'https://api.openai.com';
      const body = {
        model: input.model,
        messages: wireMessages(input.messages),
        stream,
        ...(officialOpenAi ? { stream_options: { include_usage: true } } : {}),
        [input.outputParameter ?? 'max_tokens']: input.maxOutputTokens,
        temperature: input.temperature,
        // Abliteration 官方直连接受该提示，其他兼容地址不透传。
        ...(input.promptCacheKey && officialAbliteration
          ? { prompt_cache_key: input.promptCacheKey }
          : {}),
        ...extra,
        ...(input.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };
      const requestBody = JSON.stringify(body);
      const pendingResponse = fetch(`${input.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'manual',
        signal: obs.controller.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: requestBody,
      });
      try {
        if (!obs.controller.signal.aborted)
          input.onRequestDispatched?.({ protocol: 'openai', body: JSON.parse(requestBody) });
      } catch {
        // Observability cannot change or interrupt a provider request.
      }
      const response = await pendingResponse;
      // 限制响应大小，避免异常供应商占满服务器内存；只提取结构化字段，不向外传播正文。
      obs.headers(response);
      if (!response.body) return { ok: false, category: 'provider_error', retryable: true };
      let eventStream = /text\/event-stream/i.test(response.headers.get('content-type') ?? '');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const streamed: OpenAiStream = {
        content: '',
        reasoning: '',
        done: false,
        refusal: false,
        malformed: false,
      };
      let rawBody = '';
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) {
            rawBody += decoder.decode();
            if (eventStream) readOpenAiFrames(rawBody.split(/\r?\n/), streamed);
            break;
          }
          obs.data();
          bytes += part.value.length;
          rawBody += decoder.decode(part.value, { stream: true });
          if (!eventStream && /^\s*(?:data:|:)/.test(rawBody)) eventStream = true;
          if (eventStream) {
            const lines = rawBody.split('\n');
            rawBody = lines.pop()!;
            const progress = readOpenAiFrames(lines, streamed);
            if (response.ok && progress) obs.progress();
            if (streamed.done || streamed.finishReason || streamed.refusal || streamed.error) {
              // 已收到终止状态：照原流程读取末帧用量，不能因等回执再次发送。
              obs.endProgress('terminal_frame');
            }
          } else if (rawBody.trimStart().startsWith('{')) {
            // 部分兼容服务虽然请求了流式，实际返回单个 JSON 文档。正文传输沿用原空闲策略。
            obs.endProgress('non_streaming');
          }
          // SSE 的事件信封可能远大于实质文本。逐帧丢弃信封，对实质文本、未完成单帧及传输总量分别设保护。
          if (
            bytes > (eventStream ? 64_000_000 : 2_000_000) ||
            rawBody.length + streamed.content.length + streamed.reasoning.length > 2_000_000
          ) {
            await reader.cancel();
            return {
              ok: false,
              category: 'provider_error',
              diagnostic: 'response_too_large',
              retryable: false,
            };
          }
          if (streamed.done) {
            await reader.cancel();
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
      obs.diagnostic.stage = 'decode';
      let payload: Record<string, unknown> = {};
      if (eventStream) {
        if (response.ok && !streamed.refusal && !streamed.error && streamed.malformed)
          return {
            ok: false,
            category: 'provider_error',
            diagnostic: 'response_parse_error',
            retryable: true,
          };
        if (
          response.ok &&
          !streamed.done &&
          !streamed.finishReason &&
          !streamed.error &&
          !streamed.refusal
        )
          return {
            ok: false,
            category: 'network_error',
            diagnostic: 'stream_incomplete',
            retryable: true,
            usage: usageOf(streamed.usage, input.messages, streamed.content, streamed.reasoning),
          };
        payload = {
          choices: [
            {
              message: {
                ...(streamed.content ? { content: streamed.content } : {}),
                ...(streamed.reasoning ? { reasoning_content: streamed.reasoning } : {}),
                ...(streamed.refusal ? { refusal: true } : {}),
              },
              ...(streamed.finishReason ? { finish_reason: streamed.finishReason } : {}),
            },
          ],
          ...(streamed.usage ? { usage: streamed.usage } : {}),
          ...(streamed.error ? { error: streamed.error } : {}),
        };
      } else {
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          if (response.ok)
            return {
              ok: false,
              category: 'provider_error',
              diagnostic: 'response_parse_error',
              retryable: true,
            };
        }
      }
      const error = payload?.error as { code?: unknown; type?: unknown } | undefined;
      obs.error(error);
      const code = typeof error?.code === 'string' ? error.code : '';
      if (
        ['insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(code) ||
        response.status === 402
      )
        return { ok: false, category: 'quota_exhausted', retryable: false };
      // 安全策略拦截先于 401/403 判断：服务商拒绝内容 ≠ 密钥失效（T-20261103j）。
      if (isSafetyPolicyBlock(error))
        return {
          ok: false,
          category: 'content_rejected',
          retryable: false,
          ...(payload.usage ? { usage: usageOf(payload.usage, input.messages, '') } : {}),
        };
      const safeCode = obs.diagnostic.providerCode ?? '';
      if (
        response.status === 401 ||
        response.status === 403 ||
        [
          'authentication_error',
          'invalid_api_key',
          'permission_error',
          'model_access_denied',
          'permission_denied',
        ].includes(safeCode)
      )
        return { ok: false, category: 'invalid_key', retryable: false };
      if (
        response.status === 429 ||
        ['rate_limit_error', 'rate_limit_exceeded', 'too_many_requests', 'rate_limited'].includes(
          safeCode,
        )
      )
        return { ok: false, category: 'rate_limited', retryable: true };
      if (
        error &&
        [
          'invalid_parameter',
          'unsupported_parameter',
          'unsupported_value',
          'invalid_request_error',
          'invalid_model',
          'model_not_found',
        ].includes(safeCode)
      )
        return { ok: false, category: 'bad_request', retryable: false };
      if (response.status >= 500) return { ok: false, category: 'provider_error', retryable: true };
      if (!response.ok) return { ok: false, category: 'bad_request', retryable: false };
      if (error)
        return {
          ok: false,
          category: 'provider_error',
          retryable: true,
          ...(payload.usage ? { usage: usageOf(payload.usage, input.messages, '') } : {}),
        };
      if (!payload || typeof payload !== 'object')
        return {
          ok: false,
          category: 'provider_error',
          diagnostic: 'response_parse_error',
          retryable: true,
        };
      const choice = (
        payload.choices as
          | {
              message?: {
                content?: unknown;
                refusal?: unknown;
                reasoning_content?: unknown;
                reasoning?: unknown;
              };
              finish_reason?: string;
            }[]
          | undefined
      )?.[0];
      if (!choice?.message)
        return {
          ok: false,
          category: 'provider_error',
          diagnostic: 'response_parse_error',
          retryable: true,
        };
      const finishReason = choice.finish_reason;
      const finish = typeof finishReason === 'string' ? { finishReason } : {};
      if (finishReason === 'content_filter' || choice?.message?.refusal)
        return {
          ok: false,
          category: 'content_rejected',
          retryable: false,
          ...finish,
          ...(payload.usage ? { usage: usageOf(payload.usage, input.messages, '') } : {}),
        };
      const raw: unknown = choice?.message?.content;
      if (raw !== undefined && raw !== null && typeof raw !== 'string')
        return { ok: false, category: 'provider_error', retryable: true };
      const rawText = typeof raw === 'string' ? raw : '';
      const text = stripReasoning(rawText);
      const reasoningText = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
      const usage = usageOf(
        payload.usage,
        input.messages,
        reasoningText ? text : rawText,
        reasoningText,
      );
      if (!eventStream && (text || reasoningText)) obs.progress();
      if (!text) obs.empty(rawText, !!reasoningText || Boolean(rawText.trim() && !text));
      obs.diagnostic.stage = 'complete';
      if (!text)
        NETWORK_LOG.warn({
          code: 'text_empty_output',
          model: input.model,
          finishReason,
          rawLen: rawText.length,
          strippedLen: text.length,
          startsThinkTag: /^\s*<(?:think|thinking|reasoning)>/i.test(rawText),
          hasCloseThinkTag: /<\/(?:think|thinking|reasoning)>/i.test(rawText),
          startsThinkingLabel:
            /^\s*(?:thinking(?: process)?|reasoning|思考过程|推理过程|内心思考)\s*[:：]/i.test(
              rawText,
            ),
          reasoningLen: typeof reasoningText === 'string' ? reasoningText.length : null,
        });
      if (
        (!text || input.responseFormat !== 'json') &&
        finishReason === 'length' &&
        (usage.reasoningTokens ?? 0) > 0
      )
        return {
          ok: false,
          category: 'truncated',
          retryable: true,
          usage,
          truncation: 'reasoning',
          ...finish,
        };
      // 空正文：按失败处理（网关负责重试与降级），不能当成功静默返回。
      if (!text) return { ok: false, category: 'empty_output', retryable: true, usage, ...finish };
      if (input.responseFormat !== 'json' && finishReason === 'length')
        return {
          ok: false,
          category: 'truncated',
          retryable: true,
          usage,
          partialText: rawText.trim() === text ? rawText : text,
          ...finish,
        };
      if (input.responseFormat === 'json') {
        // 批 EJ：截断只看正文——正文已是完整 JSON（后面只剩空白）就算成功，不看总 token 是否顶格。
        const complete = completeJsonPrefix(text);
        if (complete !== null) return { ok: true, text: complete, usage, ...finish };
        if (finishReason === 'length')
          return {
            ok: false,
            category: 'truncated',
            retryable: true,
            usage,
            ...finish,
            truncation: truncationKind(rawText, payload.usage, choice?.message),
            partialText: text,
          };
      }
      return {
        ok: true,
        text: input.continuingText && rawText.trim() === text ? rawText : text,
        usage,
        ...finish,
      };
    } catch (error) {
      NETWORK_LOG.warn({
        code: 'text_network_error',
        model: input.model,
        stage: obs.diagnostic.stage,
        detail: obs.timeout ?? (error instanceof TypeError ? 'transport_error' : 'request_failed'),
      });
      return { ok: false, category: 'network_error', diagnostic: obs.timeout, retryable: true };
    } finally {
      obs.close();
    }
  }
}
