import type { Tx } from './common.js';
import type { Contact } from '../http/contacts.js';

/** 提供方：contacts。 */
export interface ContactsReadPort {
  /** 只返回 status = active 的联系人；软删除中的返回 null。 */
  getActiveContact(userId: string, characterId: string, tx?: Tx): Promise<Contact | null>;
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

/** 3.0：名片推荐（CHR-04、P-27）。提供方 contacts；调用方 ai-runtime。 */
export interface ContactCardRecommendationPort {
  /** 该角色能否被推荐给用户：未添加、不在「不感兴趣」冷却期、不在全局每 7 天 1 次的限制内（ignoreWeeklyLimit 用于用户主动询问）。 */
  canRecommend(
    userId: string,
    characterId: string,
    options?: { ignoreWeeklyLimit?: boolean },
  ): Promise<boolean>;
  /** 记一次推荐（发出名片消息时，与消息同一事务）。 */
  recordRecommendation(
    tx: Tx | null,
    input: {
      userId: string;
      characterId: string;
      recommenderCharacterId: string;
      messageId: string;
    },
  ): Promise<void>;
}
