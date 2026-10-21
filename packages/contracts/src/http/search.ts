import { z } from 'zod';
import { API_PREFIX, defineEndpoint } from '../common.js';

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
export const SearchEndpoints = {
  characterCandidates: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/search/character-candidates`,
    auth: 'user',
    body: z.object({ query: z.string().trim().min(2).max(64) }).strict(),
    response: z.object({ items: z.array(CharacterSearchCandidate).max(5) }),
    summary: '3.30：手动搜索公开角色候选；平台付费，按北京自然日限额，不搜索私人信息',
  }),
} as const;
