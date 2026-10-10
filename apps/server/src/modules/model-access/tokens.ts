/**
 * model-access 的注入令牌与它依赖的外部能力（说明见 docs/backend/model-access.md 第 2 节）。
 * 必须是 Symbol（engineering-standards 3.1 第 2 条）。
 */
import type { BillingChargeQueryPort, PolicyPort, UpstreamKind } from '@weiban/contracts';
import type { z } from 'zod';
import type { ModelTextPrices, UpstreamTestFailure } from './domain/rules.js';

/**
 * 无审查模型闸门用的 policy 能力（契约 PolicyPort.checkModelForCharacter）。
 * 组合根绑定真实 policy；测试可以覆盖该窄端口。
 */
export const MODEL_ACCESS_POLICY = Symbol('weiban.model-access.policy');
export type ModelPolicy = Pick<PolicyPort, 'checkModelForCharacter'>;

/**
 * 计费只读查询（契约 1.3 BillingChargeQueryPort：查价、按日 / 按用量记录查扣费）。
 * 绑定 billing 的真实只读查询；不允许其他模块取得冻结/结算能力。
 */
export const MODEL_ACCESS_CHARGE_QUERY = Symbol('weiban.model-access.charge-query');
export type ChargeQuery = BillingChargeQueryPort;

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

export const MODEL_GATEWAY_PORT = Symbol('weiban.model-access.gateway');
export const TEXT_ADAPTER = Symbol('weiban.model-access.text-adapter');
export const MODEL_GENERATION_POLICY = Symbol('weiban.model-access.adult-generation-policy');
export type GenerationPolicy = Pick<PolicyPort, 'checkAdultGeneration'>;
/** 默认真实退避；测试可替换为立即执行，生产固定 2/5/15 秒加抖动。 */
export const GATEWAY_RETRY_WAIT = Symbol('weiban.model-access.retry-wait');
export type RetryWait = (ms: number) => Promise<void>;

export const MODEL_NOTIFICATION_READ_PORT = Symbol('weiban.model-access.notification-read');

export const ADULT_MODEL_READ_PORT = Symbol('weiban.model-access.adult-model-read');
/** 联网搜索（WebSearchProvider，prd-answers.md 第 7 节）：统一记账、统一脱敏。 */
export const WEB_SEARCH_PROVIDER = Symbol('weiban.model-access.web-search');

/** T-071：契约 ModelGatewayMediaPort（语音合成 / 识别、图片生成、联网搜索、实时识别、流式合成、服务开通）。 */
export const MODEL_GATEWAY_MEDIA_PORT = Symbol('weiban.model-access.gateway-media');
/** T-071：多媒体上游适配器（默认 OpenAI 兼容 + 博查搜索）；测试可替换。 */
export const MEDIA_ADAPTER = Symbol('weiban.model-access.media-adapter');
