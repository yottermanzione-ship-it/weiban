import type { ChatReadPort, Conversation, Message, ReadMessagesInput, Tx } from '@weiban/contracts';

export const CHAT_READ_PORT = Symbol('weiban.chat.read-port');
/**
 * CHAT_READ_PORT 的服务器内部用法（T-20261104c）：调用方拿着事务 tx 时，查找私聊、读消息也要在这个 tx 里做。
 * 契约 ChatReadPort 的这两个方法没有 tx 参数，不传 tx 时 chat 会另开一条连接、对同一会话行加锁——
 * 如果调用方的 tx 已经锁过 / 改过这行，外层等内层、内层等外层，整站卡死（2026-11-04 事故）。
 * 实现见 ChatReadService；契约不变，同一个令牌注入，只是类型多了可选的 tx。
 */
export interface ChatReadInTxPort extends ChatReadPort {
  /** 传 tx 时在调用方事务里执行，并以 FOR UPDATE 锁会话行（调用方随后通常要写这个会话）。 */
  findDirectConversation(
    userId: string,
    characterId: string,
    tx?: Tx,
  ): Promise<Conversation | null>;
  /** 传 tx 时在调用方事务里执行。 */
  readMessages(input: ReadMessagesInput, tx?: Tx): Promise<Message[]>;
}
export const CHAT_PARTICIPANT_PORT = Symbol('weiban.chat.participant-port');
export const CHAT_ADMIN_PORT = Symbol('weiban.chat.admin-port');
export const CHAT_USER_PORT = Symbol('weiban.chat.user-port');
export const CHAT_NOTIFICATION_READ_PORT = Symbol('weiban.chat.notification-read-port');
export const CHAT_GROUP_READ_PORT = Symbol('weiban.chat.group-read-port');
export const CHAT_GROUP_ADMIN_PORT = Symbol('weiban.chat.group-admin-port');
/** 10-25：年度回忆用的只读聚合端口（只给数字/日期，不给正文）。 */
export const CHAT_RECAP_READ_PORT = Symbol('weiban.chat.recap-read-port');
/**
 * 群聊需要的通讯录与名字查询（T-063）。chat 与 contacts / characters 同层且被它们 import，不能反向 import，
 * 由装配入口（app.module.ts）绑定实现（同 CHARACTER_CONTACT_ACCESS 的做法），chat 以可选注入使用。
 */
export const CHAT_GROUP_DIRECTORY = Symbol('weiban.chat.group-directory');
export interface ChatGroupDirectory {
  /** 角色是否在该用户通讯录中且为 active（SOC-03：只能拉通讯录里的角色）。 */
  isActiveContact(userId: string, characterId: string, tx?: unknown): Promise<boolean>;
  /** 用户看到的名字：备注优先，其次角色名；找不到为 null。 */
  displayName(userId: string, characterId: string, tx?: unknown): Promise<string | null>;
}
