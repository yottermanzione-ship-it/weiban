import type { NotificationSettings, Profile } from '../http/identity.js';

/** 提供方：identity。读取用户资料与设置。 */
export interface IdentityReadPort {
  getProfile(userId: string): Promise<Profile | null>;
  getNotificationSettings(userId: string): Promise<NotificationSettings | null>;
  /** v0.2：不再用于成人模式判定（不是硬性边界）；仅在 PRD v1.2 保留年龄确认时由业务模块使用。 */
  isAgeConfirmed(userId: string): Promise<boolean>;
  /** 用户最近一次打开 App 的时间（用于 P-17 长期不活跃暂停推演）。 */
  getLastActiveAt(userId: string): Promise<string | null>;
}
