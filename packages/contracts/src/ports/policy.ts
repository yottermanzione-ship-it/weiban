/**
 * 硬性边界判定端口。提供方：policy（纯函数 + 审计日志）。
 * 规则定义见 docs/architecture/hard-boundaries.md（v1.2），决策见 ADR-0007（含 T-009 修订记录）。
 * 所有可能越界的操作都必须在服务器端调用这里，不得在各模块自行判断。
 *
 * v0.2（T-009）：成人模式只保留两条底线（非儿童、非真人）。年龄确认、群聊、成人模型是否配置
 * 不再由 policy 判定（后两者若仍需要，由业务模块按 PRD 执行）。新增 checkModelForCharacter（无审查模型闸门）。
 * 形象图策略简化为 forbidden / allowed（原裁定 9.2 第 1、3 条删除）。
 * v1.1（T-020）：按 pm-rulings-2 A1 恢复 classical_art_only（管理员标注的历史人物只生成古风插画形象）；
 * checkImageGeneration 新增 style。
 */
import type { PortraitPolicy } from '../http/characters.js';

export interface CharacterPolicy {
  characterId: string;
  isRealPerson: boolean;
  isHistorical: boolean;
  isMinor: boolean;
  /** = 非真人 且 非儿童。 */
  adultModeEligible: boolean;
  /** 能否使用 adult_content（无审查）模型，= adultModeEligible。 */
  adultContentModelAllowed: boolean;
  romanceAllowed: boolean;
  portraitPolicy: PortraitPolicy;
  /** 开启 SAFE-02 输出检查（真人角色）。 */
  publicStatementGuard: boolean;
  /** 分享图必带标注：真人为 not_real_person（文案以 PRD 为准）；其他角色为 null。 */
  shareImageLabel: 'not_real_person' | null;
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
  | 'romance_not_allowed'
  | 'portrait_not_allowed'
  | 'model_not_allowed'
  | 'character_not_found';

export type PolicyDecision = { allowed: true } | { allowed: false; reason: PolicyDenyReason };

export interface PolicyPort {
  getCharacterPolicy(userId: string, characterId: string): Promise<CharacterPolicy | null>;

  /**
   * 返回该角色可以显示的情景模式；不具备资格的模式不返回（界面不显示，不是灰色）。
   * 结果 = 候选 ∩ 管理员允许列表（若有）∩ 资格。管理员只能关掉模式，永远不能打开不具备资格的模式。
   * 产品体验规则（如 PRD 若保留「群聊只用日常」）不在这里，由 ai-runtime 在此结果上再过滤。
   */
  listAllowedScenarioModes(input: {
    userId: string;
    characterId: string;
    candidates: ScenarioModeTraits[];
    /** 角色卡中管理员为该角色设置的模式允许列表（modeId）；未设置则不限制。 */
    adminAllowlist?: string[];
  }): Promise<ScenarioModeTraits[]>;

  /** 切换情景模式前调用（SAFE-03、SAFE-05）。 */
  checkScenarioMode(input: {
    userId: string;
    characterId: string;
    mode: ScenarioModeTraits;
  }): Promise<PolicyDecision>;

  /** 设置关系类型前调用（SAFE-05：儿童角色不能是恋人）。 */
  checkRelationshipType(input: {
    userId: string;
    characterId: string;
    relationshipType: string;
  }): Promise<PolicyDecision>;

  /** 模型网关在使用成人模式模型前调用（生成闸，不信任上游）。 */
  checkAdultGeneration(input: {
    userId: string;
    characterId: string;
    conversationId: string;
  }): Promise<PolicyDecision>;

  /**
   * 无审查模型闸门：模型带 adult_content 能力时，设置角色单独模型前、网关每次调用前都要调用。
   * 角色无成人资格 → model_not_allowed。
   */
  checkModelForCharacter(input: {
    userId: string;
    characterId: string;
    modelHasAdultContent: boolean;
  }): Promise<PolicyDecision>;

  /**
   * 图片生成前调用（SAFE-01）。depictsCharacter = 画面要出现该角色本人形象。
   * - portraitPolicy = forbidden：不画本人；
   * - portraitPolicy = classical_art_only（管理员标注的历史人物，v1.1）：画本人时 style 必须为
   *   classical_illustration，否则 portrait_not_allowed；
   * - 不画本人时仍须做生成后人脸检查（AI 负责）。
   */
  checkImageGeneration(input: {
    userId: string;
    characterId: string;
    depictsCharacter: boolean;
    /** v1.1：请求的画风；不传视为 unspecified。古风插画的提示词模板与生成后复检由 AI 负责人定义。 */
    style?: 'classical_illustration' | 'unspecified';
  }): Promise<PolicyDecision>;
}
