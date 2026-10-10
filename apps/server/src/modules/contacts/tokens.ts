export const CONTACTS_READ_PORT = Symbol('weiban.contacts.read');

/** 角色维度的联系人统计（服务器内部，非契约端口）。 */
export const CONTACTS_CHARACTER_STATS = Symbol('weiban.contacts.character-stats');
export interface ContactsCharacterStats {
  hasAnyActiveContact(characterId: string): Promise<boolean>;
}
export const CONTACT_CARD_RECOMMENDATION_PORT = Symbol('weiban.contacts.card-recommendation');
/** T-088：契约 ContactsWritePort（系统代用户添加，调用方 plaza）。 */
export const CONTACTS_WRITE_PORT = Symbol('weiban.contacts.write');
