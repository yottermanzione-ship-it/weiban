/**
 * proactive 模块的公开出口（R1：其他模块只能 import 这里）。
 * 说明见 docs/backend/proactive.md。
 *
 * - ProactiveModule：在 app.module.ts 装配。
 * - PROACTIVE_MESSAGE_PORT：注入后得到 ProactiveMessagePort（主动消息计数）。
 * - HOLIDAY_EVENT_PORT：注入后得到 HolidayEventPort（节日查询）。
 */
export { ProactiveModule } from './proactive.module.js';
export { PROACTIVE_MESSAGE_PORT, HOLIDAY_EVENT_PORT, DAILY_EVENT_PORT } from './tokens.js';
