/** 健康模块对外注入令牌。 */

/**
 * HealthReadPort（只读端口）。
 * **调用方限制：只有 ai-runtime 可注入**（architecture.js 登记，与 R9 同样按名字管 import）。
 * 后端注册此令牌，ai-runtime 通过它读取经期上下文。
 */
export const HEALTH_READ_PORT = Symbol('weiban.health.read-port');
