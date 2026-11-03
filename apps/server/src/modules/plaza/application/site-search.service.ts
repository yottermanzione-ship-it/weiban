/**
 * 站内角色搜索的聚合层（T-20261104b，契约 5.5 SearchEndpoints.suggest / results；
 * docs/refactor/24-character-search.md 第 1、2 步）。
 *
 * 放在 plaza：plaza 是上层，本来就同时组合官方角色（经 characters 端口）、广场作品（自己的表）和通讯录
 * （contacts 端口）。官方 / 本人角色经 CharacterSearchPort（characters 管自己的投影），广场作品查本模块投影，
 * 不跨 schema 查询。不调用模型、不收费、不联网；站内没有结果时客户端沿用原有的联网查找。
 *
 * 结果每项都由服务器重新核对资格后给出（下架、撤稿、停权、不是本人的都跳过）；点击后客户端只拿 ID 走现有页面
 * 和接口（添加闸门、作品可见性在那里再查一遍），旧搜索结果不能绕过。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SITE_SEARCH_DID_YOU_MEAN_LIMIT,
  SITE_SEARCH_SUGGEST_LIMIT,
  type CharacterSearchCard,
  type CharacterSearchNameHit,
  type ContactsReadPort,
  type SiteSearchResult,
} from '@weiban/contracts';
import { analyzeQuery, displayTerm, searchKey, type SearchQuery } from '../../../platform/index.js';
import {
  CONTACTS_CHARACTER_STATS,
  CONTACTS_READ_PORT,
  type ContactsCharacterStats,
} from '../../contacts/index.js';
import {
  ambiguousIds,
  decodeSearchCursor,
  encodeSearchCursor,
  mergeSuggestions,
  pageAfter,
  pickDidYouMean,
  plazaIdentity,
  rankCandidates,
  type RankedCandidate,
  type SitePrefer,
  type SuggestHit,
  type TypoCandidate,
} from '../domain/site-search.js';
import { PLAZA_CHARACTER_SEARCH, type PlazaCharacterSearch } from '../tokens.js';
import { PlazaSearchIndex, type PlazaSearchHit } from './search-index.js';

const OWN_FALLBACK_IDENTITY = '我创建的角色';

interface Candidate extends RankedCandidate {
  match: SiteSearchResult['match'];
  matchedTerm: SiteSearchResult['matchedTerm'];
  identity: string | null;
  characterId: string | null;
  workId: string | null;
  conversationId: string | null;
}

export interface SuggestResponse {
  query: string;
  items: ReturnType<typeof mergeSuggestions>;
  didYouMean: { text: string }[];
}

export interface ResultsResponse {
  query: string;
  items: SiteSearchResult[];
  nextCursor: string | null;
  didYouMean: { text: string }[];
}

@Injectable()
export class SiteSearchService {
  constructor(
    @Inject(PlazaSearchIndex) private readonly plaza: PlazaSearchIndex,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Optional() @Inject(PLAZA_CHARACTER_SEARCH) private readonly characters?: PlazaCharacterSearch,
    @Optional()
    @Inject(CONTACTS_CHARACTER_STATS)
    private readonly contactStats?: ContactsCharacterStats,
  ) {}

  /** 搜索词的显示形式（标准化、截断到 64 字）。 */
  private shown(raw: string): string {
    return displayTerm(raw);
  }

  private async names(userId: string, query: SearchQuery): Promise<CharacterSearchNameHit[]> {
    return this.characters ? this.characters.matchNames(userId, query) : [];
  }

  async suggest(userId: string, raw: string): Promise<SuggestResponse> {
    const query = analyzeQuery(raw);
    if (!query) return { query: '', items: [], didYouMean: [] };
    const [names, works] = await Promise.all([this.names(userId, query), this.plaza.match(query)]);
    const hits: SuggestHit[] = [
      ...names.map((hit) => ({
        text: hit.displayName,
        score: hit.score,
        match: hit.match,
        matchedTerm: hit.matchedTerm,
        source: hit.scope,
      })),
      ...works.map((hit) => ({
        text: hit.displayName,
        score: hit.score,
        match: hit.match,
        matchedTerm: hit.matchedTerm,
        source: 'plaza' as const,
      })),
    ];
    const items = mergeSuggestions(hits, SITE_SEARCH_SUGGEST_LIMIT);
    const exact = hits.some((hit) => hit.match === 'exact');
    const didYouMean = exact
      ? []
      : await this.didYouMean(
          userId,
          query,
          items.map((i) => i.text),
        );
    return { query: this.shown(raw), items, didYouMean };
  }

  async results(
    userId: string,
    input: { q: string; prefer?: 'official' | 'plaza'; cursor?: string; limit: number },
  ): Promise<ResultsResponse> {
    const query = analyzeQuery(input.q);
    if (!query) return { query: '', items: [], nextCursor: null, didYouMean: [] };
    const prefer: SitePrefer = input.prefer;
    const [names, works, contactList] = await Promise.all([
      this.names(userId, query),
      this.plaza.match(query),
      this.contacts.listActiveContacts(userId),
    ]);
    const chats = new Map<string, string>();
    for (const contact of contactList)
      if (contact.status === 'active' && contact.conversationId)
        chats.set(contact.characterId, contact.conversationId);

    const copies = await this.plaza.myCopies(
      userId,
      works.map((w) => w.workId),
    );
    const candidates = await this.candidates(names, works, chats, copies);
    const ranked = rankCandidates(candidates, prefer);
    const ambiguous = ambiguousIds(ranked);
    const after = decodeSearchCursor(input.cursor, query.key, prefer);
    const { page, last, more } = pageAfter(ranked, prefer, after, input.limit);

    const items = await this.hydrate(userId, page, ambiguous);
    const exact = candidates.some((c) => c.match === 'exact');
    const didYouMean =
      input.cursor || exact
        ? []
        : await this.didYouMean(
            userId,
            query,
            ranked.map((c) => c.name),
          );
    return {
      query: this.shown(input.q),
      items,
      nextCursor: more && last ? encodeSearchCursor(query.key, prefer, last) : null,
      didYouMean,
    };
  }

  /**
   * 把两边的命中变成候选。本人从广场复制、且已是好友的角色并进对应作品那一项（按 adoptions 的 ID 关联，
   * 不按名字），作品项显示「去聊天」；已不是好友的复制角色仍作为本人角色单独列出。
   */
  private async candidates(
    names: CharacterSearchNameHit[],
    works: PlazaSearchHit[],
    chats: ReadonlyMap<string, string>,
    copies: ReadonlyMap<string, string>,
  ): Promise<Candidate[]> {
    const merged = new Set([...copies.values()].filter((id) => chats.has(id)));
    const officialIds = names.filter((n) => n.scope === 'official').map((n) => n.characterId);
    const heat =
      officialIds.length && this.contactStats
        ? await this.contactStats.countContactUsers(officialIds)
        : new Map<string, number>();
    const out: Candidate[] = [];
    for (const hit of names) {
      if (hit.scope === 'own' && merged.has(hit.characterId)) continue;
      const conversationId = chats.get(hit.characterId) ?? null;
      out.push({
        candidateId: `${hit.scope}:${hit.characterId}`,
        source: hit.scope,
        name: hit.displayName,
        score: hit.score,
        added: conversationId !== null,
        heat: hit.scope === 'official' ? (heat.get(hit.characterId) ?? 0) : 0,
        match: hit.match,
        matchedTerm: hit.matchedTerm,
        identity: hit.scope === 'own' ? (hit.identity ?? OWN_FALLBACK_IDENTITY) : hit.identity,
        characterId: hit.characterId,
        workId: null,
        conversationId,
      });
    }
    for (const hit of works) {
      const copy = copies.get(hit.workId) ?? null;
      const conversationId = copy ? (chats.get(copy) ?? null) : null;
      out.push({
        candidateId: `plaza:${hit.workId}`,
        source: 'plaza',
        name: hit.displayName,
        score: hit.score,
        added: conversationId !== null,
        heat: hit.adoptCount,
        match: hit.match,
        matchedTerm: hit.matchedTerm,
        identity: null,
        characterId: conversationId ? copy : null,
        workId: hit.workId,
        conversationId,
      });
    }
    return out;
  }

  /** 读这一页的卡片（重新核对资格，读不到的跳过），组装成契约项。 */
  private async hydrate(
    userId: string,
    page: Candidate[],
    ambiguous: ReadonlySet<string>,
  ): Promise<SiteSearchResult[]> {
    const characterIds = page.filter((c) => c.source !== 'plaza').map((c) => c.characterId!);
    const workIds = page.filter((c) => c.source === 'plaza').map((c) => c.workId!);
    const [cards, workCards] = await Promise.all([
      characterIds.length && this.characters
        ? this.characters.searchCards(userId, characterIds)
        : Promise.resolve([] as CharacterSearchCard[]),
      this.plaza.cards(userId, workIds),
    ]);
    const cardMap = new Map(cards.map((card) => [card.summary.characterId, card]));
    const items: SiteSearchResult[] = [];
    for (const c of page) {
      if (c.source === 'plaza') {
        const found = workCards.get(c.workId!);
        if (!found) continue;
        const { card } = found;
        const identity = plazaIdentity({
          kind: card.kind,
          basedOnPresetName: card.basedOnPresetName,
          authorNickname: card.author?.nickname ?? null,
          authorDeleted: card.author?.deleted ?? false,
        });
        items.push({
          candidateId: c.candidateId,
          source: 'plaza',
          action: c.added ? 'chat' : 'view_work',
          name: card.name,
          match: c.match,
          matchedTerm: c.matchedTerm,
          identity,
          unverified: false,
          ambiguous: ambiguous.has(c.candidateId),
          entityKey: null,
          sourceUrl: null,
          characterId: c.characterId,
          workId: c.workId,
          conversationId: c.conversationId,
          added: c.added,
          character: null,
          work: card,
        });
        continue;
      }
      const card = cardMap.get(c.characterId!);
      if (!card || card.scope !== c.source) continue;
      const action = c.added ? 'chat' : c.source === 'official' ? 'add' : 'open_own';
      items.push({
        candidateId: c.candidateId,
        source: c.source,
        action,
        name: card.summary.name,
        match: c.match,
        matchedTerm: c.matchedTerm,
        identity: c.identity,
        unverified: c.identity === null,
        ambiguous: ambiguous.has(c.candidateId),
        entityKey: null,
        sourceUrl: null,
        characterId: c.characterId,
        workId: card.plazaWorkId,
        conversationId: c.conversationId,
        added: c.added,
        character: { ...card.summary, added: c.added },
        work: null,
      });
    }
    return items;
  }

  private async didYouMean(
    userId: string,
    query: SearchQuery,
    shownNames: readonly string[],
  ): Promise<{ text: string }[]> {
    if (query.chars < 2) return [];
    const [names, works] = await Promise.all([
      this.characters ? this.characters.typoNames(userId, query) : Promise.resolve([]),
      this.plaza.typos(query),
    ]);
    const typos: TypoCandidate[] = [
      ...names.map((t) => ({ text: t.text, kind: t.kind, source: t.scope })),
      ...works.map((t) => ({ text: t.text, kind: t.kind, source: 'plaza' as const })),
    ];
    const exclude = new Set(shownNames.map(searchKey).filter(Boolean));
    exclude.add(query.key);
    return pickDidYouMean(typos, exclude, SITE_SEARCH_DID_YOU_MEAN_LIMIT);
  }
}
