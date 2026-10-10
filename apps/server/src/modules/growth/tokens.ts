export const GROWTH_SERVICE = Symbol('weiban.growth.service');
/** 契约 GrowthReadPort（ai-runtime 读熟悉度等级、认识天数）。 */
export const GROWTH_READ_PORT = Symbol('weiban.growth.read-port');
/** 契约 GrowthCardPort（ai-runtime 发名场面 / 宠物 / 玩法瞬间卡；T-077、T-082、T-092、T-093）。 */
export const GROWTH_CARD_PORT = Symbol('weiban.growth.card-port');
/**
 * 节日清单来源（契约 HolidayEventPort）。growth 不能 import proactive（上层之间单向白名单），
 * 由装配入口 app.module.ts 绑定到 proactive 的 HOLIDAY_EVENT_PORT；未绑定时不发节日卡。
 */
export const GROWTH_HOLIDAY_SOURCE = Symbol('weiban.growth.holiday-source');
