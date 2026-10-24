import { SearchField } from './search-field.js';
import { WebCharacterSearch } from './web-character-search.js';
/*
 * 总经理 2026-10-14 裁定 2.3：通讯录右上「添加朋友」下的两个入口。
 * - 角色广场（/plaza）：一个页面两个 tab ——「自定义角色」（用户分享，原人设广场）与「微伴角色」（官方制作）；
 *   两边都能点赞、评论、添加、查看基本人设。其他所有角色广场入口统一到这一页。
 * - 角色创建（/roles/create）：自定义人设 / 聊天导入 / 申请制作。
 *   申请制作（/role-requests/new）：提交表单 → 我的申请（/role-requests）→ 申请详情（/role-requests/:id，推送会打开它）。
 *   状态变化有红点（data.changed(role_requests)）；按真实会员免费次数计价，超额200积分冻结，完成扣除，拒绝/撤回退回。
 * 契约：PlazaOfficialEndpoints、RoleRequestEndpoints（3.15）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CharacterEndpoints,
  PLAZA_COMMENT_MAX_CHARS,
  PlazaEndpoints,
  PlazaOfficialEndpoints,
  ROLE_REQUEST_MAX_IMAGES,
  RoleRequestEndpoints,
  type CharacterBasis,
  type PlazaComment,
  type PlazaOfficialCard,
  type RoleRequest,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { prepareImage, uploadMedia } from '../data/upload.js';
import { CharacterAvatar } from './character-avatar.js';
import { OldIcon } from './old-icons.js';
import { PlazaAvatar, PlazaTab, authorName, timeText, usePlazaBadge } from './plaza.js';
import {
  EmptyState,
  GroupHeader,
  IconTile,
  MenuGroup,
  MenuRow,
  NavBar,
  NavIcon,
  PopSelect,
  type PopSelectOption,
} from './shell-kit.js';
import { VirtualList } from './virtual-list.js';
import { Dialog, showToast } from './toast.js';

const code = (error: unknown) => (error instanceof ApiFailure ? error.code : '');
const chars = (text: string) => Array.from(text).length;

// ---------- 申请制作红点 ----------

/** 「角色创建」入口红点：状态变化后还没看过的申请数；收到 data.changed(role_requests) 重拉。 */
export function useRoleRequestBadge() {
  const remote = useRemote(RoleRequestEndpoints.listMine, {
    query: { limit: 1 },
    networkOnly: true,
  });
  const { refresh } = remote;
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'role_requests'
    )
      refresh();
  });
  useEffect(() => {
    window.addEventListener('weiban:role-requests-seen', refresh);
    return () => window.removeEventListener('weiban:role-requests-seen', refresh);
  }, [refresh]);
  return remote.data?.unseenCount ?? 0;
}
const announceSeen = () => window.dispatchEvent(new Event('weiban:role-requests-seen'));

/** 「添加朋友」顶部两行：角色广场、角色创建（同风格列表行）。 */
export function AddFriendEntries() {
  const unseen = useRoleRequestBadge();
  return (
    <MenuGroup className="contact-fixed">
      <MenuRow to="/plaza" icon="drawn/people" tint="orange" tile label="角色广场" />
      <MenuRow
        to="/roles/create"
        icon="wechat/add"
        tint="green"
        tile
        label="角色创建"
        dot={unseen > 0}
      />
    </MenuGroup>
  );
}

// ---------- 角色广场：两个 tab ----------

type PlazaTabKey = 'custom' | 'official';
const TAB_KEY = 'weiban:plaza-tab';
function readTab(): PlazaTabKey {
  try {
    return localStorage.getItem(TAB_KEY) === 'custom' ? 'custom' : 'official';
  } catch {
    return 'official';
  }
}

export function RolePlazaHubPage() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const tab: PlazaTabKey = fromUrl === 'custom' || fromUrl === 'official' ? fromUrl : readTab();
  const badge = usePlazaBadge();
  const choose = (next: PlazaTabKey) => {
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // 无痕模式：只在本次生效
    }
    setParams({ tab: next }, { replace: true });
  };
  return (
    <main className="role-plaza-hub">
      <NavBar
        title={
          <span className="role-plaza-tabs" role="tablist" aria-label="角色广场分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'custom'}
              onClick={() => choose('custom')}
            >
              自定义角色
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'official'}
              onClick={() => choose('official')}
            >
              微伴角色
            </button>
          </span>
        }
        fallback="/contacts/add"
        right={
          tab === 'custom' ? (
            <span className="nav-icon-dot">
              <NavIcon name="wechat/profile" label="我发布的" to="/plaza/me" />
              {badge && badge.myWorksUnseen + badge.reportResultsUnseen > 0 && (
                <span className="red-dot" aria-label="有新消息" />
              )}
            </span>
          ) : undefined
        }
      />
      {tab === 'custom' ? <PlazaTab embedded /> : <OfficialList />}
    </main>
  );
}

type OfficialSort = 'hot' | 'most_liked' | 'default';

const OFFICIAL_SORT_OPTIONS: PopSelectOption[] = [
  { value: 'hot', label: '热门' },
  { value: 'most_liked', label: '点赞最多' },
  { value: 'default', label: '默认顺序' },
];

function OfficialList() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<OfficialSort>('hot');
  const [categoryId, setCategoryId] = useState('');
  const categories = useRemote(CharacterEndpoints.listCategories);
  const [items, setItems] = useState<PlazaOfficialCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(
    async (after?: string) => {
      setState('loading');
      try {
        const page = await api.call(PlazaOfficialEndpoints.list, {
          query: {
            q: search || undefined,
            categoryId: categoryId || undefined,
            sort,
            cursor: after,
            limit: 20,
          },
          networkOnly: true,
        });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setState('ready');
      } catch {
        setState('error');
      }
    },
    [search, sort, categoryId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const toggleLike = async (card: PlazaOfficialCard) => {
    const id = card.character.characterId;
    try {
      const result = await api.call(
        card.likedByMe ? PlazaOfficialEndpoints.unlike : PlazaOfficialEndpoints.like,
        { params: { characterId: id } },
      );
      setItems((prev) =>
        prev.map((item) => (item.character.characterId === id ? { ...item, ...result } : item)),
      );
    } catch (e) {
      showToast(friendlyError(e));
    }
  };
  return (
    <section aria-label="微伴角色">
      <form
        className="search-strip"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
        }}
      >
        <SearchField
          aria-label="搜索微伴角色"
          placeholder="搜索名字、别名或作品"
          value={query}
          onClear={() => {
            setQuery('');
            setSearch('');
          }}
          maxLength={50}
          enterKeyHint="search"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (!next.trim()) setSearch('');
          }}
        />
        <button type="submit" className="search-strip-submit" disabled={!query.trim()}>
          搜索
        </button>
      </form>
      <div className="plaza-filter">
        <PopSelect
          label="排序"
          value={sort}
          options={OFFICIAL_SORT_OPTIONS}
          onChange={(next) => setSort(next as OfficialSort)}
        />
        <PopSelect
          label="分类"
          value={categoryId}
          options={[
            { value: '', label: '全部分类' },
            ...(categories.data?.items ?? []).map((c) => ({ value: c.categoryId, label: c.name })),
          ]}
          onChange={setCategoryId}
        />
      </div>
      {state === 'loading' && items.length === 0 && (
        <p role="status" className="empty">
          正在读取角色…
        </p>
      )}
      {state === 'error' && items.length === 0 && (
        <div className="empty">
          <p>加载失败</p>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {state === 'ready' && items.length === 0 && (
        <>
          <EmptyState
            icon="wechat/search"
            title={search ? `没有找到「${search}」` : '还没有角色'}
          />
          {search && <WebCharacterSearch key={search} query={search} />}
        </>
      )}
      {items.length > 0 && (
        <VirtualList
          items={items}
          itemKey={(card) => card.character.characterId}
          estimate={76}
          label="微伴角色列表"
          render={(card) => <OfficialRow card={card} onLike={() => void toggleLike(card)} />}
        />
      )}
      {cursor && (
        <div className="pager-row">
          <button type="button" disabled={state === 'loading'} onClick={() => void load(cursor)}>
            {state === 'loading' ? '正在读取…' : '加载更多'}
          </button>
        </div>
      )}
    </section>
  );
}

function OfficialRow({ card, onLike }: { card: PlazaOfficialCard; onLike(): void }) {
  const role = card.character;
  return (
    <div className="official-row">
      <Link to={`/plaza/official/${role.characterId}`} className="official-row-main">
        <CharacterAvatar id={role.characterId} profile={role} size={48} />
        <span className="official-row-text">
          <span className="official-row-name">{role.name}</span>
          <small>{role.tagline}</small>
          <small className="official-row-meta">
            赞 {card.likeCount} · 评论 {card.commentCount}
            {role.added ? ' · 已添加' : ''}
          </small>
        </span>
      </Link>
      <button
        type="button"
        className={`like-toggle ${card.likedByMe ? 'on' : ''}`}
        aria-pressed={card.likedByMe}
        aria-label={card.likedByMe ? '取消点赞' : '点赞'}
        onClick={onLike}
      >
        <OldIcon name={card.likedByMe ? 'wechat/like_filled' : 'wechat/like'} size={20} />
      </button>
    </div>
  );
}

// ---------- 微伴角色详情：基本人设 + 点赞 + 评论 + 添加 ----------

export function OfficialRolePage() {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useChat();
  const detail = useRemote(
    PlazaOfficialEndpoints.get,
    { params: { characterId }, networkOnly: true },
    !!characterId,
  );
  const [like, setLike] = useState<{ likeCount: number; likedByMe: boolean } | null>(null);
  const [comments, setComments] = useState<number | null>(null);
  const data = detail.data;
  const contact = state.contacts.find((c) => c.characterId === characterId);
  const liked = like ?? (data ? { likeCount: data.likeCount, likedByMe: data.likedByMe } : null);
  async function toggleLike() {
    if (!liked) return;
    try {
      setLike(
        await api.call(
          liked.likedByMe ? PlazaOfficialEndpoints.unlike : PlazaOfficialEndpoints.like,
          { params: { characterId } },
        ),
      );
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  if (detail.error && !data)
    return (
      <main>
        <NavBar title="微伴角色" fallback="/plaza" />
        <EmptyState icon="wechat/info" title="角色不存在或已下架" desc={detail.error} />
      </main>
    );
  return (
    <main className="official-page">
      <NavBar title="微伴角色" fallback="/plaza" />
      {!data ? (
        <p role="status" className="empty">
          正在读取…
        </p>
      ) : (
        <>
          <div className="profile-head">
            <CharacterAvatar id={characterId} profile={data.character} size={64} radius={8} />
            <div className="profile-head-text">
              <h2>
                <span>{data.character.name}</span>
              </h2>
              {data.character.tagline && <p>{data.character.tagline}</p>}
              {data.character.works.length > 0 && <p>出处：{data.character.works.join('、')}</p>}
            </div>
          </div>
          <GroupHeader>基本人设</GroupHeader>
          <MenuGroup>
            <div className="persona-block">
              {data.persona.summary && (
                <p>
                  <strong>简介</strong>
                  {data.persona.summary}
                </p>
              )}
              {data.persona.personality && (
                <p>
                  <strong>性格</strong>
                  {data.persona.personality}
                </p>
              )}
              {data.persona.speechStyle && (
                <p>
                  <strong>说话方式</strong>
                  {data.persona.speechStyle}
                </p>
              )}
              {data.persona.catchphrases.length > 0 && (
                <p>
                  <strong>口头禅</strong>
                  {data.persona.catchphrases.map((c) => `「${c}」`).join(' ')}
                </p>
              )}
              {!data.persona.summary && !data.persona.personality && (
                <p className="hint">{data.character.intro || '暂无介绍'}</p>
              )}
            </div>
          </MenuGroup>
          <MenuGroup className="action-rows">
            <button
              type="button"
              className={`profile-action ${liked?.likedByMe ? 'liked' : ''}`}
              aria-pressed={liked?.likedByMe}
              onClick={() => void toggleLike()}
            >
              <OldIcon name={liked?.likedByMe ? 'wechat/like_filled' : 'wechat/like'} size={20} />
              {liked?.likedByMe ? '已赞' : '赞'} {liked?.likeCount ?? 0}
            </button>
            {contact?.conversationId ? (
              <Link className="profile-action" to={`/chat/${contact.conversationId}`}>
                <OldIcon name="wechat/chat" size={20} />
                发消息
              </Link>
            ) : contact?.status === 'pending' ? (
              <span className="profile-action pending">等待通过…</span>
            ) : (
              <button
                type="button"
                className="profile-action"
                onClick={() => navigate(`/characters/${characterId}?add=1`)}
              >
                <OldIcon name="wechat/add" size={20} />
                添加到通讯录
              </button>
            )}
          </MenuGroup>
          {data.character.showPublicSourceNotice && (
            <p className="hint page-note">本角色根据公开资料创作，不代表本人</p>
          )}
          <OfficialComments
            key={characterId}
            characterId={characterId}
            count={comments ?? data.commentCount}
            onCount={setComments}
          />
        </>
      )}
    </main>
  );
}

function OfficialComments({
  characterId,
  count,
  onCount,
}: {
  characterId: string;
  count: number;
  onCount(n: number): void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<PlazaComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<PlazaComment | null>(null);
  const [sending, setSending] = useState(false);
  const [checkingAuthor, setCheckingAuthor] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const here = `/plaza/official/${characterId}`;
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setLoadError('');
      try {
        const page = await api.call(PlazaOfficialEndpoints.listComments, {
          params: { characterId },
          query: { cursor: after },
          networkOnly: true,
        });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        setLoadError(friendlyError(error));
      } finally {
        setLoading(false);
      }
    },
    [characterId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const over = chars(text) > PLAZA_COMMENT_MAX_CHARS;
  async function startCompose(target: PlazaComment | null) {
    if (checkingAuthor || sending) return;
    setCheckingAuthor(true);
    try {
      const profile = await api.call(PlazaEndpoints.getMyProfile, { networkOnly: true });
      if (!profile) {
        navigate(`/plaza/profile?next=${encodeURIComponent(here)}`);
        return;
      }
      if (profile.bannedUntil) {
        showToast('你暂时不能评论');
        return;
      }
    } catch {
      /* 读不到资料时照常打开输入栏，提交时由服务器判断 */
    } finally {
      setCheckingAuthor(false);
    }
    setReplyTo(target);
    setComposing(true);
  }
  async function send() {
    const value = text.trim();
    if (sending || !value || over) return;
    setSending(true);
    try {
      const comment = await api.call(PlazaOfficialEndpoints.addComment, {
        params: { characterId },
        body: {
          clientRequestId: requestId.current,
          text: value,
          replyToCommentId: replyTo?.commentId ?? null,
        },
      });
      requestId.current = crypto.randomUUID();
      setItems((prev) => [...prev, comment]);
      onCount(count + 1);
      setText('');
      setReplyTo(null);
      setComposing(false);
    } catch (e) {
      if (code(e) === 'conflict') navigate(`/plaza/profile?next=${encodeURIComponent(here)}`);
      else if (code(e) === 'plaza_publish_forbidden') showToast('你暂时不能评论');
      else showToast('没成功，请重试');
    } finally {
      setSending(false);
    }
  }
  async function remove(comment: PlazaComment) {
    try {
      await api.call(PlazaEndpoints.deleteComment, { params: { commentId: comment.commentId } });
      setItems((prev) => prev.filter((c) => c.commentId !== comment.commentId));
      onCount(Math.max(0, count - 1));
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  return (
    <>
      <GroupHeader>评论 {count}</GroupHeader>
      <div className="panel">
        {loading && items.length === 0 && <div className="skeleton-line" role="status" />}
        {loadError && (
          <div className="page-note">
            <p role="alert">{loadError}</p>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => void load(items.length ? (cursor ?? undefined) : undefined)}
            >
              {loading ? '正在重试…' : '重试'}
            </button>
          </div>
        )}
        {!loading && !loadError && items.length === 0 && (
          <p className="hint">还没有评论，来说第一句吧</p>
        )}
        {items.map((c) => (
          <div key={c.commentId} className="comment-item">
            <PlazaAvatar
              id={c.author.authorId}
              name={authorName(c.author)}
              url={c.author.avatarUrl}
              size={32}
            />
            <div>
              <strong>{authorName(c.author)}</strong>
              <p>
                {c.replyTo && `回复 ${authorName(c.replyTo)}：`}
                {c.text}
              </p>
              <div className="comment-tools">
                <span>{timeText(c.createdAt)}</span>
                <button
                  type="button"
                  disabled={checkingAuthor || sending}
                  onClick={() => void startCompose(c)}
                >
                  回复
                </button>
                {c.deletable && (
                  <button type="button" onClick={() => void remove(c)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {cursor && (
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void load(cursor)}
          >
            加载更多评论
          </button>
        )}
        {composing ? (
          <form
            className="message-composer stacked-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label>
              {replyTo ? `回复 ${authorName(replyTo.author)}` : '评论'}
              <textarea
                autoFocus
                rows={3}
                disabled={sending}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <small className={over ? 'char-count over-limit' : 'char-count hint'}>
              {chars(text)}/{PLAZA_COMMENT_MAX_CHARS}
            </small>
            <button
              className="primary"
              disabled={sending || over || !text.trim()}
              aria-busy={sending}
            >
              {sending ? '发送中…' : '发送'}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={sending}
              onClick={() => {
                setComposing(false);
                setReplyTo(null);
                setText('');
              }}
            >
              取消
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={checkingAuthor}
            aria-busy={checkingAuthor}
            onClick={() => void startCompose(null)}
          >
            {checkingAuthor ? '正在打开评论…' : '说点什么…'}
          </button>
        )}
      </div>
    </>
  );
}

// ---------- 角色创建：三个选项 ----------

export function RoleCreatePage() {
  const unseen = useRoleRequestBadge();
  return (
    <main className="role-create">
      <NavBar title="角色创建" fallback="/contacts/add" />
      <MenuGroup className="choice-group">
        <Link className="choice-row" to="/characters/custom/new">
          <IconTile icon="wechat/note" tint="green" size="md" />
          <span>
            <strong>自定义人设</strong>
            <small>自己写名字、性格、说话方式</small>
          </span>
        </Link>
        <Link className="choice-row" to="/imports">
          <IconTile icon="wechat/chat" tint="orange" size="md" />
          <span>
            <strong>聊天导入</strong>
            <small>粘贴、上传聊天记录或截图，生成 TA</small>
          </span>
        </Link>
        <Link className="choice-row" to="/role-requests">
          <IconTile icon="drawn/scenario_sparkle" tint="purple" size="md" />
          <span>
            <strong>
              申请制作
              {unseen > 0 && <span className="red-dot" aria-label="申请有新进展" />}
            </strong>
            <small>告诉我们你想要的角色，由官方为你制作</small>
          </span>
        </Link>
      </MenuGroup>
    </main>
  );
}

// ---------- 申请制作 ----------

const statusNames: Record<string, string> = {
  pending: '待处理',
  in_progress: '制作中',
  completed: '已完成',
  rejected: '已拒绝',
  cancelled: '已撤回',
};
const basisNames: Record<string, string> = {
  real_person: '真人',
  fictional: '虚构角色',
  original: '原创',
};
export function StatusTag({ status }: { status: string }) {
  return <span className={`request-status ${status}`}>{statusNames[status] ?? '处理中'}</span>;
}
function dateText(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 我的申请（进入即清全部红点）+ 右上「新申请」。 */
export function RoleRequestListPage() {
  const config = useRemote(RoleRequestEndpoints.getConfig, { networkOnly: true });
  const [items, setItems] = useState<RoleRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async (after?: string) => {
    setState('loading');
    try {
      const page = await api.call(RoleRequestEndpoints.listMine, {
        query: { cursor: after, limit: 20 },
        networkOnly: true,
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setState('ready');
      if (!after && page.unseenCount > 0)
        void api
          .call(RoleRequestEndpoints.markAllSeen)
          .then(announceSeen)
          .catch(() => {});
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'role_requests'
    )
      void load();
  });
  const enabled = config.data?.enabled !== false;
  return (
    <main className="role-requests">
      <NavBar title="申请制作" fallback="/roles/create" />
      <div className="request-intro">
        <p>说说你想要的角色，官方会为你制作，做好后自动加到你的通讯录。</p>
        {config.data && (
          <p className="hint">
            还剩 {config.data.quota.remaining} 次免费申请，用完后每次 {config.data.pointsCost}{' '}
            积分。
          </p>
        )}
        <Link
          className={`button primary ${enabled ? '' : 'disabled'}`}
          to={enabled ? '/role-requests/new' : '#'}
          aria-disabled={!enabled}
          onClick={(event) => {
            if (!enabled) {
              event.preventDefault();
              showToast('暂未开放', 2000, 'info');
            }
          }}
        >
          提交新申请
        </Link>
      </div>
      <GroupHeader>我的申请</GroupHeader>
      {state === 'loading' && items.length === 0 && (
        <p role="status" className="empty">
          正在读取…
        </p>
      )}
      {state === 'error' && items.length === 0 && (
        <div className="empty">
          <p>加载失败</p>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {state === 'ready' && items.length === 0 && (
        <EmptyState icon="wechat/note" title="还没有申请" desc="提交一个你想要的角色吧" />
      )}
      {items.length > 0 && (
        <MenuGroup>
          {items.map((item) => (
            <MenuRow
              key={item.requestId}
              to={`/role-requests/${item.requestId}`}
              label={
                <>
                  <span className="row-name">{item.roleName}</span>
                  {item.unseen && <span className="red-dot" aria-label="有新进展" />}
                </>
              }
              subtitle={item.adminMessage || `提交于 ${dateText(item.createdAt)}`}
              value={<StatusTag status={item.status} />}
            />
          ))}
        </MenuGroup>
      )}
      {cursor && (
        <div className="pager-row">
          <button type="button" disabled={state === 'loading'} onClick={() => void load(cursor)}>
            加载更多
          </button>
        </div>
      )}
    </main>
  );
}

/** 提交申请表单。 */
export function RoleRequestFormPage() {
  const navigate = useNavigate();
  const config = useRemote(RoleRequestEndpoints.getConfig, { networkOnly: true });
  const categories = useRemote(CharacterEndpoints.listCategories);
  const [roleName, setRoleName] = useState('');
  const [basis, setBasis] = useState<'' | CharacterBasis>('');
  const [categoryId, setCategoryId] = useState('');
  const [sourceWork, setSourceWork] = useState('');
  const [referenceText, setReferenceText] = useState('');
  const [note, setNote] = useState('');
  const [images, setImages] = useState<Array<{ mediaId: string; preview: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [expiredKey, setExpiredKey] = useState(false);
  const [blockedKey, setBlockedKey] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const file = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const list = previews.current;
    return () => list.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  async function pick(files: FileList) {
    const room = ROLE_REQUEST_MAX_IMAGES - images.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) showToast(`最多 ${ROLE_REQUEST_MAX_IMAGES} 张`);
    setUploading(true);
    setError('');
    try {
      for (const input of list) {
        const { blob } = await prepareImage(input);
        const media = await uploadMedia('role_request_image', blob);
        const preview = URL.createObjectURL(blob);
        previews.current.push(preview);
        setImages((prev) => [...prev, { mediaId: media.mediaId, preview }]);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }
  async function submit() {
    if (!roleName.trim() || !config.data || blockedKey) return;
    setPending(true);
    setError('');
    try {
      const created = await api.call(RoleRequestEndpoints.create, {
        body: {
          clientRequestId: requestId.current,
          expectedPointsCost: config.data.quota.nextPointsCost,
          roleName: roleName.trim(),
          basis: basis || null,
          categoryId: categoryId || null,
          sourceWork: sourceWork.trim() || undefined,
          referenceText: referenceText.trim() || undefined,
          referenceImageIds: images.length ? images.map((image) => image.mediaId) : undefined,
          note: note.trim() || undefined,
        },
      });
      showToast('已提交', 2000, 'success');
      navigate(`/role-requests/${created.requestId}`, { replace: true });
    } catch (e) {
      const details =
        e instanceof ApiFailure
          ? (e.details as { reason?: string; canRenew?: boolean } | undefined)
          : undefined;
      if (code(e) === 'conflict' && details?.reason === 'price_changed') {
        config.refresh();
        setError('免费次数或报价已变化，请核对更新后的金额，再点提交确认。');
      } else if (code(e) === 'conflict' && details?.reason === 'request_id_expired') {
        setExpiredKey(!!details.canRenew);
        setBlockedKey(true);
        setError(
          details.canRenew
            ? '旧提交编号已失效。请明确更换新编号，核对报价后再提交；不会自动扣费。'
            : '旧申请资金状态需要管理员核对，请勿重复提交，联系帮助与反馈。',
        );
      } else if (code(e) === 'forbidden') setError('申请制作暂未开放');
      else if (code(e) === 'conflict') setError(friendlyError(e));
      else setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  if (config.data && !config.data.enabled)
    return (
      <main>
        <NavBar title="提交申请" fallback="/role-requests" />
        <EmptyState icon="wechat/info" title="暂未开放" desc="申请制作暂时关闭，稍后再来看看" />
      </main>
    );
  return (
    <main className="role-request-form">
      <NavBar title="提交申请" fallback="/role-requests" />
      <form
        className="panel stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          角色名（必填）
          <input
            value={roleName}
            maxLength={32}
            required
            placeholder="想要的角色叫什么"
            onChange={(e) => setRoleName(e.target.value)}
          />
        </label>
        <details>
          <summary>补充资料（选填）</summary>
          <label>
            类型
            <select value={basis} onChange={(e) => setBasis(e.target.value as '' | CharacterBasis)}>
              <option value="">不确定</option>
              <option value="real_person">真人</option>
              <option value="fictional">虚构角色（动漫、游戏、影视…）</option>
              <option value="original">原创</option>
            </select>
          </label>
          <label>
            分类
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">不选</option>
              {categories.data?.items.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            出处 / 作品
            <input
              value={sourceWork}
              maxLength={60}
              placeholder="例如某部动漫、游戏、电视剧"
              onChange={(e) => setSourceWork(e.target.value)}
            />
          </label>
          <label>
            参考资料
            <textarea
              value={referenceText}
              maxLength={3000}
              rows={6}
              placeholder="人物介绍、性格、说话方式、你希望 TA 怎样和你相处……也可以贴链接"
              onChange={(e) => setReferenceText(e.target.value)}
            />
            <span className="hint char-count">{chars(referenceText)} / 3000</span>
          </label>
          <div className="request-images">
            <span>参考图（选填，最多 {ROLE_REQUEST_MAX_IMAGES} 张）</span>
            <div className="request-image-grid">
              {images.map((image) => (
                <span key={image.mediaId} className="request-image">
                  <img src={image.preview} alt="参考图" />
                  <button
                    type="button"
                    aria-label="移除这张图"
                    onClick={() => {
                      setImages((prev) => prev.filter((i) => i.mediaId !== image.mediaId));
                    }}
                  >
                    <OldIcon name="wechat/close" size={14} />
                  </button>
                </span>
              ))}
              {images.length < ROLE_REQUEST_MAX_IMAGES && (
                <button
                  type="button"
                  className="request-image add"
                  aria-label="添加参考图"
                  disabled={uploading}
                  onClick={() => file.current?.click()}
                >
                  {uploading ? '上传中' : <OldIcon name="wechat/add" size={28} />}
                </button>
              )}
            </div>
            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void pick(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </details>
        <label>
          补充说明
          <textarea
            value={note}
            maxLength={500}
            rows={3}
            placeholder="还有什么想告诉我们的"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {config.data && (
          <div className="hint">
            <p>
              {config.data.quota.tier === 'pro_plus'
                ? `PRO+ 每周免费 ${config.data.proPlusWeeklyFreeCount} 次，本周还剩 ${config.data.quota.remaining} 次`
                : `终身免费 ${config.data.lifetimeFreeCount} 次，还剩 ${config.data.quota.remaining} 次`}
              。本次{' '}
              {config.data.quota.nextPointsCost === 0
                ? '免费'
                : `冻结${config.data.quota.nextPointsCost}积分`}
              。
            </p>
            <p>
              免费用户终身 {config.data.lifetimeFreeCount} 次；PRO+ 每周{' '}
              {config.data.proPlusWeeklyFreeCount} 次，按北京时间周一 0
              点重置、不累积，不与终身次数叠加。
              被拒绝或撤回的申请会退还次数；免费次数用完后每次按配置价格收费，收费申请完成时扣除，拒绝或撤回退回冻结积分。
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {expiredKey && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              requestId.current = crypto.randomUUID();
              setExpiredKey(false);
              setBlockedKey(false);
              config.refresh();
              setError('已更换新编号。请核对报价后再次提交确认。');
            }}
          >
            更换新编号
          </button>
        )}
        <button
          className="primary"
          disabled={
            pending || uploading || blockedKey || !config.data || config.loading || !roleName.trim()
          }
        >
          {pending
            ? '正在提交…'
            : (config.data?.quota.nextPointsCost ?? 0) > 0
              ? `确认冻结${config.data?.quota.nextPointsCost}积分并提交`
              : '免费提交申请'}
        </button>
      </form>
    </main>
  );
}

/** 申请详情（推送 deepLink /role-requests/{id} 打开这里；查看即清该条红点）。 */
export function RoleRequestDetailPage() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useChat();
  const remote = useRemote(
    RoleRequestEndpoints.get,
    { params: { requestId }, networkOnly: true },
    !!requestId,
  );
  const { refresh } = remote;
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const data = remote.data;
  useEffect(() => {
    if (data) announceSeen();
  }, [data]);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string; itemId?: string } | undefined)?.section ===
        'role_requests'
    )
      refresh();
  });
  async function cancel() {
    setConfirm(false);
    setCancelling(true);
    try {
      await api.call(RoleRequestEndpoints.cancel, { params: { requestId } });
      showToast('已撤回', 2000, 'success');
      refresh();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setCancelling(false);
    }
  }
  const contact = data?.characterId
    ? state.contacts.find((c) => c.characterId === data.characterId)
    : undefined;
  return (
    <main className="role-request-detail">
      <NavBar title="申请详情" fallback="/role-requests" />
      {remote.error && !data && <EmptyState icon="wechat/info" title="找不到这条申请" />}
      {!data && !remote.error && (
        <p role="status" className="empty">
          正在读取…
        </p>
      )}
      {data && (
        <>
          <div className="request-head">
            <strong>{data.roleName}</strong>
            <StatusTag status={data.status} />
          </div>
          {data.adminMessage && (
            <div className="request-message">
              <small>官方留言</small>
              <p>{data.adminMessage}</p>
            </div>
          )}
          {data.status === 'completed' && data.characterId && (
            <>
              <GroupHeader>做好的角色</GroupHeader>
              <MenuGroup>
                <MenuRow
                  to={`/characters/${data.characterId}`}
                  leading={<CharacterAvatar id={data.characterId} size={40} />}
                  label="查看角色资料"
                  subtitle={
                    data.addedToContacts || contact
                      ? '已加到你的通讯录'
                      : '通讯录已满，删除一些角色后点这里添加'
                  }
                />
                {contact?.conversationId && (
                  <MenuRow
                    label="发消息"
                    onClick={() => navigate(`/chat/${contact.conversationId}`)}
                  />
                )}
              </MenuGroup>
            </>
          )}
          <GroupHeader>申请内容</GroupHeader>
          <MenuGroup>
            <MenuRow
              label="类型"
              chevron={false}
              value={basisNames[data.basis ?? ''] ?? '不确定'}
            />
            {data.sourceWork && <MenuRow label="出处" chevron={false} value={data.sourceWork} />}
            <MenuRow label="提交时间" chevron={false} value={dateText(data.createdAt)} />
            {data.freeQuotaApplied && (
              <MenuRow label="申请费用" chevron={false} value="使用免费次数" />
            )}
            {data.pointsCost > 0 && (
              <MenuRow
                label="积分"
                chevron={false}
                value={`${data.pointsCharged} / ${data.pointsCost}`}
              />
            )}
          </MenuGroup>
          {data.referenceText && (
            <div className="request-message">
              <small>参考资料</small>
              <p>{data.referenceText}</p>
            </div>
          )}
          {data.referenceImages.length > 0 && (
            <div className="request-image-grid readonly">
              {data.referenceImages.map((image) =>
                image.url ? (
                  <a
                    key={image.mediaId}
                    className="request-image"
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src={image.url} alt="参考图" loading="lazy" decoding="async" />
                  </a>
                ) : (
                  <span key={image.mediaId} className="request-image gone">
                    已删除
                  </span>
                ),
              )}
            </div>
          )}
          {data.note && (
            <div className="request-message">
              <small>补充说明</small>
              <p>{data.note}</p>
            </div>
          )}
          {data.status === 'pending' && (
            <MenuGroup>
              <MenuRow
                label="撤回申请"
                danger
                center
                disabled={cancelling}
                onClick={() => setConfirm(true)}
              />
            </MenuGroup>
          )}
        </>
      )}
      {confirm && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setConfirm(false) },
            { label: '撤回', danger: true, onClick: () => void cancel() },
          ]}
        >
          <p>撤回这条申请？</p>
        </Dialog>
      )}
    </main>
  );
}
