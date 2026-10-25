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
