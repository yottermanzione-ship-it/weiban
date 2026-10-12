export const CHAT_READ_PORT = Symbol('weiban.chat.read-port');
export const CHAT_PARTICIPANT_PORT = Symbol('weiban.chat.participant-port');
export const CHAT_ADMIN_PORT = Symbol('weiban.chat.admin-port');
export const CHAT_USER_PORT = Symbol('weiban.chat.user-port');
export const CHAT_NOTIFICATION_READ_PORT = Symbol('weiban.chat.notification-read-port');
export const CHAT_GROUP_READ_PORT = Symbol('weiban.chat.group-read-port');
export const CHAT_GROUP_ADMIN_PORT = Symbol('weiban.chat.group-admin-port');
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
