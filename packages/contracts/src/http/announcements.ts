/**
 * 公告与更新说明（换壳 UI 批次，契约 3.2 次版本新增）。数据归 identity 模块（表 identity.announcements 等）。
 *
 * 和旧版的区别（详见 docs/backend/announcements.md）：
 * - 旧版公告 = 「小 V」官方角色给每个人各发一条主动消息，发出后不能改、不能撤回，发送之后注册的人收不到。
 *   新版公告是独立的一条记录，按生效时间和目标平台实时筛选：可编辑、可撤回、新用户也能看到；已读回执存服务器，多端同步。
 * - 旧版更新说明只有「最新版本」一段文字，跳过中间版本的人看不到；网页版完全没有。
 *   新版按版本号逐条维护，用户端一次拿到「上次看过的版本之后」的全部说明，只弹一次。
 * - 强制更新只看一个「最低可用版本号」（安卓 versionCode / 网页构建号），不再有容易用错的软更新开关组合。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

/** 公告与更新说明用的平台（iOS 主屏网页按 web）。网页版本号用网页构建号（整数，每次部署递增），安卓用 versionCode。 */
export const ReleasePlatform = z.enum(['web', 'android']);
export type ReleasePlatform = z.infer<typeof ReleasePlatform>;

/** 整数版本号（安卓 versionCode / 网页构建号）。 */
export const VersionCode = z.coerce.number().int().positive().max(2_000_000_000);

// ---------- 公告 ----------

const AnnouncementFields = z.object({
  title: z.string().trim().min(1).max(60),
  /** 纯文本，换行保留；客户端不解析 HTML。 */
  body: z.string().trim().min(1).max(4000),
  /** 目标平台；空数组 = 所有平台。 */
  platforms: z.array(ReleasePlatform).max(2),
  /** 生效时间；null = 发布即生效。 */
  startsAt: Timestamp.nullable(),
  /** 结束时间；null = 一直有效直到撤回。 */
  endsAt: Timestamp.nullable(),
  /** 未读时打开应用自动弹窗一次（读过后不再弹）。 */
  popup: z.boolean(),
  /** 置顶：公告列表排在最前。 */
  pinned: z.boolean(),
});

/** 用户端看到的公告（只返回已发布、在生效期内、平台匹配的）。 */
export const Announcement = AnnouncementFields.extend({
  announcementId: Id,
  publishedAt: Timestamp,
  updatedAt: Timestamp,
  /** 本人已读时间；null = 未读。管理员编辑时选择「重新提醒」会清空所有人的已读。 */
  readAt: Timestamp.nullable(),
});
export type Announcement = z.infer<typeof Announcement>;

export const AnnouncementStatus = z.enum(['draft', 'published', 'withdrawn']);

export const AdminAnnouncement = AnnouncementFields.extend({
  announcementId: Id,
  status: tolerantEnum(AnnouncementStatus),
  publishedAt: Timestamp.nullable(),
  withdrawnAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** 已读人数。 */
  readCount: z.number().int().nonnegative(),
});
export type AdminAnnouncement = z.infer<typeof AdminAnnouncement>;

export const AnnouncementWrite = AnnouncementFields.extend({
  platforms: z.array(ReleasePlatform).max(2).default([]),
  startsAt: Timestamp.nullable().default(null),
  endsAt: Timestamp.nullable().default(null),
  popup: z.boolean().default(false),
  pinned: z.boolean().default(false),
});

export const AnnouncementEndpoints = {
  listAnnouncements: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/announcements`,
    auth: 'user',
    query: z.object({ platform: ReleasePlatform }),
    response: z.object({
      /** 置顶在前，其余按发布时间倒序；最多 50 条。 */
      items: z.array(Announcement),
      unreadCount: z.number().int().nonnegative(),
    }),
    summary:
      '当前有效的公告（打开应用、回到前台时拉取）。popup = true 且 readAt = null 的按发布时间从旧到新依次弹窗',
  }),
  markAnnouncementsRead: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/announcements/read`,
    auth: 'user',
    body: z.object({ announcementIds: z.array(Id).min(1).max(50) }),
    response: NoContent,
    summary:
      '已读回执（关闭弹窗或打开公告详情时调用）；幂等，不存在或已撤回的 id 忽略；本人所有设备同步',
  }),
} as const;

export const AnnouncementAdminEndpoints = {
  listAnnouncements: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/announcements`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminAnnouncement) }),
    summary: '全部公告（含草稿、已撤回），按创建时间倒序',
  }),
  createAnnouncement: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/announcements`,
    auth: 'admin',
    body: AnnouncementWrite.extend({ publish: z.boolean().default(false) }),
    response: AdminAnnouncement,
    summary:
      '新建公告；publish = true 直接发布，否则存为草稿。endsAt 早于 startsAt 返回 400；写审计',
  }),
  updateAnnouncement: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/announcements/:announcementId`,
    auth: 'admin',
    params: z.object({ announcementId: Id }),
    body: AnnouncementWrite.partial().extend({
      /** true = 清空所有人的已读，让大家重新看到（含弹窗）。 */
      resetReads: z.boolean().optional(),
    }),
    response: AdminAnnouncement,
    summary: '编辑公告（草稿和已发布都可改，已撤回的 409）；写审计',
  }),
  publishAnnouncement: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/announcements/:announcementId/publish`,
    auth: 'admin',
    params: z.object({ announcementId: Id }),
    response: AdminAnnouncement,
    summary: '发布草稿，或重新发布已撤回的公告；已发布的原样返回',
  }),
  withdrawAnnouncement: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/announcements/:announcementId/withdraw`,
    auth: 'admin',
    params: z.object({ announcementId: Id }),
    response: AdminAnnouncement,
    summary: '撤回：用户端立即不再返回；已撤回的原样返回',
  }),
  deleteAnnouncement: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/announcements/:announcementId`,
    auth: 'admin',
    params: z.object({ announcementId: Id }),
    response: NoContent,
    summary: '删除草稿或已撤回的公告（连同已读回执）；已发布的需先撤回（409）',
  }),
} as const;

// ---------- 更新说明与版本 ----------

const ReleaseNoteFields = z.object({
  platform: ReleasePlatform,
  /** 显示用版本名，例 "1.4.0"。 */
  version: z.string().trim().min(1).max(32),
  versionCode: VersionCode,
  title: z.string().trim().max(60),
  /** 本版本新内容，纯文本，换行保留。 */
  body: z.string().trim().min(1).max(4000),
});

export const ReleaseNote = ReleaseNoteFields.extend({
  releaseNoteId: Id,
  publishedAt: Timestamp,
});
export type ReleaseNote = z.infer<typeof ReleaseNote>;

export const AdminReleaseNote = ReleaseNoteFields.extend({
  releaseNoteId: Id,
  /** false = 草稿，用户端不返回。 */
  published: z.boolean(),
  publishedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type AdminReleaseNote = z.infer<typeof AdminReleaseNote>;

/** 某个平台的版本策略（每个平台一行）。 */
export const AppVersionPolicy = z.object({
  platform: ReleasePlatform,
  /** 最新版本；null = 未设置（不提示更新）。 */
  latestVersion: z.string().max(32).nullable(),
  latestVersionCode: z.number().int().positive().nullable(),
  /** 安装包下载地址（安卓）；网页为 null，「更新」就是刷新页面。 */
  downloadUrl: z.url().max(1000).nullable(),
  /** 最低可用版本号：低于它必须更新才能继续用；null = 不限制。 */
  minSupportedVersionCode: z.number().int().positive().nullable(),
  /** 强制更新时弹窗里的说明；null 用客户端默认文案。 */
  forceUpdateMessage: z.string().max(200).nullable(),
  updatedAt: Timestamp.nullable(),
});
export type AppVersionPolicy = z.infer<typeof AppVersionPolicy>;

export const ClientVersionQuery = z.object({ platform: ReleasePlatform, versionCode: VersionCode });

export const ReleaseEndpoints = {
  checkVersion: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/app/version-check`,
    auth: 'none',
    query: ClientVersionQuery,
    response: z.object({
      platform: ReleasePlatform,
      latestVersion: z.string().nullable(),
      latestVersionCode: z.number().int().positive().nullable(),
      downloadUrl: z.string().nullable(),
      minSupportedVersionCode: z.number().int().positive().nullable(),
      /** 有比当前更新的版本。 */
      updateAvailable: z.boolean(),
      /** 当前版本低于最低可用版本：弹不可关闭的更新提示。 */
      updateRequired: z.boolean(),
      forceUpdateMessage: z.string().nullable(),
      /** 最新版本的更新说明（有则返回，用于「发现新版本」弹窗）。 */
      latestNote: ReleaseNote.nullable(),
    }),
    summary:
      '启动时检查更新（登录前也可调用）。安卓：updateRequired 时只能去下载；updateAvailable 时提示一次（客户端记住「以后再说」的版本号）。网页：updateRequired 时提示刷新',
  }),
  listReleaseNotes: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/app/release-notes`,
    auth: 'user',
    query: ClientVersionQuery,
    response: z.object({
      /** 版本号不高于当前的已发布说明，新的在前，最多 20 条（「关于 › 更新日志」）。 */
      items: z.array(ReleaseNote),
      /**
       * 首次打开新版本时要弹的说明：上次看过的版本之后、到当前版本为止的全部说明（新的在前，最多 5 条）；
       * 从没看过时只含当前版本这一条（若有）。已看过当前版本则为空数组，不弹。
       */
      whatsNew: z.array(ReleaseNote),
      lastSeenVersionCode: z.number().int().positive().nullable(),
    }),
    summary: '更新说明与「本版新功能」弹窗内容',
  }),
  markReleaseNotesSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/app/release-notes/seen`,
    auth: 'user',
    body: ClientVersionQuery,
    response: NoContent,
    summary: '「本版新功能」弹窗已看过（关闭弹窗时调用）；只前进不后退，幂等；同平台多设备共享',
  }),
} as const;

export const ReleaseAdminEndpoints = {
  listReleaseNotes: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/release-notes`,
    auth: 'admin',
    query: z.object({ platform: ReleasePlatform.optional() }),
    response: z.object({ items: z.array(AdminReleaseNote) }),
    summary: '更新说明列表（含草稿），按平台、版本号倒序',
  }),
  createReleaseNote: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/release-notes`,
    auth: 'admin',
    body: ReleaseNoteFields.extend({
      title: z.string().trim().max(60).default(''),
      published: z.boolean().default(true),
    }),
    response: AdminReleaseNote,
    summary: '新增某版本的更新说明；同平台同版本号已存在 409；写审计',
  }),
  updateReleaseNote: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/release-notes/:releaseNoteId`,
    auth: 'admin',
    params: z.object({ releaseNoteId: Id }),
    body: ReleaseNoteFields.omit({ platform: true, versionCode: true })
      .extend({ published: z.boolean() })
      .partial(),
    response: AdminReleaseNote,
    summary: '修改版本名、标题、正文、发布状态（平台与版本号不可改，填错就删掉重建）',
  }),
  deleteReleaseNote: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/release-notes/:releaseNoteId`,
    auth: 'admin',
    params: z.object({ releaseNoteId: Id }),
    response: NoContent,
    summary: '删除更新说明',
  }),
  listVersionPolicies: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/app-version-policies`,
    auth: 'admin',
    response: z.object({ items: z.array(AppVersionPolicy) }),
    summary: '各平台版本策略（web、android 各一行；没设置过的返回全 null）',
  }),
  updateVersionPolicy: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/app-version-policies/:platform`,
    auth: 'admin',
    params: z.object({ platform: ReleasePlatform }),
    body: AppVersionPolicy.omit({ platform: true, updatedAt: true }),
    response: AppVersionPolicy,
    summary:
      '设置最新版本、下载地址、最低可用版本；最低可用版本不能高于最新版本号（400），防止把所有人锁死；写审计',
  }),
} as const;
