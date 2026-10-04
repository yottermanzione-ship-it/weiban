/**
 * push 模块：推送设备登记与通知载荷格式。
 * 需求：CHAT-10、ACC-01（退出不再推送）、ACC-03；余额 / 模型状态提醒（billing.md 第 6.4 节）。
 * 推送规则见 docs/architecture/message-reliability.md 第 7 节。
 * 安卓推送通道的具体厂商由 Android 负责人评估（D-L1-06），契约只约束格式，新增通道属于次版本变更。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';

export const WebPushSubscription = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const AndroidPushProvider = z.enum(['fcm', 'jpush', 'getui', 'xiaomi', 'huawei', 'honor', 'oppo', 'vivo']);
export type AndroidPushProvider = z.infer<typeof AndroidPushProvider>;

export const RegisterPushDeviceRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webpush'), subscription: WebPushSubscription }),
  z.object({ kind: z.literal('android'), provider: AndroidPushProvider, token: z.string().min(1).max(4096) }),
]);
export type RegisterPushDeviceRequest = z.infer<typeof RegisterPushDeviceRequest>;

export const PushDevice = z.object({
  pushDeviceId: Id,
  kind: z.enum(['webpush', 'android']),
  /** 绑定的登录会话；会话失效（退出登录、被踢下线）时自动删除。 */
  sessionId: Id,
  createdAt: Timestamp,
});

/**
 * 通知载荷：服务器发给 Service Worker / 安卓原生的数据格式。
 * 两端都按此渲染通知，点击时打开 deepLink。
 */
export const NotificationPayload = z.object({
  v: z.literal(1),
  /** balance：余额不足 / 过低提醒（v0.2 新增）。 */
  kind: z.enum(['message', 'call', 'model_status', 'balance', 'system']),
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
