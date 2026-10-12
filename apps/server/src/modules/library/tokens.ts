/**
 * library 自己的注入令牌（T-078）。library 是上层模块，按 T-101 上层白名单不能 import moments、growth，
 * 这两个依赖由装配入口 app.module.ts 绑定实现（同 calls / CallAgentPort 的做法），library 以可选注入使用。
 */
import type { MomentsReadPort } from '@weiban/contracts';

/** 契约 MomentsReadPort（收藏朋友圈动态、朋友圈分享图）。未绑定时相关请求返回 not_found。 */
export const LIBRARY_MOMENTS_READ = Symbol('weiban.library.moments-read');
export type LibraryMomentsRead = Pick<MomentsReadPort, 'getPost'>;

/** 卡片分享图要知道卡片属于哪个角色（真人标注）；由 app.module.ts 绑定到 growth 的卡片查询。 */
export const LIBRARY_CARD_LOOKUP = Symbol('weiban.library.card-lookup');
export interface LibraryCardLookup {
  /** 卡片所属角色；卡片不存在或不属于该用户时为 null。 */
  getCardCharacterId(userId: string, cardId: string): Promise<string | null>;
}
