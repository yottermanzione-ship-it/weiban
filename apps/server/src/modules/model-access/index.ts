/**
 * model-access 模块的公开出口（R1：其他模块只能 import 这里）。说明见 docs/backend/model-access.md。
 *
 * - ModelAccessModule：在 app.module.ts 装配。
 * - MODEL_ACCESS_POLICY：无审查模型闸门使用的 policy 能力。policy 模块（D-L0-11）上线后，
 *   在装配处把它绑定到 policy 的 PolicyPort。
 * 模型网关端口（ModelGatewayPort）的注入令牌由 D-L0-09 在这里加入。
 */
export { ModelAccessModule } from './model-access.module.js';
export { MODEL_ACCESS_POLICY, type ModelPolicy } from './tokens.js';

export { MODEL_GATEWAY_PORT } from './tokens.js';
export { MODEL_PLATFORM_GATEWAY_PORT } from './tokens.js';
export { INITIAL_MODELS, initialPriceItems } from './domain/seed.js';

export { MODEL_NOTIFICATION_READ_PORT } from './tokens.js';

export { ADULT_MODEL_READ_PORT } from './tokens.js';
export { WEB_SEARCH_PROVIDER } from './tokens.js';
export type { WebSearchProvider } from './application/web-search.js';
export { MODEL_GATEWAY_MEDIA_PORT } from './tokens.js';
export { MODEL_QUOTE_PORT } from './tokens.js';
/** 本机运维脚本（cli/setup-local-model.ts）以管理员身份走服务层登记目录、读上游。 */
export { CatalogService } from './application/catalog.js';
export { UpstreamService } from './application/upstreams.js';
/** v3.6：请求结构对比工具（ai-runtime/tools/prompt-compare.ts）用的估算与前缀缓存模拟（纯函数）。 */
export { estimateTokens } from './infra/text-adapter.js';
export { simulatePrefixCache } from './domain/prefix-cache.js';
