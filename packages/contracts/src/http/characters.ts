/**
 * characters 模块：角色广场、角色资料、角色分类、管理后台角色库（最小版）。
 * 需求：CHR-01、CHR-02、CHR-11（结构见 character-card.ts）、ADM-01（最小）、PRD 第 10 章 10.0。
 * 硬性边界字段规则见 docs/architecture/hard-boundaries.md 第 2 节。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  LocalDate,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';
import { DraftCharacterCard } from '../character-card.js';

// ---------- 分类（硬性边界的判定依据） ----------

/**
 * 角色原型。real_person = 以真实人物本人身份呈现（使用真名，或含可识别的真实身份事实：真实作品、
 * 真实人际关系、真实经历）；以真人为灵感但用新名字、不带真实身份事实的角色归为 original
 * （总负责人 2026-10-04 补充决定，hard-boundaries.md 第 2 节）。系统只按此字段执行，不检测灵感来源。
 */
export const CharacterBasis = z.enum(['real_person', 'fictional', 'original']);
export type CharacterBasis = z.infer<typeof CharacterBasis>;

export const RealPersonKind = z.enum(['celebrity', 'historical', 'private_person']);
export type RealPersonKind = z.infer<typeof RealPersonKind>;

export const AgeSetting = z.enum(['minor', 'adult']);
export type AgeSetting = z.infer<typeof AgeSetting>;

const classificationFields = {
  basis: CharacterBasis,
  /** basis = real_person 时必填，其他情况必须为 null（组合校验见 checkClassificationCombination）。 */
  realPersonKind: RealPersonKind.nullable(),
  ageSetting: AgeSetting,
  childAppearance: z.boolean(),
};

/**
 * 分类组合校验（Q-006）：real_person 必须给出 realPersonKind；fictional / original 的 realPersonKind 必须为 null。
 * 读写两种 schema 都执行，服务器另在数据库加同样的 CHECK 约束。
 */
function checkClassificationCombination(
  value: { basis: CharacterBasis; realPersonKind: RealPersonKind | null },
  ctx: z.RefinementCtx,
) {
  if (value.basis === 'real_person' && value.realPersonKind === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['realPersonKind'],
      message: '真人角色必须选择真人类型（公众人物 / 历史人物 / 身边真人）',
    });
  }
  if (value.basis !== 'real_person' && value.realPersonKind !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['realPersonKind'],
      message: '只有真人角色才能设置真人类型',
    });
  }
}

/** 可写入的分类事实（谁能写见 hard-boundaries.md 第 2 节）。 */
export const CharacterClassificationInput = z
  .object(classificationFields)
  .superRefine(checkClassificationCombination);
export type CharacterClassificationInput = z.infer<typeof CharacterClassificationInput>;

/**
 * 形象图生成策略（SAFE-01、MED-02，推导规则见 hard-boundaries.md 第 2 节）：
 * - forbidden：真人分类（公众人物、身边真人；以及未经管理员标注的历史人物）不生成本人形象；
 * - classical_art_only：管理员在角色库标注的历史人物（预设角色），只能生成古风插画风格的本人形象，
 *   不生成写实照片风格（PRD SAFE-01 第 6 条、pm-rulings-2 A1）；
 * - allowed：虚构、原创角色。
 * v0.2 曾删除 classical_art_only；v1.1（T-020）按裁定 A1 恢复。响应中用接收端容错解析。
 */
export const PortraitPolicy = z.enum(['forbidden', 'classical_art_only', 'allowed']);
export type PortraitPolicy = z.infer<typeof PortraitPolicy>;

/** 读取时返回：分类事实 + 系统推导结果（只读，任何接口都不能写入推导字段）。 */
export const CharacterClassification = z
  .object({
    ...classificationFields,
    /** 由系统检测人设文本写入（SAFE-03 第 4 条）。 */
    childFeaturesDetected: z.boolean(),
    derived: z.object({
      isMinor: z.boolean(),
      /** = 非真人 且 非儿童（两条底线，hard-boundaries.md 第 2 节）；同时决定能否使用无审查模型。 */
      adultModeEligible: z.boolean(),
      romanceAllowed: z.boolean(),
      /** 不认识的取值解析为 'unsupported'（v1.1），客户端按 forbidden 对待。 */
      portraitPolicy: tolerantEnum(PortraitPolicy),
      /** 是否开启「不冒充本人公开言论」检查（SAFE-02），= basis 为 real_person。 */
      publicStatementGuard: z.boolean(),
    }),
  })
  .superRefine(checkClassificationCombination);
export type CharacterClassification = z.infer<typeof CharacterClassification>;

// ---------- 展示信息 ----------

export const CharacterKind = z.enum(['preset', 'custom']);
export type CharacterKind = z.infer<typeof CharacterKind>;

/** 十六进制颜色，例 "#FF6FA3"。 */
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** 默认头像右上角小图案（docs/design/default-avatar.md 3.5）。heart 对儿童角色不可用（服务器校验，422）。 */
export const AvatarPattern = z.enum(['star', 'heart', 'note', 'moon', 'flower', 'none']);
export type AvatarPattern = z.infer<typeof AvatarPattern>;

/**
 * 角色展示字段（设计负责人 T-006 申请，T-009 批准）。客户端据此绘制非肖像默认头像，
 * 规则见 docs/design/default-avatar.md 第 3 节。与 App 界面主题（微信绿 / 微伴粉）无关。
 */
export const CharacterDisplay = z.object({
  /** 官方应援色，0–3 个；为空时客户端按角色 ID 哈希从预设盘取色。第 1 个作底色，第 2 个作图案色。 */
  supportColors: z.array(HexColor).max(3),
  /** 头像字，1–2 个字；null 时客户端按名字自动取字。 */
  avatarText: z.string().min(1).max(2).nullable(),
  avatarPattern: AvatarPattern,
  /** 角色主题色（资料页等处的点缀色）；null 时用第一个应援色或预设色。 */
  themeColor: HexColor.nullable(),
});
export type CharacterDisplay = z.infer<typeof CharacterDisplay>;

/**
 * 头像：image 为管理员上传的图片（purpose = character_avatar，见 http/media.ts）；
 * 为 null 时客户端用 display 绘制默认头像。图片加载失败时同样退回默认头像。
 * 用户为自己通讯录设置的头像在 Contact.customAvatarMediaId，优先级更高，只对本人可见。
 */
export const CharacterAvatar = z.object({
  image: z.object({ mediaId: Id, url: z.url() }).nullable(),
  display: CharacterDisplay,
});
export type CharacterAvatar = z.infer<typeof CharacterAvatar>;

/** 管理后台写入头像：传 mediaId（null 表示去掉图片，用默认头像），展示字段整体提交。 */
export const CharacterAvatarWrite = z.object({
  imageMediaId: Id.nullable(),
  display: CharacterDisplay,
});

export const CharacterPublishStatus = z.enum([
  'draft',
  'pending_check',
  'published',
  'unpublished',
  'disabled',
]);
export type CharacterPublishStatus = z.infer<typeof CharacterPublishStatus>;

/** 角色广场卡片（CHR-01 第 4 条）。 */
export const CharacterSummary = z.object({
  characterId: Id,
  kind: CharacterKind,
  name: z.string().min(1).max(32),
  avatar: CharacterAvatar,
  tagline: z.string().max(60),
  tags: z.array(z.string().max(16)).max(10),
  categoryId: z.string().nullable(),
  basis: CharacterBasis,
  /** 当前用户是否已添加（CHR-01 验收第 2 条）。 */
  added: z.boolean(),
});
export type CharacterSummary = z.infer<typeof CharacterSummary>;

/** 角色资料页的基础信息（CHR-02 第 1 条）。养成、记忆等入口数据由各自模块提供。 */
export const CharacterProfile = CharacterSummary.extend({
  aliases: z.array(z.string()),
  works: z.array(z.string()),
  intro: z.string().max(1000),
  birthday: LocalDate.nullable(),
  fanName: z.string().max(20).nullable(),
  classification: CharacterClassification,
  /** 真人角色资料页底部显示「本角色根据公开资料创作，不代表本人」（CHR-02 第 3 条）。 */
  showPublicSourceNotice: z.boolean(),
  personaVersion: z.number().int().positive(),
  /** 人设有新版本、当前用户还没看过（CHR-10 第 4 条，L2 起使用）。 */
  personaUpdatedUnseen: z.boolean(),
});
export type CharacterProfile = z.infer<typeof CharacterProfile>;

export const CharacterCategory = z.object({
  categoryId: z.string(),
  name: z.string(),
  order: z.number().int(),
});

// ---------- 用户端接口 ----------

export const CharacterEndpoints = {
  listCategories: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/categories`,
    auth: 'user',
    response: z.object({ items: z.array(CharacterCategory) }),
    summary: '角色广场分类（明星、虚构角色、历史人物…，管理员维护）',
  }),
  searchPlaza: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters`,
    auth: 'user',
    query: z.object({
      q: z.string().max(50).optional(),
      categoryId: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: cursorPage(CharacterSummary),
    summary: '角色广场：只返回已上架预设角色；按名字、别名、作品名搜索（CHR-01）',
  }),
  getProfile: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: CharacterProfile,
    summary: '角色资料（CHR-02）。下架角色对已添加用户仍可见',
  }),
} as const;

// ---------- 用户自定义角色（CHR-07） ----------

/**
 * 用户手动创建的自定义角色写入字段（CHR-07）。
 * 人设描述 ≥ 50 字；真人选择后不能改回其他分类（分类单向规则由服务器用数据库触发器执行）。
 */
export const UserCustomCharacterWrite = z.object({
  name: z.string().min(1).max(32),
  /** 人设描述，至少 50 字（含空格），用于儿童特征检测与生成回复。 */
  description: z.string().min(50).max(2000),
  classification: CharacterClassificationInput,
  birthday: LocalDate.nullable().optional(),
  /** 口头禅，显示在资料页，也参与儿童特征检测。 */
  catchphrase: z.string().max(200).optional(),
  /**
   * 3.1（T-098 申请）：完整口头禅列表（写入角色卡 speech.catchphrases）。同时传 catchphrase 与 catchphrases 时以列表为准，
   * catchphrase 视为列表第一条；只传 catchphrase 时只替换第一条、保留其余。
   */
  catchphrases: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  /** 3.1（T-098 申请）：说话方式（语气、句子长短、习惯用语的自由描述，写入角色卡 speech.tone）。 */
  speechStyle: z.string().trim().max(500).optional(),
  /** 示例对话（纯文本，多轮用换行分隔）。 */
  exampleDialogue: z.string().max(2000).optional(),
  tags: z.array(z.string().max(16)).max(10).optional(),
  /** 自定义头像媒体 ID（custom_character_avatar；可继承公开 plaza_avatar / character_avatar）；null 使用默认头像。 */
  avatarMediaId: Id.nullable().optional(),
  /** 默认音色，从启用中的音色库选择；null 清空。陪伴设置里的选择优先。 */
  voiceId: Id.nullable().optional(),
});
export type UserCustomCharacterWrite = z.infer<typeof UserCustomCharacterWrite>;
export const UserCustomTrialWrite = UserCustomCharacterWrite.extend({
  sourceCharacterId: Id.optional(),
});
export type UserCustomTrialWrite = z.infer<typeof UserCustomTrialWrite>;

/** PATCH 请求：所有字段可选。 */
export const UserCustomCharacterPatch = UserCustomCharacterWrite.partial();
export type UserCustomCharacterPatch = z.infer<typeof UserCustomCharacterPatch>;

/** 用户自定义角色的完整响应（资料页 + 自定义字段）。 */
export const UserCustomCharacter = CharacterProfile.extend({
  description: z.string(),
  catchphrase: z.string().nullable(),
  /** 3.1：完整口头禅列表；旧服务器不带时客户端只显示 catchphrase。 */
  catchphrases: z.array(z.string()).optional(),
  /** 3.1：说话方式；未填为 null。 */
  speechStyle: z.string().nullable().optional(),
  /** 自定义角色默认音色；旧服务器可省略，null 未选择。 */
  voiceId: Id.nullable().optional(),
  exampleDialogue: z.string().nullable(),
  tags: z.array(z.string().max(16)),
  /**
   * 人设文本中检测到儿童特征（SAFE-03 第 4 条）。
   * true 时系统已设置 classification.childFeaturesDetected=true，禁止成人模式。
   */
  childFeaturesDetected: z.boolean(),
});
export type UserCustomCharacter = z.infer<typeof UserCustomCharacter>;

const customParams = z.object({ characterId: Id });

export const UserCustomEndpoints = {
  /** 3.0.1（L4 收尾）：我的自定义角色列表（「TA 认识的人」选人、管理）。 */
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/custom`,
    auth: 'user',
    response: z.object({ items: z.array(UserCustomCharacter) }),
    summary: '我创建的全部自定义角色，按创建时间倒序',
  }),
  /** 创建自定义角色（CHR-07）；自动执行儿童特征检测后返回检测结果。 */
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/custom`,
    auth: 'user',
    body: UserCustomCharacterWrite,
    response: UserCustomCharacter,
    summary: 'CHR-07 手动创建自定义角色；儿童特征检测在服务器同步完成',
  }),
  /** 更新自定义角色（仅限创建者；分类单向规则由数据库触发器执行）。 */
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/characters/custom/:characterId`,
    auth: 'user',
    params: customParams,
    body: UserCustomCharacterPatch,
    response: UserCustomCharacter,
    summary: 'CHR-07 更新自定义角色；real_person→other 触发 422 classification_change_forbidden',
  }),
  /**
   * 开始或复用试聊会话（CHR-07 第 6 条）。
   * 试聊会话不建立正式联系人关系，不写入长期记忆。
   * 试聊会话的 conversationId 仅当前用户可见；关闭编辑器后可被清理。
   */
  startTrial: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/custom/:characterId/trial`,
    auth: 'user',
    params: customParams,
    response: z.object({ conversationId: Id }),
    summary: 'CHR-07 试聊：开始或复用试聊会话，试聊记录不保留',
  }),
  draftTrial: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/custom/trial`,
    auth: 'user',
    body: UserCustomTrialWrite,
    response: z.object({ characterId: Id, conversationId: Id, expiresAt: Timestamp }),
    summary: 'CHR-07 保存前试聊：独立临时人设和会话，不创建正式角色或好友',
  }),
  endTrial: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/characters/custom/trial/:conversationId`,
    auth: 'user',
    params: z.object({ conversationId: Id }),
    response: z.object({ ended: z.literal(true) }),
    summary: 'CHR-07 结束试聊并清除临时会话、人设与回复计划；幂等',
  }),
} as const;

// ---------- 管理后台（ADM-01 最小版） ----------

/**
 * 角色数据格式。`wbcard` = 新卡（draft / published 密文，按 WB-Card 1.0 编辑）；
 * `legacy` = 旧卡（`characters.legacy_card` 整行，运行时直接读旧字段）。
 * 旧卡没有 WB-Card 数据：后台必须按旧字段查看与保存，不能拿空 WB-Card 壳当资料，也不把旧卡转成新卡。
 */
export const CharacterCardFormat = z.enum(['wbcard', 'legacy']);
export type CharacterCardFormat = z.infer<typeof CharacterCardFormat>;

export const AdminCharacter = z.object({
  characterId: Id,
  status: CharacterPublishStatus,
  name: z.string().min(1).max(32),
  aliases: z.array(z.string()),
  works: z.array(z.string()),
  tagline: z.string().max(60),
  intro: z.string().max(1000),
  tags: z.array(z.string().max(16)).max(10),
  categoryId: z.string().nullable(),
  avatar: CharacterAvatar,
  birthday: LocalDate.nullable(),
  fanName: z.string().max(20).nullable(),
  classification: CharacterClassification,
  /** 备用开场白：未配置模型时的第一条消息（CHR-03 第 6 条），上架前至少 1 条。 */
  fallbackGreetings: z.array(z.string().min(1).max(200)),
  card: DraftCharacterCard,
  personaVersion: z.number().int().positive(),
  /** 上架前置检查结果（ADM-01 第 3 条）。旧卡不适用 WB-Card 检查，后台按旧字段编辑。 */
  publishChecks: z.object({
    requiredFieldsComplete: z.boolean(),
    personaStabilityPassed: z.boolean(),
    hardBoundaryCasesPassed: z.boolean(),
    hasFallbackGreeting: z.boolean(),
  }),
  /**
   * 数据格式。缺省按新卡处理，兼容不认识该字段的旧客户端 / 旧服务端。
   * 旧卡详情与保存走 `CharacterAdminEndpoints.legacyDetail` / `legacyUpdate`。
   */
  format: CharacterCardFormat.optional(),
  /** 当前修订号（乐观并发）；旧卡保存作为 `expectedRevision`，不一致返回 409。 */
  revision: z.number().int().positive().optional(),
  updatedAt: Timestamp,
});
export type AdminCharacter = z.infer<typeof AdminCharacter>;

/** 角色库的可写字段（不带默认值）。 */
const adminCharacterFields = {
  name: z.string().min(1).max(32),
  aliases: z.array(z.string()),
  works: z.array(z.string()),
  tagline: z.string().max(60),
  intro: z.string().max(1000),
  tags: z.array(z.string().max(16)).max(10),
  categoryId: z.string().nullable(),
  avatar: CharacterAvatarWrite,
  birthday: LocalDate.nullable(),
  fanName: z.string().max(20).nullable(),
  classification: CharacterClassificationInput,
  fallbackGreetings: z.array(z.string().min(1).max(200)),
  card: DraftCharacterCard,
};

/** 新建角色：别名、作品、标签、备用开场白不传时为空数组。 */
export const AdminCharacterWrite = z.object({
  ...adminCharacterFields,
  aliases: adminCharacterFields.aliases.default([]),
  works: adminCharacterFields.works.default([]),
  tags: adminCharacterFields.tags.default([]),
  fallbackGreetings: adminCharacterFields.fallbackGreetings.default([]),
});
export type AdminCharacterWrite = z.infer<typeof AdminCharacterWrite>;

/**
 * 编辑角色：只传要改的字段；没传的字段保持原值（Q-001：不复用带默认值的新建 schema，
 * 否则只改名字会把别名、作品、标签、备用开场白清空）。
 */
export const AdminCharacterUpdate = z.object(adminCharacterFields).partial();
export type AdminCharacterUpdate = z.infer<typeof AdminCharacterUpdate>;

// ---------- 旧卡（legacy_card）后台读写 ----------

/**
 * 旧卡可编辑字段（白名单，逻辑名与后台表单一致）。写入时按旧库字段名落回 `legacy_card`；
 * 不在白名单里的旧字段（raw_json、voice_json、source_json 等）一律原样保留，不进编辑表单。
 * 旧卡核心人设不允许清空（运行时没有兜底人设）；其余字段可以显式清空。
 */
export const AdminLegacyFields = z.object({
  displayName: z.string().min(1).max(32),
  nickname: z.string().max(32),
  aliases: z.array(z.string().min(1).max(32)).max(20),
  signature: z.string().max(200),
  corePersona: z.string().min(1).max(8000),
  speakingStyle: z.string().max(4000),
  relationshipMode: z.string().max(4000),
  /** 朋友圈设定（旧卡 `moment_profile_json`）；null = 没有，保存时清空该键。 */
  momentProfile: z.json().nullable(),
  /** 群聊设定（旧卡 `group_chat_json`）；null = 没有，保存时清空该键。 */
  groupChat: z.json().nullable(),
  /** 备用开场白（旧卡 `opening_messages_json`）；空数组 = 没有。 */
  openingMessages: z.array(z.string().min(1).max(200)).max(10),
});
export type AdminLegacyFields = z.infer<typeof AdminLegacyFields>;

/** 允许显式清空的字段（核心人设与角色名字不能清空）。 */
export const AdminLegacyClearableField = z.enum([
  'nickname',
  'aliases',
  'signature',
  'speakingStyle',
  'relationshipMode',
  'momentProfile',
  'groupChat',
  'openingMessages',
]);
export type AdminLegacyClearableField = z.infer<typeof AdminLegacyClearableField>;

/** 旧库世界书一整行（payload 原样，未识别键保留）。 */
export const AdminLegacyLorebookEntry = z.object({
  id: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()),
});
export type AdminLegacyLorebookEntry = z.infer<typeof AdminLegacyLorebookEntry>;

/** 旧库对话示例一整行（payload + 独立的排序号）。 */
export const AdminLegacyDialogueExample = z.object({
  id: z.string().min(1).max(64),
  sortOrder: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});
export type AdminLegacyDialogueExample = z.infer<typeof AdminLegacyDialogueExample>;

/**
 * 旧卡版本历史里的一条（来自 characters.legacy_character_revisions 的元数据，新的在前）。
 * `revision` 是快照代表的那一版（即保存 / 恢复之前的状态），恢复时用它作为目标版本号。
 */
export const AdminLegacyRevision = z.object({
  revision: z.number().int().positive(),
  at: Timestamp,
  /** save = 保存前留存；restore = 恢复前留存。 */
  source: z.enum(['save', 'restore']),
  operatorUserId: Id.nullable(),
  operatorName: z.string(),
  /** 快照当时的主表显示名与签名（便于不看正文也能辨认版本）。 */
  name: z.string(),
  aliases: z.array(z.string()),
  signature: z.string(),
  /** 这次改动涉及哪些逻辑字段（来自审计，不含正文）。 */
  changedFields: z.array(z.string()),
  note: z.string().nullable(),
});
export type AdminLegacyRevision = z.infer<typeof AdminLegacyRevision>;

/**
 * 一个旧卡版本快照的完整内容（查看 / 恢复确认用）。
 * 与旧卡同等权限、只给后台角色管理读；不含短效签名 URL，只有头像 media id 与展示参数。
 */
export const AdminLegacySnapshot = z.object({
  characterId: Id,
  revision: z.number().int().positive(),
  at: Timestamp,
  source: z.enum(['save', 'restore']),
  operatorUserId: Id.nullable(),
  operatorName: z.string(),
  note: z.string().nullable(),
  name: z.string(),
  aliases: z.array(z.string()),
  signature: z.string(),
  fields: AdminLegacyFields,
  avatar: z.object({ mediaId: Id.nullable(), display: CharacterDisplay }),
  lorebook: z.array(AdminLegacyLorebookEntry),
  examples: z.array(AdminLegacyDialogueExample),
});
export type AdminLegacySnapshot = z.infer<typeof AdminLegacySnapshot>;

/**
 * 恢复到某个旧卡快照版本。
 * - `revision`：历史里的快照版本号（`AdminLegacyRevision.revision`）；
 * - `expectedRevision`：当前详情的 revision，不一致返回 409（避免覆盖别人刚保存的内容）；
 * - `confirm: true`：后台二次确认的显式标记，缺省不执行。
 * 恢复会写一个新 revision，并在恢复前再存一份快照；不还原上架状态与资格标注，
 * 不改角色 ID、联系人、消息，也不重新上架。
 */
export const AdminLegacyRestoreRequest = z.object({
  revision: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  confirm: z.literal(true),
  note: z.string().trim().max(200).optional(),
});
export type AdminLegacyRestoreRequest = z.infer<typeof AdminLegacyRestoreRequest>;

/** 旧卡详情：旧字段按逻辑名给出；未识别字段原样只读；世界书与示例带 id 便于局部保存。 */
export const AdminLegacyCharacterDetail = z.object({
  characterId: Id,
  status: CharacterPublishStatus,
  revision: z.number().int().positive(),
  updatedAt: Timestamp,
  name: z.string(),
  avatar: CharacterAvatar,
  fields: AdminLegacyFields,
  /** 未识别 / 不可编辑的旧字段原样值（只读；保存时不动）。 */
  preserved: z.record(z.string(), z.unknown()),
  lorebook: z.array(AdminLegacyLorebookEntry),
  examples: z.array(AdminLegacyDialogueExample),
  /** 最近的版本历史，新的在前（最多 20 条）。 */
  history: z.array(AdminLegacyRevision),
});
export type AdminLegacyCharacterDetail = z.infer<typeof AdminLegacyCharacterDetail>;

export const AdminLegacyLorebookPatch = z.object({
  /** 无 id = 新建；有 id = 更新该角色下的这一条（payload 与原值浅合并，未提交的键保留）。 */
  upsert: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .max(200)
    .optional(),
  /** 删除条目 id；必须属于该角色。 */
  delete: z.array(z.string().min(1).max(64)).max(200).optional(),
});
export type AdminLegacyLorebookPatch = z.infer<typeof AdminLegacyLorebookPatch>;

export const AdminLegacyExamplesPatch = z.object({
  upsert: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        payload: z.record(z.string(), z.unknown()),
        sortOrder: z.number().int().min(0).max(100000).optional(),
      }),
    )
    .max(200)
    .optional(),
  delete: z.array(z.string().min(1).max(64)).max(200).optional(),
});
export type AdminLegacyExamplesPatch = z.infer<typeof AdminLegacyExamplesPatch>;

/**
 * 旧卡局部保存。语义：
 * - `fields` 只传改动过的字段（没传 = 保持原值）；空串 / 空数组 / null 表示明确清空；
 * - `clear` 显式清空字段（与 fields 里的同名字段互斥，核心人设与名字不可清空）；
 * - `lorebook` / `examples` 按 id 局部更新或删除，不带 id 的新增；条目必须属于该角色；
 * - `avatarMediaId` 省略 = 不动；null = 恢复默认头像（文字）；字符串 = 换成已上传的角色头像；
 * - `expectedRevision` 与当前 revision 不一致时返回 409，避免覆盖别人刚保存的内容。
 * 不会写新卡 draft / published 密文，不改分类、上架状态、角色 ID 与关联数据。
 */
export const AdminLegacyCharacterPatch = z
  .object({
    expectedRevision: z.number().int().positive(),
    fields: AdminLegacyFields.partial().optional(),
    clear: z.array(AdminLegacyClearableField).max(10).optional(),
    lorebook: AdminLegacyLorebookPatch.optional(),
    examples: AdminLegacyExamplesPatch.optional(),
    avatarMediaId: Id.nullable().optional(),
    /** 可选备注，写进修改记录。 */
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    const both = (value.clear ?? []).filter(
      (field) => value.fields !== undefined && value.fields[field] !== undefined,
    );
    if (both.length)
      ctx.addIssue({
        code: 'custom',
        path: ['clear'],
        message: `同一字段不能既提交新值又清空：${both.join('、')}`,
      });
    for (const [label, block] of [
      ['lorebook', value.lorebook],
      ['examples', value.examples],
    ] as const) {
      if (!block) continue;
      const ids = block.delete ?? [];
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: 'custom',
          path: [label, 'delete'],
          message: '删除列表里有重复条目',
        });
      const upserted = (block.upsert ?? []).flatMap((item) => (item.id ? [item.id] : []));
      const clash = upserted.filter((id) => ids.includes(id));
      if (clash.length)
        ctx.addIssue({
          code: 'custom',
          path: [label],
          message: `同一条目不能既保存又删除：${clash.join('、')}`,
        });
    }
  });
export type AdminLegacyCharacterPatch = z.infer<typeof AdminLegacyCharacterPatch>;

/**
 * 3.25（试用反馈第三轮 G1-2）：后台人工标注角色资格。可直接改「真人 / 未成年设定 / 儿童外貌 / 检出儿童特征」，
 * 两个方向都能改（纠正 AI 误判）；预设角色与用户自建角色都适用。人工标注优先于自动结果（含 AI 检出、
 * 用户套用的预设改版检出），清除人工标注后恢复自动结果。每次修改留审计（谁、何时、原因必填）。
 */
export const CharacterEligibilityFacts = z
  .object({
    ...classificationFields,
    childFeaturesDetected: z.boolean(),
  })
  .superRefine(checkClassificationCombination);
export type CharacterEligibilityFacts = z.infer<typeof CharacterEligibilityFacts>;

export const CharacterEligibilityChange = z.object({
  at: Timestamp,
  operatorUserId: Id.nullable(),
  /** 操作人账号名（查不到时为空字符串）。 */
  operatorName: z.string(),
  reason: z.string(),
  /** 修改前的人工标注（null = 当时没有人工标注，按自动结果）。 */
  before: CharacterEligibilityFacts.nullable(),
  /** 修改后的人工标注（null = 清除人工标注，恢复自动结果）。 */
  after: CharacterEligibilityFacts.nullable(),
});
export type CharacterEligibilityChange = z.infer<typeof CharacterEligibilityChange>;

export const AdminCharacterEligibility = z.object({
  characterId: Id,
  name: z.string(),
  kind: CharacterKind,
  /** 自动结果（资料里的分类 + 系统 / AI 检出），不含人工标注。 */
  auto: CharacterEligibilityFacts,
  /** 当前人工标注；null = 没有人工标注。 */
  override: CharacterEligibilityFacts.nullable(),
  /** 实际生效的分类与推导结果（有人工标注时按人工标注）。 */
  effective: CharacterClassification,
  /** 修改记录（新的在前，最多 50 条）。 */
  history: z.array(CharacterEligibilityChange),
});
export type AdminCharacterEligibility = z.infer<typeof AdminCharacterEligibility>;

export const UpdateCharacterEligibilityRequest = z.object({
  /** 新的人工标注；null = 清除人工标注，恢复自动结果。 */
  override: CharacterEligibilityFacts.nullable(),
  /** 修改原因（必填）。 */
  reason: z.string().trim().min(2).max(200),
});
export type UpdateCharacterEligibilityRequest = z.infer<typeof UpdateCharacterEligibilityRequest>;

/**
 * 后台「彻底删除（硬删）」影响面。与「下架（软删）」并存：硬删会物理删除角色及下列关联数据，
 * 无法恢复。计数口径：contacts = 该角色的全部联系人记录（含待通过 / 已进入删除保留期的记录）；
 * conversations / messages = 与该角色的私聊会话及其消息（不含群聊，群聊只移除该角色成员关系）；
 * moments = 该角色发布的朋友圈动态。查询与执行在同一套 SQL 上，执行结果按实际删除前的计数返回。
 */
export const AdminCharacterPurgeCounts = z.object({
  contacts: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  moments: z.number().int().nonnegative(),
});
export type AdminCharacterPurgeCounts = z.infer<typeof AdminCharacterPurgeCounts>;

export const AdminCharacterPurgeImpact = z.object({
  characterId: Id,
  name: z.string(),
  status: CharacterPublishStatus,
  counts: AdminCharacterPurgeCounts,
});
export type AdminCharacterPurgeImpact = z.infer<typeof AdminCharacterPurgeImpact>;

/**
 * 彻底删除结果。`counts` 是删除前实际算出的影响面；`purgedAt` 是事务提交时间。
 * 角色不存在、已删除或不是预设角色时返回 404；仍有不能自动清理的引用（例如用户已发布的预设改版作品）
 * 时返回 409，`details` 给出原因和计数，不静默跳过。
 */
export const AdminCharacterPurgeResult = z.object({
  characterId: Id,
  purgedAt: Timestamp,
  counts: AdminCharacterPurgeCounts,
});
export type AdminCharacterPurgeResult = z.infer<typeof AdminCharacterPurgeResult>;

export const CharacterAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters`,
    auth: 'admin',
    query: z.object({ status: CharacterPublishStatus.optional(), q: z.string().optional() }),
    response: z.object({ items: z.array(AdminCharacter) }),
    summary: '角色库列表',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters`,
    auth: 'admin',
    body: AdminCharacterWrite,
    response: AdminCharacter,
    summary: '新建预设角色（草稿）。分类必填；成人模式资格由系统推导，不可设置',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/characters/:characterId`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: AdminCharacterUpdate,
    response: AdminCharacter,
    summary: '编辑预设角色；分类变化触发 characters.character_classification_changed',
  }),
  legacyDetail: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/legacy`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: AdminLegacyCharacterDetail,
    summary:
      '旧卡详情：按旧字段返回人设/风格/关系/朋友圈/群聊/开场白，世界书与示例按需读，未识别字段只读保留；非旧卡返回 422',
  }),
  legacyUpdate: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/characters/:characterId/legacy`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: AdminLegacyCharacterPatch,
    response: AdminLegacyCharacterDetail,
    summary:
      '旧卡局部保存：白名单字段局部合并与显式清空、世界书/示例按 id 更新删除、头像替换；expectedRevision 冲突返回 409；保存前写完整版本快照，不写新卡密文',
  }),
  legacyRevision: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/legacy/revisions/:revision`,
    auth: 'admin',
    params: z.object({ characterId: Id, revision: z.coerce.number().int().positive() }),
    response: AdminLegacySnapshot,
    summary: '旧卡某个版本快照的完整内容（查看 / 恢复确认用）；只查本角色的快照，不含签名 URL',
  }),
  legacyRestore: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/legacy/restore`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: AdminLegacyRestoreRequest,
    response: AdminLegacyCharacterDetail,
    summary:
      '恢复到某个旧卡快照版本：需 expectedRevision 与 confirm=true；写新 revision 并在恢复前再存快照；不还原上架状态与资格，不动角色 ID/联系人/消息',
  }),
  publish: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/publish`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: AdminCharacter,
    summary: '上架；publishChecks 任一项为 false 时 422',
  }),
  unpublish: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/unpublish`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: AdminCharacter,
    summary: '下架：不再出现在广场，已添加的用户不受影响（ADM-01 第 5 条）',
  }),
  getEligibility: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/eligibility`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: AdminCharacterEligibility,
    summary: '3.25：角色资格（自动结果、人工标注、生效结果与修改记录）；预设与用户自建角色都可查',
  }),
  setEligibility: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/characters/:characterId/eligibility`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: UpdateCharacterEligibilityRequest,
    response: AdminCharacterEligibility,
    summary:
      '3.25：人工标注 / 清除角色资格（原因必填，写审计）；生效结果变化时发 characters.character_classification_changed',
  }),
  purgeImpact: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/purge-impact`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: AdminCharacterPurgeImpact,
    summary: '彻底删除前的影响面：联系人、私聊会话、消息、朋友圈条数；角色不存在或已删除时 404',
  }),
  purge: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/characters/:characterId`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    query: z.object({ purge: z.literal('true') }),
    response: AdminCharacterPurgeResult,
    summary:
      '管理员彻底删除预设角色（硬删，不可恢复）：单事务删除角色与联系人 / 私聊 / 消息 / 朋友圈等关联数据，写审计；不存在或已删除 404',
  }),
} as const;
