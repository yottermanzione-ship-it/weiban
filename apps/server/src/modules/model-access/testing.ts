/**
 * model-access 的测试出口（R10：只给测试用，生产代码 import 会被 lint 拦截）。
 * 集成测试替换外部能力（假上游、假 policy、假价格、假计费查询）和直接调用网关用的内部服务时用这里。
 */
export {
  UPSTREAM_PROBE,
  MODEL_PRICE_SOURCE,
  MODEL_ACCESS_CHARGE_QUERY,
  type UpstreamProbe,
  type ChargeQuery,
} from './tokens.js';
export { ChargeQueryUnavailableError } from './application/defaults.js';
export { OpenAiCompatibleProbe } from './infra/upstream-probe.js';
export { UpstreamService } from './application/upstreams.js';
export { ModelResolver, ModelStatusService } from './application/resolver.js';
export { UsageRecorder } from './application/usage.js';
export { UsageReconciliationService } from './application/reconciliation.js';
export { ModelAccessLifecycle, RECONCILE_USAGE_JOB } from './application/lifecycle.js';
export type { ModelTextPrices } from './domain/rules.js';
export { CatalogService } from './application/catalog.js';
