/**
 * plaza 模块（L7，D-L7-01～D-L7-06）：人设广场（PLZ-01～PLZ-08）与管理端（ADM-09）。
 * 设计见 docs/architecture/persona-plaza.md；硬性边界在广场上的执行见 hard-boundaries.md 第 6 节。数据归 plaza。
 *
 * 发布的是**快照**：快照 schema 是严格对象（多一个字段即校验失败），由 characters 按白名单生成（CharacterPlazaPort），
 * plaza 保存前再校验一次。「永不发布」清单（PLZ-02 第 4 条）里的东西根本不在 schema 里。
 * 复制 = characters 新建一个自定义角色，分类从快照写入并锁定（只能更严）。客户端没有任何字段能影响分类。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  LocalDate,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';
import { AgeSetting, CharacterBasis, RealPersonKind } from './characters.js';

/** P-35：评论长度上限。 */
export const PLAZA_COMMENT_MAX_CHARS = 200 as const;

// ---------- 快照（白名单，严格） ----------

/** 快照里的分类（PLZ-02 第 3 条、persona-plaza.md 第 4 节）。复制时原样写入新角色并锁定。 */
export const PlazaSnapshotClassification = z.strictObject({
  basis: CharacterBasis,
  realPersonKind: RealPersonKind.nullable(),
  ageSetting: AgeSetting,
  childAppearance: z.boolean(),
  childFeaturesDetected: z.boolean(),
  /** 只增标记；为 true 的角色不能发布（PLZ-02 第 11 条），出现在快照里只为复制后继续锁定。 */
  everPrivatePerson: z.boolean(),
});
export type PlazaSnapshotClassification = z.infer<typeof PlazaSnapshotClassification>;

/** 自定义角色作品的快照。 */
export const PlazaCustomCharacterSnapshot = z.strictObject({
  kind: z.literal('custom_character'),
  name: z.string().min(1).max(32),
  classification: PlazaSnapshotClassification,
  description: z.string().min(1).max(2000),
  speechStyle: z.string().max(1000),
  catchphrases: z.array(z.string().max(50)).max(20),
  exampleDialogue: z.string().max(2000),
  tags: z.array(z.string().max(16)).max(10),
  birthday: LocalDate.nullable(),
  /** 音色库中的音色名（不是音色 ID）。 */
  voiceName: z.string().max(20).nullable(),
  /** 头像（purpose = plaza_avatar 的公开副本）；真人分类强制为 null（PLZ-02 第 5 条）。 */
  avatarMediaId: Id.nullable(),
});

/** 预设改版作品的快照：只引用预设角色，不复制预设内容（PLZ-02 第 3 条）。 */
export const PlazaPresetVariantSnapshot = z.strictObject({
  kind: z.literal('preset_variant'),
  presetCharacterId: Id,
  variantText: z.string().min(1).max(5000),
});

export const PlazaSnapshot = z.discriminatedUnion('kind', [
  PlazaCustomCharacterSnapshot,
  PlazaPresetVariantSnapshot,
]);
export type PlazaSnapshot = z.infer<typeof PlazaSnapshot>;

/** 两种作品共有的发布设置。 */
export const PlazaPublishSettings = z.strictObject({
  /** 一句话介绍（≤30 字）。 */
  tagline: z.string().trim().min(1).max(30),
  /** 发布说明（≤300 字）。 */
  publishNote: z.string().max(300),
  /** 允许改编后再发布，默认允许（PLZ-04 第 6 条）。 */
  allowRemix: z.boolean(),
  commentsOpen: z.boolean(),
});

// ---------- 作品 ----------

export const PlazaWorkKind = z.enum(['custom_character', 'preset_variant']);
export const PlazaWorkStatus = z.enum([
  'listed',
  'unlisted_by_author',
  'removed_by_admin',
  'author_banned',
]);

export const PlazaAuthor = z.object({
  /** 作者在广场上的身份 ID（不是 userId，不能反查账号）。 */
  authorId: Id,
  nickname: z.string().max(12),
  avatarUrl: z.url().nullable(),
  /** 作者已注销：显示「已注销用户」。 */
  deleted: z.boolean(),
});
export type PlazaAuthor = z.infer<typeof PlazaAuthor>;

/** 列表卡片（PLZ-01 第 2 条）。 */
export const PlazaWorkCard = z.object({
  workId: Id,
  kind: tolerantEnum(PlazaWorkKind),
  name: z.string().max(32),
  tagline: z.string().max(30),
  /** 类型标签：原创 / 虚构 / 真人；预设改版为 null（客户端显示「预设改版 · 基于 XX」）。 */
  basis: tolerantEnum(CharacterBasis).nullable(),
  basedOnPresetId: Id.nullable(),
  basedOnPresetName: z.string().max(32).nullable(),
  avatarUrl: z.url().nullable(),
  author: PlazaAuthor,
  likeCount: z.number().int().nonnegative(),
  adoptCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  /** 我已添加或应用过。 */
  adoptedByMe: z.boolean(),
  likedByMe: z.boolean(),
  currentVersion: z.number().int().positive(),
  publishedAt: Timestamp,
});
export type PlazaWorkCard = z.infer<typeof PlazaWorkCard>;

export const PlazaVersionNote = z.object({
  version: z.number().int().positive(),
  /** 更新说明（≤100 字，PLZ-05 第 1 条）；第一版为 null。 */
  changeNote: z.string().max(100).nullable(),
  createdAt: Timestamp,
});

/** 作品页（PLZ-01 第 6 条）：完整预览 + 版本记录。 */
export const PlazaWorkDetail = PlazaWorkCard.extend({
  status: tolerantEnum(PlazaWorkStatus),
  settings: PlazaPublishSettings,
  snapshot: PlazaSnapshot,
  versions: z.array(PlazaVersionNote),
  /** 改编自（PLZ-04 第 6 条，不可删除）。 */
  remixOf: z
    .object({ workId: Id, name: z.string(), authorNickname: z.string(), available: z.boolean() })
    .nullable(),
  /** 我是作者。 */
  isMine: z.boolean(),
});
export type PlazaWorkDetail = z.infer<typeof PlazaWorkDetail>;

export const PlazaSort = z.enum(['hot', 'latest', 'most_liked']);

export const ListPlazaWorksQuery = z.object({
  q: z.string().trim().min(1).max(50).optional(),
  sort: PlazaSort.default('hot'),
  kind: PlazaWorkKind.optional(),
  basis: CharacterBasis.optional(),
  /** 作者页：只看某作者的作品（PLZ-01 第 7 条）。 */
  authorId: Id.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------- 发布 ----------

/** 隐私检查标出的疑似私人信息类别（docs/ai/plaza-privacy-check.md 第 4 节）。 */
export const PrivacyKind = z.enum([
  'phone',
  'id_number',
  'bank_card',
  'email',
  'address',
  'account',
  'plate',
  'my_profile',
  'about_me',
  'my_nickname',
  'my_memory',
  'third_party_name',
  'private_event',
  'other_private',
]);
export type PrivacyKind = z.infer<typeof PrivacyKind>;

/** 一个被标出的片段：fieldKey 指快照里的文字字段（例 description、catchphrases.2）；[start, end) 为字符位置。 */
export const PrivacySpan = z.object({
  spanId: z.string().max(32),
  fieldKey: z.string().max(40),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  kinds: z.array(tolerantEnum(PrivacyKind)).min(1),
});

/** 发布草稿（发布内容确认页，PLZ-02 第 6 条）：服务器生成的待发布快照 + 标出的片段。草稿保留 24 小时。 */
export const PlazaPublishDraft = z.object({
  draftId: Id,
  /** 新作品为 null；发布新版本时为原作品。 */
  workId: Id.nullable(),
  snapshot: PlazaSnapshot,
  spans: z.array(PrivacySpan),
  /** 发布时重跑的儿童特征检测结果（PLZ-02 第 7 条）；为 true 时提示「该角色不具备成人模式资格」，仍可发布。 */
  childFeaturesDetected: z.boolean(),
  /** 第一次发布需要先设置广场昵称（PLZ-02 第 2 条）。 */
  needsAuthorProfile: z.boolean(),
  expiresAt: Timestamp,
});
export type PlazaPublishDraft = z.infer<typeof PlazaPublishDraft>;

export const PlazaPublishSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('custom_character'), characterId: Id }),
  z.object({ kind: z.literal('preset_variant'), presetCharacterId: Id }),
]);

export const ConfirmPublishRequest = z.object({
  draftId: Id,
  settings: PlazaPublishSettings,
  /**
   * 用户逐条处理被标出的片段：keep = 确认保留（「这不是我的私人信息」）；不在列表里的片段一律以「▢」遮盖。
   * 用户想改写文字时回到角色编辑后重新生成草稿。
   */
  keptSpanIds: z.array(z.string().max(32)).max(200),
  /** 原创 / 虚构角色带头像时必须勾选「我有权使用这张图片」，否则用默认头像。 */
  avatarRightsConfirmed: z.boolean(),
  /** 发布新版本时的更新说明。 */
  changeNote: z.string().max(100).nullable().optional(),
});

// ---------- 点赞、评论、举报 ----------

export const PlazaComment = z.object({
  commentId: Id,
  author: PlazaAuthor,
  replyTo: PlazaAuthor.nullable(),
  replyToCommentId: Id.nullable(),
  text: z.string().max(PLAZA_COMMENT_MAX_CHARS),
  createdAt: Timestamp,
  /** 我能删除（我是评论者或作品作者）。 */
  deletable: z.boolean(),
});
export type PlazaComment = z.infer<typeof PlazaComment>;

export const PlazaReportReason = z.enum(['rights', 'hard_boundary', 'inappropriate', 'other']);

export const PlazaAuthorProfile = z.object({
  authorId: Id,
  nickname: z.string().min(1).max(12),
  avatarMediaId: Id.nullable(),
  avatarUrl: z.url().nullable(),
  /** 被停止发布与评论权限到何时（ADM-09 第 4 条）；null 表示正常，永久为 "permanent"。 */
  bannedUntil: z.union([Timestamp, z.literal('permanent')]).nullable(),
});

export const PlazaBadge = z.object({
  /** 「我发布的」红点：新点赞、新评论、评论被回复（PLZ-03 第 4 条，不推送）。 */
  myWorksUnseen: z.number().int().nonnegative(),
  /** 举报处理结果通知（PLZ-07 第 4 条）。 */
  reportResultsUnseen: z.number().int().nonnegative(),
  /** 我复制 / 应用过的作品有新版本（PLZ-05 第 4 条）。 */
  adoptedUpdatesAvailable: z.number().int().nonnegative(),
});

export const PlazaNotice = z.object({
  noticeId: Id,
  kind: z.enum([
    'work_liked',
    'work_commented',
    'comment_replied',
    'report_resolved',
    'work_removed_by_admin',
  ]),
  workId: Id.nullable(),
  /** 例「你举报的作品已处理」「你的作品《XX》已被下架，原因：…」。 */
  text: z.string().max(300),
  seen: z.boolean(),
  createdAt: Timestamp,
});

const WorkParams = z.object({ workId: Id });

export const PlazaEndpoints = {
  listWorks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/works`,
    auth: 'user',
    query: ListPlazaWorksQuery,
    response: cursorPage(PlazaWorkCard),
    summary:
      '人设广场列表：搜索（角色名、标签、作者昵称、基于的预设角色名）、排序（热门 P-34 / 最新 / 点赞最多）、筛选（PLZ-01）；不含下架和被停权作者的作品',
  }),
  getWork: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/works/:workId`,
    auth: 'user',
    params: WorkParams,
    response: PlazaWorkDetail,
    summary: '作品页；已下架作品对非作者返回 404 not_found',
  }),
  getAuthor: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/authors/:authorId`,
    auth: 'user',
    params: z.object({ authorId: Id }),
    response: PlazaAuthor,
    summary: '作者页头部（只有昵称和头像；作品列表用 listWorks?authorId=）',
  }),
  createPublishDraft: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/publish-drafts`,
    auth: 'user',
    body: z.object({ source: PlazaPublishSource }),
    response: PlazaPublishDraft,
    summary:
      '点「发布」：生成白名单快照、跑隐私检查与儿童特征重检（费用从余额扣，用途 import_analysis）。' +
      '基于身边真人 / 原作品不允许改编 / 被停权 / 作品被管理员下架 → 403 plaza_publish_forbidden；检测无法完成 → 422 plaza_check_unavailable。' +
      '已有作品时即为「发布新版本」草稿',
  }),
  confirmPublish: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/publish-drafts/:draftId/confirm`,
    auth: 'user',
    params: z.object({ draftId: Id }),
    body: ConfirmPublishRequest.omit({ draftId: true }),
    response: PlazaWorkDetail,
    summary:
      '确认发布（新作品或新版本）。新版本分类比上一版宽 → 422 plaza_classification_loosened。发出 plaza.work_published / plaza.work_version_published',
  }),
  updateWorkSettings: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/plaza/works/:workId`,
    auth: 'user',
    params: WorkParams,
    body: PlazaPublishSettings.partial(),
    response: PlazaWorkDetail,
    summary: '作者修改介绍、发布说明、是否允许改编、开关评论（关闭后已有评论隐藏，重开恢复）',
  }),
  unlistWork: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/unlist`,
    auth: 'user',
    params: WorkParams,
    response: PlazaWorkDetail,
    summary: '作者下架（PLZ-06 第 1 条）；不影响已复制 / 应用的用户',
  }),
  relistWork: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/relist`,
    auth: 'user',
    params: WorkParams,
    response: PlazaWorkDetail,
    summary: '作者重新上架；被管理员下架的返回 403 plaza_publish_forbidden',
  }),
  deleteWork: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/plaza/works/:workId`,
    auth: 'user',
    params: WorkParams,
    response: NoContent,
    summary: '作者删除作品（连同点赞评论，不可恢复）；发出 plaza.work_removed',
  }),
  listMyWorks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/me/works`,
    auth: 'user',
    response: z.object({ items: z.array(PlazaWorkDetail) }),
    summary: '「我发布的」（含下架的）',
  }),
  getMyProfile: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/me/profile`,
    auth: 'user',
    response: PlazaAuthorProfile.nullable(),
    summary: '我的广场昵称与头像；从未发布或评论过为 null',
  }),
  putMyProfile: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/plaza/me/profile`,
    auth: 'user',
    body: z.object({ nickname: z.string().trim().min(1).max(12), avatarMediaId: Id.nullable() }),
    response: PlazaAuthorProfile,
    summary:
      '设置 / 修改广场昵称与头像（第一次发布或评论前必须设置，PLZ-02 第 2 条）；所有作品署名一起变',
  }),
  getBadge: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/badge`,
    auth: 'user',
    response: PlazaBadge,
    summary: '人设广场页红点（不推送）',
  }),
  listNotices: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/notices`,
    auth: 'user',
    query: z.object({ cursor: z.string().optional() }),
    response: cursorPage(PlazaNotice),
    summary: '广场通知（点赞、评论、回复、举报结果、被下架），查看后标记已读',
  }),
  like: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/like`,
    auth: 'user',
    params: WorkParams,
    response: z.object({ likeCount: z.number().int().nonnegative(), likedByMe: z.boolean() }),
    summary: '点赞（每人每作品一次，幂等）',
  }),
  unlike: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/plaza/works/:workId/like`,
    auth: 'user',
    params: WorkParams,
    response: z.object({ likeCount: z.number().int().nonnegative(), likedByMe: z.boolean() }),
    summary: '取消点赞',
  }),
  listComments: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/plaza/works/:workId/comments`,
    auth: 'user',
    params: WorkParams,
    query: z.object({ cursor: z.string().optional() }),
    response: cursorPage(PlazaComment),
    summary: '评论（按时间正序，只有一层回复）；作品关闭评论时返回空列表',
  }),
  addComment: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/comments`,
    auth: 'user',
    params: WorkParams,
    body: z.object({
      clientRequestId: Id,
      text: z.string().trim().min(1).max(PLAZA_COMMENT_MAX_CHARS),
      replyToCommentId: Id.nullable().optional(),
    }),
    response: PlazaComment,
    summary:
      '评论 / 回复评论；未设置广场昵称返回 409 conflict（客户端先设置）；被停权 403 plaza_publish_forbidden',
  }),
  deleteComment: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/plaza/comments/:commentId`,
    auth: 'user',
    params: z.object({ commentId: Id }),
    response: NoContent,
    summary: '评论者删除自己的评论，或作者删除自己作品下的评论',
  }),
  report: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/reports`,
    auth: 'user',
    body: z.object({
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('work'), workId: Id }),
        z.object({ kind: z.literal('comment'), commentId: Id }),
      ]),
      reason: PlazaReportReason,
      note: z.string().max(200).nullable().optional(),
    }),
    response: NoContent,
    summary:
      '举报作品或评论（PLZ-07）；同一用户同一对象只能一次，重复返回 409 conflict；不自动隐藏',
  }),
  adopt: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/adopt`,
    auth: 'user',
    params: WorkParams,
    body: z.object({ adoptionId: Id }),
    response: z.object({ characterId: Id, workVersion: z.number().int().positive() }),
    summary:
      '「添加为我的角色」（PLZ-04 第 1 条）：复制当前版本为新的自定义角色（分类锁定）并走添加流程；受 P-26 约束（422 contact_limit_reached）。' +
      'adoptionId 为客户端生成的幂等键，重试不会建出两个角色',
  }),
  apply: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/works/:workId/apply`,
    auth: 'user',
    params: WorkParams,
    body: z.object({ adoptionId: Id, confirmReplaceSupplement: z.boolean() }),
    response: z.object({ characterId: Id, workVersion: z.number().int().positive() }),
    summary:
      '「应用到我的 XX」（只有预设改版）：写入我的补充设定；已有补充设定且未确认替换返回 409 conflict；未添加该预设角色时先添加（PLZ-04 第 3 条）',
  }),
  updateAdopted: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/plaza/adoptions/:characterId/update`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({
      decision: z.enum(['update', 'dismiss']),
      confirmOverwrite: z.boolean().default(false),
    }),
    response: z.object({ characterId: Id, workVersion: z.number().int().positive() }),
    summary:
      '作者发布了新版本（PLZ-05 第 4 条）：update 用新版本替换人设类字段或补充设定（我改过且未确认覆盖时 409 conflict），分类只会更严；dismiss 红点消失',
  }),
} as const;

// ---------- 管理端（ADM-09） ----------

export const AdminPlazaWork = PlazaWorkDetail.extend({
  authorUserId: Id,
  reportCount: z.number().int().nonnegative(),
  removedReason: z.string().max(200).nullable(),
});

export const AdminPlazaReport = z.object({
  reportId: Id,
  reporterUserId: Id,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work'), workId: Id }),
    z.object({ kind: z.literal('comment'), commentId: Id, workId: Id, text: z.string() }),
  ]),
  reason: tolerantEnum(PlazaReportReason),
  note: z.string().nullable(),
  status: z.enum(['pending', 'dismissed', 'actioned']),
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});

const AdminReason = z.object({ reason: z.string().trim().min(1).max(200) });

export const PlazaAdminEndpoints = {
  listWorks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/plaza/works`,
    auth: 'admin',
    query: z.object({
      authorUserId: Id.optional(),
      kind: PlazaWorkKind.optional(),
      basis: CharacterBasis.optional(),
      status: PlazaWorkStatus.optional(),
      minReports: z.coerce.number().int().nonnegative().optional(),
      cursor: z.string().optional(),
    }),
    response: cursorPage(AdminPlazaWork),
    summary: '全部广场作品（ADM-09 第 1 条）',
  }),
  getWorkVersion: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/plaza/works/:workId/versions/:version`,
    auth: 'admin',
    params: z.object({ workId: Id, version: z.coerce.number().int().positive() }),
    response: z.object({
      snapshot: PlazaSnapshot,
      settings: PlazaPublishSettings,
      createdAt: Timestamp,
    }),
    summary: '某个版本的完整发布内容',
  }),
  removeWork: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/works/:workId/remove`,
    auth: 'admin',
    params: WorkParams,
    body: AdminReason,
    response: AdminPlazaWork,
    summary:
      '管理员下架（原因必填），作者收到通知且不能自行重新上架；写审计，发 plaza.work_removed',
  }),
  restoreWork: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/works/:workId/restore`,
    auth: 'admin',
    params: WorkParams,
    body: AdminReason,
    response: AdminPlazaWork,
    summary: '管理员恢复被下架的作品；写审计',
  }),
  tightenClassification: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/works/:workId/tighten-classification`,
    auth: 'admin',
    params: WorkParams,
    body: z.object({
      basis: CharacterBasis,
      realPersonKind: RealPersonKind.nullable(),
      ageSetting: AgeSetting,
      childAppearance: z.boolean(),
      reason: z.string().trim().min(1).max(200),
    }),
    response: z.object({
      work: AdminPlazaWork,
      affectedCharacterCount: z.number().int().nonnegative(),
    }),
    summary:
      '更正分类（只能更严，ADM-09 第 6 条）：作品及所有由它复制 / 应用 / 改编出去的角色逐个更正，受影响会话立即退出成人模式并有系统提示；放宽返回 422 plaza_classification_loosened；写审计',
  }),
  listReports: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/plaza/reports`,
    auth: 'admin',
    query: z.object({
      status: z.enum(['pending', 'dismissed', 'actioned']).optional(),
      cursor: z.string().optional(),
    }),
    response: cursorPage(AdminPlazaReport),
    summary: '举报列表（ADM-09 第 3 条）',
  }),
  resolveReport: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/reports/:reportId/resolve`,
    auth: 'admin',
    params: z.object({ reportId: Id }),
    body: z.object({
      action: z.enum(['dismiss', 'remove_work', 'delete_comment']),
      reason: z.string().trim().min(1).max(200),
    }),
    response: AdminPlazaReport,
    summary: '处理举报：驳回或下架作品 / 删除评论；通知举报人；写审计',
  }),
  deleteComment: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/comments/:commentId/delete`,
    auth: 'admin',
    params: z.object({ commentId: Id }),
    body: AdminReason,
    response: NoContent,
    summary: '删除任何评论（原因必填）；写审计',
  }),
  banAuthor: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/users/:userId/ban`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: z.object({
      until: z.union([Timestamp, z.literal('permanent')]),
      reason: z.string().trim().min(1).max(200),
    }),
    response: NoContent,
    summary: '停止发布与评论权限（ADM-09 第 4 条）：期间其作品全部不展示；写审计',
  }),
  unbanAuthor: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/plaza/users/:userId/unban`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: AdminReason,
    response: NoContent,
    summary: '恢复权限，作品重新展示（被单独下架的除外）；写审计',
  }),
} as const;
