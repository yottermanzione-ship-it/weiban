/**
 * 文本协议适配器：OpenAI 兼容（本文件）与 Anthropic 原生 Messages（anthropic-adapter.ts，3.24），
 * RoutingTextAdapter 按上游账号的协议选用。不记录响应原文、不跟随重定向、不持有密钥。
 */
import type { GenerateTextInput, UsageQuantities } from '@weiban/contracts';

export interface TextUsage {
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
  | { ok: true; text: string; usage: TextUsage; ttftMs?: number }
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
        /** 要求 JSON 却因输出额度用完被截断。 */
        | 'truncated';
      retryable: boolean;
      usage?: TextUsage;
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
    timeoutMs: number;
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
 * 判断不出时按模型名；都不认识就不发任何字段，避免别家报 400。
 */
export type ThinkingControl = 'deepseek' | 'qwen' | 'openrouter' | 'reasoning_none' | 'none';
export function thinkingControlFor(baseUrl: string, model: string): ThinkingControl {
  const url = baseUrl.toLowerCase();
  const id = model.toLowerCase();
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('deepseek.com')) return 'deepseek';
  if (url.includes('dashscope') || url.includes('aliyuncs.com')) return 'qwen';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (id.startsWith('qwen') || id.startsWith('qwq')) return 'qwen';
  // 2026-10-29 关思考：GPT 5.6 系列与 Abliteration 基础款/大闪款厂商均接受 reasoning_effort none；
  // Abliteration large-v2 除外（它会把 none 映射为低档隐藏思考，不是真正关掉），故排除。
  if (/^gpt-5\.6(-|$)/.test(id)) return 'reasoning_none';
  if (id.startsWith('abliterated-model') && !id.includes('large-v2')) return 'reasoning_none';
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
/**
 * 剥掉混进正文的思考内容（旧版 reply_content.js 的做法）：成对的 <think>…</think>、
 * 只有结束标记时去掉它之前的全部内容、结尾未闭合的开始标记、开头的「思考过程：」段。
 */
export function stripReasoning(text: string): string {
  let out = text.replace(new RegExp(`<(${REASONING_TAGS})>[\\s\\S]*?</\\1>`, 'gi'), '');
  const close = new RegExp(`</(?:${REASONING_TAGS})>`, 'i').exec(out);
  if (close) out = out.slice(close.index + close[0].length);
  out = out.replace(new RegExp(`<(?:${REASONING_TAGS})>[\\s\\S]*$`, 'i'), '');
  out = out.replace(
    /^\s*(?:思考过程|推理过程|内心思考|thinking(?: process)?|reasoning)\s*[:：][\s\S]*?\n\s*\n/i,
    '',
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

function usageOf(raw: unknown, inputEstimate: number, output: string): TextUsage {
  const object = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const details = object.prompt_tokens_details as Record<string, unknown> | undefined;
  const numberOrNull = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const reported = {
    promptTokens: numberOrNull(object.prompt_tokens),
    cachedTokens: numberOrNull(object.prompt_cache_hit_tokens ?? details?.cached_tokens),
    completionTokens: numberOrNull(object.completion_tokens),
  };
  if (raw && typeof raw === 'object') {
    const u = raw as Record<string, unknown>;
    const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
    const cached = u.prompt_cache_hit_tokens ?? details?.cached_tokens ?? 0;
    const totalInput = u.prompt_tokens;
    const out = u.completion_tokens;
    if (
      [totalInput, cached, out].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) &&
      Number(cached) <= Number(totalInput)
    ) {
      return {
        inputTokens: Number(totalInput) - Number(cached),
        cachedInputTokens: Number(cached),
        outputTokens: Number(out),
        estimated: false,
        reported,
      };
    }
  }
  return {
    inputTokens: Math.max(1, inputEstimate),
    cachedInputTokens: 0,
    outputTokens: estimateTokens(output),
    estimated: true,
    reported,
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
    const extra =
      input.thinking === 'default'
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
    try {
      const response = await fetch(`${input.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(input.timeoutMs),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          model: input.model,
          messages: wireMessages(input.messages),
          stream: false,
          [input.outputParameter ?? 'max_tokens']: input.maxOutputTokens,
          temperature: input.temperature,
          ...extra,
          ...(input.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      // 限制响应大小，避免异常供应商占满服务器内存；只提取结构化字段，不向外传播正文。
      if (!response.body) return { ok: false, category: 'provider_error', retryable: true };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 2_000_000) {
            await reader.cancel();
            return { ok: false, category: 'provider_error', retryable: false };
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        if (response.ok) return { ok: false, category: 'provider_error', retryable: true };
      }
      const error = payload?.error as { code?: unknown } | undefined;
      const code = typeof error?.code === 'string' ? error.code : '';
      if (
        ['insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(code) ||
        response.status === 402
      )
        return { ok: false, category: 'quota_exhausted', retryable: false };
      if (['content_filter', 'content_policy_violation', 'moderation_blocked'].includes(code))
        return {
          ok: false,
          category: 'content_rejected',
          retryable: false,
          ...(payload.usage
            ? { usage: usageOf(payload.usage, estimateInputTokens(input.messages), '') }
            : {}),
        };
      if (response.status === 401 || response.status === 403)
        return { ok: false, category: 'invalid_key', retryable: false };
      if (response.status === 429) return { ok: false, category: 'rate_limited', retryable: true };
      if (response.status >= 500) return { ok: false, category: 'provider_error', retryable: true };
      if (!response.ok) return { ok: false, category: 'bad_request', retryable: false };
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
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal)
        return {
          ok: false,
          category: 'content_rejected',
          retryable: false,
          ...(payload.usage
            ? { usage: usageOf(payload.usage, estimateInputTokens(input.messages), '') }
            : {}),
        };
      const raw: unknown = choice?.message?.content;
      if (raw !== undefined && raw !== null && typeof raw !== 'string')
        return { ok: false, category: 'provider_error', retryable: true };
      const rawText = typeof raw === 'string' ? raw : '';
      const text = stripReasoning(rawText);
      const baseUsage = usageOf(payload.usage, estimateInputTokens(input.messages), rawText);
      // 批 EJ：思考 token 单独计量（计费仍按总输出）。
      const reasoningTokens = reasoningTokensOf(
        payload.usage,
        choice?.message?.reasoning_content ?? choice?.message?.reasoning,
      );
      const usage: TextUsage =
        reasoningTokens === undefined ? baseUsage : { ...baseUsage, reasoningTokens };
      // 空正文：按失败处理（网关负责重试与降级），不能当成功静默返回。
      if (!text) return { ok: false, category: 'empty_output', retryable: true, usage };
      if (input.responseFormat === 'json') {
        // 批 EJ：截断只看正文——正文已是完整 JSON（后面只剩空白）就算成功，不看总 token 是否顶格。
        const complete = completeJsonPrefix(text);
        if (complete !== null) return { ok: true, text: complete, usage };
        if (choice?.finish_reason === 'length')
          return {
            ok: false,
            category: 'truncated',
            retryable: true,
            usage,
            truncation: truncationKind(rawText, payload.usage, choice?.message),
            partialText: text,
          };
      }
      return { ok: true, text, usage };
    } catch {
      return { ok: false, category: 'network_error', retryable: true };
    }
  }
}
