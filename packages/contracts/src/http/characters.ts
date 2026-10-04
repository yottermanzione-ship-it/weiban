/**
 * characters 模块：角色广场、角色资料、角色分类、管理后台角色库（最小版）。
 * 需求：CHR-01、CHR-02、CHR-11（结构见 character-card.ts）、ADM-01（最小）、PRD 第 10 章 10.0。
 * 硬性边界字段规则见 docs/architecture/hard-boundaries.md 第 2 节。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, cursorPage, defineEndpoint } from '../common.js';
import { CharacterCard } from '../character-card.js';

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

/** 可写入的分类事实（谁能写见 hard-boundaries.md 第 2 节）。 */
export const CharacterClassificationInput = z.object({
  basis: CharacterBasis,
  /** basis = real_person 时必填，其他情况必须为 null。 */
  realPersonKind: RealPersonKind.nullable(),
  ageSetting: AgeSetting,
  childAppearance: z.boolean(),
});
export type CharacterClassificationInput = z.infer<typeof CharacterClassificationInput>;

/**
 * 形象图生成策略（SAFE-01、MED-02）：
 * forbidden 真人分类（公众人物、身边真人、历史人物）不生成本人形象；
 * allowed 虚构、原创角色。
 * v0.2：原裁定 9.2 第 1、3 条（古风插画、仅个人测试）已删除，去掉 classical_art_only、personal_only。
 */
export const PortraitPolicy = z.enum(['forbidden', 'allowed']);
export type PortraitPolicy = z.infer<typeof PortraitPolicy>;

/** 读取时返回：分类事实 + 系统推导结果（只读，任何接口都不能写入推导字段）。 */
export const CharacterClassification = CharacterClassificationInput.extend({
  /** 由系统检测人设文本写入（SAFE-03 第 4 条）。 */
  childFeaturesDetected: z.boolean(),
  derived: z.object({
    isMinor: z.boolean(),
    /** = 非真人 且 非儿童（两条底线，hard-boundaries.md 第 2 节）；同时决定能否使用无审查模型。 */
    adultModeEligible: z.boolean(),
    romanceAllowed: z.boolean(),
    portraitPolicy: PortraitPolicy,
    /** 是否开启「不冒充本人公开言论」检查（SAFE-02），= basis 为 real_person。 */
    publicStatementGuard: z.boolean(),
  }),
});
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

export const CharacterPublishStatus = z.enum(['draft', 'pending_check', 'published', 'unpublished', 'disabled']);
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

// ---------- 管理后台（ADM-01 最小版） ----------

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
  card: CharacterCard,
  personaVersion: z.number().int().positive(),
  /** 上架前置检查结果（ADM-01 第 3 条）。 */
  publishChecks: z.object({
    requiredFieldsComplete: z.boolean(),
    personaStabilityPassed: z.boolean(),
    hardBoundaryCasesPassed: z.boolean(),
    hasFallbackGreeting: z.boolean(),
  }),
  updatedAt: Timestamp,
});
export type AdminCharacter = z.infer<typeof AdminCharacter>;

export const AdminCharacterWrite = z.object({
  name: z.string().min(1).max(32),
  aliases: z.array(z.string()).default([]),
  works: z.array(z.string()).default([]),
  tagline: z.string().max(60),
  intro: z.string().max(1000),
  tags: z.array(z.string().max(16)).max(10).default([]),
  categoryId: z.string().nullable(),
  avatar: CharacterAvatarWrite,
  birthday: LocalDate.nullable(),
  fanName: z.string().max(20).nullable(),
  classification: CharacterClassificationInput,
  fallbackGreetings: z.array(z.string().min(1).max(200)).default([]),
  card: CharacterCard,
});

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
    body: AdminCharacterWrite.partial(),
    response: AdminCharacter,
    summary: '编辑预设角色；分类变化触发 characters.character_classification_changed',
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
} as const;
