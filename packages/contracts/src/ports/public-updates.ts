/**
 * 公开动态端口（D-L3-02，SIM-03、ADM-03）。
 * - PublicUpdateReadPort：提供方 characters，使用方 ai-runtime（推演、聊天上下文、时间线、主动分享）。
 *   只返回 status = effective 且生效日期已到的动态；候选、驳回、撤回的动态永远不返回（SAFE-02）。
 * - WebSearchProvider：联网搜索的可插拔接口（docs/architecture/prd-answers.md 第 7 节），
 *   提供方 model-access 旁的实现，统一记账、统一脱敏。公开动态候选搜索记平台账户。
 */
import type { PortResult } from './common.js';
import type { PublicUpdateKind } from '../http/public-updates.js';

export interface EffectivePublicUpdate {
  updateId: string;
  characterId: string;
  kind: PublicUpdateKind;
  content: string;
  startDate: string;
  endDate: string | null;
  effectiveDate: string;
  sourceUrl: string;
  /** recent = 近期（尚未结束）；past = 已结束，角色以过去时提起（SIM-03 第 6 条）。 */
  phase: 'recent' | 'past';
}

export interface PublicUpdateReadPort {
  /**
   * 某角色在 asOfDate（YYYY-MM-DD）已生效的公开动态，按开始日期倒序。
   * pastDays：结束超过这么多天的「经历」不再返回（默认 90）。
   */
  listEffective(
    characterId: string,
    asOfDate: string,
    opts?: { limit?: number; pastDays?: number },
  ): Promise<EffectivePublicUpdate[]>;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  /** 发布日期（YYYY-MM-DD），上游未提供时为 null。 */
  publishedDate: string | null;
}

export interface WebSearchInput {
  /** 发起调用的用户；billingOwner = platform 时为管理员。 */
  userId: string;
  billingOwner: 'user' | 'platform';
  purpose: 'web_search' | 'admin_public_update_search';
  query: string;
  /** 只要最近多少天的结果。 */
  recencyDays?: number;
  maxResults?: number;
  characterId?: string;
  idempotencyKey: string;
}

export type WebSearchError =
  | 'not_configured'
  | 'insufficient_balance'
  | 'budget_exceeded'
  | 'provider_unavailable'
  | 'bad_request';

export interface WebSearchProvider {
  search(input: WebSearchInput): Promise<PortResult<WebSearchHit[], WebSearchError>>;
}
