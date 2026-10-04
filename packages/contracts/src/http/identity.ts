/**
 * identity 模块：注册、登录、会话、我的资料、年龄确认、全局通知设置、注销。
 * 需求：ACC-01、ACC-02、ACC-03、ACC-06。规则见 docs/architecture/security-and-privacy.md 第 2、5 节。
 */
import { z } from 'zod';
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
  /**
   * 是否已完成「我已年满 18 周岁」确认（ACC-02 第 2 条）。
   * v0.2：不再是成人模式的前置条件（硬性边界只剩两条底线）；是否保留此确认由 PRD v1.2 决定，若取消则下个主版本删除。
   */
  ageConfirmed: z.boolean(),
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

export const Profile = z.object({
  nickname: z.string().min(1).max(20).nullable(),
  avatarMediaId: Id.nullable(),
  birthday: LocalDate.nullable(),
  gender: Gender.default('unspecified'),
  city: z.string().max(32).nullable(),
  about: z.string().max(500).nullable(),
  /** 用户时区；客户端每次连接上报设备时区，服务器据此更新（SIM-04 以设备时区为准）。 */
  timeZone: TimeZone,
  updatedAt: Timestamp,
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileRequest = Profile.omit({ updatedAt: true }).partial();

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
  confirmAge: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/age-confirmation`,
    auth: 'user',
    body: z.object({ confirmedAdult: z.literal(true) }),
    response: CurrentUser,
    summary: '确认「我已年满 18 周岁」（ACC-02 第 2 条），不可撤销',
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
    summary: '注销账号（ACC-06，L6 完成全部模块删除清单）。立即下线所有设备，各模块（含钱包与流水）随后物理删除',
  }),
} as const;

// ---------- 管理接口 ----------

export const Invite = z.object({
  code: z.string(),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  usedAt: Timestamp.nullable(),
});

export const IdentityAdminEndpoints = {
  createInvite: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    body: z.object({ expiresInDays: z.number().int().min(1).max(365).nullable() }),
    response: Invite,
    summary: '生成一次性邀请码',
  }),
  listInvites: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    response: z.object({ items: z.array(Invite) }),
    summary: '邀请码列表',
  }),
} as const;
