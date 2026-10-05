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
