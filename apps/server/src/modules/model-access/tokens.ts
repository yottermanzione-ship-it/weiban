/**
 * model-access 的注入令牌与它依赖的外部能力（说明见 docs/backend/model-access.md 第 2 节）。
 * 必须是 Symbol（engineering-standards 3.1 第 2 条）。
 */
import type { PolicyPort, UpstreamKind } from '@weiban/contracts';
import type { z } from 'zod';
import type { ModelTextPrices, UpstreamTestFailure } from './domain/rules.js';

/**
 * 无审查模型闸门用的 policy 能力（契约 PolicyPort.checkModelForCharacter）。
 * policy 模块（D-L0-11）尚未实现：默认绑定「失败即拒绝」的实现（FailClosedModelPolicy），
 * policy 模块上线后在装配处改为 `{ provide: MODEL_ACCESS_POLICY, useExisting: <policy 的 PolicyPort 令牌> }`。
 */
export const MODEL_ACCESS_POLICY = Symbol('weiban.model-access.policy');
export type ModelPolicy = Pick<PolicyPort, 'checkModelForCharacter'>;

/** 上游连通测试（默认：OpenAI 兼容接口的模型列表）。测试里换成假的。 */
export const UPSTREAM_PROBE = Symbol('weiban.model-access.upstream-probe');
export type UpstreamProbeResult = { ok: true } | { ok: false; reason: UpstreamTestFailure };
export interface UpstreamProbe {
  test(input: {
    kind: z.infer<typeof UpstreamKind>;
    baseUrl: string;
    apiKey: string;
  }): Promise<UpstreamProbeResult>;
}

/**
 * 模型价格来源（用于推算价格档位 priceTier）。billing 的契约端口目前没有「读当前价目表」的方法
 * （已提契约变更申请，见交接说明），默认实现返回空，档位显示「中等」。
 */
export const MODEL_PRICE_SOURCE = Symbol('weiban.model-access.price-source');
export interface ModelPriceSource {
  textPrices(modelKeys: readonly string[]): Promise<Map<string, ModelTextPrices>>;
}
