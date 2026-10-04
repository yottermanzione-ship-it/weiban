import type { Contact } from '../http/contacts.js';

/** 提供方：contacts。 */
export interface ContactsReadPort {
  /** 只返回 status = active 的联系人；软删除中的返回 null。 */
  getActiveContact(userId: string, characterId: string): Promise<Contact | null>;
  listActiveContacts(userId: string): Promise<Contact[]>;
  /** 添加时填写的「打招呼的话」（CHR-03 第 3 条），角色第一条消息生成后可被清除。 */
  getPendingGreeting(userId: string, characterId: string): Promise<string | null>;
}
