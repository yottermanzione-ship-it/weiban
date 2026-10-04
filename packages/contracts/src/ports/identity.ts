import type { NotificationSettings, Profile } from '../http/identity.js';

/** 提供方：identity。读取用户资料与设置。 */
export interface IdentityReadPort {
  getProfile(userId: string): Promise<Profile | null>;
  getNotificationSettings(userId: string): Promise<NotificationSettings | null>;
  isAgeConfirmed(userId: string): Promise<boolean>;
  /** 用户最近一次打开 App 的时间（用于 P-17 长期不活跃暂停推演）。 */
  getLastActiveAt(userId: string): Promise<string | null>;
}
