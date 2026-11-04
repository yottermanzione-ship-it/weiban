/**
 * 5.6（T-20261104e）：联网查找（S）的站外候选出口。提供 WebCandidateSearchPort 给 plaza 的聚合层。
 *
 * S 的含义一律不变：先过隐私词 → 联网搜索是否开通 → 每人 / 全站 / 每分钟额度（WebToolsStore.consumeCandidate，
 * 一次主动查询计一次）→ 网关 webSearch（search_candidates 用途、平台付费、公共查询缓存、租约去重、
 * 按实际供应商结果计费）。本层只在拿到公开结果之后做结构化（domain/web-candidates.ts，不调用模型）
 * 并保存候选快照，点击时按候选 ID 重读。供应商调用不在任何数据库事务里。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  WebCandidateSearchError,
  WebCandidateSearchPort,
  WebCharacterCandidate,
} from '@weiban/contracts';
import { newId } from '../../../platform/index.js';
import { structureCandidates } from '../domain/web-candidates.js';
import { privateSearchText } from '../domain/web-search.js';
import { ModelGatewayMedia } from './media-gateway.js';
import { WebToolsStore } from './web-tools-store.js';

/** S 的候选查询格式（3.30 起不变）。 */
export function candidateSearchQuery(query: string): string {
  return `"${query.replace(/["\\]/gu, '')}" (人物 OR 演员 OR 歌手 OR 动漫 OR 游戏 OR 小说角色)`;
}

@Injectable()
export class WebCandidateSearch implements WebCandidateSearchPort {
  constructor(
    @Inject(ModelGatewayMedia) private readonly media: ModelGatewayMedia,
    @Inject(WebToolsStore) private readonly store: WebToolsStore,
  ) {}

  async search(
    userId: string,
    raw: string,
  ): Promise<
    { ok: true; value: WebCharacterCandidate[] } | { ok: false; error: WebCandidateSearchError }
  > {
    const query = raw.trim();
    if (privateSearchText(query)) return { ok: false, error: 'private_query' };
    if (!(await this.media.isServiceEnabled('web_search')))
      return { ok: false, error: 'unavailable' };
    if (!(await this.store.consumeCandidate(userId))) return { ok: false, error: 'rate_limited' };
    const result = await this.media.webSearch({
      userId,
      purpose: 'search_candidates',
      billingOwner: 'platform',
      query: candidateSearchQuery(query),
      maxResults: 5,
      idempotencyKey: `search-candidate:${newId()}`,
    });
    if (!result.ok) return { ok: false, error: 'failed' };
    const candidates = structureCandidates(query, result.value.items);
    await this.store.saveCandidates(candidates);
    return { ok: true, value: candidates };
  }

  read(candidateId: string): Promise<WebCharacterCandidate | null> {
    return this.store.readCandidate(candidateId);
  }
}
