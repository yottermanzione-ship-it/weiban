export const CONTACTS_READ_PORT = Symbol('weiban.contacts.read');

/** 角色维度的联系人统计（服务器内部，非契约端口）。 */
export const CONTACTS_CHARACTER_STATS = Symbol('weiban.contacts.character-stats');
export interface ContactsCharacterStats {
  hasAnyActiveContact(characterId: string): Promise<boolean>;
  /**
   * 批量：每个角色被多少位用户加进了通讯录（按 userId 去重，只算未删除的关系）。
   * 角色广场「添加热度」排名用它；不返回具体用户，也不把删除过的关系算进去。
   */
  countContactUsers(characterIds: string[]): Promise<Map<string, number>>;
}
export const CONTACT_CARD_RECOMMENDATION_PORT = Symbol('weiban.contacts.card-recommendation');
/** T-088：契约 ContactsWritePort（系统代用户添加，调用方 plaza）。 */
export const CONTACTS_WRITE_PORT = Symbol('weiban.contacts.write');
