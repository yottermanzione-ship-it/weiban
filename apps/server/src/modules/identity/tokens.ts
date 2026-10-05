/** identity 对外提供的注入令牌（从 index.ts 导出）。 */

/** 契约 IdentityReadPort 的实现：读资料、通知设置、最近活跃时间。 */
export const IDENTITY_READ_PORT = Symbol('weiban.identity.read-port');

/** 管理端按 ID 查询用户名及当前管理员。 */
export const IDENTITY_DIRECTORY_PORT = Symbol('weiban.identity.directory-port');

/**
 * 契约 IdentityAccountStatusPort（1.2）的实现：账号是否 active / deleting / 不存在。
 * 订阅注册等事件、要为用户新建数据的模块，写入前先确认账号仍是 active（billing.md 8.3）。
 */
export const IDENTITY_ACCOUNT_STATUS_PORT = Symbol('weiban.identity.account-status-port');
