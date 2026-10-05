/**
 * 上游连通测试（billing.md 3.1 第 2 条）：调用 OpenAI 兼容接口的「模型列表」`GET {baseUrl}/models`。
 * 选模型列表而不是一次极小的生成请求：它不产生费用，也就不需要冻结和记账；能区分「密钥无效 / 余额不足 / 网络 / 供应商故障」。
 * 若某家上游的模型列表不校验密钥，AI 负责人在 D-L0-09 的适配器里改为极小生成请求（经网关记平台账户，用途 admin_upstream_test）。
 *
 * 安全：密钥只放在 Authorization 头；不跟随重定向（避免把密钥带到别的地址）；
 * 任何错误都只返回类别，不记录上游原文（security-and-privacy.md 第 4 节第 3 条）。
 */
import type { UpstreamProbe, UpstreamProbeResult } from '../tokens.js';
import { classifyTestStatus } from '../domain/rules.js';

/** 连通测试超时。 */
export const UPSTREAM_TEST_TIMEOUT_MS = 10_000;

export class OpenAiCompatibleProbe implements UpstreamProbe {
  constructor(private readonly timeoutMs = UPSTREAM_TEST_TIMEOUT_MS) {}

  async test(input: { baseUrl: string; apiKey: string }): Promise<UpstreamProbeResult> {
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
