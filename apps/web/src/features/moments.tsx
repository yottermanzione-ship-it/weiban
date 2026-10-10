import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, ChatCircle, Heart, Users } from '@phosphor-icons/react';
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
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';

/*
 * 朋友圈（SOC-07～SOC-09；设计 moments.md、social-l4.md 第 3 节）。
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

function ActorAvatar({ actor, profile }: { actor: MomentsActor; profile: ActorNames['profile'] }) {
  return actor.kind === 'user' ? (
    <UserAvatar profile={profile} />
  ) : (
    <Link to={`/characters/${actor.refId}`}>
      <CharacterAvatar id={actor.refId} size={40} />
    </Link>
  );
}

/** 一条动态（C 10.1）。 */
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { register } = actors;
  useEffect(() => register(actorsOf(post)), [post, register]);
  const mine = post.author.kind === 'user';
  async function run(operation: () => Promise<MomentsPost | null>) {
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
  return (
    <article className="moment-card">
      <ActorAvatar actor={post.author} profile={actors.profile} />
      <div className="moment-body">
        <strong className="moment-author">{actors.name(post.author)}</strong>
        {post.text && <p className={full ? '' : 'clamp-6'}>{post.text}</p>}
        {post.images.length > 0 && (
          <div className={`moment-images count-${Math.min(post.images.length, 4)}`}>
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
            {post.link.title}
          </a>
        )}
        <div className="moment-meta">
          <Link to={`/moments/posts/${post.postId}`}>
            <small>{timeText(post.createdAt)}</small>
          </Link>
          {mine && post.visibility?.kind === 'selected' && (
            <button
              className="icon-button"
              aria-label="部分可见"
              onClick={() => setError(`仅 ${post.visibility?.characterIds.length ?? 0} 个角色可见`)}
            >
              <Users size={16} />
            </button>
          )}
          {mine && onDeleted && (
            <button
              className="text-button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm('删除这条朋友圈？')) return;
                void api
                  .call(MomentsEndpoints.deletePost, { params: { postId: post.postId } })
                  .then(onDeleted)
                  .catch((e) => setError(friendlyError(e)));
              }}
            >
              删除
            </button>
          )}
          <span className="moment-actions">
            <button
              className="icon-button"
              aria-label={post.likedByMe ? '取消赞' : '赞'}
              aria-pressed={post.likedByMe}
              disabled={pending}
              onClick={() =>
                void run(() =>
                  api.call(post.likedByMe ? MomentsEndpoints.unlike : MomentsEndpoints.like, {
                    params: { postId: post.postId },
                  }),
                )
              }
            >
              <Heart size={18} weight={post.likedByMe ? 'fill' : 'regular'} />
            </button>
            <button className="icon-button" aria-label="评论" onClick={() => setReplying(null)}>
              <ChatCircle size={18} />
            </button>
          </span>
        </div>
        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="moment-feedback">
            {post.likes.length > 0 && (
              <p className="moment-likes">
                <Heart size={14} aria-hidden /> {post.likes.map((a) => actors.name(a)).join('，')}
              </p>
            )}
            {visibleComments.map((c) => (
              <p key={c.commentId} className="moment-comment">
                <button className="text-button" onClick={() => setReplying(c)}>
                  <strong>{actors.name(c.author)}</strong>
                  {c.replyTo && (
                    <>
                      {' '}
                      回复 <strong>{actors.name(c.replyTo)}</strong>
                    </>
                  )}
                  ：{c.text}
                </button>
                {c.author.kind === 'user' && (
                  <button
                    className="text-button danger"
                    aria-label="删除评论"
                    onClick={() =>
                      void run(() =>
                        api.call(MomentsEndpoints.deleteComment, {
                          params: { postId: post.postId, commentId: c.commentId },
                        }),
                      )
                    }
                  >
                    删除
                  </button>
                )}
              </p>
            ))}
            {!full && post.comments.length > visibleComments.length && (
              <Link to={`/moments/posts/${post.postId}`}>查看全部评论</Link>
            )}
          </div>
        )}
        {replying !== undefined && (
          <form
            className="message-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
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
            <label>
              {replying ? `回复 ${actors.name(replying.author)}` : '评论'}
              <input
                autoFocus
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button className="primary" disabled={pending || !text.trim()}>
              发送
            </button>
          </form>
        )}
        {error && <small role="alert">{error}</small>}
      </div>
    </article>
  );
}

/** 列表加载器：游标原样回传；收到 moments.post_changed 时重拉单条。 */
function usePostList(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: MomentsPost[]; nextCursor: string | null }>,
) {
  const [items, setItems] = useState<MomentsPost[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
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
  }, [cursor, fetchPage]);
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
    replace: (post: MomentsPost) =>
      setItems((prev) => prev.map((p) => (p.postId === post.postId ? post : p))),
    remove: (postId: string) => setItems((prev) => prev.filter((p) => p.postId !== postId)),
    prepend: (post: MomentsPost) => setItems((prev) => [post, ...prev]),
  };
}

function LoadMore({ onVisible }: { onVisible(): void }) {
  useEffect(() => {
    onVisible();
  }, [onVisible]);
  return <p className="hint center">正在读取…</p>;
}

/** 发现 › 朋友圈。 */
export function MomentsFeedPage() {
  const actors = useActorName();
  const badge = useMomentsBadge();
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      api.call(MomentsEndpoints.listFeed, { query: { cursor, limit: 10 }, networkOnly: true }),
    [],
  );
  const list = usePostList(fetchPage);
  useEffect(() => {
    void api.call(MomentsEndpoints.markSeen, { body: { scope: 'posts' } }).catch(() => {});
  }, []);
  type Row = MomentsPost | { postId: '__more__' } | { postId: '__end__' };
  const rows: Row[] = [
    ...list.items,
    ...(list.done ? [{ postId: '__end__' as const }] : [{ postId: '__more__' as const }]),
  ];
  return (
    <main className="moments-page">
      <header className="page-header">
        <Link to="/discover">‹ 发现</Link>
        <h1>朋友圈</h1>
        <Link to="/moments/new" aria-label="发朋友圈">
          <Camera size={22} />
        </Link>
      </header>
      {badge && badge.unseenInteractionCount > 0 && (
        <Link className="moments-pill" to="/moments/notifications">
          {badge.unseenInteractionCount} 条新消息
        </Link>
      )}
      {list.items.length === 0 && list.error && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={() => void list.load()}>重试</button>
        </div>
      )}
      {list.items.length === 0 && list.done && (
        <p className="empty">还没有朋友圈，等 TA 们分享生活吧</p>
      )}
      <VirtualList
        items={rows}
        itemKey={(item) => item.postId}
        label="朋友圈"
        estimate={260}
        render={(item) =>
          item.postId === '__more__' ? (
            list.error ? (
              <button className="text-button" onClick={() => void list.load()}>
                加载失败，点击重试
              </button>
            ) : (
              <LoadMore onVisible={() => void list.load()} />
            )
          ) : item.postId === '__end__' ? (
            <p className="hint center">没有更多了</p>
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

function dateParts(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const key = d.toDateString();
  const today = new Date();
  if (key === today.toDateString()) return { key, label: '今天' };
  if (key === new Date(today.getTime() - 86400000).toDateString()) return { key, label: '昨天' };
  return { key, label: `${d.getDate()} ${d.getMonth() + 1}月` };
}

/** 个人朋友圈相册页（资料页 › 朋友圈；我 › 朋友圈）。 */
function Album({
  title,
  mine,
  fetchPage,
  back,
}: {
  title: string;
  mine: boolean;
  fetchPage(
    cursor: string | undefined,
  ): Promise<{ items: MomentsPost[]; nextCursor: string | null }>;
  back: string;
}) {
  const list = usePostList(fetchPage);
  const sentinel = useRef<HTMLDivElement>(null);
  const { load, done, error } = list;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || done || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [load, done, error]);
  let previous = '';
  return (
    <main>
      <header className="page-header">
        <Link to={back}>‹ 返回</Link>
        <h1>{title}</h1>
        {mine ? (
          <Link to="/moments/new" aria-label="发朋友圈">
            <Camera size={22} />
          </Link>
        ) : (
          <span />
        )}
      </header>
      {list.items.length === 0 && list.loading && (
        <div className="stack" role="status" aria-label="正在读取">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}
      {list.items.length === 0 && list.done && (
        <p className="empty">{mine ? '你还没有发过朋友圈' : 'TA 还没有发过朋友圈'}</p>
      )}
      <div className="album">
        {list.items.map((post) => {
          const { key, label } = dateParts(post.createdAt);
          const showDate = key !== previous;
          previous = key;
          return (
            <Link key={post.postId} to={`/moments/posts/${post.postId}`} className="album-row">
              <span className="album-date">{showDate ? label : ''}</span>
              {post.images[0] && <MomentImage mediaId={post.images[0].mediaId} single={false} />}
              <span className={post.images.length ? 'album-text' : 'album-text plain-block'}>
                {post.text || `${post.images.length} 张图片`}
              </span>
            </Link>
          );
        })}
      </div>
      {list.items.length > 0 && list.error && (
        <button className="text-button" onClick={() => void list.load()}>
          加载失败，点击重试
        </button>
      )}
      {!list.done && <div ref={sentinel} className="timeline-sentinel" aria-hidden />}
    </main>
  );
}

export function CharacterMomentsPage() {
  const { characterId = '' } = useParams();
  const { state } = useChat();
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
  return (
    <Album
      title={`${name} 的朋友圈`}
      mine={false}
      fetchPage={fetchPage}
      back={`/characters/${characterId}`}
    />
  );
}

export function MyMomentsPage() {
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      api.call(MomentsEndpoints.listMyPosts, { query: { cursor, limit: 10 }, networkOnly: true }),
    [],
  );
  return <Album title="我的朋友圈" mine fetchPage={fetchPage} back="/me" />;
}

/** 动态详情页（social-l4.md 3.2）。 */
export function MomentDetailPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const actors = useActorName();
  const [post, setPost] = useState<MomentsPost | null>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void api
      .call(MomentsEndpoints.getPost, { params: { postId }, networkOnly: true })
      .then((p) => active && setPost(p))
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiFailure && e.status === 404) setPost(null);
        else setError(friendlyError(e));
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
    <main>
      <header className="page-header">
        <button className="text-button" onClick={() => navigate(-1)}>
          ‹ 返回
        </button>
        <h1>详情</h1>
        <span />
      </header>
      {post === null && <p className="empty">该动态已删除</p>}
      {error && !post && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={() => setRevision((v) => v + 1)}>重试</button>
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

/** 发朋友圈（moments.md 第 5 节、social-l4.md 3.4、3.5）。 */
export function ComposeMomentPage() {
  const navigate = useNavigate();
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
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.preview)), [images]);
  const nameOf = (id: string) =>
    contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    const valid = files.filter(
      (f) =>
        (MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(f.type) &&
        f.size <= MEDIA_LIMITS.imageMaxBytes,
    );
    if (valid.length < files.length) setError('只支持 10 MB 以内的 JPG、PNG、WebP、GIF 图片');
    setImages((prev) =>
      [...prev, ...valid.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, 9),
    );
  }
  async function publish() {
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
    <main>
      <header className="page-header">
        <button
          className="text-button"
          onClick={() => {
            if (!dirty || window.confirm('不保留此次编辑？')) navigate(-1);
          }}
        >
          取消
        </button>
        <h1>发朋友圈</h1>
        <button
          className="primary"
          disabled={pending || !dirty || (visibility === 'selected' && selected.length === 0)}
          onClick={() => void publish()}
        >
          {pending ? '发表中…' : '发表'}
        </button>
      </header>
      <label>
        这一刻的想法
        <textarea maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="image-picker">
        {images.map((image, index) => (
          <span key={image.preview} className="moment-image">
            <img src={image.preview} alt="" />
            <button
              className="member-remove"
              aria-label="移除图片"
              onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
        {images.length < 9 && (
          <label className="moment-image add-image">
            ＋
            <input
              type="file"
              accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
              multiple
              hidden
              onChange={pick}
            />
          </label>
        )}
      </div>
      <div className="panel stack">
        <h2 className="group-label">谁可以看</h2>
        <label className="check">
          <input
            type="radio"
            name="visibility"
            checked={visibility === 'all'}
            onChange={() => setVisibility('all')}
          />
          全部角色
        </label>
        <label className="check">
          <input
            type="radio"
            name="visibility"
            checked={visibility === 'selected'}
            onChange={() => {
              setVisibility('selected');
              setChoosing(true);
            }}
          />
          部分角色可见
        </label>
        {visibility === 'selected' && (
          <button className="text-button" onClick={() => setChoosing((v) => !v)}>
            {selected.length ? selected.map(nameOf).join('、') : '选择角色'} ›
          </button>
        )}
        {choosing && visibility === 'selected' && (
          <div className="rows">
            {contacts.map((c) => (
              <label key={c.characterId} className="role-row check-row">
                <input
                  type="checkbox"
                  checked={selected.includes(c.characterId)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, c.characterId]
                        : v.filter((id) => id !== c.characterId),
                    )
                  }
                />
                <CharacterAvatar id={c.characterId} size={40} />
                {nameOf(c.characterId)}
              </label>
            ))}
          </div>
        )}
        <small>看不到的角色不会点赞评论，也不会在聊天里提起这条动态</small>
      </div>
      {error && <p role="alert">{error}</p>}
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
    <main className="moments-page">
      <header className="page-header">
        <Link to="/moments">‹ 朋友圈</Link>
        <h1>消息</h1>
        <span />
      </header>
      {error && (
        <p role="alert">
          {error} <button onClick={load}>重试</button>
        </p>
      )}
      {items.length === 0 && cursor === null && <p className="empty">暂无消息</p>}
      <div className="panel rows">
        {items.map((n) => (
          <Link key={n.notificationId} className="role-row" to={`/moments/posts/${n.postId}`}>
            <ActorAvatar actor={n.actor} profile={actors.profile} />
            <span className="conversation-copy">
              <strong>{actors.name(n.actor)}</strong>
              <span>
                {n.kind === 'like' ? (
                  <Heart size={16} aria-label="赞" />
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
      </div>
      {cursor !== null && items.length > 0 && (
        <button className="text-button full" disabled={loading} onClick={load}>
          {loading ? '正在读取…' : '查看更多'}
        </button>
      )}
    </main>
  );
}
