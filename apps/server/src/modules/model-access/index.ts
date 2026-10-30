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
export { CatalogService, type ModelFacts } from './application/catalog.js';
export { UpstreamService } from './application/upstreams.js';
/** 组合通话模型运维脚本（cli/voice-call-pipeline.ts）：组合标记、固定模型键与设置结构校验。 */
export {
  isVoiceCallComposite,
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_TAG,
} from './application/voice-call-composite.js';
export { parseVoiceCallPipeline, type VoiceCallPipeline } from './domain/voice-call-pipeline.js';
/** Private maintenance CLI; no HTTP endpoint and no supplier probing. */
export { LegacyUpstreamImportService } from './application/legacy-upstream-import.js';
export { LegacyImportReceiver } from './application/legacy-receiver.js';
export { LegacyImportError } from './domain/legacy-import.js';
/** v3.6：请求结构对比工具（ai-runtime/tools/prompt-compare.ts）用的估算与前缀缓存模拟（纯函数）。 */
export { estimateTokens } from './infra/text-adapter.js';
export { contextTokens } from './domain/context-budget.js';
export { simulatePrefixCache } from './domain/prefix-cache.js';
/** Bounded synthetic operations probe; never changes runtime configuration. */
export { evaluateConfiguredDecisions } from './application/decision-evaluation.js';
export { SHARED_WEB_SEARCH_PORT } from './tokens.js';
/** 旧卡音色导入 CLI：只读当前可用的语音消息模型键。 */
export { listVoiceMessageModelKeys } from './application/voice-model-registry.js';
/** 批 V：语音目录登记 / 实时通话音色运维脚本。 */
export { ModelAdminService } from './application/models.js';
export { RealtimeVoiceStore, ProviderVoiceKey } from './application/realtime-voices.js';
export {
  isRealtimeCallEntry,
  REALTIME_CALL_TAG,
  REALTIME_VOICE_CLONE_COST_YUAN,
  realtimeVoiceCloneCostYuan,
} from './application/realtime-call.js';
/** V2：实时通话按需复刻——角色声音来源（装配入口绑定）与拨打前的音色检查（calls 经 CALL_SERVICE_STATUS 调用）。 */
export { MODEL_ACCESS_CHARACTER_VOICE, type ModelAccessCharacterVoice } from './tokens.js';
export type { RealtimeCallVoiceCheck } from './application/media-gateway.js';
