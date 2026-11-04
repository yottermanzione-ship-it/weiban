/** 3.31 H4: internal ports; one supplier usage funds a frozen participant snapshot. */
export interface SharedSearchBillingPort {
  begin(input: { key: string; characterId: string; modelKey: string; userIds: string[] }): Promise<{
    groupId: string;
    userIds: string[];
    state: 'pending' | 'settled' | 'cancelled';
  } | null>;
  settle(
    groupId: string,
    usageRecordId: string,
    /** 3.29：结算前重核的当前合格用户；省略=沿用旧行为（仅账户状态过滤）。 */
    eligibleUserIds?: readonly string[],
  ): Promise<{ collectedMicros: number; userCharges: Record<string, number> }>;
  cancel(groupId: string): Promise<void>;
}
export interface SharedWebSearchPort {
  search(input: {
    characterId: string;
    requesterUserId: string;
    userIds: string[];
    query: string;
    key: string;
    /**
     * 3.29：结算前重核资格。调用方用检索开始时记下的 {userId,epoch} 调
     * WeiboSyncService.recheckParticipants，返回现在仍合格的 userId；不传则不过滤。
     */
    eligibleUserIds?: () => Promise<readonly string[]>;
  }): Promise<
    | {
        ok: true;
        items: import('./model-gateway.js').WebSearchResultItem[];
        chargedMicros: number;
        requesterChargeMicros: number;
      }
    | { ok: false }
  >;
}
export interface WeiboPublicationPort {
  publish(
    tx: import('./common.js').Tx,
    input: {
      characterId: string;
      content: string;
      sourceUrl: string;
      publishedOn: string;
      nickname: string;
      weiboUserId?: string;
    },
  ): Promise<string | null>;
}

/**
 * 5.6（T-20261104e）：站外候选（联网查找）结构化后的一项。提供方 model-access（查询、额度、缓存、计费都沿用 S），
 * 调用方 plaza 的聚合层（再按 characters 的实体关联合并、补添加 / 去聊天）。
 * 全部来自公开搜索结果（已过隐私词与公开人物 / 虚构作品过滤），不含查询原文和任何用户信息。
 */
export interface WebCharacterCandidate {
  /** web_ + 22 位：按公开资料标识或规范化出处算出，同一条目每次都一样。 */
  candidateId: string;
  name: string;
  title: string;
  description: string;
  /** 只从公开结果的标题括注 / 摘要首句按固定规则摘出，不调用模型；摘不出为 null。 */
  identity: string | null;
  identitySourceUrl: string | null;
  sources: Array<{ url: string; title: string; site: string | null }>;
  /** 出处地址里认出的公开资料标识（同一标识才合并）。 */
  identifiers: string[];
}

export type WebCandidateSearchError = 'private_query' | 'unavailable' | 'rate_limited' | 'failed';

export interface WebCandidateSearchPort {
  /** 一次主动联网查找：先过隐私词、服务开通、每人 / 全站额度，再走网关（公共缓存、租约去重、按实际结果计费）。 */
  search(
    userId: string,
    query: string,
  ): Promise<
    { ok: true; value: WebCharacterCandidate[] } | { ok: false; error: WebCandidateSearchError }
  >;
  /** 按候选 ID 重读服务器保存的候选；过期或不存在为 null。不联网、不收费。 */
  read(candidateId: string): Promise<WebCharacterCandidate | null>;
}
