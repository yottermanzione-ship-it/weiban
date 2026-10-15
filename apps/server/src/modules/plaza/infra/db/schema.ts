/**
 * plaza 模块的表（T-087，迁移 0060～0062）。设计见 docs/architecture/persona-plaza.md 第 3 节。
 * 作品内容是用户主动公开发布的内容，明文保存；快照字段严格按契约 PlazaSnapshot（白名单）。
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PlazaSnapshot, PlazaSnapshotClassification } from '@weiban/contracts';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const plazaSchema = pgSchema('plaza');

export interface PublishSettingsJson {
  tagline: string;
  publishNote: string;
  allowRemix: boolean;
  commentsOpen: boolean;
}

export interface DraftSpanJson {
  spanId: string;
  fieldKey: string;
  start: number;
  end: number;
  kinds: string[];
}

export type DraftSourceJson =
  | { kind: 'custom_character'; characterId: string }
  | { kind: 'preset_variant'; presetCharacterId: string };

export const authorProfiles = plazaSchema.table('author_profiles', {
  userId: uuid('user_id').primaryKey(),
  /** 广场上的身份 ID（不是 userId，不能反查账号）。 */
  authorId: uuid('author_id').notNull().unique(),
  nickname: text('nickname').notNull(),
  /** purpose = plaza_avatar 的公开副本（ownerUserId = null）。 */
  avatarMediaId: uuid('avatar_media_id'),
  createdAt: time('created_at').notNull(),
  updatedAt: time('updated_at').notNull(),
});

/** 停止发布与评论权限（ADM-09 第 4 条）。 */
export const bans = plazaSchema.table('bans', {
  userId: uuid('user_id').primaryKey(),
  until: time('until'),
  permanent: boolean('permanent').notNull().default(false),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: time('created_at').notNull(),
});

export const works = plazaSchema.table(
  'works',
  {
    id: uuid('id').primaryKey(),
    authorUserId: uuid('author_user_id').notNull(),
    kind: text('kind').$type<'custom_character' | 'preset_variant'>().notNull(),
    /** 自定义角色：作者自己的角色；预设改版：补充设定所属的预设角色。 */
    sourceCharacterId: uuid('source_character_id').notNull(),
    basedOnPresetId: uuid('based_on_preset_id'),
    basedOnPresetName: text('based_on_preset_name'),
    /** 改编自（PLZ-04 第 6 条，不可删除）。 */
    originWorkId: uuid('origin_work_id'),
    originWorkName: text('origin_work_name'),
    originAuthorUserId: uuid('origin_author_user_id'),
    originAuthorNickname: text('origin_author_nickname'),
    /** 以下为当前版本的冗余列，便于列表、搜索、筛选。 */
    name: text('name').notNull(),
    basis: text('basis').$type<'real_person' | 'fictional' | 'original'>(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    avatarMediaId: uuid('avatar_media_id'),
    tagline: text('tagline').notNull(),
    publishNote: text('publish_note').notNull().default(''),
    allowRemix: boolean('allow_remix').notNull().default(true),
    commentsOpen: boolean('comments_open').notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    status: text('status')
      .$type<'listed' | 'unlisted_by_author' | 'removed_by_admin'>()
      .notNull()
      .default('listed'),
    removedReason: text('removed_reason'),
    /** 0074（契约 3.1，积压 ㊱）：作者上次打开作品的时间；之后新增的点赞 + 评论计入「我发布的」红点 unreadCount。 */
    authorSeenAt: time('author_seen_at'),
    likeCount: integer('like_count').notNull().default(0),
    adoptCount: integer('adopt_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    publishedAt: time('published_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('works_source_idx').on(t.authorUserId, t.kind, t.sourceCharacterId),
    index('works_author_idx').on(t.authorUserId, t.publishedAt),
  ],
);

/** 版本快照：只增不改（数据库触发器禁止 UPDATE）。 */
export const workVersions = plazaSchema.table(
  'work_versions',
  {
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<PlazaSnapshot>().notNull(),
    settings: jsonb('settings').$type<PublishSettingsJson>().notNull(),
    /** 快照分类的冗余列；预设改版为 null。 */
    classification: jsonb('classification').$type<PlazaSnapshotClassification>(),
    changeNote: text('change_note'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.version] })],
);

export const publishDrafts = plazaSchema.table('publish_drafts', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  workId: uuid('work_id'),
  source: jsonb('source').$type<DraftSourceJson>().notNull(),
  /** 未遮盖的待发布快照；确认时按用户选择遮盖后写入版本。 */
  snapshot: jsonb('snapshot').$type<PlazaSnapshot>().notNull(),
  spans: jsonb('spans')
    .$type<DraftSpanJson[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  childFeaturesDetected: boolean('child_features_detected').notNull().default(false),
  originWorkId: uuid('origin_work_id'),
  consumedWorkId: uuid('consumed_work_id'),
  expiresAt: time('expires_at').notNull(),
  createdAt: time('created_at').notNull(),
});

export const adoptions = plazaSchema.table(
  'adoptions',
  {
    /** 客户端生成的幂等键 adoptionId。 */
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    workId: uuid('work_id').notNull(),
    version: integer('version').notNull(),
    kind: text('kind').$type<'copy' | 'apply'>().notNull(),
    /** copy：复制得到的新角色；apply：被应用改版的预设角色。 */
    characterId: uuid('character_id').notNull(),
    updateDismissedVersion: integer('update_dismissed_version').notNull().default(0),
    /** 作者已注销、作品随之删除的时间（迁移 0056，T-080；来源显示「已注销用户」）。 */
    authorDeletedAt: time('author_deleted_at'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    index('adoptions_work_idx').on(t.workId, t.createdAt),
    index('adoptions_user_idx').on(t.userId, t.characterId),
  ],
);

export const likes = plazaSchema.table(
  'likes',
  {
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    createdAt: time('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.userId] }), index('likes_user_idx').on(t.userId)],
);

export const comments = plazaSchema.table(
  'comments',
  {
    id: uuid('id').primaryKey(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    replyToCommentId: uuid('reply_to_comment_id'),
    replyToUserId: uuid('reply_to_user_id'),
    text: text('text').notNull(),
    createdAt: time('created_at').notNull(),
    deletedAt: time('deleted_at'),
    deletedBy: text('deleted_by').$type<'commenter' | 'work_author' | 'admin'>(),
  },
  (t) => [
    uniqueIndex('comments_client_idx').on(t.authorUserId, t.clientRequestId),
    index('comments_work_idx').on(t.workId, t.createdAt, t.id),
  ],
);

export const reports = plazaSchema.table(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterUserId: uuid('reporter_user_id').notNull(),
    targetKind: text('target_kind').$type<'work' | 'comment'>().notNull(),
    targetId: uuid('target_id').notNull(),
    workId: uuid('work_id').notNull(),
    reason: text('reason')
      .$type<'rights' | 'hard_boundary' | 'inappropriate' | 'other'>()
      .notNull(),
    note: text('note'),
    status: text('status')
      .$type<'pending' | 'dismissed' | 'actioned'>()
      .notNull()
      .default('pending'),
    resolutionReason: text('resolution_reason'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: time('resolved_at'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('reports_once_idx').on(t.reporterUserId, t.targetKind, t.targetId),
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_work_idx').on(t.workId),
  ],
);

export type NoticeKind =
  'work_liked' | 'work_commented' | 'comment_replied' | 'report_resolved' | 'work_removed_by_admin';

export const notices = plazaSchema.table(
  'notices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').$type<NoticeKind>().notNull(),
    workId: uuid('work_id'),
    text: text('text').notNull(),
    seen: boolean('seen').notNull().default(false),
    createdAt: time('created_at').notNull(),
  },
  (t) => [index('notices_user_idx').on(t.userId, t.createdAt)],
);

export type WorkRow = typeof works.$inferSelect;
export type VersionRow = typeof workVersions.$inferSelect;
export type ProfileRow = typeof authorProfiles.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type AdoptionRow = typeof adoptions.$inferSelect;

// ---------- 3.5：「微伴角色」tab 与申请制作（迁移 0090） ----------

/** 官方预设角色的点赞（characterId 指 characters 的预设角色，跨模块不加外键）。 */
export const officialLikes = plazaSchema.table(
  'official_likes',
  {
    characterId: uuid('character_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.userId] }),
    index('official_likes_user_idx').on(t.userId),
  ],
);

export const officialComments = plazaSchema.table(
  'official_comments',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    replyToCommentId: uuid('reply_to_comment_id'),
    replyToUserId: uuid('reply_to_user_id'),
    text: text('text').notNull(),
    createdAt: time('created_at').notNull(),
    deletedAt: time('deleted_at'),
    deletedBy: text('deleted_by').$type<'commenter' | 'admin'>(),
  },
  (t) => [
    uniqueIndex('official_comments_client_idx').on(t.authorUserId, t.clientRequestId),
    index('official_comments_character_idx').on(t.characterId, t.createdAt, t.id),
    index('official_comments_created_idx').on(t.createdAt),
  ],
);

export type RoleRequestStatusValue =
  'pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';

export interface RoleRequestHistoryJson {
  status: RoleRequestStatusValue;
  message: string | null;
  at: string;
  by: 'user' | 'admin';
}

/**
 * 角色制作申请。内容是用户主动提交给官方制作的资料（管理员要读），明文保存；
 * 参考图在 media（purpose = role_request_image，只有本人可读，管理员经详情取短期链接）。
 */
export const roleRequests = plazaSchema.table(
  'role_requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    roleName: text('role_name').notNull(),
    basis: text('basis').$type<'real_person' | 'fictional' | 'original'>(),
    categoryId: text('category_id'),
    sourceWork: text('source_work').notNull().default(''),
    referenceText: text('reference_text').notNull().default(''),
    referenceMediaIds: uuid('reference_media_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    note: text('note').notNull().default(''),
    status: text('status').$type<RoleRequestStatusValue>().notNull().default('pending'),
    adminMessage: text('admin_message'),
    characterId: uuid('character_id'),
    addedToContacts: boolean('added_to_contacts').notNull().default(false),
    pointsCost: integer('points_cost').notNull().default(0),
    pointsCharged: integer('points_charged').notNull().default(0),
    freeQuotaApplied: boolean('free_quota_applied').notNull().default(false),
    /** 0092（Q5）：billing 服务费冻结 ID；价格为 0 时为空。 */
    feeHoldId: uuid('fee_hold_id'),
    /** 0092：none（不收费）/ held（冻结中）/ settled（已扣除）/ released（已退回）。 */
    feeState: text('fee_state')
      .$type<'none' | 'held' | 'settled' | 'released'>()
      .notNull()
      .default('none'),
    handledBy: uuid('handled_by'),
    history: jsonb('history')
      .$type<RoleRequestHistoryJson[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 状态变化后用户还没看过（红点）。 */
    userUnseen: boolean('user_unseen').notNull().default(false),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('role_requests_client_idx').on(t.userId, t.clientRequestId),
    index('role_requests_user_idx').on(t.userId, t.createdAt),
    index('role_requests_status_idx').on(t.status, t.createdAt),
    index('role_requests_fee_idx').on(t.feeState),
    index('role_requests_free_quota_idx').on(t.userId,t.createdAt).where(sql`${t.freeQuotaApplied} = true`),
  ],
);

/** plaza 的键值设置（键 role_request_config）。 */
export const plazaSettings = plazaSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: time('updated_at').notNull(),
});

export type OfficialCommentRow = typeof officialComments.$inferSelect;
export type RoleRequestRow = typeof roleRequests.$inferSelect;
