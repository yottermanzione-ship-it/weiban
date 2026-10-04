/**
 * 原生桥：网页（apps/web）与安卓壳（apps/android，Capacitor）之间的接口。
 *
 * 网页只依赖这里的 NativeBridge 接口；在安卓壳里由 Capacitor 插件实现，在浏览器 / iPhone PWA 里
 * 由网页自己的实现顶替（例如推送走 Web Push）。Android 负责人新增原生能力时，先提变更申请扩展本文件。
 * L1 范围：平台信息、推送凭证、通知点击、角标、前后台状态。L5 扩展：语音通话、全屏来电、唤起外部 App。
 */
import { z } from 'zod';
import { ClientPlatform } from './common.js';
import { AndroidPushProvider } from './http/push.js';

export const PlatformInfo = z.object({
  platform: ClientPlatform,
  /** 原生壳版本（安卓 APK 版本名）；浏览器中为 null。 */
  shellVersion: z.string().nullable(),
  /** 打包进壳的网页构建版本。 */
  webVersion: z.string(),
  osVersion: z.string(),
  /** 手机厂商（如 xiaomi、huawei），用于选择推送通道和显示保活引导；浏览器中为 null。 */
  manufacturer: z.string().nullable(),
});
export type PlatformInfo = z.infer<typeof PlatformInfo>;

export const NativePushRegistration = z.object({
  provider: AndroidPushProvider,
  token: z.string(),
});
export type NativePushRegistration = z.infer<typeof NativePushRegistration>;

export const NotificationOpenedEvent = z.object({
  /** 与通知载荷 NotificationPayload.deepLink 一致，例："/chat/{conversationId}"。 */
  deepLink: z.string().startsWith('/'),
});

export type PushPermissionState = 'granted' | 'denied' | 'prompt';

export interface NativeBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
  /** 请求通知权限（安卓 13+ 需要运行时授权）。 */
  requestPushPermission(): Promise<PushPermissionState>;
  /** 获取当前推送通道凭证；拿到后网页调用 POST /api/v1/push/devices 登记。凭证变化时通过 onPushTokenChanged 通知。 */
  getPushRegistration(): Promise<NativePushRegistration | null>;
  onPushTokenChanged(listener: (registration: NativePushRegistration) => void): () => void;
  /** 用户点击通知打开 App 时触发；冷启动时若由通知打开，也会在网页就绪后补发一次。 */
  onNotificationOpened(listener: (event: z.infer<typeof NotificationOpenedEvent>) => void): () => void;
  /** 设置桌面图标角标（总未读数）；不支持的系统忽略。 */
  setBadgeCount(count: number): Promise<void>;
  /** App 前后台切换，用于上报 presence.focus 和断开 / 重连 WebSocket。 */
  onAppStateChanged(listener: (state: { foreground: boolean }) => void): () => void;
  /** 打开系统设置中本应用的「后台运行 / 自启动」页面（厂商保活引导）；不支持时返回 false。 */
  openBackgroundSettings(): Promise<boolean>;
}
