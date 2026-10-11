import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CaretLeft, Lock, MagnifyingGlass } from '@phosphor-icons/react';
import {
  IdentityEndpoints,
  LibraryEndpoints,
  SHARE_IMAGE_MAX_ITEMS,
  type Favorite,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { ImageBubble, LinkCardBubble, MediaImg, StickerBubble } from './media.js';
import { SHARE_REJECT_TEXT, openShare } from './share.js';
import { shareText } from './share-render.js';
import { showToast } from './toast.js';
import { Highlight } from './search.js';

/*
 * 我的收藏（favorites.md；CHAT-11）。收藏的是快照：原消息删了、角色删了都还在。
 * 成人模式 / 健康消息照常显示，只是不能生成分享图（shareable = false 时置灰）。
 */

function dateText(iso: string, full = false) {
  const d = new Date(iso);
  return full
    ? d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function useFavoriteNames(items: Favorite[]) {
  const { state } = useChat();
  const names = useCharacterNames(items.flatMap((f) => (f.characterId ? [f.characterId] : [])));
  return (favorite: Favorite) =>
    favorite.characterNameSnapshot ||
    (favorite.characterId
      ? state.contacts.find((c) => c.characterId === favorite.characterId)?.remark ||
        names[favorite.characterId] ||
        '角色'
      : '我');
}

function FavoriteAvatar({ favorite, size }: { favorite: Favorite; size: number }) {
  return favorite.characterAvatarMediaIdSnapshot ? (
    <span
      className="avatar"
      style={{ width: size, height: size, overflow: 'hidden', borderRadius: '50%' }}
    >
      <MediaImg
        mediaId={favorite.characterAvatarMediaIdSnapshot}
        alt={favorite.characterNameSnapshot ?? '角色头像'}
      />
    </span>
  ) : (
    <CharacterAvatar id={favorite.characterId!} size={size} />
  );
}

function groupTitle(favorite: Favorite, titles: Map<string, string>) {
  return favorite.source.kind === 'message'
    ? titles.get(favorite.source.conversationId)
    : undefined;
}

function FavoriteBody({ favorite, keyword }: { favorite: Favorite; keyword: string }) {
  const content = favorite.content;
  if (favorite.source.kind === 'moments_post')
    return (
      <div className="favorite-moment">
        <p className="clamp-3">
          <Highlight text={shareText(content)} keyword={keyword} />
        </p>
        {favorite.extraImages[0] && (
          <span className="favorite-thumb">
            <MediaImg mediaId={favorite.extraImages[0]} />
          </span>
        )}
      </div>
    );
  switch (content.type) {
    case 'image':
      return <ImageBubble content={content} />;
    case 'sticker':
      return <StickerBubble content={content} />;
    case 'link':
      return <LinkCardBubble content={content} />;
    case 'letter':
      return (
        <p className="clamp-3">
          {content.direction === 'from_character' ? '寄给你的信：' : '你寄出的信：'}
          {content.body}
        </p>
      );
    default:
      return (
        <p className="clamp-6">
          <Highlight text={shareText(content)} keyword={keyword} />
        </p>
      );
  }
}

function FavoriteCard({
  favorite,
  name,
  group,
  keyword,
  selecting,
  selected,
  onToggle,
  onOpen,
  onShare,
  onRemove,
}: {
  favorite: Favorite;
  name: string;
  group?: string;
  keyword: string;
  selecting: boolean;
  selected: boolean;
  onToggle(): void;
  onOpen(): void;
  onShare(): void;
  onRemove(): void;
}) {
  const profile = useRemote(IdentityEndpoints.getProfile);
  return (
    <article className={`favorite-card ${selected ? 'selected' : ''}`}>
      {selecting && (
        <input
          type="checkbox"
          className="select-box"
          aria-label="选择"
          checked={selected}
          onChange={onToggle}
        />
      )}
      <button className="favorite-main" onClick={selecting ? onToggle : onOpen}>
        <span className="favorite-head">
          {favorite.characterId ? (
            <FavoriteAvatar favorite={favorite} size={24} />
          ) : (
            <UserAvatar profile={profile.data} size={24} />
          )}
          <small>
            {name}
            {group ? ` · ${group}` : ''} · {dateText(favorite.sourceCreatedAt)}
          </small>
          {favorite.source.kind === 'moments_post' && <span className="tag neutral">朋友圈</span>}
          {!favorite.shareable && (
            <span className="tag neutral">
              <Lock size={12} aria-hidden /> 不能生成分享图
            </span>
          )}
        </span>
        <FavoriteBody favorite={favorite} keyword={keyword} />
      </button>
      {!selecting && (
        <details className="favorite-menu">
          <summary aria-label="收藏操作">•••</summary>
          {favorite.shareable && <button onClick={onShare}>生成分享图</button>}
          <button className="danger" onClick={onRemove}>
            取消收藏
          </button>
        </details>
      )}
    </article>
  );
}

export function FavoritesPage() {
  const navigate = useNavigate();
  const chat = useChat();
  const [items, setItems] = useState<Favorite[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState(false);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [revision, setRevision] = useState(0);
  const name = useFavoriteNames(items);
  const filterNames = useCharacterNames([...counts.keys()]);
  const titles = useMemo(
    () =>
      new Map(
        chat.state.conversations
          .filter((c) => c.type === 'group' && c.title)
          .map((c) => [c.conversationId, c.title!]),
      ),
    [chat.state.conversations],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const load = useCallback(
    async (after: string | null) => {
      const page = await api.call(LibraryEndpoints.listFavorites, {
        query: {
          characterId: characterId ?? undefined,
          q: keyword || undefined,
          cursor: after ?? undefined,
          limit: 20,
        },
        networkOnly: true,
      });
      return page;
    },
    [characterId, keyword],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void load(null)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        if (!characterId && !keyword)
          setCounts((old) => {
            const next = new Map(old);
            for (const f of page.items)
              if (f.characterId) next.set(f.characterId, (next.get(f.characterId) ?? 0) + 1);
            return next.size === old.size ? old : next;
          });
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
  }, [load, characterId, keyword, revision]);

  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'favorites'
    )
      setRevision((v) => v + 1);
  });

  function more() {
    if (!cursor) return;
    setMoreError(false);
    void load(cursor)
      .then((page) => {
        setItems((list) => [...list, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => setMoreError(true));
  }
  async function remove(ids: string[]) {
    try {
      for (const favoriteId of ids)
        await api.call(LibraryEndpoints.removeFavorite, { params: { favoriteId } });
      setItems((list) => list.filter((f) => !ids.includes(f.favoriteId)));
      setSelected(new Set());
      showToast('已取消收藏');
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  function open(favorite: Favorite) {
    const source = favorite.source;
    if (source.kind === 'moments_post') {
      navigate(`/moments/posts/${source.postId}`);
      return;
    }
    if (source.seq !== undefined) {
      navigate(`/chat/${source.conversationId}?seq=${source.seq}`);
      return;
    }
    const local = chat.state.messages.find(
      (m) => m.messageId === source.messageId && m.status === 'normal',
    );
    if (local) navigate(`/chat/${source.conversationId}?seq=${local.seq}`);
    else navigate(`/me/favorites/${favorite.favoriteId}`, { state: { favorite } });
  }
  const chosen = items.filter((f) => selected.has(f.favoriteId));
  const shareBlocked =
    chosen.length > SHARE_IMAGE_MAX_ITEMS
      ? `最多选择 ${SHARE_IMAGE_MAX_ITEMS} 条`
      : chosen.some((f) => !f.shareable)
        ? SHARE_REJECT_TEXT
        : '';
  const filters = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <main className={selecting ? 'with-select-bar' : ''}>
      <header className="page-header">
        <Link to="/me" aria-label="返回">
          <CaretLeft size={24} />
        </Link>
        <h1>收藏</h1>
        <span className="button-row">
          <button
            className="icon-button"
            aria-label="搜索"
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setInput('');
            }}
          >
            <MagnifyingGlass size={20} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          >
            {selecting ? '取消' : '选择'}
          </button>
        </span>
      </header>
      {searchOpen && (
        <label className="search-label">
          搜索收藏
          <input
            autoFocus
            value={input}
            maxLength={50}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索文字和朋友圈"
          />
        </label>
      )}
      {filters.length > 0 && (
        <div className="chip-row" role="tablist" aria-label="按角色筛选">
          <button
            role="tab"
            aria-selected={characterId === null}
            className="chip"
            onClick={() => setCharacterId(null)}
          >
            全部
          </button>
          {filters.map(([id]) => (
            <button
              key={id}
              role="tab"
              aria-selected={characterId === id}
              className="chip"
              onClick={() => setCharacterId(id)}
            >
              {chat.state.contacts.find((c) => c.characterId === id)?.remark ||
                filterNames[id] ||
                '角色'}
            </button>
          ))}
        </div>
      )}
      {loading && items.length === 0 && (
        <div className="stack" role="status" aria-label="正在读取收藏">
          {[0, 1, 2].map((i) => (
            <div key={i} className="favorite-card skeleton-card" />
          ))}
        </div>
      )}
      {error && items.length === 0 && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={() => setRevision((v) => v + 1)}>重试</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="empty">
          {characterId || keyword ? '没有找到相关收藏' : '长按 TA 的消息，就可以收藏'}
        </p>
      )}
      <div className="stack">
        {items.map((favorite) => (
          <FavoriteCard
            key={favorite.favoriteId}
            favorite={favorite}
            name={name(favorite)}
            group={groupTitle(favorite, titles)}
            keyword={keyword}
            selecting={selecting}
            selected={selected.has(favorite.favoriteId)}
            onToggle={() =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(favorite.favoriteId)) next.delete(favorite.favoriteId);
                else next.add(favorite.favoriteId);
                return next;
              })
            }
            onOpen={() => open(favorite)}
            onShare={() =>
              openShare(navigate, { kind: 'favorites', favoriteIds: [favorite.favoriteId] })
            }
            onRemove={() => void remove([favorite.favoriteId])}
          />
        ))}
      </div>
      {cursor && (
        <button className="plain full" onClick={more}>
          {moreError ? '加载失败，点击重试' : '加载更多'}
        </button>
      )}
      {selecting && (
        <div className="select-bar">
          {shareBlocked && chosen.length > 0 && <small className="hint">{shareBlocked}</small>}
          <div className="button-row">
            <button
              className="primary"
              disabled={chosen.length === 0 || !!shareBlocked}
              onClick={() =>
                openShare(navigate, {
                  kind: 'favorites',
                  favoriteIds: chosen.map((f) => f.favoriteId),
                })
              }
            >
              生成分享图
            </button>
            <button
              className="danger"
              disabled={chosen.length === 0}
              onClick={() => void remove(chosen.map((f) => f.favoriteId))}
            >
              取消收藏
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** 收藏详情（原消息不在时，favorites.md 第 4 节）。 */
export function FavoriteDetailPage() {
  const { favoriteId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const favorite = (location.state as { favorite?: Favorite } | null)?.favorite;
  const name = useFavoriteNames(favorite ? [favorite] : []);
  const profile = useRemote(IdentityEndpoints.getProfile);
  if (!favorite || favorite.favoriteId !== favoriteId)
    return (
      <main>
        <p className="empty">请从收藏列表打开</p>
        <Link to="/me/favorites">返回收藏</Link>
      </main>
    );
  return (
    <main>
      <header className="page-header">
        <button className="text-button" onClick={() => navigate(-1)} aria-label="返回">
          <CaretLeft size={24} />
        </button>
        <h1>详情</h1>
        <span />
      </header>
      <div className="panel stack">
        <span className="favorite-head">
          {favorite.characterId ? (
            <FavoriteAvatar favorite={favorite} size={32} />
          ) : (
            <UserAvatar profile={profile.data} size={32} />
          )}
          <small>
            {name(favorite)} · {dateText(favorite.sourceCreatedAt, true)}
          </small>
        </span>
        {favorite.content.type === 'image' ||
        favorite.content.type === 'sticker' ||
        favorite.content.type === 'link' ? (
          <FavoriteBody favorite={favorite} keyword="" />
        ) : (
          <p className="selectable-text">{shareText(favorite.content)}</p>
        )}
        {favorite.extraImages.length > 0 && (
          <div className="favorite-images">
            {favorite.extraImages.map((id) => (
              <span key={id} className="favorite-thumb">
                <MediaImg mediaId={id} />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="button-row">
        {favorite.shareable && (
          <button
            className="tonal"
            onClick={() =>
              openShare(navigate, { kind: 'favorites', favoriteIds: [favorite.favoriteId] })
            }
          >
            生成分享图
          </button>
        )}
        <button
          className="danger"
          onClick={() =>
            void api
              .call(LibraryEndpoints.removeFavorite, { params: { favoriteId } })
              .then(() => {
                showToast('已取消收藏');
                navigate('/me/favorites', { replace: true });
              })
              .catch((e) => showToast(friendlyError(e)))
          }
        >
          取消收藏
        </button>
      </div>
    </main>
  );
}
