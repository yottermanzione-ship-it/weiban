import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  IdentityEndpoints,
  MediaEndpoints,
  MEDIA_LIMITS,
  MomentsEndpoints,
  type MomentsActor,
  type MomentsNotification,
  type MomentsBadge,
  type MomentsComment,
  type MomentsPost,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { VirtualList } from './virtual-list.js';
import { KeyboardBar } from './keyboard-bar.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { AvatarEditor } from './avatar-editor.js';
import { MediaImg } from './media.js';
import { AlertDialog, showToast, Dialog } from './toast.js';
import { OldIcon } from './old-icons.js';
import {
  ActionSheet,
  useBack,
  useLongPress,
  EmptyState,
  GroupHeader,
  MenuGroup,
  NavBar,
  NavIcon,
  CheckCircle,
} from './shell-kit.js';

/*
 * 朋友圈（SOC-07～SOC-09；视觉按 docs/refactor/06-old-ui-spec.md 4.11）。
 * 新动态不推送：发现页入口用 getBadge 显示红点，收到 moments.badge_updated 时更新。
 */

/** 发现页 / 我页使用的红点数据。 */
export function useMomentsBadge() {
  const remote = useRemote(MomentsEndpoints.getBadge, { networkOnly: true });
  const [badge, setBadge] = useState<MomentsBadge>();
  useUpdates((update) => {
    if (update.type === 'moments.badge_updated') {
      const next = (update.data as { badge?: MomentsBadge } | undefined)?.badge;
      if (next) setBadge(next);
    }
  });
  return badge ?? remote.data;
}

function timeText(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${Math.floor(diff)} 分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`;
  if (diff < 2880) return '昨天';
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function useActorName() {
  const { state } = useChat();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const [ids, setIds] = useState<string[]>([]);
  const names = useCharacterNames(ids);
  return {
    register: useCallback((list: string[]) => {
      setIds((prev) => {
        const missing = list.filter((id) => !prev.includes(id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    }, []),
    name: (actor: MomentsActor) =>
      actor.kind === 'user'
        ? profile.data?.nickname || '我'
        : state.contacts.find((c) => c.characterId === actor.refId)?.remark ||
          names[actor.refId] ||
          '角色',
    profile: profile.data,
  };
}
type ActorNames = ReturnType<typeof useActorName>;

function actorsOf(post: MomentsPost): string[] {
  return [
    post.author,
    ...post.likes,
    ...post.comments.flatMap((c) => (c.replyTo ? [c.author, c.replyTo] : [c.author])),
  ]
    .filter((a) => a.kind === 'character')
    .map((a) => a.refId);
}

function MomentImage({ mediaId, single }: { mediaId: string; single: boolean }) {
  const media = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  const url = single ? media.data?.url : (media.data?.thumbnailUrl ?? media.data?.url);
  return (
    <span className={single ? 'moment-image single' : 'moment-image'}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" />}
    </span>
  );
}
/** 列表加载器：游标原样回传；收到 moments.post_changed 时重拉单条。 */
type PostPage = { items: MomentsPost[]; nextCursor: string | null };
/**
 * U8：朋友圈首页第一页的内存快照（按账号）。切回朋友圈先画上次那页、后台静默刷新，
 * 不再每次先出骨架屏；启动页预加载也写这里。
 */
const firstPages = new Map<string, PostPage>();
const FEED_CACHE = 'feed';
const feedRequest = (cursor: string | undefined) =>
  api.call(MomentsEndpoints.listFeed, { query: { cursor, limit: 10 }, networkOnly: true });
/** 启动页预加载：取朋友圈第一页放进内存快照。 */
export async function preloadMomentsFeed(): Promise<void> {
  const owner = api.ownerKey();
  const page = await feedRequest(undefined);
  if (api.ownerKey() === owner) firstPages.set(`${owner}|${FEED_CACHE}`, page);
}
function usePostList(
  fetchPage: (cursor: string | undefined) => Promise<PostPage>,
  cacheKey?: string,
) {
  const scoped = cacheKey ? `${api.ownerKey()}|${cacheKey}` : null;
  const [seed] = useState(() => (scoped ? firstPages.get(scoped) : undefined));
  const [items, setItems] = useState<MomentsPost[]>(() => seed?.items ?? []);
  const [cursor, setCursor] = useState<string | null | undefined>(() =>
    seed ? seed.nextCursor : undefined,
  );
  /** 内存快照跟着本页的删改走，切回来不会先闪出已删掉的动态。 */
  const editCache = (change: (page: PostPage) => PostPage) => {
    const cached = scoped ? firstPages.get(scoped) : undefined;
    if (scoped && cached) firstPages.set(scoped, change(cached));
  };
  useEffect(() => {
    if (!seed || !scoped) return;
    let alive = true;
    void fetchPage(undefined)
      .then((page) => {
        firstPages.set(scoped, page);
        if (!alive) return;
        // 只换掉第一页那一段；已经往下翻出来的保留。
        setItems((previous) => {
          const fresh = new Set(page.items.map((post) => post.postId));
          const rest = previous.slice(seed.items.length).filter((post) => !fresh.has(post.postId));
          return [...page.items, ...rest];
        });
        setCursor((previous) => (previous === seed.nextCursor ? page.nextCursor : previous));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [seed, scoped, fetchPage]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current || cursor === null) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await fetchPage(cursor);
      if (cursor === undefined && scoped) firstPages.set(scoped, page);
      setItems((prev) => [
        ...prev,
        ...page.items.filter((p) => !prev.some((q) => q.postId === p.postId)),
      ]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, fetchPage, scoped]);
  useEffect(() => {
    if (cursor === undefined && items.length === 0 && !error) void load();
  }, [cursor, items.length, error, load]);
  useUpdates((update) => {
    if (update.type !== 'moments.post_changed') return;
    const data = update.data as { postId: string; deleted: boolean };
    if (!items.some((p) => p.postId === data.postId)) return;
    if (data.deleted) setItems((prev) => prev.filter((p) => p.postId !== data.postId));
    else
      void api
        .call(MomentsEndpoints.getPost, { params: { postId: data.postId } })
        .then((post) => setItems((prev) => prev.map((p) => (p.postId === post.postId ? post : p))))
        .catch(() => {});
  });
  return {
    items,
    loading,
    error,
    done: cursor === null,
    load,
    replace: (post: MomentsPost) => {
      editCache((page) => ({
        ...page,
        items: page.items.map((p) => (p.postId === post.postId ? post : p)),
      }));
      setItems((prev) => prev.map((p) => (p.postId === post.postId ? post : p)));
    },
    remove: (postId: string) => {
      editCache((page) => ({ ...page, items: page.items.filter((p) => p.postId !== postId) }));
      setItems((prev) => prev.filter((p) => p.postId !== postId));
    },
    prepend: (post: MomentsPost) => {
      editCache((page) => ({ ...page, items: [post, ...page.items] }));
      setItems((prev) => [post, ...prev]);
    },
  };
}

function LoadMore({ onVisible }: { onVisible(): void }) {
  useEffect(() => {
    onVisible();
  }, [onVisible]);
  return <p className="hint center">正在读取…</p>;
}

function ActorAvatar({
  actor,
  profile,
  size = 42,
}: {
  actor: MomentsActor;
  profile: ActorNames['profile'];
  size?: number;
}) {
  return actor.kind === 'user' ? (
    <Link to="/me/moments" className="moment-avatar">
      <UserAvatar profile={profile} size={size} radius={4} />
    </Link>
  ) : (
    <Link to={`/characters/${actor.refId}`} className="moment-avatar">
      <CharacterAvatar id={actor.refId} size={size} radius={4} />
    </Link>
  );
}

/** 名字是独立资料入口，不能与评论正文共用回复按钮。 */
export function MomentActorName({ actor, actors }: { actor: MomentsActor; actors: ActorNames }) {
  return (
    <Link
      className="moment-actor-name"
      to={actor.kind === 'character' ? `/characters/${actor.refId}` : '/me/moments'}
      onClick={(event) => event.stopPropagation()}
    >
      {actors.name(actor)}
    </Link>
  );
}

export function MomentCommentRow({
  comment,
  actors,
  pending,
  onReply,
  onDelete,
}: {
  comment: MomentsComment;
  actors: ActorNames;
  pending: boolean;
  onReply(): void;
  onDelete(): void;
}) {
  const press = useLongPress(() => {
    if (!pending && comment.author.kind === 'user') onDelete();
  });
  return (
    <p className="moment-comment">
      <MomentActorName actor={comment.author} actors={actors} />
      {comment.replyTo && (
        <>
          回复
          <MomentActorName actor={comment.replyTo} actors={actors} />
        </>
      )}
      {/*
        U5：正文用可点的行内文字（role=button），跟在名字后面接着排；
        原生 button 在浏览器里总是行内块，长评论会整块掉到下一行。
      */}
      <span
        role="button"
        tabIndex={pending ? -1 : 0}
        className="moment-comment-text"
        aria-disabled={pending || undefined}
        aria-label={`回复${actors.name(comment.author)}的评论`}
        {...press}
        onClick={() => {
          if (!pending) onReply();
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !pending) {
            event.preventDefault();
            onReply();
          }
        }}
      >
        ：{comment.text}
      </span>
    </p>
  );
}

/** 一条动态（4.11 动态卡）。 */
export function MomentCard({
  post,
  actors,
  onChange,
  onDeleted,
  full = false,
}: {
  post: MomentsPost;
  actors: ActorNames;
  onChange(post: MomentsPost): void;
  onDeleted?(): void;
  full?: boolean;
}) {
  const [replying, setReplying] = useState<MomentsComment | null | undefined>(undefined);
  const [text, setText] = useState('');
  /** U5：草稿跟着评论对象走——收起后再点同一处评论接着写，换了回复对象才清空。 */
  const [draftFor, setDraftFor] = useState<string | null>(null);
  function openReply(target: MomentsComment | null) {
    const key = target?.commentId ?? 'post';
    if (key !== draftFor) {
      setText('');
      setDraftFor(key);
    }
    setReplying(target);
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [commentMenu, setCommentMenu] = useState<MomentsComment | null>(null);
  const { register } = actors;
  useEffect(() => register(actorsOf(post)), [post, register]);
  const mine = post.author.kind === 'user';
  async function run(operation: () => Promise<MomentsPost | null>) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const next = await operation();
      if (next) onChange(next);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const visibleComments = full ? post.comments : post.comments.slice(-20);
  const like = () =>
    void run(() =>
      api.call(post.likedByMe ? MomentsEndpoints.unlike : MomentsEndpoints.like, {
        params: { postId: post.postId },
      }),
    );
  return (
    <article
      className={`moment-card${full ? ' moment-card-detail' : ''}`}
      onContextMenu={(event) => {
        const target = event.target;
        const contentTarget =
          target instanceof Element &&
          (target === event.currentTarget ||
            target.classList.contains('moment-body') ||
            target.closest('.moment-text, .moment-images'));
        if (!pending && mine && onDeleted && contentTarget) {
          event.preventDefault();
          setConfirmDelete(true);
        }
      }}
    >
      <ActorAvatar actor={post.author} profile={actors.profile} />
      <div className="moment-body">
        <strong className="moment-author">
          <Link to={mine ? '/me/moments' : `/characters/${post.author.refId}`}>
            {actors.name(post.author)}
          </Link>
        </strong>
        {post.text && <p className={`moment-text ${full ? '' : 'clamp-6'}`}>{post.text}</p>}
        {post.images.length > 0 && (
          <div className={`moment-images ${post.images.length === 1 ? 'single' : 'grid'}`}>
            {post.images.map((image) => (
              <MomentImage
                key={image.mediaId}
                mediaId={image.mediaId}
                single={post.images.length === 1}
              />
            ))}
          </div>
        )}
        {post.link && (
          <a className="moment-link" href={post.link.url} target="_blank" rel="noreferrer noopener">
            <OldIcon name="wechat/link" size={20} />
            <span>{post.link.title}</span>
          </a>
        )}
        <div className="moment-meta">
          <Link to={`/moments/posts/${post.postId}`}>
            <small>{timeText(post.createdAt)}</small>
          </Link>
          {mine && post.visibility?.kind === 'selected' && (
            <button
              type="button"
              className="moment-visibility"
              aria-label="部分可见"
              onClick={() =>
                showToast(`仅 ${post.visibility?.characterIds.length ?? 0} 个角色可见`)
              }
            >
              <OldIcon name="drawn/people" size={14} />
            </button>
          )}
          {mine && onDeleted && (
            <button
              type="button"
              className="moment-delete"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </button>
          )}
          {!full && (
            <span className="moment-more-host">
              {menu && (
                <span className="moment-pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => {
                      setMenu(false);
                      like();
                    }}
                  >
                    <OldIcon
                      name={post.likedByMe ? 'wechat/like_filled' : 'wechat/like'}
                      size={18}
                    />
                    {post.likedByMe ? '取消' : '赞'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => {
                      setMenu(false);
                      openReply(null);
                    }}
                  >
                    <OldIcon name="wechat/chat" size={18} />
                    评论
                  </button>
                </span>
              )}
              <button
                type="button"
                className="moment-dots"
                disabled={pending}
                aria-label="赞和评论"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                <i />
                <i />
              </button>
            </span>
          )}
        </div>
        {full && (
          <div className="moment-detail-actions" aria-label="动态操作">
            <button type="button" disabled={pending} aria-pressed={post.likedByMe} onClick={like}>
              <OldIcon name={post.likedByMe ? 'wechat/like_filled' : 'wechat/like'} size={18} />
              {post.likedByMe ? '取消赞' : '赞'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError('');
                openReply(null);
              }}
            >
              <OldIcon name="wechat/chat" size={18} />
              评论
            </button>
          </div>
        )}
        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="moment-feedback">
            {post.likes.length > 0 && (
              <p className="moment-likes">
                <OldIcon name="wechat/like" size={14} />
                <span>
                  {post.likes.map((actor, index) => (
                    <Fragment key={`${actor.kind}:${actor.refId}`}>
                      {index > 0 && '、'}
                      <MomentActorName actor={actor} actors={actors} />
                    </Fragment>
                  ))}
                </span>
              </p>
            )}
            {visibleComments.map((c) => (
              <MomentCommentRow
                key={c.commentId}
                comment={c}
                actors={actors}
                pending={pending}
                onReply={() => {
                  setError('');
                  openReply(c);
                }}
                onDelete={() => setCommentMenu(c)}
              />
            ))}
            {!full && post.comments.length > visibleComments.length && (
              <Link className="moment-all" to={`/moments/posts/${post.postId}`}>
                查看全部评论
              </Link>
            )}
          </div>
        )}
        {replying !== undefined && (
          <KeyboardBar
            label={replying ? `回复${actors.name(replying.author)}` : '评论'}
            onDismiss={() => {
              // 收起但保留草稿（微信同款）；发送中不收。
              if (!pending) setReplying(undefined);
            }}
          >
            <form
              className="moment-reply moment-comment-bar"
              onSubmit={(e) => {
                e.preventDefault();
                if (pending || !text.trim()) return;
                void run(async () => {
                  const next = await api.call(MomentsEndpoints.comment, {
                    params: { postId: post.postId },
                    body: {
                      clientRequestId: crypto.randomUUID(),
                      text: text.trim(),
                      replyToCommentId: replying?.commentId ?? null,
                    },
                  });
                  setText('');
                  setReplying(undefined);
                  return next;
                });
              }}
            >
              <textarea
                autoFocus
                rows={1}
                disabled={pending}
                maxLength={500}
                value={text}
                aria-label="评论"
                placeholder={replying ? `回复${actors.name(replying.author)}：` : '评论'}
                onChange={(e) => {
                  setText(e.target.value);
                  // 随内容长高，最多 4 行（样式里 max-height 封顶）。
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
              />
              <button
                className="primary wx-send"
                disabled={pending || !text.trim()}
                aria-busy={pending}
              >
                发送
              </button>
              {error && <small role="alert">{error}</small>}
            </form>
          </KeyboardBar>
        )}
        {error && <small role="alert">{error}</small>}
      </div>
      {confirmDelete && onDeleted && (
        <AlertDialog
          title="删除这条朋友圈？"
          message="删除后不能恢复，点赞和评论也会一起删除。"
          confirmLabel="删除"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void api
              .call(MomentsEndpoints.deletePost, { params: { postId: post.postId } })
              .then(onDeleted)
              .catch((e) => setError(friendlyError(e)));
          }}
        />
      )}
      {commentMenu && (
        <ActionSheet
          onClose={() => setCommentMenu(null)}
          items={[
            {
              label: '删除',
              danger: true,
              onClick: () =>
                void run(() =>
                  api.call(MomentsEndpoints.deleteComment, {
                    params: { postId: post.postId, commentId: commentMenu.commentId },
                  }),
                ),
            },
          ]}
        />
      )}
    </article>
  );
}

const coverGradients = [
  ['#6E8EAE', '#C9D6DF'],
  ['#6D597A', '#B56576'],
  ['#52796F', '#94B49F'],
  ['#B08968', '#E6CCB2'],
  ['#4A6FA5', '#9FB8D4'],
  ['#9A8C98', '#C9ADA7'],
  ['#5F7470', '#A4B8AE'],
  ['#BC6C25', '#E9B872'],
  ['#3D5A80', '#98C1D9'],
  ['#7B6D8D', '#C4B2CE'],
] as const;
function coverFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return coverGradients[hash % coverGradients.length]!;
}

/** 朋友圈封面（4.11）：高 370，预设渐变 + 底部压暗；头像 70 探出封面 23.4。 */
function MomentsCover({
  name,
  avatar,
  to,
  editable = false,
}: {
  name: string;
  avatar: ReactNode;
  to: string;
  editable?: boolean;
}) {
  const [top, bottom] = coverFor(name);
  const profile = useRemote(IdentityEndpoints.getProfile, {}, editable);
  const [open, setOpen] = useState(false);
  const { assertOwner } = useChat();
  const coverId = editable ? profile.data?.momentsCoverMediaId : null;
  async function save(mediaId: string | null) {
    assertOwner();
    await api.call(IdentityEndpoints.updateProfile, { body: { momentsCoverMediaId: mediaId } });
    window.dispatchEvent(new Event('weiban:settings-updated'));
    showToast(mediaId ? '已更换封面' : '已恢复默认封面', 2000, 'success');
  }
  return (
    <>
      <div className="moments-cover-wrap">
        <div
          className={`moments-cover ${coverId ? '' : 'is-default'}`}
          style={{ backgroundImage: `linear-gradient(${top}, ${bottom})` }}
        >
          {coverId && (
            <div className="moments-cover-image">
              <MediaImg key={coverId} mediaId={coverId} thumbnail={false} alt="朋友圈封面" />
            </div>
          )}
          <i className="moments-cover-shade" />
          {editable && (
            <button
              className="moments-change-cover"
              aria-label="换封面"
              onClick={() => setOpen(true)}
            />
          )}
          <Link className="moments-cover-name" to={to}>
            {name}
          </Link>
        </div>
        <Link className="moments-cover-avatar" to={to} aria-label={`${name}的资料`}>
          {avatar}
        </Link>
      </div>
      {/* U2：换封面直接弹出 拍照 / 从相册选择 / 恢复默认封面 的 Action Sheet */}
      {open && (
        <AvatarEditor
          sheet
          onClose={() => setOpen(false)}
          purpose="moments_cover"
          label="封面"
          onSaved={save}
          onRestore={
            coverId
              ? () => {
                  void save(null).catch((e) => showToast(friendlyError(e), 2500, 'error'));
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/** 发现 › 朋友圈。 */
export function MomentsFeedPage() {
  const actors = useActorName();
  const badge = useMomentsBadge();
  const navigate = useNavigate();
  const [cameraMenu, setCameraMenu] = useState(false);
  const cameraPress = useLongPress(() => navigate('/moments/new'));
  const list = usePostList(feedRequest, FEED_CACHE);
  useEffect(() => {
    void api.call(MomentsEndpoints.markSeen, { body: { scope: 'posts' } }).catch(() => {});
  }, []);
  type Row =
    | MomentsPost
    | { postId: '__cover__' }
    | { postId: '__more__' }
    | { postId: '__end__' | '__empty__' };
  const rows: Row[] = [
    { postId: '__cover__' },
    ...list.items,
    ...(list.done
      ? [{ postId: list.items.length ? ('__end__' as const) : ('__empty__' as const) }]
      : [{ postId: '__more__' as const }]),
  ];
  const nickname = actors.profile?.nickname || '我';
  return (
    <main className="moments-page moments-feed">
      <NavBar
        transparent
        fallback="/discover"
        right={
          <button
            type="button"
            className="nav-bar-icon"
            aria-label="发朋友圈"
            {...cameraPress}
            onClick={() => setCameraMenu(true)}
          >
            <OldIcon name="wechat/camera" size={24} />
          </button>
        }
      />
      <VirtualList
        items={rows}
        itemKey={(item) => item.postId}
        label="朋友圈"
        estimate={260}
        render={(item) =>
          item.postId === '__cover__' ? (
            <>
              <MomentsCover
                editable
                name={nickname}
                avatar={<UserAvatar profile={actors.profile} size={70} radius={8} />}
                to="/me/moments"
              />
              {badge && badge.unseenInteractionCount > 0 && (
                <div className="moments-new-wrap">
                  <Link className="moments-new" to="/moments/notifications">
                    <UserAvatar profile={actors.profile} size={28} radius={4} />
                    {badge.unseenInteractionCount}条新消息
                  </Link>
                </div>
              )}
              {list.items.length === 0 && list.error && (
                <div className="empty">
                  <p>加载失败</p>
                  <button onClick={() => void list.load()}>重试</button>
                </div>
              )}
            </>
          ) : item.postId === '__more__' ? (
            list.error ? (
              <button className="text-button full" onClick={() => void list.load()}>
                加载失败，点击重试
              </button>
            ) : (
              <LoadMore onVisible={() => void list.load()} />
            )
          ) : item.postId === '__end__' ? (
            <p className="hint center moments-end">没有更多了</p>
          ) : item.postId === '__empty__' ? (
            <p className="moments-empty">暂时没有动态</p>
          ) : (
            <MomentCard
              post={item as MomentsPost}
              actors={actors}
              onChange={list.replace}
              onDeleted={() => list.remove(item.postId)}
            />
          )
        }
      />
      {cameraMenu && (
        <ActionSheet
          onClose={() => setCameraMenu(false)}
          items={[
            { label: '拍摄', onClick: () => navigate('/moments/new?pick=camera') },
            { label: '从相册选择', onClick: () => navigate('/moments/new?pick=album') },
            { label: '只发文字', onClick: () => navigate('/moments/new') },
          ]}
        />
      )}
    </main>
  );
}

/** 角色朋友圈（资料页 › 朋友圈；聊天信息 › 成员 › 资料页 › 朋友圈）：与发现页同一套 feed 形态，当页可点赞/评论。 */
export function CharacterMomentsPage() {
  const { characterId = '' } = useParams();
  const { state } = useChat();
  const actors = useActorName();
  const names = useCharacterNames([characterId]);
  const name =
    state.contacts.find((c) => c.characterId === characterId)?.remark || names[characterId] || 'TA';
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      api.call(MomentsEndpoints.listCharacterPosts, {
        params: { characterId },
        query: { cursor, limit: 10 },
        networkOnly: true,
      }),
    [characterId],
  );
  const list = usePostList(fetchPage);
  type Row =
    | MomentsPost
    | { postId: '__cover__' }
    | { postId: '__more__' }
    | { postId: '__end__' | '__empty__' };
  const rows: Row[] = [
    { postId: '__cover__' },
    ...list.items,
    ...(list.done
      ? [{ postId: list.items.length ? ('__end__' as const) : ('__empty__' as const) }]
      : [{ postId: '__more__' as const }]),
  ];
  return (
    <main className="moments-page moments-feed">
      <NavBar transparent title={`${name}的朋友圈`} fallback={`/characters/${characterId}`} />
      <VirtualList
        items={rows}
        itemKey={(item) => item.postId}
        label={`${name}的朋友圈`}
        estimate={260}
        render={(item) =>
          item.postId === '__cover__' ? (
            <>
              <MomentsCover
                editable={false}
                name={name}
                avatar={<CharacterAvatar id={characterId} size={70} radius={8} />}
                to={`/characters/${characterId}`}
              />
              {list.items.length === 0 && list.error && (
                <div className="empty">
                  <p>加载失败</p>
                  <button onClick={() => void list.load()}>重试</button>
                </div>
              )}
            </>
          ) : item.postId === '__more__' ? (
            list.error ? (
              <button className="text-button full" onClick={() => void list.load()}>
                加载失败，点击重试
              </button>
            ) : (
              <LoadMore onVisible={() => void list.load()} />
            )
          ) : item.postId === '__end__' ? (
            <p className="hint center moments-end">没有更多了</p>
          ) : item.postId === '__empty__' ? (
            <p className="moments-empty">TA 还没有发过朋友圈</p>
          ) : (
            <MomentCard
              post={item as MomentsPost}
              actors={actors}
              onChange={list.replace}
              onDeleted={() => list.remove(item.postId)}
            />
          )
        }
      />
    </main>
  );
}

/** 我的朋友圈：与发现页同一套 feed 形态，当页可点赞/评论。 */
export function MyMomentsPage() {
  const profile = useRemote(IdentityEndpoints.getProfile);
  const actors = useActorName();
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      api.call(MomentsEndpoints.listMyPosts, { query: { cursor, limit: 10 }, networkOnly: true }),
    [],
  );
  const list = usePostList(fetchPage);
  type Row =
    | MomentsPost
    | { postId: '__cover__' }
    | { postId: '__more__' }
    | { postId: '__end__' | '__empty__' };
  const rows: Row[] = [
    { postId: '__cover__' },
    ...list.items,
    ...(list.done
      ? [{ postId: list.items.length ? ('__end__' as const) : ('__empty__' as const) }]
      : [{ postId: '__more__' as const }]),
  ];
  const name = profile.data?.nickname || '我';
  return (
    <main className="moments-page moments-feed">
      <NavBar
        transparent
        title="我的朋友圈"
        fallback="/me"
        right={<NavIcon name="wechat/camera" label="发朋友圈" to="/moments/new" size={24} />}
      />
      <VirtualList
        items={rows}
        itemKey={(item) => item.postId}
        label="我的朋友圈"
        estimate={260}
        render={(item) =>
          item.postId === '__cover__' ? (
            <>
              <MomentsCover
                editable
                name={name}
                avatar={<UserAvatar profile={profile.data} size={70} radius={8} />}
                to="/profile"
              />
              {list.items.length === 0 && list.error && (
                <div className="empty">
                  <p>加载失败</p>
                  <button onClick={() => void list.load()}>重试</button>
                </div>
              )}
            </>
          ) : item.postId === '__more__' ? (
            list.error ? (
              <button className="text-button full" onClick={() => void list.load()}>
                加载失败，点击重试
              </button>
            ) : (
              <LoadMore onVisible={() => void list.load()} />
            )
          ) : item.postId === '__end__' ? (
            <p className="hint center moments-end">没有更多了</p>
          ) : item.postId === '__empty__' ? (
            <p className="moments-empty">你还没有发过朋友圈</p>
          ) : (
            <MomentCard
              post={item as MomentsPost}
              actors={actors}
              onChange={list.replace}
              onDeleted={() => list.remove(item.postId)}
            />
          )
        }
      />
    </main>
  );
}

/** 动态详情页（4.11 详情页）。 */
export function MomentDetailPage() {
  const { postId = '' } = useParams();
  const actors = useActorName();
  const [post, setPost] = useState<MomentsPost | null>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setError('');
    setLoading(true);
    setPost(undefined);
    void api
      .call(MomentsEndpoints.getPost, { params: { postId }, networkOnly: true })
      .then((p) => active && setPost(p))
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiFailure && e.status === 404) setPost(null);
        else setError(friendlyError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [postId, revision]);
  useUpdates((update) => {
    if (update.type !== 'moments.post_changed') return;
    const data = update.data as { postId: string; deleted: boolean };
    if (data.postId !== postId) return;
    if (data.deleted) setPost(null);
    else setRevision((v) => v + 1);
  });
  return (
    <main className="moment-detail">
      <NavBar title="详情" fallback="/moments" />
      {loading && (
        <p className="empty" role="status">
          正在读取动态…
        </p>
      )}
      {post === null && <EmptyState icon="wechat/picture" title="该动态已删除" />}
      {error && !post && (
        <div className="empty">
          <p role="alert">{error}</p>
          <button className="text-button" onClick={() => setRevision((v) => v + 1)}>
            重试
          </button>
        </div>
      )}
      {post && (
        <MomentCard
          post={post}
          actors={actors}
          full
          onChange={setPost}
          onDeleted={() => setPost(null)}
        />
      )}
    </main>
  );
}

interface Picked {
  file: File;
  preview: string;
}

/** 发朋友圈（moments.md 第 5 节；4.11 发表页）。 */
export function ComposeMomentPage() {
  const navigate = useNavigate();
  const back = useBack('/moments');
  const { state } = useChat();
  const contacts = state.contacts.filter((c) => c.status === 'active');
  const names = useCharacterNames(contacts.map((c) => c.characterId));
  const [text, setText] = useState('');
  const [images, setImages] = useState<Picked[]>([]);
  const [visibility, setVisibility] = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useRef<Picked[]>([]);
  useEffect(() => {
    previews.current = images;
  }, [images]);
  useEffect(() => () => previews.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);
  useEffect(() => {
    const pick = new URLSearchParams(window.location.search).get('pick');
    if (pick && fileInput.current) {
      if (pick === 'camera') fileInput.current.setAttribute('capture', 'environment');
      fileInput.current.click();
    }
  }, []);
  const nameOf = (id: string) =>
    contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    event.target.removeAttribute('capture');
    const valid = files.filter(
      (f) =>
        (MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(f.type) &&
        f.size <= MEDIA_LIMITS.imageMaxBytes,
    );
    if (valid.length < files.length) setError('只支持 10 MB 以内的 JPG、PNG、WebP、GIF 图片');
    setImages((prev) => [
      ...prev,
      ...valid
        .slice(0, 9 - prev.length)
        .map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }
  async function publish() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const imageMediaIds: string[] = [];
      for (const image of images) {
        const media = await api.call(MediaEndpoints.upload, {
          query: { purpose: 'moments_image' },
          file: image.file,
        });
        imageMediaIds.push(media.mediaId);
      }
      await api.call(MomentsEndpoints.createPost, {
        body: {
          clientRequestId: requestId,
          text,
          imageMediaIds,
          visibility:
            visibility === 'all'
              ? { kind: 'all_characters', characterIds: [] }
              : { kind: 'selected', characterIds: selected },
        },
      });
      navigate('/moments', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const dirty = text.trim().length > 0 || images.length > 0;
  return (
    <main className="moment-compose">
      <NavBar
        left={
          <button
            type="button"
            className="text-button text-action plain-text"
            disabled={pending}
            onClick={() => (dirty ? setLeaving(true) : back())}
          >
            取消
          </button>
        }
        right={
          <button
            type="button"
            className="primary"
            disabled={pending || !dirty || (visibility === 'selected' && selected.length === 0)}
            onClick={() => void publish()}
          >
            {pending ? '发表中' : '发表'}
          </button>
        }
      />
      <div className="compose-card">
        <textarea
          aria-label="这一刻的想法"
          placeholder="这一刻的想法..."
          maxLength={2000}
          disabled={pending}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="hint compose-count">{text.length}/2000</p>
        <div className="image-picker">
          {images.map((image, index) => (
            <span key={image.preview} className="picked-image">
              <img src={image.preview} alt="" />
              <button
                type="button"
                disabled={pending}
                aria-label="移除图片"
                onClick={() => {
                  URL.revokeObjectURL(image.preview);
                  setImages((prev) => prev.filter((_, i) => i !== index));
                }}
              >
                <OldIcon name="wechat/close" size={18} />
              </button>
            </span>
          ))}
          {images.length < 9 && (
            <button
              type="button"
              className="picked-image add-image"
              disabled={pending}
              aria-label="添加图片"
              onClick={() => fileInput.current?.click()}
            >
              <OldIcon name="wechat/add" size={28} />
            </button>
          )}
          <input
            ref={fileInput}
            disabled={pending}
            type="file"
            accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
            multiple
            hidden
            onChange={pick}
          />
        </div>
      </div>
      <GroupHeader>谁可以看</GroupHeader>
      <MenuGroup>
        <button
          type="button"
          className="menu-row"
          disabled={pending}
          aria-pressed={visibility === 'all'}
          onClick={() => {
            setVisibility('all');
            setChoosing(false);
          }}
        >
          <span className="menu-text">
            <span className="menu-label">公开</span>
            <small className="menu-subtitle">所有角色可见</small>
          </span>
          <CheckCircle checked={visibility === 'all'} />
        </button>
        <button
          type="button"
          className="menu-row"
          disabled={pending}
          aria-pressed={visibility === 'selected'}
          onClick={() => {
            setVisibility('selected');
            setChoosing(true);
          }}
        >
          <span className="menu-text">
            <span className="menu-label">部分可见</span>
            <small className="menu-subtitle">
              {selected.length ? selected.map(nameOf).join('、') : '选中的角色可见'}
            </small>
          </span>
          <CheckCircle checked={visibility === 'selected'} />
        </button>
      </MenuGroup>
      {choosing && visibility === 'selected' && (
        <MenuGroup>
          {!contacts.length && (
            <EmptyState
              title="还没有可选的朋友"
              desc="添加朋友后，可以选择谁能看到这条动态"
              action={
                <Link to="/contacts/add" className="text-button">
                  添加朋友
                </Link>
              }
            />
          )}
          {contacts.map((c) => {
            const checked = selected.includes(c.characterId);
            return (
              <button
                key={c.characterId}
                type="button"
                className="menu-row select-row"
                disabled={pending}
                aria-pressed={checked}
                onClick={() =>
                  setSelected((v) =>
                    checked ? v.filter((id) => id !== c.characterId) : [...v, c.characterId],
                  )
                }
              >
                <CheckCircle checked={checked} />
                <CharacterAvatar id={c.characterId} size={40} />
                <span className="menu-label">{nameOf(c.characterId)}</span>
              </button>
            );
          })}
        </MenuGroup>
      )}
      <p className="hint page-note">看不到的角色不会点赞评论，也不会在聊天里提起这条动态</p>
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
      {leaving && (
        <Dialog
          actions={[
            { label: '继续编辑', onClick: () => setLeaving(false) },
            { label: '不保留', danger: true, onClick: back },
          ]}
        >
          <p>不保留此次编辑？</p>
        </Dialog>
      )}
    </main>
  );
}

/** 朋友圈消息列表（谁点赞 / 评论 / 回复 / @ 了我）。进入即清互动红点。 */
export function MomentsNotificationsPage() {
  const actors = useActorName();
  const [items, setItems] = useState<MomentsNotification[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = actors;
  const load = useCallback(() => {
    if (loading || cursor === null) return;
    setLoading(true);
    setError('');
    void api
      .call(MomentsEndpoints.listNotifications, {
        query: { cursor: cursor ?? undefined, limit: 20 },
        networkOnly: true,
      })
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
        register(
          page.items.flatMap((n) =>
            [n.actor, n.post.author].filter((a) => a.kind === 'character').map((a) => a.refId),
          ),
        );
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [cursor, loading, register]);
  useEffect(() => {
    load();
    void api.call(MomentsEndpoints.markSeen, { body: { scope: 'interactions' } }).catch(() => {});
    // 只在进入时加载第一页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const verb: Record<string, string> = {
    like: '赞了你的动态',
    comment: '评论了动态',
    reply: '回复了你',
    mention: '在评论中提到了你',
  };
  return (
    <main className="moments-notices">
      <NavBar title="消息" fallback="/moments" />
      {error && (
        <p role="alert" className="notice-bar">
          {error} <button onClick={load}>重试</button>
        </p>
      )}
      {items.length === 0 && cursor === null && <EmptyState icon="wechat/chat" title="暂无消息" />}
      <MenuGroup>
        {items.map((n) => (
          <Link key={n.notificationId} className="notice-row" to={`/moments/posts/${n.postId}`}>
            {n.actor.kind === 'user' ? (
              <UserAvatar profile={actors.profile} size={46} radius={6} />
            ) : (
              <CharacterAvatar id={n.actor.refId} size={46} radius={6} />
            )}
            <span className="notice-copy">
              <b>{actors.name(n.actor)}</b>
              <span>
                {n.kind === 'like' ? (
                  <OldIcon name="wechat/like" size={16} label="赞" />
                ) : (
                  (n.text ?? verb[n.kind] ?? '')
                )}
              </span>
              <small>{timeText(n.createdAt)}</small>
            </span>
            {n.post.imageMediaId ? (
              <MomentImage mediaId={n.post.imageMediaId} single={false} />
            ) : (
              <small className="moments-notice-text">{n.post.text}</small>
            )}
          </Link>
        ))}
      </MenuGroup>
      {cursor !== null && items.length > 0 && (
        <button className="text-button full" disabled={loading} onClick={load}>
          {loading ? '正在读取…' : '查看更多'}
        </button>
      )}
    </main>
  );
}
