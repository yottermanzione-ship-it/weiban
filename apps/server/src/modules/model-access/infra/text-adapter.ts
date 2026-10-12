/** OpenAI 兼容文本协议；不记录响应原文、不跟随重定向、不持有密钥。 */
import type { GenerateTextInput } from '@weiban/contracts';

export interface TextUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimated: boolean;
}
export type TextResult =
  | { ok: true; text: string; usage: TextUsage }
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
    };
export interface AdapterMessage {
  role: GenerateTextInput['messages'][number]['role'];
  content: string;
  images?: string[];
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
    baseUrl: string;
    apiKey: string;
    model: string;
    /** T-071：images 为已读取的图片 data URL（网关经 MediaSystemPort 读取），按 OpenAI 多模态格式发送。 */
    messages: AdapterMessage[];
    maxOutputTokens: number;
    temperature?: number;
    responseFormat?: 'text' | 'json';
    idempotencyKey: string;
    timeoutMs: number;
    /** 思考开关：off = 按厂商发关闭思考的字段（默认）；default = 不发，用模型默认。 */
    thinking?: 'off' | 'default';
  }): Promise<TextResult>;
}

/**
 * 厂商思考开关的写法（docs/refactor/03 第 2.2 B 节）。按上游地址优先判断（同一模型在不同平台字段不同），
 * 判断不出时按模型名；都不认识就不发任何字段，避免别家报 400。
 */
export type ThinkingControl = 'deepseek' | 'qwen' | 'openrouter' | 'none';
export function thinkingControlFor(baseUrl: string, model: string): ThinkingControl {
  const url = baseUrl.toLowerCase();
  const id = model.toLowerCase();
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('deepseek.com')) return 'deepseek';
  if (url.includes('dashscope') || url.includes('aliyuncs.com')) return 'qwen';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (id.startsWith('qwen') || id.startsWith('qwq')) return 'qwen';
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

function usageOf(raw: unknown, input: string, output: string): TextUsage {
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
      };
    }
  }
  return {
    inputTokens: estimateTokens(input),
    cachedInputTokens: 0,
    outputTokens: estimateTokens(output),
    estimated: true,
  };
}

export class OpenAiTextAdapter implements TextAdapter {
  async generate(input: Parameters<TextAdapter['generate']>[0]): Promise<TextResult> {
    const extra =
      input.thinking === 'default'
        ? {}
        : thinkingOffFields(thinkingControlFor(input.baseUrl, input.model));
    const first = await this.once(input, extra);
    // 个别平台不认识关闭思考的字段会报 400：去掉字段再试一次。
    if (!first.ok && first.category === 'bad_request' && Object.keys(extra).length)
      return this.once(input, {});
    return first;
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
          max_tokens: input.maxOutputTokens,
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
          ...(payload.usage ? { usage: usageOf(payload.usage, '', '') } : {}),
        };
      if (response.status === 401 || response.status === 403)
        return { ok: false, category: 'invalid_key', retryable: false };
      if (response.status === 429) return { ok: false, category: 'rate_limited', retryable: true };
      if (response.status >= 500) return { ok: false, category: 'provider_error', retryable: true };
      if (!response.ok) return { ok: false, category: 'bad_request', retryable: false };
      const choice = (
        payload.choices as
          | { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[]
          | undefined
      )?.[0];
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal)
        return {
          ok: false,
          category: 'content_rejected',
          retryable: false,
          ...(payload.usage ? { usage: usageOf(payload.usage, '', '') } : {}),
        };
      const raw: unknown = choice?.message?.content;
      if (raw !== undefined && raw !== null && typeof raw !== 'string')
        return { ok: false, category: 'provider_error', retryable: true };
      const rawText = typeof raw === 'string' ? raw : '';
      const text = stripReasoning(rawText);
      const usage = usageOf(
        payload.usage,
        input.messages.map((m) => m.content).join('\n'),
        rawText,
      );
      // 空正文或 JSON 被截断：按失败处理（网关负责重试与降级），不能当成功静默返回。
      if (!text) return { ok: false, category: 'empty_output', retryable: true, usage };
      if (choice?.finish_reason === 'length' && input.responseFormat === 'json')
        return { ok: false, category: 'truncated', retryable: true, usage };
      return { ok: true, text, usage };
    } catch {
      return { ok: false, category: 'network_error', retryable: true };
    }
  }
}
