import type { Tx } from './common.js';
import type { NotificationSettings, Profile } from '../http/identity.js';

/** 提供方：identity。读取用户资料与设置。 */
export interface IdentityReadPort {
  getProfile(userId: string): Promise<Profile | null>;
  getNotificationSettings(userId: string): Promise<NotificationSettings | null>;
  /** 用户最近一次打开 App 的时间（用于 P-17 长期不活跃暂停推演）。 */
  getLastActiveAt(userId: string): Promise<string | null>;
  // v1.0：isAgeConfirmed 删除（PRD v1.2 取消年龄确认）。
}

/**
 * v1.2（T-024）：账号状态。active = 正常；deleting = 已申请注销、各模块正在删除。
 * 账号不存在（已删除或从未存在）时端口返回 null。
 */
export type AccountStatus = 'active' | 'deleting';

/**
 * v1.2（T-024）：账号状态端口。提供方：identity；任何模块可用。
 * 单独成一个接口（而不是并入 IdentityReadPort），是为了新增它不影响已有实现；
 * identity 可以让同一个服务同时实现两个接口，注入令牌由后端在 identity 的 index.ts 定义。
 */
export interface IdentityAccountStatusPort {
  /**
   * 订阅 identity.user_registered 等事件、要为用户**新建**数据的模块，写入前先确认账号仍是 active，
   * 避免事件迟到（晚于注销删除）时给已删除的账号留下残留数据（例：billing 建钱包、记注册赠送，billing.md 8.3 节）。
   */
  /** 可选调用方事务：同连接读取并锁定账号行，避免并发事务耗尽连接池。 */
  getAccountStatus(userId: string, tx?: Tx): Promise<AccountStatus | null>;
}

/**
 * v1.3（T-026）：账号目录端口。提供方：identity；任何模块可用。
 * 同 IdentityAccountStatusPort，单独成接口，新增它不影响已有实现。
 */
export interface IdentityDirectoryPort {
  /**
   * 按用户 ID 批量取用户名（登录名，管理后台展示用；一次最多 500 个 ID，超过抛异常）。
   * 返回「用户 ID → 用户名」；不存在（已删除或从未存在）的 ID 不出现在结果里，调用方按「已注销」显示。
   * 只用于管理后台的展示与「按用户名搜索」（例：billing 的 AdminAccountSummary.username，billing.md 10.1 第 5 条）；
   * 调用方**不得**把用户名存进自己的表（避免复制别的模块的数据、注销时漏删）。
   */
  getUsernames(userIds: readonly string[]): Promise<Record<string, string>>;
  /** 当前所有管理员（role = admin、账号 active）的用户 ID。push 给管理员发提醒时用（billing.md 8.4 节）。 */
  listAdminUserIds(): Promise<string[]>;
}
