/**
 * 站内角色搜索界面（T-20261104b，契约 5.5 SearchEndpoints.suggest / results）：
 * - SiteSuggestions：边输入边出的站内联想（防抖 250ms）和「你是否想找…」，点击才采用，不改写搜索词；
 * - SiteSearchResults：提交搜索后的聚合结果，每项标来源与动作（添加 / 看作品 / 去聊天 / 我的角色），
 *   同名的不同人物分开显示并附身份说明；站内一个都没有时才显示 empty（各页放现有的联网查找）。
 *   5.6：站内有结果时在列表下面显示 footer（各页放「查找公开人物或作品」，找同名的另一位）；
 *   官方角色被后台关联到公开资料实体时，第二行带一条可点击的公开出处。
 * 样式沿用全局搜索页的微信式分组行（.wx-search-group / .wx-search-row）。
 * 切换账号、换搜索词后迟到的旧响应一律丢弃；断网只提示，不清掉已经显示的结果。不调用模型、不收费。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SearchEndpoints, type SiteSearchResult } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { useAuth } from '../app/auth.js';
import { CharacterAvatar } from './character-avatar.js';
import { OldIcon } from './old-icons.js';
import { PlazaAvatar } from './plaza.js';
import { Highlight } from './search.js';
import {
  RequestGate,
  SITE_SEARCH_DEBOUNCE_MS,
  safeExternalUrl,
  sourceLabel,
  SuggestRunner,
  siteActionLabel,
  siteIdentityText,
  siteResultHref,
  siteSourceLabel,
  siteSuggestionNote,
  type SuggestState,
} from './site-search-logic.js';

type SuggestBody = Awaited<ReturnType<typeof fetchSuggest>>;
type ResultsPage = Awaited<ReturnType<typeof fetchResults>>;

function fetchSuggest(q: string) {
  return api.call(SearchEndpoints.suggest, { query: { q }, networkOnly: true });
}

function fetchResults(q: string, prefer: 'official' | 'plaza' | undefined, cursor?: string) {
  return api.call(SearchEndpoints.results, {
    query: { q, prefer, cursor, limit: 20 },
    networkOnly: true,
  });
}

function useOwner(): string {
  const { session } = useAuth();
  return session ? `${session.user.userId}:${session.session.sessionId}` : '';
}

const OFFLINE_HINT = '网络不可用，联想暂时出不来';

function describe(error: unknown): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? OFFLINE_HINT
    : friendlyError(error);
}

/** 站内联想：input 为当前输入框内容；active = false 时（已提交搜索、输入没变）不请求也不显示。 */
export function SiteSuggestions({
  input,
  active,
  onPick,
}: {
  input: string;
  active: boolean;
  onPick: (text: string) => void;
}) {
  const owner = useOwner();
  const [state, setState] = useState<SuggestState<SuggestBody>>({
    key: '',
    dataKey: '',
    data: null,
    loading: false,
    error: '',
  });
  const runner = useRef<SuggestRunner<SuggestBody> | null>(null);
  if (!runner.current)
    runner.current = new SuggestRunner<SuggestBody>({
      delay: SITE_SEARCH_DEBOUNCE_MS,
      fetch: fetchSuggest,
      onChange: setState,
      describeError: describe,
    });
  useEffect(() => {
    runner.current?.update(owner, active && owner ? input : '');
  }, [owner, input, active]);
  useEffect(() => () => runner.current?.dispose(), []);

  const keyword = input.trim();
  if (!active || !keyword) return null;
  const data = state.data;
  const items = data?.items ?? [];
  const didYouMean = state.dataKey === keyword ? (data?.didYouMean ?? []) : [];
  if (!items.length && !didYouMean.length && !state.error) return null;
  return (
    <div className="site-search" aria-label="站内联想">
      {items.length > 0 && (
        <section className="wx-search-group">
          {items.map((item) => {
            const note = siteSuggestionNote(item);
            return (
              <button
                key={item.text}
                type="button"
                className="wx-search-row site-search-suggest-row"
                onClick={() => onPick(item.text)}
              >
                <OldIcon name="wechat/search" size={16} />
                <span className="wx-search-text">
                  <span>
                    <Highlight text={item.text} keyword={keyword} />
                  </span>
                  {note && <small>{note}</small>}
                </span>
              </button>
            );
          })}
        </section>
      )}
      {didYouMean.length > 0 && <DidYouMean items={didYouMean} onPick={onPick} />}
      {state.error && (
        <p className="hint page-note" role="status">
          {state.error}
        </p>
      )}
    </div>
  );
}

function DidYouMean({
  items,
  onPick,
}: {
  items: Array<{ text: string }>;
  onPick: (text: string) => void;
}) {
  return (
    <section className="wx-search-group" aria-label="你是否想找">
      {items.map((item) => (
        <button
          key={item.text}
          type="button"
          className="wx-search-more site-search-did-you-mean"
          onClick={() => onPick(item.text)}
        >
          你是否想找：<b>{item.text}</b>
        </button>
      ))}
    </section>
  );
}

/**
 * 聚合结果。父组件按搜索词 key 重建；empty 只在站内一个结果都没有时显示（各页放 EmptyState + 联网查找）。
 * prefer：在广场「微伴角色」/「自定义角色」页签里，相关性相同时对应来源排前面。
 */
export function SiteSearchResults({
  query,
  prefer,
  onPick,
  empty,
  footer,
  title = '站内结果',
}: {
  query: string;
  prefer?: 'official' | 'plaza';
  onPick: (text: string) => void;
  empty?: ReactNode;
  /** 5.6：站内有结果时显示在列表下面（联网查找入口）。 */
  footer?: ReactNode;
  title?: string;
}) {
  const owner = useOwner();
  const gate = useRef(new RequestGate());
  const [items, setItems] = useState<SiteSearchResult[]>([]);
  const [didYouMean, setDidYouMean] = useState<Array<{ text: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(after?: string) {
    const key = `${prefer ?? ''}:${query}`;
    const ticket = gate.current.begin(owner, key);
    if (after) setMoreBusy(true);
    else setStatus('loading');
    setError('');
    try {
      const page: ResultsPage = await fetchResults(query, prefer, after);
      if (!gate.current.accept(ticket, owner, key)) return;
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      if (!after) setDidYouMean(page.didYouMean);
      setCursor(page.nextCursor);
      setStatus('ready');
    } catch (e) {
      if (!gate.current.accept(ticket, owner, key)) return;
      // 断网 / 失败：已经显示的结果留着，只提示可以重试。
      setError(describe(e));
      if (!after) setStatus('error');
    } finally {
      if (gate.current.accept(ticket, owner, key)) setMoreBusy(false);
    }
  }

  useEffect(() => {
    const requests = gate.current;
    setItems([]);
    setDidYouMean([]);
    setCursor(null);
    if (!owner || !query.trim()) {
      requests.reset();
      return;
    }
    void load();
    return () => requests.reset();
    // load 读的是本次渲染的 query / prefer / owner，依赖已列全。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, query, prefer]);

  const keyword = query.trim();
  if (!keyword) return null;
  if (status === 'loading' && !items.length)
    return <span className="spinner" role="status" aria-label="正在搜索" />;
  return (
    <div className="site-search">
      {didYouMean.length > 0 && <DidYouMean items={didYouMean} onPick={onPick} />}
      {items.length > 0 && (
        <section className="wx-search-group" aria-label={title}>
          <h2>{title}</h2>
          {items.map((item) => (
            <ResultRow key={item.candidateId} item={item} keyword={keyword} />
          ))}
          {cursor && (
            <button
              type="button"
              className="wx-search-more"
              disabled={moreBusy}
              onClick={() => void load(cursor)}
            >
              {moreBusy ? '正在加载…' : '查看更多'}
            </button>
          )}
        </section>
      )}
      {error && (
        <p className="hint page-note" role="alert">
          {error}{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => void load(cursor ?? undefined)}
          >
            重试
          </button>
        </p>
      )}
      {status === 'ready' && !items.length && empty}
      {status === 'ready' && items.length > 0 && footer}
    </div>
  );
}

function ResultAvatar({ item }: { item: SiteSearchResult }) {
  const work = item.work;
  if (work) {
    return work.kind === 'preset_variant' && work.basedOnPresetId ? (
      <CharacterAvatar id={work.basedOnPresetId} size={40} />
    ) : (
      <PlazaAvatar id={work.workId} name={work.name} url={work.avatarUrl} size={40} />
    );
  }
  if (item.characterId)
    return (
      <CharacterAvatar id={item.characterId} profile={item.character ?? undefined} size={40} />
    );
  return <OldIcon name="wechat/search" size={24} />;
}

function ResultRow({ item, keyword }: { item: SiteSearchResult; keyword: string }) {
  const href = siteResultHref(item);
  const identity = siteIdentityText(item);
  // 广场作品、本人角色的身份说明里已经写了来源（「广场原创 · 作者 …」「我创建的角色」），不再重复。
  const source = item.source === 'official' || !identity ? siteSourceLabel(item.source) : null;
  const matched =
    item.matchedTerm && item.matchedTerm.kind !== 'keyword'
      ? `${item.matchedTerm.kind === 'based_on' ? '基于' : '别名'}：${item.matchedTerm.text}`
      : null;
  const body = (
    <>
      <ResultAvatar item={item} />
      <span className="wx-search-text">
        <span>
          <Highlight text={item.name} keyword={keyword} />
        </span>
        <small>{[source, identity, matched].filter(Boolean).join(' · ')}</small>
      </span>
      <span className={`site-search-action${item.action === 'chat' ? ' is-chat' : ''}`}>
        {siteActionLabel(item.action)}
      </span>
    </>
  );
  const row = href ? (
    <Link to={href} className="wx-search-row site-search-row" data-candidate={item.candidateId}>
      {body}
    </Link>
  ) : (
    <div className="wx-search-row site-search-row" data-candidate={item.candidateId}>
      {body}
    </div>
  );
  // 5.6：后台关联到公开资料实体的官方角色带一条出处（放在行外，链接不嵌在行链接里）。
  const proof = item.sourceUrl ? safeExternalUrl(item.sourceUrl) : null;
  if (!proof) return row;
  return (
    <>
      {row}
      <p className="hint page-note site-search-source">
        身份出处：
        <a
          href={proof}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
        >
          {sourceLabel({ url: proof, site: null })}
        </a>
      </p>
    </>
  );
}
