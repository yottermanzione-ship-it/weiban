export const CHARACTER_READ_PORT = Symbol('weiban.characters.read');
export const CHARACTER_NAME_READ_PORT = Symbol('weiban.characters.name-read');
export const CHARACTER_EVALUATOR = Symbol('weiban.characters.evaluator');
export const CHARACTER_CONTACT_ACCESS = Symbol('weiban.characters.contact-access');
export interface CharacterContactAccess {
  hasContact(userId: string, characterId: string): Promise<boolean>;
  /** 是否至少有一个用户添加了该角色（D-L3-02 候选搜索范围）；未装配时视为 false。 */
  hasAnyContact?(characterId: string): Promise<boolean>;
}
export const PUBLIC_UPDATE_READ_PORT = Symbol('weiban.characters.public-update-read');
export const PUBLIC_UPDATE_WEB_SEARCH = Symbol('weiban.characters.public-update-web-search');
export const CHARACTER_RELATION_READ_PORT = Symbol('weiban.characters.relation-read');
/** T-069：契约 CharacterWorkLinkReadPort、CharacterVoiceReadPort；音色名称检查用的真人姓名列表（装配入口绑给 media）。 */
export const CHARACTER_WORK_LINK_READ_PORT = Symbol('weiban.characters.work-link-read');
export const CHARACTER_VOICE_READ_PORT = Symbol('weiban.characters.voice-read');
export const CHARACTER_REAL_PERSON_NAMES = Symbol('weiban.characters.real-person-names');
/** T-079：契约 CharacterSupplementPort（ai-runtime 读补充设定）。 */
export const CHARACTER_SUPPLEMENT_PORT = Symbol('weiban.characters.supplement-port');
/**
 * T-079 服务器内部（非契约）：AI 检出补充设定冲突项后写入。
 * 类型 { setConflicts(userId, characterId, conflicts: SupplementConflict[]): Promise<void> }。
 */
export const CHARACTER_SUPPLEMENT_CONFLICTS = Symbol('weiban.characters.supplement-conflicts');
