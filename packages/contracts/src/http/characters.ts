/**
 * characters 模块：角色广场、角色资料、角色分类、管理后台角色库（最小版）。
 * 需求：CHR-01、CHR-02、CHR-11（结构见 character-card.ts）、ADM-01（最小）、PRD 第 10 章 10.0。
 * 硬性边界字段规则见 docs/architecture/hard-boundaries.md 第 2 节。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, cursorPage, defineEndpoint } from '../common.js';
import { CharacterCard } from '../character-card.js';

// ---------- 分类（硬性边界的判定依据） ----------

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
 * 形象图生成策略（SAFE-01、MED-02、总负责人裁定 9.2 第 1、3 条）：
 * forbidden 真人（在世公众人物、基于身边真人）不生成本人形象；
 * classical_art_only 历史人物，只允许古风插画风格、不模仿具体作品；
 * personal_only 虚构作品角色，允许生成，仅限个人测试、不对外分发，分享图需加注；
 * allowed 原创角色。
 */
export const PortraitPolicy = z.enum(['forbidden', 'classical_art_only', 'personal_only', 'allowed']);
export type PortraitPolicy = z.infer<typeof PortraitPolicy>;

/** 读取时返回：分类事实 + 系统推导结果（只读，任何接口都不能写入推导字段）。 */
export const CharacterClassification = CharacterClassificationInput.extend({
  /** 由系统检测人设文本写入（SAFE-03 第 4 条）。 */
  childFeaturesDetected: z.boolean(),
  derived: z.object({
    isMinor: z.boolean(),
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

/** 头像：非肖像的字母 / 应援色设计（真人默认），或一张图片。 */
export const CharacterAvatar = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('monogram'),
    text: z.string().min(1).max(2),
    /** 设计令牌中的颜色名，具体取值由设计负责人定义。 */
    colorToken: z.string(),
  }),
  z.object({ type: z.literal('media'), mediaId: Id, url: z.url() }),
]);
export type CharacterAvatar = z.infer<typeof CharacterAvatar>;

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
  avatar: CharacterAvatar,
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
