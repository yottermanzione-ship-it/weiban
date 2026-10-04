/**
 * 端口（模块之间的同步接口）公共类型。
 * 端口是同一进程内的 TypeScript 接口，不经过网络。规则见 ADR-0004：
 * 别的模块只能通过对方 index.ts 导出的端口办事，不能读写对方的表。
 */

/**
 * 数据库事务句柄（不透明类型）。由平台内核创建，调用方原样传入，
 * 使多个模块的写入（例如消息 + 每用户更新 + 事件）落在同一个事务里。
 */
export interface Tx {
  readonly __brand: 'weiban.tx';
}

/**
 * 删除清单：每个拥有用户数据的模块必须实现并注册到平台内核（docs/architecture/security-and-privacy.md 第 5.1 节）。
 * 注销时由订阅 identity.user_deletion_requested 的流程调用 purgeUser；验证脚本调用 countUserData。
 */
export interface UserDataOwner {
  readonly module: string;
  /** 物理删除本模块与该用户相关的全部数据（含对象存储文件），可重复调用。返回删除的行数。 */
  purgeUser(userId: string): Promise<number>;
  /** 本模块中仍与该用户相关的数据条数，注销完成后必须为 0。 */
  countUserData(userId: string): Promise<number>;
}

/** 端口方法统一的失败结果：不抛业务异常，而是返回可判断的错误。 */
export type PortResult<T, E extends string> =
  { ok: true; value: T } | { ok: false; error: E; message?: string };
