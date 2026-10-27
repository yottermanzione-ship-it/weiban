import { useCharacterNames } from '../data/character-names.js';
import { useAuth } from '../app/auth.js';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  IdentityEndpoints,
  LibraryEndpoints,
  MediaEndpoints,
  type Favorite,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { CallRecordBubble, ImageBubble, LinkCardBubble, MediaImg, StickerBubble } from './media.js';
import { shareText } from './share-render.js';
import { Lightbox } from './lightbox.js';
import { EmptyState, NavBar } from './shell-kit.js';
import { showSnackbar, showToast } from './toast.js';

function FavoriteVoice({ mediaId, transcript }: { mediaId: string; transcript?: string | null }) {
  const media = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  return (
    <div>
      {media.data && <audio controls preload="none" src={media.data.url} />}
      {media.error && <p role="alert">{media.error}</p>}
      {transcript && <p>{transcript}</p>}
    </div>
  );
}
function FavoriteContent({ favorite }: { favorite: Favorite }) {
  const content = favorite.content;
  if (content.type === 'forwarded_record')
    return (
      <details className="favorite-record">
        <summary>
          {content.title} · {content.items.length} 条
        </summary>
        <div className="wx-forward-record">
          {content.items.map((item, i) => (
            <article key={i}>
              <header>
                <strong>{item.senderName}</strong>
                <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
              </header>
              {item.content.type === 'image' ? (
                <FavoriteImage
                  mediaId={item.content.mediaId}
                  width={item.content.width}
                  height={item.content.height}
                />
              ) : item.content.type === 'link' ? (
                <LinkCardBubble content={item.content} />
              ) : item.content.type === 'sticker' ? (
                <StickerBubble content={item.content} />
              ) : item.content.type === 'voice' ? (
                <FavoriteVoice
                  mediaId={item.content.mediaId}
                  transcript={item.content.transcript}
                />
              ) : (
                <p style={{ whiteSpace: 'pre-wrap' }}>{shareText(item.content)}</p>
              )}
            </article>
          ))}
        </div>
      </details>
    );
  if (content.type === 'call_record') return <CallRecordBubble content={content} />;
  if (content.type === 'image')
    return (
      <FavoriteImage mediaId={content.mediaId} width={content.width} height={content.height} />
    );
  if (content.type === 'sticker') return <StickerBubble content={content} />;
  if (content.type === 'link') return <LinkCardBubble content={content} />;
  if (content.type === 'voice')
    return <FavoriteVoice mediaId={content.mediaId} transcript={content.transcript} />;
  return (
    <div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shareText(content)}</p>
    </div>
  );
}
/** U5：点图片用全屏看图 Lightbox（原来是底部弹层）；同一条收藏里的多张图可左右切换。 */
function FavoriteImage({
  mediaId,
  width = null,
  height = null,
  gallery,
}: {
  mediaId: string;
  width?: number | null;
  height?: number | null;
  /** 同一条收藏里的全部图片（含自己），看图时可左右滑。 */
  gallery?: string[];
}) {
  const [open, setOpen] = useState(false);
  const list = gallery && gallery.includes(mediaId) ? gallery : [mediaId];
  return (
    <>
      <ImageBubble
        content={{ type: 'image', mediaId, width, height }}
        onOpen={() => setOpen(true)}
      />
      {open && (
        <Lightbox
          items={list.map((id, i) => ({ mediaId: id, key: id + ':' + i }))}
          index={list.indexOf(mediaId)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function FavoriteBody({ favorite }: { favorite: Favorite }) {
  return (
    <div className="favorite-content">
      <FavoriteContent favorite={favorite} />
      {favorite.extraImages.length > 0 && (
        <div className="favorite-extra-images">
          {favorite.extraImages.map((id, i) => (
            <FavoriteImage key={id + ':' + i} mediaId={id} gallery={favorite.extraImages} />
          ))}
        </div>
      )}
    </div>
  );
}
/** 收藏直接读取持久快照，原消息和好友删除不影响内容。 */
export function FavoritesPage() {
  const auth = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const remote = useRemote(LibraryEndpoints.listFavorites, { query: { limit: 20 } });
  const [extra, setExtra] = useState<Favorite[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  /** U2：取消收藏可撤销——先从列表藏起来，撤销条消失后才真正删除。 */
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (remote.data) {
      setExtra([]);
      setCursor(remote.data.nextCursor);
    }
  }, [remote.data]);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string }).section === 'favorites'
    )
      remote.refresh();
  });
  const items = [...(remote.data?.items ?? []), ...extra].filter(
    (f, i, all) =>
      all.findIndex((x) => x.favoriteId === f.favoriteId) === i && !hidden.includes(f.favoriteId),
  );
  const names = useCharacterNames(items.flatMap((f) => (f.characterId ? [f.characterId] : [])));
  async function more() {
    if (!cursor || pending) return;
    setPending(true);
    setError('');
    const owner = auth.session
      ? { userId: auth.session.user.userId, sessionId: auth.session.session.sessionId }
      : null;
    try {
      const page = await api.call(LibraryEndpoints.listFavorites, {
        query: { limit: 20, cursor },
        networkOnly: true,
      });
      if (!owner || !api.owns(owner)) return;
      setExtra((old) => [...old, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const unhide = (id: string) => setHidden((old) => old.filter((x) => x !== id));
  async function commitRemove(id: string) {
    try {
      await api.call(LibraryEndpoints.removeFavorite, { params: { favoriteId: id } });
      remote.refresh();
    } catch (e) {
      unhide(id);
      showToast(friendlyError(e), 2500, 'error');
    }
  }
  function remove(favorite: Favorite) {
    const id = favorite.favoriteId;
    setHidden((old) => [...old, id]);
    showSnackbar({
      text: '已取消收藏',
      onAction: () => unhide(id),
      onEnd: (reason) => {
        if (reason !== 'action') void commitRemove(id);
      },
    });
  }
  return (
    <main>
      <NavBar title="收藏" fallback="/me" />
      {items.map((f) => (
        <article className="favorite-card simple-favorite" key={f.favoriteId}>
          <div className="favorite-head">
            {f.characterAvatarMediaIdSnapshot ? (
              <span className="avatar" style={{ width: 32, height: 32 }}>
                <MediaImg mediaId={f.characterAvatarMediaIdSnapshot} />
              </span>
            ) : f.characterId ? (
              <CharacterAvatar id={f.characterId} size={32} />
            ) : (
              <UserAvatar profile={profile.data} size={32} />
            )}
            <span>
              {f.characterNameSnapshot || (f.characterId ? (names[f.characterId] ?? '角色') : '我')}
            </span>
            <time>{new Date(f.sourceCreatedAt).toLocaleString('zh-CN')}</time>
          </div>
          <FavoriteBody favorite={f} />
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => {
              setError('');
              remove(f);
            }}
          >
            取消收藏
          </button>
        </article>
      ))}
      {remote.loading && !remote.data && <p className="empty">正在读取收藏…</p>}
      {!remote.loading && items.length === 0 && !remote.error && (
        <EmptyState icon="wechat/star" title="还没有收藏" desc="在聊天里长按消息，选择「收藏」" />
      )}
      {(error || remote.error) && (
        <p role="alert" className="notice-bar">
          {error || remote.error}
        </p>
      )}
      {remote.error && (
        <button className="text-button full" type="button" onClick={remote.refresh}>
          重试
        </button>
      )}
      {cursor && (
        <button className="text-button full" disabled={pending} onClick={() => void more()}>
          {pending ? '正在读取…' : '加载更多'}
        </button>
      )}
    </main>
  );
}
export function FavoriteDetailPage() {
  return <Navigate to="/me/favorites" replace />;
}
