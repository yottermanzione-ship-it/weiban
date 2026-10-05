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
        | 'bad_request';
      retryable: boolean;
      usage?: TextUsage;
    };
export interface TextAdapter {
  generate(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: GenerateTextInput['messages'];
    maxOutputTokens: number;
    temperature?: number;
    responseFormat?: 'text' | 'json';
    idempotencyKey: string;
    timeoutMs: number;
  }): Promise<TextResult>;
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
          messages: input.messages,
          stream: false,
          max_tokens: input.maxOutputTokens,
          temperature: input.temperature,
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
      if (typeof choice?.message?.content !== 'string')
        return { ok: false, category: 'provider_error', retryable: true };
      return {
        ok: true,
        text: choice.message.content,
        usage: usageOf(
          payload.usage,
          input.messages.map((m) => m.content).join('\n'),
          choice.message.content,
        ),
      };
    } catch {
      return { ok: false, category: 'network_error', retryable: true };
    }
  }
}
