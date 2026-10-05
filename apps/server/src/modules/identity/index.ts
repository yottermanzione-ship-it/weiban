/**
 * identity 模块的公开出口（R1：其他模块只能 import 这里）。说明见 docs/backend/identity.md。
 *
 * - IdentityModule：在 app.module.ts 装配。
 * - IDENTITY_READ_PORT：注入后得到契约 IdentityReadPort（读资料、通知设置、最近活跃时间）。
 * - IdentityCommands：命令行脚本用（创建管理员、重置密码等）。
 * 会话校验通过平台的 SESSION_VERIFIER 提供，业务模块不需要直接用。
 */
export { IdentityModule } from './identity.module.js';
export { IDENTITY_READ_PORT } from './tokens.js';
export { IdentityCommands, CommandError } from './application/commands.js';
