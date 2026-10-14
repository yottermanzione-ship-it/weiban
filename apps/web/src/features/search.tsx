import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaretLeft } from './old-icons.js';
import {
  ChatSearchEndpoints,
  IdentityEndpoints,
  LibraryEndpoints,
  MomentsEndpoints,
  type Favorite,
  type MomentsPost,
  type Conversation,
  type GlobalSearchResult,
  type Message,
  type MessageSearchHit,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { GroupAvatar } from './groups.js';
import { Name } from './chat.js';
import { MediaImg as LazyMedia } from './media.js';
import { OldIcon } from './old-icons.js';
import { Chevron } from './shell-kit.js';

/*
 * 聊天搜索（search.md；CHAT-12）。只搜文字内容；结果点开都定位到那条消息的上下文
 * （聊天页读 ?seq= 参数，见 chat.tsx）。
 */

/** 关键词高亮（C 21.1）。 */
export function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>;
  const parts = text.split(keyword);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <mark className="keyword">{keyword}</mark>}
        </span>
      ))}
    </>
  );
}

function shortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.getFullYear() === now.getFullYear()
    ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function locateLink(conversationId: string, seq: number) {
  return `/chat/${conversationId}?seq=${seq}`;
}

function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  const ids = conversation.participants.filter((p) => p.kind === 'character').map((p) => p.refId);
  return conversation.type === 'group' ? (
    <GroupAvatar ids={ids} />
  ) : (
    <CharacterAvatar id={ids[0] ?? conversation.conversationId} size={40} />
  );
}

// ---------- 全局搜索（总经理 10-14 总对照表 T1.2：照微信搜索页，皮肤用旧版） ----------

type Scope = 'all' | 'characters' | 'groups' | 'messages' | 'moments' | 'favorites';
const scopes: Array<{ key: Exclude<Scope, 'all'>; label: string }> = [
  { key: 'characters', label: '角色' },
  { key: 'groups', label: '群聊' },
  { key: 'messages', label: '聊天记录' },
  { key: 'moments', label: '朋友圈' },
  { key: 'favorites', label: '收藏' },
];
const isScope = (value: string | null): value is Scope =>
  value === 'all' || scopes.some((s) => s.key === value);

function favoriteText(favorite: Favorite): string {
  const content = favorite.content as { type: string; text?: string; title?: string };
  if (content.type === 'text' && content.text) return content.text;
  if (content.title) return content.title;
  return (
    { image: '[图片]', voice: '[语音]', sticker: '[表情]', link: '[链接]' }[content.type] ??
    '[收藏]'
  );
}

export function GlobalSearchPage() {
  const navigate = useNavigate();
  const { state } = useChat();
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const fromUrl = params.get('scope');
  const [scope, setScope] = useState<Scope>(isScope(fromUrl) ? fromUrl : 'all');
  const [input, setInput] = useState(initial);
  const [keyword, setKeyword] = useState(initial.trim());
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [moments, setMoments] = useState<MomentsPost[] | null>(null);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const names = useCharacterNames([
    ...(result?.characterIds ?? []),
    ...(moments ?? []).filter((p) => p.author.kind === 'character').map((p) => p.author.refId),
  ]);
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(input.trim().slice(0, 50)), 300);
    return () => window.clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const next: Record<string, string> = {};
    if (keyword) next.q = keyword;
    if (scope !== 'all') next.scope = scope;
    setParams(next, { replace: true });
    if (!keyword) {
      setResult(null);
      setMoments(null);
      setFavorites(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const want = (s: Scope) => scope === 'all' || scope === s;
    setLoading(true);
    setFailed(false);
    const jobs: Array<Promise<unknown>> = [];
    if (want('characters') || want('groups') || want('messages'))
      jobs.push(
        api
          .call(ChatSearchEndpoints.searchAll, {
            query: { q: keyword },
            networkOnly: true,
            signal: controller.signal,
          })
          .then((r) => active && setResult(r)),
      );
    else setResult(null);
    // 朋友圈没有服务器搜索：取最近 60 条动态在本机按文字筛选
    if (want('moments'))
      jobs.push(
        (async () => {
          const found: MomentsPost[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 2; page++) {
            const r = await api.call(MomentsEndpoints.listFeed, {
              query: { cursor, limit: 30 },
              networkOnly: true,
              signal: controller.signal,
            });
            found.push(...r.items.filter((p) => p.text.includes(keyword)));
            if (!r.nextCursor) break;
            cursor = r.nextCursor;
          }
          if (active) setMoments(found);
        })(),
      );
    else setMoments(null);
    if (want('favorites'))
      jobs.push(
        api
          .call(LibraryEndpoints.listFavorites, {
            query: { q: keyword, limit: 20 },
            networkOnly: true,
            signal: controller.signal,
          })
          .then((r) => active && setFavorites(r.items)),
      );
    else setFavorites(null);
    setExpanded({});
    void Promise.allSettled(jobs).then((settled) => {
      if (!active) return;
      setLoading(false);
      if (settled.length > 0 && settled.every((s) => s.status === 'rejected')) setFailed(true);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [keyword, retry, scope, setParams]);
  const conversation = (id: string) => state.conversations.find((c) => c.conversationId === id);
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  const show = (s: Scope) => scope === 'all' || scope === s;
  const limit = (key: string, list: unknown[]) =>
    scope !== 'all' || expanded[key] ? list.length : 3;
  const counts = {
    characters: show('characters') ? (result?.characterIds.length ?? 0) : 0,
    groups: show('groups') ? (result?.groupConversationIds.length ?? 0) : 0,
    messages: show('messages') ? (result?.messages.length ?? 0) : 0,
    moments: moments?.length ?? 0,
    favorites: favorites?.length ?? 0,
  };
  const empty =
    !!keyword && !loading && !failed && Object.values(counts).every((count) => count === 0);
  const more = (key: string, total: number, label: string) =>
    scope === 'all' &&
    total > 3 &&
    !expanded[key] && (
      <button
        type="button"
        className="wx-search-more"
        onClick={() => setExpanded((v) => ({ ...v, [key]: true }))}
      >
        <OldIcon name="wechat/search" size={15} />
        更多{label}
        <Chevron />
      </button>
    );
  const scopeLabel = scopes.find((s) => s.key === scope)?.label;
  return (
    <main className="search-page wx-search">
      <form
        className="wx-search-head"
        role="search"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setKeyword(input.trim().slice(0, 50));
        }}
      >
        <label className="wx-search-box">
          <OldIcon name="wechat/search" size={16} />
          {scopeLabel && (
            <button
              type="button"
              className="wx-search-scope"
              aria-label={`取消只搜${scopeLabel}`}
              onClick={() => {
                setScope('all');
                inputRef.current?.focus();
              }}
            >
              {scopeLabel}
            </button>
          )}
          <input
            ref={inputRef}
            autoFocus
            type="search"
            enterKeyHint="search"
            aria-label="搜索"
            value={input}
            maxLength={50}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索"
          />
          {input && (
            <button
              type="button"
              className="wx-search-clear"
              aria-label="清除"
              onClick={() => {
                setInput('');
                setKeyword('');
                inputRef.current?.focus();
              }}
            >
              <OldIcon name="wechat/close" size={12} />
            </button>
          )}
        </label>
        <button type="button" className="wx-search-cancel" onClick={() => navigate(-1)}>
          取消
        </button>
      </form>
      {!keyword && scope === 'all' && (
        <section className="wx-search-scopes" aria-label="搜索指定内容">
          <p>搜索指定内容</p>
          <div>
            {scopes.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setScope(s.key);
                  inputRef.current?.focus();
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {!keyword && scope !== 'all' && <p className="wx-search-tip">搜索{scopeLabel}，输入关键词</p>}
      {loading && <span className="spinner" role="status" aria-label="正在搜索" />}
      {failed && (
        <button type="button" className="plain full" onClick={() => setRetry((v) => v + 1)}>
          搜索失败，点击重试
        </button>
      )}
      {empty && <p className="empty">没有找到「{keyword}」相关结果</p>}
      {result && counts.characters > 0 && (
        <section className="wx-search-group">
          <h2>角色</h2>
          {result.characterIds.slice(0, limit('c', result.characterIds)).map((id) => {
            const contact = state.contacts.find((c) => c.characterId === id);
            return (
              <Link key={id} to={`/characters/${id}`} className="wx-search-row">
                <CharacterAvatar id={id} size={40} />
                <span className="wx-search-text">
                  <span>
                    <Highlight text={nameOf(id)} keyword={keyword} />
                  </span>
                  {contact?.remark && names[id] && (
                    <small>
                      昵称：
                      <Highlight text={names[id]} keyword={keyword} />
                    </small>
                  )}
                </span>
              </Link>
            );
          })}
          {more('c', counts.characters, '角色')}
        </section>
      )}
      {result && counts.groups > 0 && (
        <section className="wx-search-group">
          <h2>群聊</h2>
          {result.groupConversationIds
            .slice(0, limit('g', result.groupConversationIds))
            .map((id) => {
              const group = conversation(id);
              return (
                <Link key={id} to={`/chat/${id}`} className="wx-search-row">
                  {group && <ConversationAvatar conversation={group} />}
                  <span className="wx-search-text">
                    <span>{group ? <Name conversation={group} /> : '群聊'}</span>
                  </span>
                </Link>
              );
            })}
          {more('g', counts.groups, '群聊')}
        </section>
      )}
      {result && counts.messages > 0 && (
        <section className="wx-search-group">
          <h2>聊天记录</h2>
          {result.messages.slice(0, limit('m', result.messages)).map((group) => {
            const item = conversation(group.conversationId);
            const single = group.matchCount === 1;
            return (
              <Link
                key={group.conversationId}
                to={
                  single
                    ? locateLink(group.conversationId, group.latestHit.seq)
                    : `/search/${group.conversationId}?q=${encodeURIComponent(keyword)}`
                }
                className="wx-search-row"
              >
                {item && <ConversationAvatar conversation={item} />}
                <span className="wx-search-text">
                  <span>{item ? <Name conversation={item} /> : '会话'}</span>
                  <small>
                    {single ? (
                      <Highlight text={group.latestHit.snippet} keyword={keyword} />
                    ) : (
                      `${group.matchCount} 条相关聊天记录`
                    )}
                  </small>
                </span>
                {single && (
                  <small className="wx-search-time">{shortDate(group.latestHit.createdAt)}</small>
                )}
              </Link>
            );
          })}
          {more('m', counts.messages, '聊天记录')}
        </section>
      )}
      {moments && counts.moments > 0 && (
        <section className="wx-search-group">
          <h2>朋友圈</h2>
          {moments.slice(0, limit('p', moments)).map((post) => (
            <Link key={post.postId} to={`/moments/posts/${post.postId}`} className="wx-search-row">
              {post.author.kind === 'character' ? (
                <CharacterAvatar id={post.author.refId} size={40} />
              ) : (
                <UserAvatar size={40} />
              )}
              <span className="wx-search-text">
                <span>{post.author.kind === 'character' ? nameOf(post.author.refId) : '我'}</span>
                <small>
                  <Highlight text={post.text} keyword={keyword} />
                </small>
              </span>
              <small className="wx-search-time">{shortDate(post.createdAt)}</small>
            </Link>
          ))}
          {more('p', counts.moments, '朋友圈')}
        </section>
      )}
      {favorites && counts.favorites > 0 && (
        <section className="wx-search-group">
          <h2>收藏</h2>
          {favorites.slice(0, limit('f', favorites)).map((favorite) => (
            <Link
              key={favorite.favoriteId}
              to={`/me/favorites/${favorite.favoriteId}`}
              className="wx-search-row"
            >
              {favorite.characterId ? (
                <CharacterAvatar id={favorite.characterId} size={40} />
              ) : (
                <UserAvatar size={40} />
              )}
              <span className="wx-search-text">
                <span>
                  {favorite.characterNameSnapshot ??
                    (favorite.characterId ? nameOf(favorite.characterId) : '我')}
                </span>
                <small>
                  <Highlight text={favoriteText(favorite)} keyword={keyword} />
                </small>
              </span>
              <small className="wx-search-time">{shortDate(favorite.createdAt)}</small>
            </Link>
          ))}
          {more('f', counts.favorites, '收藏')}
        </section>
      )}
    </main>
  );
}

// ---------- 某个会话的命中列表（全局搜索推入 / 会话内搜索共用） ----------

function HitList({
  conversationId,
  keyword,
  senderParticipantId,
}: {
  conversationId: string;
  keyword: string;
  senderParticipantId?: string;
}) {
  const { state } = useChat();
  const conversation = state.conversations.find((c) => c.conversationId === conversationId);
  const profile = useRemote(IdentityEndpoints.getProfile);
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const everyone = useMemo(
    () => [
      ...(conversation?.participants ?? []),
      ...(conversation?.group?.formerParticipants ?? []),
    ],
    [conversation],
  );
  const names = useCharacterNames(
    everyone.filter((p) => p.kind === 'character').map((p) => p.refId),
  );
  useEffect(() => {
    if (!keyword) return;
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(ChatSearchEndpoints.searchConversation, {
        params: { conversationId },
        query: { q: keyword, limit: 20, senderParticipantId },
        networkOnly: true,
      })
      .then((r) => {
        if (!active) return;
        setHits(r.items);
        setMore(r.hasMore);
      })
      .catch((e) => {
        if (active) setError(friendlyError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, keyword, retry, senderParticipantId]);
  function loadMore() {
    const last = hits.at(-1);
    if (!last) return;
    setLoading(true);
    void api
      .call(ChatSearchEndpoints.searchConversation, {
        params: { conversationId },
        query: { q: keyword, beforeSeq: last.seq, limit: 20, senderParticipantId },
        networkOnly: true,
      })
      .then((r) => {
        setHits((list) => [...list, ...r.items]);
        setMore(r.hasMore);
      })
      .catch(() => setError('加载失败，点击重试'))
      .finally(() => setLoading(false));
  }
  const sender = (hit: MessageSearchHit) =>
    everyone.find((p) => p.participantId === hit.senderParticipantId);
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  return (
    <>
      {loading && hits.length === 0 && <span className="spinner" role="status" />}
      {error && (
        <button className="plain full" onClick={() => setRetry((v) => v + 1)}>
          {error === '加载失败，点击重试' ? error : '搜索失败，点击重试'}
        </button>
      )}
      {!loading && !error && hits.length === 0 && (
        <p className="empty">没有找到「{keyword}」相关结果</p>
      )}
      <div className="panel rows">
        {hits.map((hit) => {
          const who = sender(hit);
          const mine = hit.senderKind === 'user';
          return (
            <Link
              key={hit.messageId}
              to={locateLink(conversationId, hit.seq)}
              className="search-result-row"
            >
              {mine ? (
                <UserAvatar profile={profile.data} size={40} />
              ) : (
                <CharacterAvatar id={who?.refId ?? conversationId} size={40} />
              )}
              <span className="overview-name">
                {mine ? '我' : who ? nameOf(who.refId) : '角色'}
                <small className="hint">
                  <Highlight text={hit.snippet} keyword={keyword} />
                </small>
              </span>
              <small className="hint">{shortDate(hit.createdAt)}</small>
            </Link>
          );
        })}
      </div>
      {more && (
        <button className="plain full" disabled={loading} onClick={loadMore}>
          {loading ? '正在加载…' : '加载更多'}
        </button>
      )}
    </>
  );
}

export function ConversationHitsPage() {
  const { conversationId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { state } = useChat();
  const keyword = (params.get('q') ?? '').trim();
  const conversation = state.conversations.find((c) => c.conversationId === conversationId);
  return (
    <main className="search-page">
      <header className="page-header">
        <button className="text-button" aria-label="返回" onClick={() => navigate(-1)}>
          <CaretLeft size={24} />
        </button>
        <h1>
          "{keyword}" 的聊天记录
          <small className="hint subtitle">
            {conversation ? <Name conversation={conversation} /> : null}
          </small>
        </h1>
        <span />
      </header>
      <HitList conversationId={conversationId} keyword={keyword} />
    </main>
  );
}

// ---------- 会话内查找聊天记录 ----------

type QuickMode = 'none' | 'date' | 'images' | 'links';

export function ConversationSearchPage() {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const chat = useChat();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [keyword, setKeyword] = useState((params.get('q') ?? '').trim());
  const [mode, setMode] = useState<QuickMode>('none');
  const [dateHint, setDateHint] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(input.trim().slice(0, 50)), 300);
    return () => window.clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    setParams(keyword ? { q: keyword } : {}, { replace: true });
  }, [keyword, setParams]);
  const [senderParticipantId, setSenderParticipantId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [quickMore, setQuickMore] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [quickRetry, setQuickRetry] = useState(0);
  const conversation = chat.state.conversations.find(
    (item) => item.conversationId === conversationId,
  );
  const members = [
    ...(conversation?.participants ?? []),
    ...(conversation?.group?.formerParticipants ?? []),
  ];
  const memberNames = useCharacterNames(
    members.filter((member) => member.kind === 'character').map((member) => member.refId),
  );
  const quickKey = `${conversationId}:${mode}:${senderParticipantId}`;
  const quickKeyRef = useRef(quickKey);
  quickKeyRef.current = quickKey;
  const dateRequestRef = useRef(0);
  useEffect(
    () => () => {
      dateRequestRef.current++;
    },
    [conversationId],
  );
  useEffect(() => {
    setMessages([]);
    setQuickMore(false);
    setQuickError('');
    if (mode !== 'images' && mode !== 'links') return;
    const controller = new AbortController();
    setQuickLoading(true);
    void api
      .call(ChatSearchEndpoints.listByType, {
        params: { conversationId },
        query: {
          contentType: mode === 'images' ? 'image' : 'link',
          senderParticipantId: senderParticipantId || undefined,
          limit: 50,
        },
        networkOnly: true,
        signal: controller.signal,
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setMessages(page.items);
        setQuickMore(page.hasMore);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setQuickError(friendlyError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuickLoading(false);
      });
    return () => controller.abort();
  }, [conversationId, mode, senderParticipantId, quickRetry]);
  async function loadQuickMore() {
    const last = messages.at(-1);
    if (!last || quickLoading || (mode !== 'images' && mode !== 'links')) return;
    const owner = quickKey;
    setQuickLoading(true);
    setQuickError('');
    try {
      const page = await api.call(ChatSearchEndpoints.listByType, {
        params: { conversationId },
        query: {
          contentType: mode === 'images' ? 'image' : 'link',
          senderParticipantId: senderParticipantId || undefined,
          beforeSeq: last.seq,
          limit: 50,
        },
        networkOnly: true,
      });
      if (owner === quickKeyRef.current) {
        setMessages((items) => [...items, ...page.items]);
        setQuickMore(page.hasMore);
      }
    } catch (error) {
      if (owner === quickKeyRef.current) setQuickError(friendlyError(error));
    } finally {
      if (owner === quickKeyRef.current) setQuickLoading(false);
    }
  }
  const images = messages.filter((message) => message.content?.type === 'image');
  const links = messages.filter((message) => message.content?.type === 'link');
  const byMonth = useMemo(() => {
    const groups = new Map<string, Message[]>();
    for (const message of images) {
      const date = new Date(message.createdAt);
      const key = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
      groups.set(key, [...(groups.get(key) ?? []), message]);
    }
    return [...groups.entries()];
  }, [images]);
  async function jumpToDate(value: string) {
    const request = ++dateRequestRef.current;
    if (!value) return;
    setDateHint('正在查找…');
    try {
      const target = await api.call(ChatSearchEndpoints.locateByDate, {
        params: { conversationId },
        query: { date: value },
        networkOnly: true,
      });
      if (request !== dateRequestRef.current) return;
      if (target.seq !== null) navigate(locateLink(conversationId, target.seq));
      else setDateHint('这个日期之后没有聊天记录');
    } catch (error) {
      if (request === dateRequestRef.current) setDateHint(friendlyError(error));
    }
  }
  return (
    <main className="search-page">
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(input.trim().slice(0, 50));
        }}
      >
        <label className="search-label">
          搜索
          <input
            ref={inputRef}
            autoFocus
            type="search"
            value={input}
            maxLength={50}
            onChange={(e) => {
              setInput(e.target.value);
              setMode('none');
            }}
            placeholder="搜索"
          />
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => navigate(`/chat/${conversationId}`)}
        >
          取消
        </button>
      </form>
      {conversation?.type === 'group' && (
        <label className="panel">
          发送者
          <select
            value={senderParticipantId}
            onChange={(event) => setSenderParticipantId(event.target.value)}
          >
            <option value="">全部成员</option>
            {members.map((member) => (
              <option key={member.participantId} value={member.participantId}>
                {member.kind === 'user' ? '我' : (memberNames[member.refId] ?? '角色')}
              </option>
            ))}
          </select>
        </label>
      )}
      {keyword ? (
        <HitList
          key={senderParticipantId}
          conversationId={conversationId}
          keyword={keyword}
          senderParticipantId={senderParticipantId || undefined}
        />
      ) : mode === 'none' ? (
        <div className="quick-find">
          <p className="hint center">快速查找</p>
          <div className="button-row center">
            <button className="plain" onClick={() => setMode('date')}>
              日期
            </button>
            <button className="plain" onClick={() => setMode('images')}>
              图片
            </button>
            <button className="plain" onClick={() => setMode('links')}>
              链接
            </button>
          </div>
        </div>
      ) : (
        <section>
          <button className="text-button" onClick={() => setMode('none')}>
            ‹ 快速查找
          </button>
          {mode === 'date' && (
            <label className="stack">
              选择日期
              <input
                type="date"
                onChange={(e) => {
                  setDateHint('');
                  jumpToDate(e.target.value);
                }}
              />
              {dateHint && <small className="hint">{dateHint}</small>}
            </label>
          )}
          {quickLoading && <span className="spinner" role="status" />}
          {quickError && (
            <button onClick={() => setQuickRetry((value) => value + 1)}>{quickError} · 重试</button>
          )}
          {mode === 'images' &&
            (images.length === 0 ? (
              <p className="empty">还没有图片</p>
            ) : (
              byMonth.map(([month, list]) => (
                <div key={month}>
                  <h2 className="section-label">{month}</h2>
                  <div className="image-wall">
                    {list.map((m) =>
                      m.content?.type === 'image' ? (
                        <Link
                          key={m.messageId}
                          to={locateLink(conversationId, m.seq)}
                          aria-label="定位到聊天位置"
                        >
                          <MediaThumb mediaId={m.content.mediaId} />
                        </Link>
                      ) : null,
                    )}
                  </div>
                </div>
              ))
            ))}
          {mode === 'links' &&
            (links.length === 0 ? (
              <p className="empty">还没有链接</p>
            ) : (
              <div className="panel rows">
                {links.map((m) =>
                  m.content?.type === 'link' ? (
                    <div key={m.messageId} className="link-row">
                      <a href={m.content.url} target="_blank" rel="noopener noreferrer">
                        <strong className="clamp-2">{m.content.title}</strong>
                        <small className="hint">
                          {m.content.source ?? ''} {shortDate(m.createdAt)}
                        </small>
                      </a>
                      <Link className="text-button" to={locateLink(conversationId, m.seq)}>
                        定位到聊天位置
                      </Link>
                    </div>
                  ) : null,
                )}
              </div>
            ))}
          {quickMore && (
            <button disabled={quickLoading} onClick={() => void loadQuickMore()}>
              加载更多
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function MediaThumb({ mediaId }: { mediaId: string }) {
  return (
    <span className="image-wall-cell">
      <LazyMedia mediaId={mediaId} />
    </span>
  );
}
