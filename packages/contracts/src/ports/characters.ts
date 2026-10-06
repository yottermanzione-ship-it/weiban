import type { Tx } from './common.js';
import type { CharacterCard } from '../character-card.js';
import type { CharacterClassification, CharacterProfile } from '../http/characters.js';

/** AI 运行时生成回复所需的角色数据。 */
export interface CharacterForRuntime {
  profile: CharacterProfile;
  classification: CharacterClassification;
  card: CharacterCard;
  personaVersion: number;
  /** 备用开场白（未配置模型时用，CHR-03 第 6 条）。 */
  fallbackGreetings: string[];
  /** 当前用户的「我的补充设定」（CHR-09，L6 前为 null）。只是自由文本，永不参与硬性边界判定。 */
  userSupplement: string | null;
}

/** 提供方：characters。 */
export interface CharacterReadPort {
  /** 用户视角的角色数据：预设角色对所有人可读；自定义角色只有创建者可读，否则返回 null。 */
  getForRuntime(userId: string, characterId: string): Promise<CharacterForRuntime | null>;
  /** 可选事务用于资格闸门：锁定当前分类，与消息/模式写入共享同一提交。 */
  getClassification(characterId: string, tx?: Tx): Promise<CharacterClassification | null>;
  getProfiles(userId: string, characterIds: string[]): Promise<CharacterProfile[]>;
}
