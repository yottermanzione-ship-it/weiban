/**
 * proactive 模块对外提供的注入令牌（从 index.ts 导出）。
 * 规则同 billing/tokens.ts：必须是 Symbol，不 import 就拿不到端口。
 */

/** 契约 ProactiveMessagePort：主动消息计数与待回复状态。供 ai-runtime 调度器使用。 */
export const PROACTIVE_MESSAGE_PORT = Symbol('weiban.proactive.message-port');

/** 契约 HolidayEventPort：节日/纪念日查询。供 ai-runtime 调度器使用。 */
export const HOLIDAY_EVENT_PORT = Symbol('weiban.proactive.holiday-event-port');
export const DAILY_EVENT_PORT = Symbol('weiban.proactive.daily-event-port');
