export const CONTACTS_READ_PORT = Symbol('weiban.contacts.read');

/** 角色维度的联系人统计（服务器内部，非契约端口）。 */
export const CONTACTS_CHARACTER_STATS = Symbol('weiban.contacts.character-stats');
export interface ContactsCharacterStats {
  hasAnyActiveContact(characterId: string): Promise<boolean>;
}
