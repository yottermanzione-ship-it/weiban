import { z } from 'zod';
import { API_PREFIX, Id, defineEndpoint, tolerantEnum } from '../common.js';
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
export const CharacterSearchCandidate = z.object({
  name: z.string().min(1).max(32),
  title: z.string().max(300),
  description: z.string().max(500),
  sourceUrl: z.url().max(2000),
});
export type CharacterSearchCandidate = z.infer<typeof CharacterSearchCandidate>;

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
  /** 预留：经核实的实体键（第 3 步后台人工关联后才有）；本版恒为 null。 */
  entityKey: z.string().max(120).nullable(),
  /** 预留：可点击的公开出处（第 3 步站外候选才有）；站内结果为 null。 */
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
    summary: '3.30：手动搜索公开角色候选；平台付费，按北京自然日限额，不搜索私人信息',
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
