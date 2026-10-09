/**
 * characters 模块 3.0 扩展（L4～L7，T-062）：
 * - 关系网（SOC-01、ADM-02）：预设角色之间由管理员录入，公开依据必填；用户的自定义角色之间由用户设定；
 * - 我的补充设定（CHR-09）与人设更新提示（CHR-10 第 4 条）；
 * - 作品链接库（MED-05 第 2、3 条）；
 * - 预设角色的默认音色（MED-03 第 1 条；音色库本身归 media，见 http/assets.ts）。
 * 数据归 characters（表 relations、user_supplements、work_links 等，overview.md 第 4 节）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';
import { LinkAppHint } from './chat.js';

// ---------- 关系网 ----------

/** 关系类型（SOC-01 第 1 条）。新增取值是次版本变更；客户端读时用接收端容错。 */
export const RelationType = z.enum([
  'groupmate', // 同团成员
  'costar', // 合作演员
  'friend',
  'mentor', // 师徒
  'family',
  'colleague',
  'in_work', // 作品中的关系
  'other',
]);
export type RelationType = z.infer<typeof RelationType>;

/** 亲疏程度：点头之交 / 熟悉 / 亲密（SOC-01 第 6 条）。 */
export const RelationCloseness = z.enum(['acquaintance', 'familiar', 'close']);
export type RelationCloseness = z.infer<typeof RelationCloseness>;

/** 一条关系，双向生效（ADM-02 第 2 条）。characterAId < characterBId（服务器规范化）。 */
export const CharacterRelation = z.object({
  relationId: Id,
  characterAId: Id,
  characterBId: Id,
  type: RelationType,
  /** 作品中的关系、其他：补充说明，例「《XX》中的师兄妹」。 */
  label: z.string().max(30).nullable(),
  closeness: RelationCloseness,
  /** 公开依据（预设角色之间必填，ADM-02 第 1 条）；用户自定义角色之间为 null。 */
  evidence: z.string().min(1).max(500).nullable(),
  /** 预设角色之间为 null；自定义角色之间为设定关系的用户。 */
  ownerUserId: Id.nullable(),
  updatedAt: Timestamp,
});
export type CharacterRelation = z.infer<typeof CharacterRelation>;

export const AdminRelationWrite = z.object({
  characterAId: Id,
  characterBId: Id,
  type: RelationType,
  label: z.string().max(30).nullable().default(null),
  closeness: RelationCloseness,
  evidence: z.string().trim().min(1).max(500),
});

export const UserRelationWrite = z.object({
  characterAId: Id,
  characterBId: Id,
  type: RelationType,
  label: z.string().max(30).nullable().default(null),
  closeness: RelationCloseness,
});

export const RelationParams = z.object({ relationId: Id });

export const RelationAdminEndpoints = {
  listRelations: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/relations`,
    auth: 'admin',
    query: z.object({ characterId: Id.optional() }),
    response: z.object({ items: z.array(CharacterRelation) }),
    summary: '关系网列表（ADM-02），可按角色筛选',
  }),
  createRelation: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/relations`,
    auth: 'admin',
    body: AdminRelationWrite,
    response: CharacterRelation,
    summary:
      '在两个预设角色之间添加关系，公开依据必填；两人已有关系返回 409 conflict；真人与虚构之间返回 422 bad_request（SOC-01 第 2 条）。写审计，发 characters.relation_changed',
  }),
  updateRelation: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/relations/:relationId`,
    auth: 'admin',
    params: RelationParams,
    body: AdminRelationWrite.omit({ characterAId: true, characterBId: true }).partial(),
    response: CharacterRelation,
    summary: '编辑关系；写审计，发 characters.relation_changed',
  }),
  deleteRelation: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/relations/:relationId`,
    auth: 'admin',
    params: RelationParams,
    response: NoContent,
    summary: '删除关系（ADM-02 第 3 条），历史聊天保留；写审计，发 characters.relation_changed',
  }),
} as const;

export const UserRelationEndpoints = {
  listMyRelations: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/character-relations`,
    auth: 'user',
    response: z.object({ items: z.array(CharacterRelation) }),
    summary: '我为自定义角色之间设定的关系（SOC-01 第 3 条）',
  }),
  createMyRelation: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/character-relations`,
    auth: 'user',
    body: UserRelationWrite,
    response: CharacterRelation,
    summary:
      '在我的两个自定义角色之间设定关系；任一方是预设角色返回 422 bad_request（不能声称明星认识用户的朋友）',
  }),
  updateMyRelation: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/character-relations/:relationId`,
    auth: 'user',
    params: RelationParams,
    body: UserRelationWrite.omit({ characterAId: true, characterBId: true }).partial(),
    response: CharacterRelation,
    summary: '修改我设定的关系（资料页「TA 认识的人」）',
  }),
  deleteMyRelation: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/character-relations/:relationId`,
    auth: 'user',
    params: RelationParams,
    response: NoContent,
    summary: '删除我设定的关系',
  }),
} as const;

// ---------- 我的补充设定（CHR-09） ----------

/** 补充设定与基础人设公开事实的冲突项（CHR-09 第 2 条：以公开事实为准并提示）。 */
export const SupplementConflict = z.object({
  field: z.string().max(32),
  publicValue: z.string().max(200),
  supplementValue: z.string().max(200),
});

export const UserSupplement = z.object({
  characterId: Id,
  text: z.string().max(5000),
  conflicts: z.array(SupplementConflict),
  /** 来自人设广场「应用改版」时的来源（PLZ-04 第 4 条）；手写或导入为 null。 */
  plazaSource: z
    .object({ workId: Id, version: z.number().int().positive(), authorName: z.string() })
    .nullable(),
  updatedAt: Timestamp,
});
export type UserSupplement = z.infer<typeof UserSupplement>;

export const CharacterSupplementEndpoints = {
  getSupplement: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/supplement`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: UserSupplement.nullable(),
    summary: '我对某个预设角色的补充设定（只对我生效）；没有时返回 null',
  }),
  putSupplement: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/characters/:characterId/supplement`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({ text: z.string().trim().min(1).max(5000) }),
    response: UserSupplement,
    summary:
      '保存补充设定（手写或导入结果确认后）。只对预设角色可用；自定义角色的导入结果直接合并进人设（PATCH /characters/custom/:id）。' +
      '不能改变分类与成人模式资格（CHR-09 第 5 条）。发 characters.supplement_changed',
  }),
  deleteSupplement: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/characters/:characterId/supplement`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: NoContent,
    summary: '删除补充设定，角色回到基础人设',
  }),
} as const;

// ---------- 人设更新提示（CHR-10 第 4 条） ----------

export const PersonaUpdateNote = z.object({
  personaVersion: z.number().int().positive(),
  /** 管理员写的更新摘要，例「新增作品《XX》」。 */
  summary: z.string().max(200),
  publishedAt: Timestamp,
});

export const PersonaUpdateEndpoints = {
  listPersonaUpdates: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/persona-updates`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: z.object({ items: z.array(PersonaUpdateNote), unseenCount: z.number().int() }),
    summary: '角色资料页「资料已更新」：最近的人设版本摘要，最新在前（最多 20 条）',
  }),
  markPersonaUpdatesSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/:characterId/persona-updates/seen`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: NoContent,
    summary: '看过后红点消失（CharacterProfile.personaUpdatedUnseen 变为 false）',
  }),
} as const;

// ---------- 作品链接库（MED-05） ----------

export const WorkLink = z.object({
  workLinkId: Id,
  characterId: Id,
  title: z.string().min(1).max(100),
  url: z.url().max(2000),
  source: z.string().max(30).nullable(),
  appHint: LinkAppHint,
  coverMediaId: Id.nullable(),
  /** 最近一次可访问性检查（AI / 后端定时任务写入），失败的链接角色不再分享。 */
  lastCheck: z.object({ ok: z.boolean(), checkedAt: Timestamp }).nullable(),
  enabled: z.boolean(),
  updatedAt: Timestamp,
});
export type WorkLink = z.infer<typeof WorkLink>;

export const WorkLinkWrite = WorkLink.pick({
  title: true,
  url: true,
  source: true,
  appHint: true,
  coverMediaId: true,
  enabled: true,
});

export const WorkLinkAdminEndpoints = {
  listWorkLinks: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/work-links`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: z.object({ items: z.array(WorkLink) }),
    summary: '某预设角色的作品链接库（MED-05 第 2、3 条）',
  }),
  createWorkLink: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/work-links`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: WorkLinkWrite,
    response: WorkLink,
    summary: '添加作品链接；保存后立即做一次可访问性检查',
  }),
  updateWorkLink: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/characters/:characterId/work-links/:workLinkId`,
    auth: 'admin',
    params: z.object({ characterId: Id, workLinkId: Id }),
    body: WorkLinkWrite.partial(),
    response: WorkLink,
    summary: '编辑作品链接',
  }),
  deleteWorkLink: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/characters/:characterId/work-links/:workLinkId`,
    auth: 'admin',
    params: z.object({ characterId: Id, workLinkId: Id }),
    response: NoContent,
    summary: '删除作品链接',
  }),
  setDefaultVoice: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/characters/:characterId/voice`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    body: z.object({ voiceId: Id.nullable() }),
    response: z.object({ characterId: Id, voiceId: Id.nullable() }),
    summary:
      '为预设角色指定默认音色（MED-03 第 1 条；音色库见 media）；用户可在陪伴设置 voiceId 中更换。写审计',
  }),
} as const;

// ---------- 自定义角色来源（PLZ-04 第 4 条、hard-boundaries.md 第 6 节） ----------

/** 自定义角色的来源。plaza_copy 的角色分类被锁定，只能更严（数据库触发器）。 */
export const CustomCharacterOrigin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), importJobId: Id.nullable() }),
  z.object({
    kind: z.literal('plaza_copy'),
    workId: Id,
    version: z.number().int().positive(),
    /** 作者广场昵称快照；作者注销后客户端显示「已注销用户」（authorDeleted = true）。 */
    authorName: z.string().max(12),
    authorDeleted: z.boolean(),
    /** 作品已下架或删除时为 false：来源标注只显示文字，不能跳转（PLZ-06 第 3 条）。 */
    workAvailable: z.boolean(),
    /** 作者发布了更新的版本、我还没处理（PLZ-05 第 4 条）。 */
    newerVersionAvailable: z.number().int().positive().nullable(),
  }),
]);
export type CustomCharacterOrigin = z.infer<typeof CustomCharacterOrigin>;

export const CustomCharacterOriginEndpoints = {
  getOrigin: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/custom/:characterId/origin`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: z.object({
      origin: CustomCharacterOrigin,
      /** 只增标记：曾经被标为「基于身边真人」（PLZ-02 第 11 条），为 true 时不能发布到人设广场。 */
      everPrivatePerson: z.boolean(),
    }),
    summary: '自定义角色的来源标注与能否发布的依据（资料页「来自人设广场 · 作者 XX · 版本 N」）',
  }),
} as const;
