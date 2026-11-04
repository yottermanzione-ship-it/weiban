import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';
import { CharacterSummary } from './characters.js';
import { PlazaWorkCard } from './plaza.js';

/** 搜索供应商返回的公开资料，不是已经核实的人设或平台指令。 */
export const WebSearchHit = z.object({
  title: z.string().max(300),
  url: z.url().max(2000),
  snippet: z.string().max(1000),
  source: z.string().max(200).nullable(),
  publishedAt: z.string().max(40).nullable(),
  authority: z.number().int().min(-1).max(4).optional(),
  relevance: z.number().min(0).max(3).optional(),
  content: z.string().max(20000).optional(),
});
export const WebPage = z.object({ title: z.string().max(300), content: z.string().max(20000) });
// ---------- 5.6：站外候选的身份与出处（T-20261104e，docs/refactor/24-character-search.md 第 3 步） ----------

/** 一个站外候选最多附几条出处。 */
export const WEB_CANDIDATE_SOURCE_LIMIT = 5;
/** 一条公开出处：网页标题、地址、网站名（供应商给的或域名）。都是不可信的公开资料，不是平台结论。 */
export const WebCandidateSource = z.object({
  url: z.url().max(2000),
  title: z.string().max(300),
  site: z.string().max(200).nullable(),
});
export type WebCandidateSource = z.infer<typeof WebCandidateSource>;
/**
 * 站外候选的主动作：add = 后台已把它关联到本站官方角色（直接添加）；chat = 关联的官方角色已是好友；
 * create = 本站没有对应角色（用公开资料预填创建 / 申请制作页）。接收端按 tolerantEnum 解析，不认识的退回 create。
 */
export const WebCandidateAction = z.enum(['add', 'chat', 'create']);
export type WebCandidateAction = z.infer<typeof WebCandidateAction>;
/** 站外候选 ID：服务器按公开资料标识 / 规范化出处算出，点击时只提交它，服务器重读候选。 */
export const WebCandidateId = z.string().regex(/^web_[A-Za-z0-9_-]{22}$/u);

/**
 * 3.30 联网候选；5.6 起附结构化身份与出处（新增字段都是可选的，旧客户端只读前四个字段不受影响）。
 * 同名的不同人物分开列出：只有同一个公开资料标识（如同一个百科条目）或后台人工关联才合并成一项，
 * 名字、头像相同或模型一句判断都不算证据。
 */
export const CharacterSearchCandidate = z.object({
  name: z.string().min(1).max(32),
  title: z.string().max(300),
  description: z.string().max(500),
  /** 第一条出处（3.30 起就有）；完整出处见 sources。 */
  sourceUrl: z.url().max(2000),
  /** 5.6：候选 ID；点击时只提交它（SearchEndpoints.resolveCandidate）。 */
  candidateId: WebCandidateId.optional(),
  /**
   * 5.6：一句身份说明（职业 / 作品 / 所属）。后台核实过的取后台填写的；否则只从公开结果的标题括注或
   * 摘要首句里按固定规则摘出（不调用模型、不编），出处见 identitySourceUrl；摘不出为 null。
   */
  identity: z.string().max(120).nullable().optional(),
  /** 5.6：身份说明摘自哪条出处；后台核实的为后台登记的第一条出处，可能为 null。 */
  identitySourceUrl: z.url().max(2000).nullable().optional(),
  /** 5.6：逐项出处（同一公开资料条目的多个网页合并在这里）。 */
  sources: z.array(WebCandidateSource).min(1).max(WEB_CANDIDATE_SOURCE_LIMIT).optional(),
  /** 5.6：实体键：公开资料标识（baike:… / wiki:zh:… 等）或后台人工关联的 manual:…；没有可靠标识为 null。 */
  entityKey: z.string().max(120).nullable().optional(),
  /** 5.6：身份未经平台核实（不是后台填写过身份说明的实体）。客户端显示「未核实」。 */
  unverified: z.boolean().optional(),
  /** 5.6：这批候选里还有同名的其他项（身份查不到时客户端写「暂未核实身份」并提示补作品 / 职业再查）。 */
  ambiguous: z.boolean().optional(),
  action: tolerantEnum(WebCandidateAction).optional(),
  /** 5.6：action = add / chat 时关联的本站官方角色。 */
  characterId: Id.nullable().optional(),
  /** 5.6：action = chat 时的私聊会话。 */
  conversationId: Id.nullable().optional(),
  added: z.boolean().optional(),
  /** 5.6：关联官方角色的卡片（头像、简介）。 */
  character: CharacterSummary.nullable().optional(),
});
export type CharacterSearchCandidate = z.infer<typeof CharacterSearchCandidate>;

/** 5.6：点击候选后服务器重读的结果。添加仍走现有添加闸门（POST /contacts 会再核一次资格）。 */
export const WebCandidateResolution = z.object({
  candidateId: WebCandidateId,
  action: tolerantEnum(WebCandidateAction),
  characterId: Id.nullable(),
  conversationId: Id.nullable(),
  /** action = create 时的预填资料，全部来自服务器保存的候选，不用客户端提交的名字或网址。 */
  prefill: z
    .object({
      name: z.string().min(1).max(32),
      identity: z.string().max(120).nullable(),
      description: z.string().max(500),
      sourceUrl: z.url().max(2000),
    })
    .nullable(),
});
export type WebCandidateResolution = z.infer<typeof WebCandidateResolution>;

// ---------- 5.5：站内角色搜索（T-20261104b，docs/refactor/24-character-search.md 第 1、2 步） ----------

/** 参与匹配的最大字数；更长的输入截断后只在站内搜，不提示联网查找。 */
export const SITE_SEARCH_QUERY_MAX_CHARS = 64;
/** 站内联想最多条数。 */
export const SITE_SEARCH_SUGGEST_LIMIT = 8;
/** 「你是否想找…」错字建议最多条数（方案：近似建议最多 5 条）。 */
export const SITE_SEARCH_DID_YOU_MEAN_LIMIT = 5;
/** 聚合结果每页条数（方案：展开结果每页 20 条、稳定游标）。 */
export const SITE_SEARCH_PAGE_LIMIT = 20;

/** 结果来源：官方角色（已上架预设）、广场作品、本人角色（只对本人可见）。 */
export const SiteSearchSource = z.enum(['official', 'plaza', 'own']);
export type SiteSearchSource = z.infer<typeof SiteSearchSource>;
/**
 * 结果的主动作：官方角色直接添加；广场作品进详情看作者再添加；已是好友去聊天；本人角色打开自己的资料。
 * 接收端一律按 tolerantEnum 解析：以后新增的动作读成 unsupported，客户端退回「打开资料 / 作品页」。
 */
export const SiteSearchAction = z.enum(['add', 'view_work', 'chat', 'open_own']);
export type SiteSearchAction = z.infer<typeof SiteSearchAction>;
/** 命中方式：精确（名字或别名完全相同）、前缀、完整拼音、拼音首字母、包含。错字不在这里，只进 didYouMean。 */
export const SiteSearchMatch = z.enum(['exact', 'prefix', 'pinyin', 'initials', 'contains']);
export type SiteSearchMatch = z.infer<typeof SiteSearchMatch>;
/** 不是名字本身命中时，命中的是哪一项：经审核的别名、关键词（代表作品等）、预设改版「基于的角色」。 */
export const SiteSearchTermKind = z.enum(['alias', 'keyword', 'based_on']);
export const SiteSearchMatchedTerm = z.object({
  text: z.string().min(1).max(64),
  kind: tolerantEnum(SiteSearchTermKind),
});
export type SiteSearchMatchedTerm = z.infer<typeof SiteSearchMatchedTerm>;
/** 「你是否想找…」：点击才把 text 当作新的搜索词，服务器不会悄悄改写搜索词。 */
export const SiteSearchDidYouMean = z.object({ text: z.string().min(1).max(64) });
export type SiteSearchDidYouMean = z.infer<typeof SiteSearchDidYouMean>;

/** 站内联想的一条：只是一个名字（同名的不同人物在聚合结果里才分开显示）。 */
export const SiteSearchSuggestion = z.object({
  text: z.string().min(1).max(64),
  match: tolerantEnum(SiteSearchMatch),
  matchedTerm: SiteSearchMatchedTerm.nullable(),
  /** 这个名字出现在哪些来源。 */
  sources: z.array(tolerantEnum(SiteSearchSource)).max(3),
});
export type SiteSearchSuggestion = z.infer<typeof SiteSearchSuggestion>;

/**
 * 聚合结果的一项：每个角色 / 作品单独一项，不按名字、头像或模型判断合并人物。
 * 点击后客户端只用 characterId / workId / conversationId 走现有页面与接口，服务器在那里重新核对资格
 * （添加闸门、作品可见性），旧搜索结果不能绕过。
 */
export const SiteSearchResult = z.object({
  /** 候选 ID：来源 + 角色 / 作品 ID，例如 official:<uuid>。 */
  candidateId: z.string().min(1).max(80),
  source: tolerantEnum(SiteSearchSource),
  action: tolerantEnum(SiteSearchAction),
  name: z.string().min(1).max(64),
  match: tolerantEnum(SiteSearchMatch),
  matchedTerm: SiteSearchMatchedTerm.nullable(),
  /** 一句身份说明：只取本站已审核资料（官方角色的职业 / 出处 / 代表作品，改版作品基于的官方角色）；没有为 null。 */
  identity: z.string().max(120).nullable(),
  /** 没有可核实的身份说明。 */
  unverified: z.boolean(),
  /** 结果里还有同名的其他项；unverified 且 ambiguous 时客户端显示「暂未核实身份」。 */
  ambiguous: z.boolean(),
  /** 经核实的实体键：5.6 起官方角色被后台人工关联到实体时才有，其余为 null。 */
  entityKey: z.string().max(120).nullable(),
  /** 可点击的公开出处：5.6 起为官方角色所关联实体登记的第一条出处，其余为 null。 */
  sourceUrl: z.url().max(2000).nullable(),
  /** 官方 / 本人角色的 ID；广场作品已添加时是自己的那份角色。 */
  characterId: Id.nullable(),
  workId: Id.nullable(),
  /** action = chat 时的私聊会话。 */
  conversationId: Id.nullable(),
  /** 已在通讯录（好友关系有效）。 */
  added: z.boolean(),
  /** 官方 / 本人角色的卡片（头像、简介）。 */
  character: CharacterSummary.nullable(),
  /** 广场作品的卡片（头像、作者、热度）。 */
  work: PlazaWorkCard.nullable(),
});
export type SiteSearchResult = z.infer<typeof SiteSearchResult>;

const SiteSearchQueryText = z.string().max(200).default('');

export const SearchEndpoints = {
  characterCandidates: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/search/character-candidates`,
    auth: 'user',
    body: z.object({ query: z.string().trim().min(2).max(64) }).strict(),
    response: z.object({ items: z.array(CharacterSearchCandidate).max(5) }),
    summary:
      '3.30：手动搜索公开角色候选；平台付费，按北京自然日限额，不搜索私人信息。' +
      '5.6：候选附身份说明、逐项出处、实体键、未核实标记与动作；同名不同人分开列出，后台关联到官方角色的显示添加 / 去聊天',
  }),
  resolveCandidate: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/search/character-candidates/resolve`,
    auth: 'user',
    body: z.object({ candidateId: WebCandidateId }).strict(),
    response: WebCandidateResolution,
    summary:
      '5.6：点击站外候选：只提交候选 ID，服务器重读保存的候选与后台实体关联，返回添加 / 去聊天的官方角色或创建页预填；' +
      '不接受客户端提交的名字和网址，不收费、不联网；候选过期或不存在返回 404',
  }),
  suggest: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/search/suggest`,
    auth: 'user',
    query: z.object({ q: SiteSearchQueryText }),
    response: z.object({
      /** 实际参与匹配的搜索词（标准化显示形式，超长已截断）。 */
      query: z.string().max(SITE_SEARCH_QUERY_MAX_CHARS),
      items: z.array(SiteSearchSuggestion).max(SITE_SEARCH_SUGGEST_LIMIT),
      didYouMean: z.array(SiteSearchDidYouMean).max(SITE_SEARCH_DID_YOU_MEAN_LIMIT),
    }),
    summary:
      '5.5：站内联想（边输入边查）：名字 / 经审核别名 / 关键词的精确、前缀、完整拼音、拼音首字母与包含；' +
      '只查官方角色、上架中的广场作品和本人角色（私人角色只按本人查）；不调用模型、不收费、不联网。' +
      '错字只给 didYouMean 建议，不改写搜索词',
  }),
  results: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/search/characters`,
    auth: 'user',
    query: z.object({
      q: SiteSearchQueryText,
      /** 明确选择的来源（广场「微伴角色」/「自定义角色」页签）：相关性相同时排在前面。 */
      prefer: z.enum(['official', 'plaza']).optional(),
      cursor: z.string().max(500).optional(),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(SITE_SEARCH_PAGE_LIMIT)
        .default(SITE_SEARCH_PAGE_LIMIT),
    }),
    response: z.object({
      query: z.string().max(SITE_SEARCH_QUERY_MAX_CHARS),
      items: z.array(SiteSearchResult).max(SITE_SEARCH_PAGE_LIMIT),
      nextCursor: z.string().nullable(),
      didYouMean: z.array(SiteSearchDidYouMean).max(SITE_SEARCH_DID_YOU_MEAN_LIMIT),
    }),
    summary:
      '5.5：站内聚合结果：每项标明来源与动作（官方可添加、广场作品看详情、已是好友去聊天、本人角色看资料），' +
      '同名的不同人物分开列出并附身份说明；排序先看文本相关性，热度只在最后比较；每页 20 条、稳定游标。' +
      '不调用模型、不收费；站内没有时客户端沿用联网查找',
  }),
} as const;

// ---------- 5.6：后台人工修正实体关联、别名、身份说明（T-20261104e） ----------

/** 修改原因（写进审计）。 */
const CorrectionReason = z.string().trim().min(2).max(200);
/** 实体键：公开资料标识或 manual:<uuid>（服务器校验格式）。 */
const EntityKey = z.string().trim().min(3).max(120);
const AdminSourceInput = z
  .object({ url: z.url().max(2000), title: z.string().trim().max(300).default('') })
  .strict();

export const AdminSearchEntity = z.object({
  entityKey: z.string().max(120),
  displayName: z.string().max(64),
  /** 后台核实的身份说明；null = 没填（搜索里仍用公开资料摘出的说明，标未核实）。 */
  identity: z.string().max(120).nullable(),
  sources: z.array(WebCandidateSource).max(WEB_CANDIDATE_SOURCE_LIMIT),
  /** 归到这个实体的公开资料标识（合并 = 多个标识归到同一实体）。 */
  identifiers: z
    .array(z.object({ identifier: z.string().max(120), sourceUrl: z.url().max(2000).nullable() }))
    .max(50),
  /** 关联的本站官方角色。 */
  characters: z
    .array(z.object({ characterId: Id, name: z.string().max(64), published: z.boolean() }))
    .max(20),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type AdminSearchEntity = z.infer<typeof AdminSearchEntity>;

/** 别名状态：pending 待审核（不进投影）、approved 已通过（进投影）、blocked 已从搜索里去掉（人设里的别名）。 */
export const SearchAliasStatus = z.enum(['pending', 'approved', 'blocked']);
export type SearchAliasStatus = z.infer<typeof SearchAliasStatus>;
export const AdminSearchAlias = z.object({
  alias: z.string().max(64),
  aliasKey: z.string().max(64),
  /** persona = 已发布人设里的别名；admin = 本页添加的搜索别名。 */
  origin: z.enum(['persona', 'admin']),
  status: SearchAliasStatus,
  /** 当前是否进入站内搜索投影。 */
  searchable: z.boolean(),
});
export type AdminSearchAlias = z.infer<typeof AdminSearchAlias>;

/** 一条修正审计：谁、何时、改了什么、原因。 */
export const AdminSearchCorrection = z.object({
  auditId: Id,
  at: Timestamp,
  action: z.string().max(80),
  actorName: z.string().max(64),
  reason: z.string().max(200),
  summary: z.string().max(500),
});
export type AdminSearchCorrection = z.infer<typeof AdminSearchCorrection>;

export const AdminSearchEntityDetail = z.object({
  entity: AdminSearchEntity,
  history: z.array(AdminSearchCorrection).max(100),
});
export type AdminSearchEntityDetail = z.infer<typeof AdminSearchEntityDetail>;

export const AdminSearchCharacterView = z.object({
  characterId: Id,
  name: z.string().max(64),
  published: z.boolean(),
  entity: AdminSearchEntity.nullable(),
  aliases: z.array(AdminSearchAlias).max(100),
  history: z.array(AdminSearchCorrection).max(100),
});
export type AdminSearchCharacterView = z.infer<typeof AdminSearchCharacterView>;

const IdentifierInput = z.string().trim().min(3).max(2000);

export const AdminSearchEntityCreate = z
  .object({
    displayName: z.string().trim().min(1).max(64),
    identity: z.string().trim().max(120).nullable().default(null),
    sources: z.array(AdminSourceInput).max(WEB_CANDIDATE_SOURCE_LIMIT).default([]),
    /** 公开资料标识或百科条目地址；第一个可识别的标识当实体键，都没有时用 manual:<uuid>。 */
    identifiers: z.array(IdentifierInput).max(20).default([]),
    characterIds: z.array(Id).max(20).default([]),
    reason: CorrectionReason,
  })
  .strict();
export type AdminSearchEntityCreate = z.infer<typeof AdminSearchEntityCreate>;

export const AdminSearchEntityUpdate = z
  .object({
    entityKey: EntityKey,
    displayName: z.string().trim().min(1).max(64).optional(),
    identity: z.string().trim().max(120).nullable().optional(),
    sources: z.array(AdminSourceInput).max(WEB_CANDIDATE_SOURCE_LIMIT).optional(),
    reason: CorrectionReason,
  })
  .strict();
export type AdminSearchEntityUpdate = z.infer<typeof AdminSearchEntityUpdate>;

export const AdminSearchEntityLinks = z
  .object({
    entityKey: EntityKey,
    addIdentifiers: z.array(IdentifierInput).max(20).default([]),
    removeIdentifiers: z.array(z.string().trim().min(3).max(120)).max(20).default([]),
    addCharacterIds: z.array(Id).max(20).default([]),
    removeCharacterIds: z.array(Id).max(20).default([]),
    reason: CorrectionReason,
  })
  .strict();
export type AdminSearchEntityLinks = z.infer<typeof AdminSearchEntityLinks>;

export const AdminSearchEntityMerge = z
  .object({ entityKey: EntityKey, fromEntityKey: EntityKey, reason: CorrectionReason })
  .strict();
export type AdminSearchEntityMerge = z.infer<typeof AdminSearchEntityMerge>;

export const AdminSearchEntitySplit = z
  .object({
    entityKey: EntityKey,
    identifiers: z.array(z.string().trim().min(3).max(120)).max(50).default([]),
    characterIds: z.array(Id).max(20).default([]),
    displayName: z.string().trim().min(1).max(64),
    identity: z.string().trim().max(120).nullable().default(null),
    reason: CorrectionReason,
  })
  .strict();
export type AdminSearchEntitySplit = z.infer<typeof AdminSearchEntitySplit>;

export const AdminSearchAliasOp = z.enum(['propose', 'approve', 'reject', 'remove', 'restore']);
export type AdminSearchAliasOp = z.infer<typeof AdminSearchAliasOp>;
export const AdminSearchAliasChange = z
  .object({
    /**
     * propose 添加待审核别名；approve 通过（进投影）；reject 驳回待审核别名；
     * remove 去掉已通过的别名（人设里的别名改为 blocked，不改人设本身）；restore 恢复被去掉的人设别名。
     */
    op: AdminSearchAliasOp,
    alias: z.string().trim().min(1).max(64),
    reason: CorrectionReason,
  })
  .strict();
export type AdminSearchAliasChange = z.infer<typeof AdminSearchAliasChange>;

const characterParams = z.object({ characterId: Id });

export const SearchAdminEndpoints = {
  listEntities: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/search/entities`,
    auth: 'admin',
    query: z.object({ q: z.string().max(200).default('') }),
    response: z.object({ items: z.array(AdminSearchEntity).max(50) }),
    summary: '5.6：搜索实体列表（按显示名、实体键、标识查；最多 50 条，最近修改在前）',
  }),
  getEntity: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/search/entity`,
    auth: 'admin',
    query: z.object({ entityKey: EntityKey }),
    response: AdminSearchEntityDetail,
    summary: '5.6：实体详情与修正历史',
  }),
  createEntity: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/entities`,
    auth: 'admin',
    body: AdminSearchEntityCreate,
    response: AdminSearchEntityDetail,
    summary:
      '5.6：新建实体（人工关联公开资料标识与官方角色、填写核实的身份说明）；写审计，刷新关联角色的投影',
  }),
  updateEntity: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/entity/update`,
    auth: 'admin',
    body: AdminSearchEntityUpdate,
    response: AdminSearchEntityDetail,
    summary: '5.6：修正实体的显示名、身份说明、出处；写审计，刷新关联角色的投影',
  }),
  linkEntity: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/entity/links`,
    auth: 'admin',
    body: AdminSearchEntityLinks,
    response: AdminSearchEntityDetail,
    summary:
      '5.6：关联 / 取消关联公开资料标识与官方角色；已属于其他实体的标识或角色返回 409（先拆分或合并）；写审计并刷新投影',
  }),
  mergeEntity: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/entity/merge`,
    auth: 'admin',
    body: AdminSearchEntityMerge,
    response: AdminSearchEntityDetail,
    summary:
      '5.6：合并实体（fromEntityKey 的标识与角色并入 entityKey，原实体删除）；写审计并刷新投影',
  }),
  splitEntity: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/entity/split`,
    auth: 'admin',
    body: AdminSearchEntitySplit,
    response: AdminSearchEntityDetail,
    summary: '5.6：拆分实体（选中的标识与角色移到新实体，返回新实体）；写审计并刷新投影',
  }),
  getCharacter: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/search/characters/:characterId`,
    auth: 'admin',
    params: characterParams,
    response: AdminSearchCharacterView,
    summary: '5.6：官方角色的搜索别名、实体关联与修正历史',
  }),
  changeAlias: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/search/characters/:characterId/aliases`,
    auth: 'admin',
    params: characterParams,
    body: AdminSearchAliasChange,
    response: AdminSearchCharacterView,
    summary:
      '5.6：官方角色搜索别名：添加（待审核，不进投影）/ 通过 / 驳回 / 去掉 / 恢复；写审计，通过或去掉后刷新投影',
  }),
} as const;
