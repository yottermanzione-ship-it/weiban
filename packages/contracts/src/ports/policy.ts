/**
 * 硬性边界判定端口。提供方：policy（纯函数 + 审计日志）。
 * 规则定义见 docs/architecture/hard-boundaries.md，决策见 ADR-0007。
 * 所有可能越界的操作都必须在服务器端调用这里，不得在各模块自行判断。
 */
import type { PortraitPolicy } from '../http/characters.js';
import type { ConversationType } from '../http/chat.js';

export interface CharacterPolicy {
  characterId: string;
  isRealPerson: boolean;
  isHistorical: boolean;
  isMinor: boolean;
  adultModeEligible: boolean;
  romanceAllowed: boolean;
  portraitPolicy: PortraitPolicy;
  /** 开启 SAFE-02 输出检查（真人角色）。 */
  publicStatementGuard: boolean;
  /**
   * 分享图必带标注（EXP-01 第 5 条、裁定 9.2 第 3 条）：
   * not_real_person = 「微伴 AI 角色对话，非本人」（真人）；
   * ai_dialogue_if_portrait = 分享图含该角色形象图时加「微伴 AI 角色对话」（虚构 / 原创）。
   * 「微伴」标识对所有分享图都必带，不在此表示。
   */
  shareImageLabel: 'not_real_person' | 'ai_dialogue_if_portrait';
  /** 恒为 false：系统不提供声音克隆能力。 */
  voiceCloneAllowed: false;
  /** 识图可以认出的角色 ID：本人 + 关系网中有关系且为真人或有公开形象的角色（SAFE-04）。 */
  recognitionAllowlist: string[];
}

/** 情景模式的系统属性（具体模式列表由管理员维护，ADM-05）。 */
export interface ScenarioModeTraits {
  modeId: string;
  containsRomance: boolean;
  containsAdultContent: boolean;
}

export type PolicyDenyReason =
  | 'adult_mode_not_eligible'
  | 'age_not_confirmed'
  | 'adult_model_missing'
  | 'group_conversation'
  | 'romance_not_allowed'
  | 'portrait_not_allowed'
  | 'character_not_found';

export type PolicyDecision = { allowed: true } | { allowed: false; reason: PolicyDenyReason };

export interface PolicyPort {
  getCharacterPolicy(userId: string, characterId: string): Promise<CharacterPolicy | null>;

  /**
   * 返回该角色在该类会话中可以显示的情景模式；不具备资格的模式不返回（界面不显示，不是灰色）。
   * 结果 = 候选 ∩ 管理员允许列表（若有）∩ 资格。管理员只能关掉模式，永远不能打开不具备资格的模式。
   */
  listAllowedScenarioModes(input: {
    userId: string;
    characterId: string;
    conversationType: ConversationType;
    candidates: ScenarioModeTraits[];
    /** 角色卡中管理员为该角色设置的模式允许列表（modeId）；未设置则不限制。 */
    adminAllowlist?: string[];
  }): Promise<ScenarioModeTraits[]>;

  /** 切换情景模式前调用（MODE-03、SAFE-03、SAFE-05）。 */
  checkScenarioMode(input: {
    userId: string;
    characterId: string;
    conversationType: ConversationType;
    mode: ScenarioModeTraits;
  }): Promise<PolicyDecision>;

  /** 设置关系类型前调用（SAFE-05：儿童角色不能是恋人）。 */
  checkRelationshipType(input: { userId: string; characterId: string; relationshipType: string }): Promise<PolicyDecision>;

  /** 模型网关在使用成人模式模型前调用（生成闸，不信任上游）。 */
  checkAdultGeneration(input: { userId: string; characterId: string; conversationId: string }): Promise<PolicyDecision>;

  /**
   * 图片生成前调用（SAFE-01）。depictsCharacter = 画面要出现该角色本人形象。
   * 历史人物允许时附带强制风格约束（古风插画）；真人不画本人时仍须做生成后人脸检查（AI 负责）。
   */
  checkImageGeneration(input: {
    userId: string;
    characterId: string;
    depictsCharacter: boolean;
  }): Promise<PolicyDecision & { requiredStyle?: 'ancient_illustration' }>;
}
