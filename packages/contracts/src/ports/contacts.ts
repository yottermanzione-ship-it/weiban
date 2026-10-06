import type { Tx } from './common.js';
import type { Contact } from '../http/contacts.js';

/** 提供方：contacts。 */
export interface ContactsReadPort {
  /** 只返回 status = active 的联系人；软删除中的返回 null。 */
  getActiveContact(userId: string, characterId: string): Promise<Contact | null>;
  /** 本轮接受的内部版本；恢复会生成新版本，防止迟到AI回复进入恢复后的关系。 */
  getActiveContactEpoch(
    userId: string,
    characterId: string,
    tx?: Tx,
  ): Promise<{ version: string; acceptAfter: string } | null>;
  listActiveContacts(userId: string): Promise<Contact[]>;
  /** 添加时填写的「打招呼的话」（CHR-03 第 3 条），角色第一条消息生成后可被清除。 */
  getPendingGreeting(userId: string, characterId: string): Promise<string | null>;
}
