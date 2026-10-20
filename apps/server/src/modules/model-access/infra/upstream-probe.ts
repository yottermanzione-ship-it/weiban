/**
 * 上游连通测试（billing.md 3.1 第 2 条）：调用「模型列表」接口——OpenAI 兼容 `GET {baseUrl}/models`，
 * 3.24 Anthropic 原生协议 `GET {baseUrl}/v1/models`（x-api-key）。
 * 选模型列表而不是一次极小的生成请求：它不产生费用，也就不需要冻结和记账；能区分「密钥无效 / 余额不足 / 网络 / 供应商故障」。
 * Anthropic 协议的中转站没有模型列表（404 / 405）时，改发一个**故意不完整**的 Messages 请求（messages 为空）：
 * 上游先校验密钥再校验参数，所以 401 / 403 = 密钥无效、402 = 余额不足、其余 4xx = 密钥可用；不会生成内容、不产生费用。
 *
 * 安全：密钥只放在请求头；不跟随重定向（避免把密钥带到别的地址）；
 * 任何错误都只返回类别，不记录上游原文（security-and-privacy.md 第 4 节第 3 条）。
 */
import type { UpstreamProbe, UpstreamProbeResult } from '../tokens.js';
import { classifyTestStatus, type UpstreamTestFailure } from '../domain/rules.js';
import { anthropicHeaders, anthropicUrl, fetchAnthropicModels } from './anthropic-adapter.js';

/** 连通测试超时。 */
export const UPSTREAM_TEST_TIMEOUT_MS = 10_000;

export class OpenAiCompatibleProbe implements UpstreamProbe {
  constructor(private readonly timeoutMs = UPSTREAM_TEST_TIMEOUT_MS) {}

  async test(input: {
    kind?: string;
    baseUrl: string;
    apiKey: string;
  }): Promise<UpstreamProbeResult> {
    if (input.kind === 'anthropic') return anthropicProbe(input, this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${input.baseUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { ok: false, reason: 'network_error' };
    }
    // 不读响应正文（可能回显部分密钥），直接丢弃
    await response.body?.cancel().catch(() => undefined);
    const failure = classifyTestStatus(response.status);
    return failure ? { ok: false, reason: failure } : { ok: true };
  }
}

async function anthropicProbe(
  input: { baseUrl: string; apiKey: string },
  timeoutMs: number,
): Promise<UpstreamProbeResult> {
  const listed = await fetchAnthropicModels({ ...input, timeoutMs });
  if (!listed) return { ok: false, reason: 'network_error' };
  if (listed.status !== 404 && listed.status !== 405) {
    const failure = classifyTestStatus(listed.status);
    return failure ? { ok: false, reason: failure } : { ok: true };
  }
  let response: Response;
  try {
    response = await fetch(anthropicUrl(input.baseUrl, 'messages'), {
      method: 'POST',
      headers: anthropicHeaders(input.apiKey),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: 'connectivity-check', max_tokens: 1, messages: [] }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403)
    return { ok: false, reason: 'invalid_key' };
  if (response.status === 402) return { ok: false, reason: 'insufficient_balance' };
  if (response.status >= 500) return { ok: false, reason: 'provider_error' };
  if (response.status >= 300 && response.status < 400)
    return { ok: false, reason: 'provider_error' };
  return { ok: true };
}

/**
 * v3.4：拉取账号可用模型（添加模型向导）。读模型列表的 `data[].id`（OpenAI 兼容与 Anthropic 格式相同）。
 * 只取 id 字段，最多 500 个；状态码按连通测试同样分类。不跟随重定向、不记录正文。
 */
export async function fetchUpstreamModels(input: {
  kind?: string;
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: true; ids: string[] } | { ok: false; reason: UpstreamTestFailure }> {
  if (input.kind === 'anthropic') {
    const listed = await fetchAnthropicModels({ ...input, timeoutMs: UPSTREAM_TEST_TIMEOUT_MS });
    if (!listed) return { ok: false, reason: 'network_error' };
    const failure = classifyTestStatus(listed.status);
    if (failure) return { ok: false, reason: failure };
    return listed.ids ? { ok: true, ids: listed.ids } : { ok: false, reason: 'provider_error' };
  }
  let response: Response;
  try {
    response = await fetch(`${input.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  const failure = classifyTestStatus(response.status);
  if (failure) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: failure };
  }
  try {
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id.slice(0, 200) : null))
      .filter((id): id is string => !!id)
      .slice(0, 500);
    return { ok: true, ids: [...new Set(ids)].sort() };
  } catch {
    return { ok: false, reason: 'provider_error' };
  }
}
