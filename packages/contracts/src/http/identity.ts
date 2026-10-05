/**
 * identity 模块：注册、登录、会话、我的资料、全局通知设置、界面偏好（主题）、注销。
 * 需求：ACC-01、ACC-02、ACC-03、ACC-06、SVC-01 第 7 条。规则见 docs/architecture/security-and-privacy.md 第 2、5 节。
 * v1.0：删除年龄确认（PRD v1.2 取消 ACC-02 第 2 条）；新增界面偏好（主题多设备同步）。
 * v1.2（T-024）：邀请码注册赠送余额（ADM-01 第 6 条）；管理接口「注销未完成」列表与重新触发删除
 * （security-and-privacy.md 5.1 第 2 条）；注销时密码错误的返回写明（403 invalid_credentials）。
 */
import { z } from 'zod';
import { ModuleName } from '../events.js';
import {
  API_PREFIX,
  DeviceInfo,
  Id,
  LocalDate,
  LocalTime,
  NoContent,
  TimeZone,
  Timestamp,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';

// ---------- 账号与会话 ----------

export const Username = z
  .string()
  .regex(/^[A-Za-z0-9_]{4,32}$/, '用户名为 4–32 位字母、数字或下划线');

export const Password = z.string().min(10).max(128);

export const UserRole = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const SessionKind = z.enum(['app', 'admin']);
export type SessionKind = z.infer<typeof SessionKind>;

export const AuthenticatedSession = z.object({
  sessionId: Id,
  /** 会话令牌原文，只在登录 / 注册响应中出现这一次；之后放在 Authorization: Bearer 中。 */
  token: z.string().min(32),
  kind: SessionKind,
  expiresAt: Timestamp,
});
export type AuthenticatedSession = z.infer<typeof AuthenticatedSession>;

export const CurrentUser = z.object({
  userId: Id,
  username: Username,
  role: UserRole,
  /** 是否已填写必填昵称（首次引导判断用，ACC-04）。 */
  profileCompleted: z.boolean(),
  createdAt: Timestamp,
});
export type CurrentUser = z.infer<typeof CurrentUser>;

export const AuthResponse = z.object({
  session: AuthenticatedSession,
  user: CurrentUser,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const RegisterRequest = z.object({
  username: Username,
  password: Password,
  inviteCode: z.string().min(6).max(64),
  device: DeviceInfo,
});

export const LoginRequest = z.object({
  username: Username,
  password: Password,
  device: DeviceInfo,
  /** app：手机 / 网页用户端；admin：管理后台（仅管理员可用，12 小时过期）。 */
  kind: SessionKind.default('app'),
});

export const SessionSummary = z.object({
  sessionId: Id,
  kind: SessionKind,
  device: DeviceInfo,
  createdAt: Timestamp,
  lastActiveAt: Timestamp,
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// ---------- 我的资料（ACC-02） ----------

export const Gender = z.enum(['female', 'male', 'other', 'unspecified']);

/** 资料的可写字段。不带默认值：修改请求只改传了的字段（Q-001）。新账号的默认值由服务器在注册时写入。 */
const profileFields = {
  nickname: z.string().min(1).max(20).nullable(),
  avatarMediaId: Id.nullable(),
  birthday: LocalDate.nullable(),
  /** 新账号为 unspecified。 */
  gender: Gender,
  city: z.string().max(32).nullable(),
  about: z.string().max(500).nullable(),
  /** 用户时区；客户端每次连接上报设备时区，服务器据此更新（SIM-04 以设备时区为准）。 */
  timeZone: TimeZone,
};

export const Profile = z.object({ ...profileFields, updatedAt: Timestamp });
export type Profile = z.infer<typeof Profile>;

/** 修改资料：只传要改的字段；没传的字段保持原值（不会被补成默认值）。 */
export const UpdateProfileRequest = z.object(profileFields).partial();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ---------- 全局通知与免打扰（ACC-03） ----------

export const NotificationSettings = z.object({
  /** 主动消息总开关。 */
  proactiveMessagesEnabled: z.boolean(),
  /** 主动来电总开关，默认关（MED-07）。 */
  proactiveCallsEnabled: z.boolean(),
  pushSoundEnabled: z.boolean(),
  /** 推送是否显示消息内容；关闭后只显示「角色名 发来一条消息」。 */
  pushShowContent: z.boolean(),
  doNotDisturb: z.object({
    enabled: z.boolean(),
    start: LocalTime,
    end: LocalTime,
  }),
  /** 是否允许角色拉我进群（SOC-06 第 4 条），默认开。 */
  allowCharacterGroupInvites: z.boolean(),
  updatedAt: Timestamp,
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const UpdateNotificationSettingsRequest = NotificationSettings.omit({
  updatedAt: true,
}).partial();

// ---------- 界面偏好（SVC-01 第 7 条：主题切换后所有设备同步） ----------

/**
 * 界面主题 id（docs/design/tokens.json 的主题列表）：green = 默认（接近微信），pink = 微伴粉。
 * 新增主题属于次版本变更；读取用 ReceivedAppTheme，客户端不认识的主题按 green 显示。
 */
export const AppTheme = z.enum(['green', 'pink']);
export type AppTheme = z.infer<typeof AppTheme>;
export const ReceivedAppTheme = tolerantEnum(AppTheme);

/**
 * 跟着账号走、所有设备同步的界面偏好。深色模式、字体大小是每台设备自己的设置，不在这里（PRD SVC-01）。
 * 新账号为 green。
 */
export const UserPreferences = z.object({
  theme: ReceivedAppTheme,
  updatedAt: Timestamp,
});
export type UserPreferences = z.infer<typeof UserPreferences>;

export const UpdateUserPreferencesRequest = z.object({ theme: AppTheme }).partial();
export type UpdateUserPreferencesRequest = z.infer<typeof UpdateUserPreferencesRequest>;

// ---------- 接口 ----------

export const IdentityEndpoints = {
  register: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/register`,
    auth: 'none',
    body: RegisterRequest,
    response: AuthResponse,
    summary: '邀请码注册（ACC-01）。错误：invite_invalid、username_taken、password_too_weak',
  }),
  login: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/login`,
    auth: 'none',
    body: LoginRequest,
    response: AuthResponse,
    summary: '登录（ACC-01）。错误：invalid_credentials、account_locked',
  }),
  logout: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/logout`,
    auth: 'user',
    response: NoContent,
    summary: '退出当前设备；同时删除该会话绑定的推送设备（ACC-01 验收第 3 条）',
  }),
  me: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me`,
    auth: 'user',
    response: CurrentUser,
    summary: '当前用户',
  }),
  listSessions: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/sessions`,
    auth: 'user',
    response: z.object({ items: z.array(SessionSummary) }),
    summary: '登录设备列表',
  }),
  revokeSession: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/sessions/:sessionId`,
    auth: 'user',
    params: z.object({ sessionId: Id }),
    response: NoContent,
    summary: '让某台设备下线',
  }),
  getProfile: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/profile`,
    auth: 'user',
    response: Profile,
    summary: '我的资料（ACC-02）',
  }),
  updateProfile: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/profile`,
    auth: 'user',
    body: UpdateProfileRequest,
    response: Profile,
    summary: '修改我的资料；角色从下一次回复起使用新资料',
  }),
  getPreferences: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/preferences`,
    auth: 'user',
    response: UserPreferences,
    summary: '界面偏好（主题），所有设备共用（SVC-01 第 7 条）',
  }),
  updatePreferences: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/preferences`,
    auth: 'user',
    body: UpdateUserPreferencesRequest,
    response: UserPreferences,
    summary:
      '修改界面偏好；本设备立即生效，其他设备收到 settings.updated(section = preferences) 后重新拉取',
  }),
  getNotificationSettings: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/notification-settings`,
    auth: 'user',
    response: NotificationSettings,
    summary: '全局通知与免打扰（ACC-03）',
  }),
  updateNotificationSettings: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/notification-settings`,
    auth: 'user',
    body: UpdateNotificationSettingsRequest,
    response: NotificationSettings,
    summary: '修改全局通知与免打扰',
  }),
  deleteAccount: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me`,
    auth: 'user',
    body: z.object({ password: Password, confirm: z.literal('DELETE') }),
    response: z.object({ status: z.literal('deleting') }),
    summary:
      '注销账号（ACC-06，L6 完成全部模块删除清单），成功 202。立即下线所有设备，各模块（含钱包与流水）随后物理删除。' +
      '密码错误返回 403 invalid_credentials（不用 401：会话仍然有效，客户端不得因此退出登录，engineering-standards 第 4 节第 2 条）',
  }),
} as const;

// ---------- 管理接口：邀请码（ADM-01 第 6 条） ----------

/**
 * v1.2：邀请码预设「注册赠送余额」的上限，1,000 元（微元）。只防管理员手误多打几个 0，
 * 不是产品参数；更大的金额用 billing 的管理员加余额接口。
 */
export const INVITE_BONUS_MAX_MICROS = 1_000_000_000 as const;

export const Invite = z.object({
  code: z.string(),
  /**
   * v1.2：注册赠送余额（微元），0 = 不赠送。用该码注册成功后，billing 给新账号记一条
   * admin_grant 流水，备注「注册赠送」（billing.md 8.3 节）。
   * 服务器**必须**返回；schema 上写成可选只是为了兼容 1.1 的服务器实现，客户端缺省按 0 显示。
   */
  bonusMicros: z.number().int().nonnegative().optional(),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  usedAt: Timestamp.nullable(),
});
export type Invite = z.infer<typeof Invite>;

export const CreateInviteRequest = z.object({
  /** null = 永不过期。 */
  expiresInDays: z.number().int().min(1).max(365).nullable(),
  /** v1.2：注册赠送余额（微元），可省略，默认 0。 */
  bonusMicros: z.number().int().nonnegative().max(INVITE_BONUS_MAX_MICROS).default(0),
});
export type CreateInviteRequest = z.input<typeof CreateInviteRequest>;

// ---------- 管理接口：注销未完成的账号（security-and-privacy.md 5.1 第 2 条） ----------

/** 一个模块对某次注销的删除进度。模块清单 = 当前删除清单登记处的全部模块 ∪ 已回报过的模块。 */
export const AccountDeletionModuleProgress = z.object({
  /** 模块名。新增模块属于次版本变更，管理后台不认识的显示为「其他模块」（接收端容错）。 */
  module: tolerantEnum(ModuleName),
  /** 是否已回报删除完成（platform.user_data_purged）。 */
  purged: z.boolean(),
  deletedRows: z.number().int().nonnegative().nullable(),
  purgedAt: Timestamp.nullable(),
});
export type AccountDeletionModuleProgress = z.infer<typeof AccountDeletionModuleProgress>;

/**
 * 一个处于「注销中」的账号。账号行在全部模块回报后才物理删除，所以这里还能看到用户名
 * （审计日志里仍然只记用户 ID 的哈希）。
 */
export const PendingAccountDeletion = z.object({
  userId: Id,
  username: z.string(),
  requestedAt: Timestamp,
  /** 管理员最近一次手动重新触发的时间；没有触发过为 null。 */
  lastRetriggeredAt: Timestamp.nullable(),
  modules: z.array(AccountDeletionModuleProgress),
});
export type PendingAccountDeletion = z.infer<typeof PendingAccountDeletion>;

export const IdentityAdminEndpoints = {
  createInvite: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    body: CreateInviteRequest,
    response: Invite,
    summary:
      '生成一次性邀请码，成功 201；支持请求头 Idempotency-Key。v1.2：可预设注册赠送余额 bonusMicros（ADM-01 第 6 条）',
  }),
  listInvites: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    response: z.object({ items: z.array(Invite) }),
    summary: '邀请码列表',
  }),
  listPendingDeletions: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/account-deletions`,
    auth: 'admin',
    response: z.object({ items: z.array(PendingAccountDeletion) }),
    summary:
      'v1.2：「注销未完成」的账号（状态为注销中的全部账号，按申请时间从早到晚），含每个模块的删除进度',
  }),
  retryDeletion: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/account-deletions/:userId/retry`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    response: PendingAccountDeletion,
    summary:
      'v1.2：重新触发删除，成功 202。对尚未回报的模块（含注销之后才登记的模块）重新投递删除任务；' +
      '全部模块都已回报时直接完成账号删除。返回触发后的进度快照。可重复调用。账号不存在或不在注销中 → 404 not_found。写审计（只记用户 ID 的哈希）',
  }),
} as const;
