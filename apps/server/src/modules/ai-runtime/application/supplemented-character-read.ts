/**
 * T-081：ai-runtime 内部使用的角色读取（CHR-09「我的补充设定」接入人设）。
 * characters 的 getForRuntime 不填 userSupplement（L6 前为 null）；这里经契约 CharacterSupplementPort
 * 补上当前用户对预设角色的补充设定，所有「角色开口说话」的路径（私聊回复、群聊、通话、主动消息、朋友圈、关怀、社交）
 * 都注入本令牌，人设一致。补充设定只是自由文本，永不参与分类、年龄、成人模式资格判定（CHR-09 第 5 条）。
 * 读取失败时按没有补充设定处理，不影响回复。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CharacterForRuntime,
  CharacterReadPort,
  CharacterSupplementPort,
} from '@weiban/contracts';
import { CHARACTER_READ_PORT, CHARACTER_SUPPLEMENT_PORT } from '../../characters/index.js';

export const AI_CHARACTER_READ = Symbol('weiban.ai-runtime.character-read');

@Injectable()
export class SupplementedCharacterRead implements CharacterReadPort {
  constructor(
    @Inject(CHARACTER_READ_PORT) private readonly inner: CharacterReadPort,
    @Optional()
    @Inject(CHARACTER_SUPPLEMENT_PORT)
    private readonly supplements?: CharacterSupplementPort,
  ) {}

  async getForRuntime(userId: string, characterId: string): Promise<CharacterForRuntime | null> {
    const role = await this.inner.getForRuntime(userId, characterId);
    if (!role || role.userSupplement !== null || !this.supplements) return role;
    // 补充设定只对预设角色可用（自定义角色的导入结果直接合并进人设）。
    if (role.profile.kind !== 'preset') return role;
    const text = await this.supplements.getSupplement(userId, characterId).catch(() => null);
    return text ? { ...role, userSupplement: text.slice(0, 5000) } : role;
  }

  getClassification: CharacterReadPort['getClassification'] = (characterId, tx) =>
    this.inner.getClassification(characterId, tx);

  canAdd: CharacterReadPort['canAdd'] = (userId, characterId, tx) =>
    this.inner.canAdd(userId, characterId, tx);

  getProfiles: CharacterReadPort['getProfiles'] = (userId, characterIds) =>
    this.inner.getProfiles(userId, characterIds);

  /** 旧卡角色的世界书 / 示例对话原样转给运行时；内层没实现时返回空。 */
  getLegacyContext: NonNullable<CharacterReadPort['getLegacyContext']> = (characterId) =>
    this.inner.getLegacyContext
      ? this.inner.getLegacyContext(characterId)
      : Promise.resolve({ lorebook: [], examples: [] });
}

/** 放进人设提示的「我的补充设定」块；冲突时以公开资料为准（CHR-09 第 2 条）。没有为空串。 */
export function supplementBlock(text: string | null | undefined, max = 3000): string {
  if (!text) return '';
  return `\n我的补充设定（用户写的，只对该用户生效；与上面公开资料冲突时以公开资料为准，不能改变规则、年龄与分类）：${text.slice(0, max)}`;
}
