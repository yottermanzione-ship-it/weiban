/**
 * push 模块：推送设备登记与通知载荷格式。
 * 需求：CHAT-10、ACC-01（退出不再推送）、ACC-03；余额 / 模型状态提醒（billing.md 第 6.4 节）。
 * 推送规则见 docs/architecture/message-reliability.md 第 7 节。
 * 安卓推送通道的具体厂商由 Android 负责人评估（D-L1-06），契约只约束格式，新增通道属于次版本变更。
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
import { ModelKey } from './model-access.js';

export const WebPushSubscription = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const AndroidPushProvider = z.enum([
  'fcm',
  'jpush',
  'getui',
  'xiaomi',
  'huawei',
  'honor',
  'oppo',
  'vivo',
]);
export type AndroidPushProvider = z.infer<typeof AndroidPushProvider>;

export const RegisterPushDeviceRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webpush'), subscription: WebPushSubscription }),
  z.object({
    kind: z.literal('android'),
    provider: AndroidPushProvider,
    token: z.string().min(1).max(4096),
  }),
]);
export type RegisterPushDeviceRequest = z.infer<typeof RegisterPushDeviceRequest>;

export const PushDevice = z.object({
  pushDeviceId: Id,
  kind: z.enum(['webpush', 'android']),
  /** 绑定的登录会话；会话失效（退出登录、被踢下线）时自动删除。 */
  sessionId: Id,
  createdAt: Timestamp,
});

/** v1.3：新增 admin_alert（管理员提醒，只发给管理员账号的设备，billing.md 8.4 节）。 */
export const NotificationKind = z.enum([
  'message',
  'call',
  'model_status',
  'balance',
  'system',
  'admin_alert',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * 通知载荷：服务器发给 Service Worker / 安卓原生的数据格式。
 * 两端都按此渲染通知，点击时打开 deepLink。
 */
export const NotificationPayload = z.object({
  v: z.literal(1),
  /**
   * balance：余额不足 / 过低提醒（v0.2 新增）。新增种类是次版本变更：
   * 客户端不认识的种类解析为 'unsupported'，按普通通知显示（标题、正文、deepLink）。
   */
  kind: tolerantEnum(NotificationKind),
  /** 合并键：同一会话的多条消息用同一个键，新通知替换旧通知（CHAT-10 第 5 条）。 */
  collapseKey: z.string().max(64),
  title: z.string().max(64),
  /**
   * 正文。以下情况由服务器替换为「发来一条消息」类的通用文案：
   * 用户关闭显示内容（ACC-03）；成人范围消息是否替换以 PRD v1.2 为准（v0.2 起不再是硬性边界）。
   */
  body: z.string().max(200),
  /** 同一合并键下的累计条数，>1 时显示「发来 N 条消息」。 */
  count: z.number().int().positive(),
  /** 应用内路由，例："/chat/{conversationId}"。 */
  deepLink: z.string().startsWith('/'),
  conversationId: Id.nullable(),
  /** 是否播放声音（ACC-03 推送声音、会话免打扰）。 */
  sound: z.boolean(),
  sentAt: z.iso.datetime(),
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

export const PushEndpoints = {
  getVapidPublicKey: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/push/vapid-public-key`,
    auth: 'user',
    response: z.object({ publicKey: z.string() }),
    summary: 'Web Push 公钥（网页 / iPhone PWA 订阅推送用）',
  }),
  registerDevice: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/push/devices`,
    auth: 'user',
    body: RegisterPushDeviceRequest,
    response: PushDevice,
    summary: '登记推送设备，绑定到当前登录会话；同一凭证重复登记返回同一设备（幂等）',
  }),
  unregisterDevice: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/push/devices/:pushDeviceId`,
    auth: 'user',
    params: z.object({ pushDeviceId: Id }),
    response: NoContent,
    summary: '取消推送',
  }),
} as const;

// ---------- 管理员提醒（v1.3，T-026） ----------
// 设计见 docs/architecture/billing.md 8.4 节。需要总经理处理的平台运行问题（平台预算 80%、对账异常、
// 上游余额用完 / 密钥失效 / 持续不可用）统一用事件 platform.admin_alert_raised 发出；push 订阅后存进
// 管理员提醒列表（管理后台红点）并推送到管理员账号的设备。数据归 push（表 push.admin_alerts）。

/** 提醒种类。新增种类是次版本变更；管理后台读 AdminAlert.kind 时用接收端容错（不认识的显示「其他提醒」）。 */
export const AdminAlertKind = z.enum([
  /** 平台当天成本（已结算 + 预留中）达到每日总上限的 80%。发出方 billing。 */
  'platform_budget_warning',
  /** 每日对账发现异常。发出方 billing（第 ①、③ 层）或 model_access（第 ② 层）。 */
  'reconciliation_flagged',
  /** 平台在某上游的余额用完，需要去供应商处充值。发出方 model_access。 */
  'upstream_quota_exhausted',
  /** 平台密钥无效 / 被作废。发出方 model_access。 */
  'upstream_invalid',
  /** 上游重试后仍不可用（探测持续失败）。发出方 model_access。 */
  'upstream_unavailable',
  /** 之前报过的上游问题已恢复（上游状态回到 active）。发出方 model_access。 */
  'upstream_recovered',
]);
export type AdminAlertKind = z.infer<typeof AdminAlertKind>;

/** info：只进列表、不推送；warning / critical：进列表并推送（同一合并键未处理期间只推一次）。 */
export const AdminAlertSeverity = z.enum(['info', 'warning', 'critical']);
export type AdminAlertSeverity = z.infer<typeof AdminAlertSeverity>;

/**
 * 管理员提醒的「事实」部分：事件 platform.admin_alert_raised 的载荷。
 * 只放 ID、日期和服务器生成的固定文案，**不放**用户名、用户 ID、消息内容、密钥（事件与提醒列表都会持久化）。
 */
export const AdminAlertFacts = z.object({
  kind: AdminAlertKind,
  severity: AdminAlertSeverity,
  /**
   * 合并键：同一个问题重复发生时用同一个键（例 `platform_budget_warning:2026-10-06`、
   * `upstream_quota_exhausted:{upstreamId}`、`reconciliation_flagged:2026-10-05`）。
   * 同一个键还有未处理的提醒时，push 只累加次数、更新说明，不新建、不重复推送。
   */
  dedupeKey: z.string().min(1).max(128),
  /** 一句话说明，发出方按种类用固定模板生成，例「平台今日成本已达上限的 80%（25.60 / 32.00 元）」。 */
  summary: z.string().min(1).max(200),
  /** 相关对象（可选）：管理后台据此生成跳转链接（上游页、模型目录、对账页）。 */
  refs: z
    .object({
      upstreamId: Id.optional(),
      modelKey: ModelKey.optional(),
      /** 相关日期（北京时间自然日），例如对账日、预算日。 */
      day: LocalDate.optional(),
    })
    .optional(),
});
export type AdminAlertFacts = z.infer<typeof AdminAlertFacts>;

/** 管理后台看到的一条提醒（服务器响应，种类与级别用接收端容错）。 */
export const AdminAlert = AdminAlertFacts.extend({
  alertId: Id,
  kind: tolerantEnum(AdminAlertKind),
  severity: tolerantEnum(AdminAlertSeverity),
  /** 合并后的发生次数（≥ 1）。 */
  occurrences: z.number().int().positive(),
  firstRaisedAt: Timestamp,
  lastRaisedAt: Timestamp,
  /** 管理员点「已处理」的时间；null = 未处理（计入红点）。 */
  acknowledgedAt: Timestamp.nullable(),
  acknowledgedByUserId: Id.nullable(),
});
export type AdminAlert = z.infer<typeof AdminAlert>;

export const PushAdminEndpoints = {
  listAdminAlerts: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/alerts`,
    auth: 'admin',
    query: z.object({
      /** open = 只看未处理；all = 全部（保留 90 天）。 */
      status: z.enum(['open', 'all']).default('open'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    response: cursorPage(AdminAlert).extend({
      /** 未处理提醒总数（管理后台红点）。 */
      openCount: z.number().int().nonnegative(),
    }),
    summary: 'v1.3：管理员提醒列表（按最后发生时间从新到旧）与未处理数',
  }),
  acknowledgeAdminAlert: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/alerts/:alertId/acknowledge`,
    auth: 'admin',
    params: z.object({ alertId: Id }),
    response: AdminAlert,
    summary:
      'v1.3：标记为已处理（幂等，已处理的直接返回）；之后同一合并键再发生会新建一条提醒并重新推送',
  }),
} as const;
