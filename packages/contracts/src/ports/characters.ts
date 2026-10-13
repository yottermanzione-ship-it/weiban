import type { PortResult, Tx } from './common.js';
import type { CharacterCard } from '../character-card.js';
import type {
  CharacterClassification,
  CharacterClassificationInput,
  CharacterProfile,
  CharacterSummary,
} from '../http/characters.js';
import type { CharacterRelation, SupplementConflict } from '../http/character-extras.js';
import type {
  PlazaOfficialPersona,
  PlazaSnapshot,
  PlazaSnapshotClassification,
} from '../http/plaza.js';

/** 通知显示专用：只返回名字，不加载头像或向调用方提供角色卡上下文，不派生供应商调用。 */
export interface CharacterNameReadPort {
  getDisplayName(userId: string, characterId: string, tx?: Tx): Promise<string | null>;
}

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
  /** 添加资格：上架预设或本人可用自定义角色；可共享调用方事务并锁定角色行。 */
  canAdd(userId: string, characterId: string, tx?: Tx): Promise<boolean>;
  getProfiles(userId: string, characterIds: string[]): Promise<CharacterProfile[]>;
}

// ---------- 3.0：关系网（SOC-01）、作品链接、广场（L4～L7） ----------

/**
 * 关系网读取。提供方 characters；调用方 ai-runtime（群聊、朋友圈互评、私聊提起、名片、共享记忆、拉群）、
 * policy（识图认人名单）、chat 不调用。userId 用于带上该用户为自定义角色设定的关系。
 */
export interface CharacterRelationReadPort {
  /** 两个角色之间的关系；没有为 null。 */
  getRelation(
    userId: string,
    characterAId: string,
    characterBId: string,
  ): Promise<CharacterRelation | null>;
  /** 某角色的全部关系（预设之间 + 该用户设定的自定义之间）。 */
  listRelations(userId: string, characterId: string): Promise<CharacterRelation[]>;
}

/** 作品链接库读取（MED-05）。只返回 enabled 且最近一次检查通过的链接。 */
export interface CharacterWorkLinkReadPort {
  listUsableWorkLinks(characterId: string): Promise<
    Array<{
      workLinkId: string;
      title: string;
      url: string;
      source: string | null;
      appHint: 'music' | 'video' | 'web';
      coverMediaId: string | null;
    }>
  >;
  /** 可访问性检查结果回写（AI / 定时任务）。 */
  recordLinkCheck(workLinkId: string, ok: boolean): Promise<void>;
}

/** 预设角色默认音色（MED-03）。 */
export interface CharacterVoiceReadPort {
  getDefaultVoiceId(characterId: string): Promise<string | null>;
}

/**
 * 广场配合（persona-plaza.md 第 2 节，D-L7-03）。提供方 characters；调用方只有 plaza。
 * 幂等键：createFromSnapshot / applyVariant 以 plaza 的 adoptionId 为幂等键，重试不会建出两个角色。
 */
export interface CharacterPlazaPort {
  /** 按白名单生成自定义角色快照；everPrivatePerson = true 返回 forbidden。 */
  buildPublishSnapshot(
    userId: string,
    characterId: string,
  ): Promise<
    PortResult<Extract<PlazaSnapshot, { kind: 'custom_character' }>, 'not_found' | 'forbidden'>
  >;
  /** 预设改版快照（用户的补充设定）；没有补充设定返回 not_found。 */
  buildVariantSnapshot(
    userId: string,
    presetCharacterId: string,
  ): Promise<PortResult<Extract<PlazaSnapshot, { kind: 'preset_variant' }>, 'not_found'>>;
  /** 按快照新建自定义角色（origin = plaza_copy，分类锁定只能更严，数据库触发器保证）。 */
  createFromSnapshot(input: {
    userId: string;
    snapshot: PlazaSnapshot;
    origin: { workId: string; version: number; authorName: string };
    idempotencyKey: string;
  }): Promise<PortResult<{ characterId: string }, 'preset_not_found'>>;
  /** 应用改版：写入用户对预设角色的补充设定。 */
  applyVariant(input: {
    userId: string;
    presetCharacterId: string;
    variantText: string;
    origin: { workId: string; version: number; authorName: string };
    idempotencyKey: string;
    /**
     * 3.1：改版快照的 PlazaPresetVariantSnapshot.childFeaturesDetected（可选，省略视为 false）。
     * 与预设分类取更严的一边，只存在这位用户的补充设定上，运行时分类按更严处理，不写回预设角色。
     */
    childFeaturesDetected?: boolean;
  }): Promise<PortResult<void, 'not_found'>>;
  /** 更新到新版本：替换人设类字段（分类只会更严）。 */
  updateFromSnapshot(input: {
    userId: string;
    characterId: string;
    snapshot: PlazaSnapshot;
    version: number;
  }): Promise<PortResult<void, 'not_found' | 'classification_loosened'>>;
  /** 管理员更正（ADM-09 第 6 条）：只能更严；变化后照常发 characters.character_classification_changed。 */
  tightenClassification(
    characterId: string,
    classification: CharacterClassificationInput,
    reason: string,
  ): Promise<PortResult<void, 'not_found' | 'classification_loosened'>>;
  /** 来源关系：plaza 用于找下游角色、显示来源标注。 */
  getPlazaOrigin(characterId: string): Promise<{ workId: string; version: number } | null>;
  /** 自定义角色当前分类（发布新版本时与上一版比较）。 */
  getSnapshotClassification(characterId: string): Promise<PlazaSnapshotClassification | null>;
  /**
   * 3.5（角色广场「微伴角色」tab）：符合条件的已上架预设角色 ID（角色库默认顺序，最多 1000 个）。
   * 可选：未实现时「微伴角色」tab 返回 service_unavailable。
   */
  listOfficialIds?(query: { q?: string; categoryId?: string }): Promise<string[]>;
  /** 3.5：按给定顺序返回这些已上架预设角色的卡片（不存在 / 未上架的跳过）。 */
  getOfficialCards?(userId: string, characterIds: string[]): Promise<CharacterSummary[]>;
  /** 3.5：已上架预设角色的资料 + 公开的基本人设摘要；不存在 / 未上架返回 null。 */
  getOfficialProfile?(
    userId: string,
    characterId: string,
  ): Promise<{ profile: CharacterProfile; persona: PlazaOfficialPersona } | null>;
}

/** 补充设定写入（importer 导入结果确认、plaza 应用改版之外的系统写入）。提供方 characters。 */
export interface CharacterSupplementPort {
  getSupplement(userId: string, characterId: string): Promise<string | null>;
}

// ---------- 3.1 补登（此前是服务器内部令牌，积压 ㉕ / ㉖ / ㉝） ----------

/**
 * 3.1：补充设定冲突项写入（T-079 / T-081 已实现的 CHARACTER_SUPPLEMENT_CONFLICTS 转为契约）。提供方 characters；调用方 ai-runtime。
 * 流程：用户保存补充设定 → characters 清空旧冲突、发 characters.supplement_changed(saved) → ai-runtime 对比公开资料 →
 * 调本端口写入。expectedTextSha256 是 ai-runtime 对比时读到的补充设定原文的 sha256（十六进制）；与当前不一致（用户又改过）
 * 时返回 stale、不写入。写入后 characters 发 data.changed(section = supplement)。
 */
export interface CharacterSupplementConflictsWritePort {
  setConflicts(
    userId: string,
    characterId: string,
    conflicts: SupplementConflict[],
    expectedTextSha256?: string,
  ): Promise<PortResult<void, 'not_found' | 'stale'>>;
}

/**
 * 3.1：儿童特征检出写回（T-089 已实现的 CHARACTER_CHILD_FEATURES_WRITER 转为契约）。提供方 characters；调用方 ai-runtime。
 * 只能从否变是；只对用户自己的自定义角色生效（预设角色不写回，见 PlazaPresetVariantSnapshot.childFeaturesDetected）。
 * 返回是否发生了变化；变化时照常发 characters.character_classification_changed。
 */
export interface CharacterChildFeaturesWritePort {
  markChildFeaturesDetected(userId: string, characterId: string): Promise<boolean>;
}

/** T-103：独立试聊会话授权。快照角色仅当前用户可用，不代表正式好友。 */
export interface CharacterTrialReadPort {
  getTrial(
    input: { userId: string; characterId: string; conversationId: string },
    tx?: Tx,
  ): Promise<{ epoch: string; expiresAt: string } | null>;
}

/** T-103：characters 结束试聊时，同一事务清除 ai-runtime 的临时回复数据。由装配入口绑定。 */
export interface CharacterTrialCleanupPort {
  purgeTrial(
    tx: Tx,
    input: { userId: string; characterId: string; conversationId: string },
  ): Promise<void>;
}

/**
 * 3.1（积压 ㉖）：「发布新版本」时生成人设更新摘要的可选 AI 接入点。提供方 ai-runtime（T-081 的 PersonaUpdateSummaryService）；
 * 调用方 characters（管理员发布预设角色新人设版本时）。characters 是底层，不 import ai-runtime：令牌定义在 characters，
 * 由装配入口绑定；未绑定或返回 null 时用管理员填写的摘要或「资料已更新」兜底，不阻塞发布。
 * 用平台账户计费（purpose = admin_persona_check）；幂等键 = characterId + version。
 */
export interface PersonaUpdateSummarizerPort {
  summarize(input: {
    adminId: string;
    characterId: string;
    before: CharacterCard | null;
    after: CharacterCard;
    version: number;
  }): Promise<string | null>;
}
