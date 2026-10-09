/**
 * health 模块公开出口（经期日记，PLAY-01）。说明见 docs/backend/health.md。
 *
 * - HealthModule：在 app.module.ts 装配；ai-runtime 需要读经期摘要时 import 它。
 * - HEALTH_READ_PORT：注入后得到契约 HealthReadPort。**只有 ai-runtime 可以使用**
 *   （lint 规则 weiban/health-port-exit 拦截其他模块）。
 */
export { HealthModule } from './health.module.js';
export { HEALTH_READ_PORT } from './tokens.js';
