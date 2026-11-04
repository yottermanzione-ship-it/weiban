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
 *
 * 5.6（T-20261104e，方案第 3 步）：联网查找（POST /search/character-candidates）也在这里组合——
 * model-access 出站外候选（S 的额度、缓存、计费不变，结构化不调用模型），characters 给后台登记的实体关联，
 * 这里按实体合并（只认登记过的公开资料标识，名字相同不合并）并补「添加 / 去聊天」。点击只提交候选 ID，
 * 服务器重读保存的候选和当前的实体关联（resolveWebCandidate），不信任客户端提交的名字和网址。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SITE_SEARCH_DID_YOU_MEAN_LIMIT,
  SITE_SEARCH_SUGGEST_LIMIT,
  type CharacterSearchCandidate,
  type CharacterSearchCard,
  type CharacterSearchNameHit,
  type ContactsReadPort,
  type SiteSearchResult,
  type WebCandidateResolution,
  type WebCandidateSearchError,
  type WebCandidateSearchPort,
  type WebCharacterCandidate,
} from '@weiban/contracts';
import {
  AppError,
  analyzeQuery,
  displayTerm,
  searchKey,
  type SearchQuery,
} from '../../../platform/index.js';
import {
  CONTACTS_CHARACTER_STATS,
  CONTACTS_READ_PORT,
  type ContactsCharacterStats,
} from '../../contacts/index.js';
import { MODEL_WEB_CANDIDATES } from '../../model-access/index.js';
import {
  ambiguousIds,
  decodeSearchCursor,
  encodeSearchCursor,
  mergeSuggestions,
  mergeWebCandidates,
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
  entityKey: string | null;
  sourceUrl: string | null;
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
    @Optional() @Inject(MODEL_WEB_CANDIDATES) private readonly web?: WebCandidateSearchPort,
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

    const officialIds = names.filter((n) => n.scope === 'official').map((n) => n.characterId);
    const [copies, heat] = await Promise.all([
      this.plaza.myCopies(
        userId,
        works.map((w) => w.workId),
      ),
      officialIds.length && this.contactStats
        ? this.contactStats.countContactUsers(officialIds)
        : Promise.resolve(new Map<string, number>()),
    ]);
    const candidates = this.candidates(names, works, chats, copies, heat);
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
  private candidates(
    names: CharacterSearchNameHit[],
    works: PlazaSearchHit[],
    chats: ReadonlyMap<string, string>,
    copies: ReadonlyMap<string, string>,
    heat: ReadonlyMap<string, number>,
  ): Candidate[] {
    const merged = new Set([...copies.values()].filter((id) => chats.has(id)));
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
        entityKey: hit.entityKey,
        sourceUrl: hit.sourceUrl,
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
        entityKey: null,
        sourceUrl: null,
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
        entityKey: c.entityKey,
        sourceUrl: c.sourceUrl,
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

  // ---------- 5.6：联网查找（站外候选） ----------

  /** 一次主动联网查找（S 的额度、缓存、计费不变），按后台实体关联合并并补「添加 / 去聊天」。 */
  async webCandidates(
    userId: string,
    query: string,
  ): Promise<{ items: CharacterSearchCandidate[] }> {
    if (!this.web) throw new AppError('service_unavailable', '联网查找暂未开通');
    const found = await this.web.search(userId, query);
    if (!found.ok) throw webSearchError(found.error);
    return { items: await this.composeWeb(userId, found.value) };
  }

  /**
   * 点击站外候选：只认候选 ID，服务器重读保存的候选与当前实体关联。关联到仍上架的官方角色时返回它
   * （添加仍走 POST /contacts 的添加闸门），否则返回服务器保存的公开资料作创建页预填。
   */
  async resolveWebCandidate(userId: string, candidateId: string): Promise<WebCandidateResolution> {
    const candidate = this.web ? await this.web.read(candidateId) : null;
    if (!candidate) throw new AppError('not_found', '这个候选已过期，请重新联网查找');
    const [item] = await this.composeWeb(userId, [candidate]);
    if (!item) throw new AppError('not_found', '这个候选已过期，请重新联网查找');
    const action = item.action ?? 'create';
    return {
      candidateId,
      action,
      characterId: item.characterId ?? null,
      conversationId: item.conversationId ?? null,
      prefill:
        action === 'create'
          ? {
              name: candidate.name,
              identity: item.identity ?? null,
              description: candidate.description,
              sourceUrl: candidate.sources[0]!.url,
            }
          : null,
    };
  }

  private async composeWeb(
    userId: string,
    candidates: WebCharacterCandidate[],
  ): Promise<CharacterSearchCandidate[]> {
    const identifiers = [...new Set(candidates.flatMap((c) => c.identifiers))];
    const entities =
      identifiers.length && this.characters
        ? await this.characters.resolveEntities(identifiers)
        : [];
    const merged = mergeWebCandidates(candidates, entities);
    const linked = [...new Set(merged.flatMap((m) => m.characterIds))];
    const cards = new Map<string, CharacterSearchCard>();
    const chats = new Map<string, string>();
    if (linked.length && this.characters) {
      const [cardList, contactList] = await Promise.all([
        this.characters.searchCards(userId, linked),
        this.contacts.listActiveContacts(userId),
      ]);
      // 重新核对资格：只认仍上架的官方角色。
      for (const card of cardList)
        if (card.scope === 'official') cards.set(card.summary.characterId, card);
      for (const contact of contactList)
        if (contact.status === 'active' && contact.conversationId)
          chats.set(contact.characterId, contact.conversationId);
    }
    return merged.map((m) => {
      const eligible = m.characterIds.filter((id) => cards.has(id));
      const characterId = eligible.find((id) => chats.has(id)) ?? eligible[0] ?? null;
      const conversationId = characterId ? (chats.get(characterId) ?? null) : null;
      const card = characterId ? cards.get(characterId) : undefined;
      const added = conversationId !== null;
      return {
        name: m.name,
        title: m.title,
        description: m.description,
        sourceUrl: m.sources[0]!.url,
        candidateId: m.candidateId,
        identity: m.identity,
        identitySourceUrl: m.identitySourceUrl,
        sources: m.sources,
        entityKey: m.entityKey,
        unverified: m.unverified,
        ambiguous: m.ambiguous,
        action: characterId ? (added ? 'chat' : 'add') : 'create',
        characterId,
        conversationId,
        added,
        character: card ? { ...card.summary, added } : null,
      };
    });
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

/** 联网查找失败的提示（与 3.30 的文案、状态码一致）。 */
function webSearchError(error: WebCandidateSearchError): AppError {
  switch (error) {
    case 'private_query':
      return new AppError('bad_request', '只能搜索公众人物或知名作品角色，请勿输入私人信息');
    case 'unavailable':
      return new AppError('service_unavailable', '联网查找暂未开通');
    case 'rate_limited':
      return new AppError('rate_limited', '今天联网找得太多啦，请稍后或明天再试');
    default:
      return new AppError('service_unavailable', '联网查找暂时不可用，请稍后重试');
  }
}
