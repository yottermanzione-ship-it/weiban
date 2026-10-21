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
