/**
 * library 模块（L6，D-L6-02）：收藏（CHAT-11）与分享图数据（EXP-01、EXP-02）。数据归 library（表 favorites 等）。
 * 收藏时复制一份内容快照，原消息被本人删除后收藏仍在（CHAT-11 第 3 条）。
 * 分享图由客户端（网页 / 安卓）按 docs/design/share-templates.md 渲染；服务器只做两件事：
 * 准备「能放进图里的内容」并强制排除不可选的消息，决定必带的微伴贴纸文案（含真人 → 「非本人」）。
 * 成人模式消息（scope = adult）与带「健康」标记的消息一律不能进分享图（EXP-01 第 6 条），由服务器拒绝。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';
import { ParticipantKind, ReceivedMessageContent } from './chat.js';

/** 单张分享图最多消息数（P-24）。 */
export const SHARE_IMAGE_MAX_ITEMS = 30 as const;

/** 不能进分享图的原因。 */
export const ShareRejectReason = z.enum(['adult_scope', 'health_label', 'recalled', 'not_found']);

export const FavoriteSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    conversationId: Id,
    messageId: Id,
    /** 收藏时的发送者。 */
    senderKind: ParticipantKind.or(z.literal('system')),
    senderRefId: Id.nullable(),
  }),
  z.object({ kind: z.literal('moments_post'), postId: Id, authorCharacterId: Id.nullable() }),
]);

export const Favorite = z.object({
  favoriteId: Id,
  source: FavoriteSource,
  /** 角色筛选用：消息发送者或动态作者是角色时为其 ID。 */
  characterId: Id.nullable(),
  /** 内容快照。朋友圈动态快照为 text 内容（图片作为 image 内容另列在 extraImages）。 */
  content: ReceivedMessageContent,
  extraImages: z.array(Id).max(9),
  /** 能否用于生成分享图；不能时给出原因（客户端在多选时置灰）。 */
  shareable: z.boolean(),
  notShareableReason: tolerantEnum(ShareRejectReason).nullable(),
  sourceCreatedAt: Timestamp,
  createdAt: Timestamp,
});
export type Favorite = z.infer<typeof Favorite>;

export const AddFavoritesRequest = z.object({
  items: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('message'), conversationId: Id, messageId: Id }),
        z.object({ kind: z.literal('moments_post'), postId: Id }),
      ]),
    )
    .min(1)
    .max(SHARE_IMAGE_MAX_ITEMS),
});

export const LibraryEndpoints = {
  listFavorites: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/library/favorites`,
    auth: 'user',
    query: z.object({
      characterId: Id.optional(),
      q: z.string().trim().min(1).max(50).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(Favorite),
    summary: '我的收藏：时间倒序，可按角色筛选、搜索文字（CHAT-11 第 2 条）',
  }),
  addFavorites: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/library/favorites`,
    auth: 'user',
    body: AddFavoritesRequest,
    response: z.object({ items: z.array(Favorite) }),
    summary:
      '收藏一条或多条（长按 / 多选 / 朋友圈）；同一来源重复收藏返回原收藏（幂等）。发出 library.favorite_added（成就第 19、20 号）',
  }),
  removeFavorite: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/library/favorites/:favoriteId`,
    auth: 'user',
    params: z.object({ favoriteId: Id }),
    response: NoContent,
    summary: '取消收藏（已获得的成就不收回）',
  }),
} as const;

// ---------- 分享图 ----------

export const ShareTemplate = z.enum(['pink_filter', 'chat_original', 'simple_white', 'card_style']);
export type ShareTemplate = z.infer<typeof ShareTemplate>;

export const ShareSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('messages'),
    conversationId: Id,
    messageIds: z.array(Id).min(1).max(SHARE_IMAGE_MAX_ITEMS),
  }),
  z.object({
    kind: z.literal('favorites'),
    favoriteIds: z.array(Id).min(1).max(SHARE_IMAGE_MAX_ITEMS),
  }),
  z.object({ kind: z.literal('moments_post'), postId: Id }),
  z.object({ kind: z.literal('card'), cardId: Id }),
]);

/** 分享图里的一条内容。senderKind = user 时客户端按「是否显示我的头像昵称」处理（默认显示为「我」）。 */
export const ShareItem = z.object({
  senderKind: ParticipantKind,
  /** 角色时为 characterId；用户为 null。 */
  characterId: Id.nullable(),
  content: ReceivedMessageContent,
  createdAt: Timestamp,
});

export const ShareImageData = z.object({
  /**
   * 微伴贴纸文案（EXP-01 第 5 条，不可关闭）：weiban = 「微伴AI聊天」；
   * weiban_not_real_person = 「微伴AI聊天非本人，请谨慎识别」（含任何真人角色内容时）。
   */
  label: z.enum(['weiban', 'weiban_not_real_person']),
  items: z.array(ShareItem).max(SHARE_IMAGE_MAX_ITEMS),
  /** 卡片分享时的卡片 ID（客户端用 GET /growth/card/:cardId 取卡面）；其他为 null。 */
  cardId: Id.nullable(),
  /** 涉及的角色，客户端据此取头像（SAFE-01 第 5 条优先级）与「认识第 N 天」角标。 */
  characterIds: z.array(Id),
});
export type ShareImageData = z.infer<typeof ShareImageData>;

export const SharePreferences = z.object({ defaultTemplate: ShareTemplate });

export const ShareEndpoints = {
  prepare: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/library/share-images/prepare`,
    auth: 'user',
    body: z.object({ source: ShareSource }),
    response: ShareImageData,
    summary:
      '准备分享图内容（四个入口：聊天多选、收藏、朋友圈、卡片）。含成人模式 / 「健康」标记消息时返回 422 share_content_not_allowed，' +
      'details.rejected = [{ id, reason }]，不静默丢弃（EXP-01 第 6 条）；撤回的消息不显示',
  }),
  recordGenerated: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/library/share-images/generated`,
    auth: 'user',
    body: z.object({ template: ShareTemplate }),
    response: NoContent,
    summary:
      '客户端生成分享图后回报一次（只记次数，不上传图片）；发出 library.share_image_generated（成就第 21 号）',
  }),
  getPreferences: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/share-preferences`,
    auth: 'user',
    response: SharePreferences,
    summary: '默认模板（EXP-02 第 4 条），初始 pink_filter',
  }),
  updatePreferences: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/share-preferences`,
    auth: 'user',
    body: SharePreferences,
    response: SharePreferences,
    summary: '设置默认模板',
  }),
} as const;
