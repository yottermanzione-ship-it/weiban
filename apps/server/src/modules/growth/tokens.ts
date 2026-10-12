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
/** 契约 PetReadPort（ai-runtime：推演、朋友圈晒宠物、聊天里知道今天玩过）。T-077。 */
export const GROWTH_PET_READ_PORT = Symbol('weiban.growth.pet-read-port');
/** 契约 PetNamingPort（ai-runtime 回传「让 TA 起名」的候选名）。T-077。 */
export const GROWTH_PET_NAMING_PORT = Symbol('weiban.growth.pet-naming-port');
/**
 * 服务器内部（非契约）：角色发来的宠物照片进相册。
 * 类型 { addCharacterPhoto(input: { userId; characterId; mediaId; messageId }): Promise<void> }。T-077。
 */
export const GROWTH_PET_ALBUM = Symbol('weiban.growth.pet-album');
/**
 * 服务器内部（非契约）：卡片归属查询，类型 { getCardCharacterId(userId, cardId): Promise<string | null> }。
 * library 的卡片分享图要按卡片角色决定真人标注（T-078），由 app.module.ts 绑定到 LIBRARY_CARD_LOOKUP。
 */
export const GROWTH_CARD_LOOKUP = Symbol('weiban.growth.card-lookup');
/**
 * 契约 3.1 CardCopywriterPort（ports/social.ts）的注入令牌：卡片文案可选 AI 接入点（ADR-0028 方案 C）。
 * 由装配入口绑定到 ai-runtime 的实现；未绑定、3 秒超时或返回 null 时用模板文案，不阻塞发卡。
 */
export const GROWTH_CARD_COPYWRITER = Symbol('weiban.growth.card-copywriter');
