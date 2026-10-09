/**
 * moments 模块（L4，D-L4-05）：朋友圈动态、点赞、评论、可见范围、新动态红点（SOC-07～SOC-09）。
 * 数据归 moments。角色的动态和互动由 ai-runtime 经 MomentsCharacterPort 写入（内容生成归 AI，D-L4-06）。
 *
 * 每个用户有自己的「朋友圈世界」：角色发的动态属于某一个用户（ownerUserId，由该用户的推演产生），
 * 别的用户看不到。用户只能看到自己通讯录里的角色的动态、点赞和评论（SOC-07 第 6 条、SOC-08 第 3 条），
 * 服务器在返回前过滤。朋友圈不包含成人模式内容和经期内容（生成侧保证，SOC-07 第 8 条）。
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
import { LinkContent } from './chat.js';

/** 发布者 / 点赞者 / 评论者：用户本人或某个角色。 */
export const MomentsActor = z.object({
  kind: z.enum(['user', 'character']),
  /** kind = user 时是 userId（只会是当前用户自己）；character 时是 characterId。 */
  refId: Id,
});
export type MomentsActor = z.infer<typeof MomentsActor>;

export const MomentsImage = z.object({
  mediaId: Id,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

/** 用户动态的可见范围（SOC-09 第 2 条）。角色动态为 null。 */
export const MomentsVisibility = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_characters'), characterIds: z.array(Id).max(0) }),
  z.object({ kind: z.literal('selected'), characterIds: z.array(Id).min(1).max(50) }),
]);
export type MomentsVisibility = z.infer<typeof MomentsVisibility>;

export const MomentsComment = z.object({
  commentId: Id,
  author: MomentsActor,
  /** 回复某人（「A 回复 B：…」）；直接评论为 null。 */
  replyTo: MomentsActor.nullable(),
  replyToCommentId: Id.nullable(),
  text: z.string().min(1).max(500),
  /** 角色评论 @ 了用户（SOC-08 第 4 条，会推送）。 */
  mentionsUser: z.boolean(),
  createdAt: Timestamp,
});
export type MomentsComment = z.infer<typeof MomentsComment>;

export const MomentsPost = z.object({
  postId: Id,
  author: MomentsActor,
  text: z.string().max(2000),
  images: z.array(MomentsImage).max(9),
  /** 分享链接（MED-05）；没有为 null。 */
  link: LinkContent.omit({ type: true }).nullable(),
  /** 只有用户自己的动态有值。 */
  visibility: MomentsVisibility.nullable(),
  likes: z.array(MomentsActor),
  likedByMe: z.boolean(),
  comments: z.array(MomentsComment),
  createdAt: Timestamp,
});
export type MomentsPost = z.infer<typeof MomentsPost>;

export const CreateMomentsPostRequest = z
  .object({
    /** 幂等：同一 clientRequestId 重复提交返回同一条。 */
    clientRequestId: Id,
    text: z.string().max(2000),
    /** 先 POST /media?purpose=moments_image；最多 9 张（SOC-09 第 1 条）。 */
    imageMediaIds: z.array(Id).max(9),
    visibility: MomentsVisibility,
  })
  .refine((v) => v.text.trim().length > 0 || v.imageMediaIds.length > 0, {
    message: '文字和图片不能都为空',
  });

export const MomentsBadge = z.object({
  /** 上次查看朋友圈后新出现的角色动态数。 */
  unseenPostCount: z.number().int().nonnegative(),
  /** 发现页「朋友圈」入口显示的头像（最新几位发了新动态的角色，最多 3 个）。 */
  characterIds: z.array(Id).max(3),
  /** 与我有关的新互动（别人回复我、@ 我、给我的动态点赞评论）。 */
  unseenInteractionCount: z.number().int().nonnegative(),
});
export type MomentsBadge = z.infer<typeof MomentsBadge>;

/** 3.0.1：朋友圈消息列表的一条（谁赞了、评论了、回复了、@ 了我，L4 收尾）。 */
export const MomentsNotificationKind = z.enum(['like', 'comment', 'reply', 'mention']);
export const MomentsNotification = z.object({
  /** 列表内唯一（like:{postId}:{characterId} 或 comment:{commentId}）。 */
  notificationId: z.string().max(120),
  kind: tolerantEnum(MomentsNotificationKind),
  postId: Id,
  /** 评论类为该评论；点赞为 null。 */
  commentId: Id.nullable(),
  actor: MomentsActor,
  /** 评论正文；点赞为 null。 */
  text: z.string().max(500).nullable(),
  /** 被互动的动态摘要（右侧缩略）。 */
  post: z.object({
    author: MomentsActor,
    text: z.string().max(100),
    imageMediaId: Id.nullable(),
  }),
  createdAt: Timestamp,
});
export type MomentsNotification = z.infer<typeof MomentsNotification>;

const PostParams = z.object({ postId: Id });

export const MomentsEndpoints = {
  listFeed: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/feed`,
    auth: 'user',
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(30).default(10),
    }),
    response: cursorPage(MomentsPost),
    summary: '朋友圈（发现 → 朋友圈）：通讯录中角色和我自己的动态，按时间倒序（SOC-07 第 1、6 条）',
  }),
  listCharacterPosts: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/characters/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(30).default(10),
    }),
    response: cursorPage(MomentsPost),
    summary: '只看某个角色的朋友圈（角色资料页入口）',
  }),
  listMyPosts: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/me`,
    auth: 'user',
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(30).default(10),
    }),
    response: cursorPage(MomentsPost),
    summary: '「我 → 朋友圈」：只看我自己发的',
  }),
  getPost: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/posts/:postId`,
    auth: 'user',
    params: PostParams,
    response: MomentsPost,
    summary: '单条动态（通知、收藏跳转用）',
  }),
  createPost: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/moments/posts`,
    auth: 'user',
    body: CreateMomentsPostRequest,
    response: MomentsPost,
    summary:
      '发朋友圈（SOC-09），成功 201；发出 moments.post_created，ai-runtime 据此安排可见角色点赞评论（P-29 内）',
  }),
  deletePost: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/moments/posts/:postId`,
    auth: 'user',
    params: PostParams,
    response: NoContent,
    summary: '删除我自己的动态（连同点赞评论）',
  }),
  like: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/moments/posts/:postId/like`,
    auth: 'user',
    params: PostParams,
    response: MomentsPost,
    summary: '点赞（幂等）；发出 moments.post_liked',
  }),
  unlike: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/moments/posts/:postId/like`,
    auth: 'user',
    params: PostParams,
    response: MomentsPost,
    summary: '取消点赞',
  }),
  comment: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/moments/posts/:postId/comments`,
    auth: 'user',
    params: PostParams,
    body: z.object({
      clientRequestId: Id,
      text: z.string().trim().min(1).max(500),
      replyToCommentId: Id.nullable().optional(),
    }),
    response: MomentsPost,
    summary:
      '评论或回复评论；发出 moments.comment_created，被评论 / 被回复的角色一定会回复（SOC-08 第 1 条，P-29 内）',
  }),
  deleteComment: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/moments/posts/:postId/comments/:commentId`,
    auth: 'user',
    params: z.object({ postId: Id, commentId: Id }),
    response: MomentsPost,
    summary: '删除我自己的评论',
  }),
  getBadge: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/badge`,
    auth: 'user',
    response: MomentsBadge,
    summary: '发现页「朋友圈」红点（SOC-07 第 7 条：新动态不单独推送）',
  }),
  markSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/moments/badge/seen`,
    auth: 'user',
    body: z.object({ scope: z.enum(['posts', 'interactions', 'all']) }),
    response: MomentsBadge,
    summary: '打开朋友圈后清红点；所有设备同步（moments.badge_updated 更新）',
  }),
  /** 3.0.1（L4 收尾）。 */
  listNotifications: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/moments/notifications`,
    auth: 'user',
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(MomentsNotification),
    summary:
      '朋友圈消息列表：通讯录中角色给我的动态点赞、评论，回复我的评论，评论里 @ 我；按时间倒序。点进去后用 markSeen(interactions) 清红点',
  }),
} as const;
