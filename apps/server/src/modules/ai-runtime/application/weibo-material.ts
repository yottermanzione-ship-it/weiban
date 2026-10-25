/**
 * 3.29：微博同步朋友圈的**素材消费接口**（给微博图片代理实现，不在这里抓取/下载/存库）。
 *
 * 消费方只做三件事：拿一条已同步的微博素材 → 校验原文安全 → 选一张图（有图时）发到用户自己的朋友圈。
 * 代理实现负责：把原文、来源、图片落到可用的媒体对象并返回 mediaId；不得返回登录凭据、Cookie、
 * 用户私信内容或未审核的图片。
 */
export interface WeiboMomentImage {
  /** 已经入库、当前用户可读的媒体对象。 */
  mediaId: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface WeiboMomentMaterial {
  /** 已发布到角色公开动态的记录 ID（用于幂等/去重，不是微博原始 ID）。 */
  updateId: string;
  /** 微博原文/已审核摘录（纯文本；消费方会再跑日常范围安全规则）。 */
  content: string;
  /** 原微博链接，仅用于展示/审计。 */
  sourceUrl?: string | null;
  publishedOn?: string | null;
  /** 该条微博的图片素材（0～N 张）；没有就返回空数组，消费方不会用 AI/随机风景图补。 */
  images?: readonly WeiboMomentImage[];
}

/** DI token：由微博图代理（e0fac）提供实现；未提供时只消费已同步的文本动态。 */
export const WEIBO_MOMENT_MATERIAL_PORT = Symbol('weiban.weibo.moment-material');

export interface WeiboMomentMaterialPort {
  /** 最近一条已同步、对当前用户可见的微博素材；没有返回 null。 */
  latest(userId: string, characterId: string): Promise<WeiboMomentMaterial | null>;
}
