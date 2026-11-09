import { useEffect, useRef, useState } from 'react';
import { LegacyFavoritesEndpoints, MediaEndpoints, type LegacyFavorite } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import {
  retryLegacyFavoritesTransfer,
  useLegacyFavoritesTransfer,
} from '../data/legacy-favorites-transfer.js';
import { ImageBubble } from './media.js';
import { Lightbox } from './lightbox.js';
import { showToast } from './toast.js';
import './legacy-favorites.css';

export function legacyFavoriteMediaNotice(issue: LegacyFavorite['mediaIssue']): string {
  const notices = {
    remote_reference: '这条附件等待旧站媒体迁移，原收藏快照已保留。',
    file_missing: '旧设备未找到原附件，收藏快照已保留。',
    media_unavailable: '附件暂不可读取，原收藏快照已保留。',
    path_rejected: '该附件暂无法安全读取，原文件和快照仍保留。',
    unsupported_media: '此附件格式暂不支持迁入，原文件和快照仍保留。',
    media_too_large: '该附件超过本机读取限制，原文件和快照仍保留。',
    item_ambiguous: '这条收藏的附件来源需核实，原数据仍保留。',
    upload_limit_exceeded: '该附件超过当前上传大小或语音时长限制，原文件和快照仍保留。',
  };
  return notices[issue ?? 'media_unavailable'];
}

function LegacyVoice({ mediaId }: { mediaId: string }) {
  const remote = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  return (
    <div>
      {remote.data && <audio controls preload="none" src={remote.data.url} />}
      {remote.error && <p role="alert">附件暂未读取，请重试</p>}
    </div>
  );
}

/** Render the safe server projection only; source paths/URLs never become browser media URLs. */
export function LegacyFavoriteBody({ favorite }: { favorite: LegacyFavorite }) {
  const [imageOpen, setImageOpen] = useState(false);
  const image =
    favorite.mediaStatus === 'ready' && favorite.media?.kind === 'image' ? favorite.media : null;
  const voice =
    favorite.mediaStatus === 'ready' && favorite.media?.kind === 'voice' ? favorite.media : null;
  return (
    <div className="favorite-content">
      {(favorite.message.quotedAuthor || favorite.message.quotedContent) && (
        <blockquote className="legacy-favorite-quote">
          {favorite.message.quotedAuthor && <strong>{favorite.message.quotedAuthor}</strong>}
          {favorite.message.quotedContent && (
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {favorite.message.quotedContent}
            </p>
          )}
        </blockquote>
      )}
      {favorite.message.content && (
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {favorite.message.content}
        </p>
      )}
      {image && (
        <ImageBubble
          content={{ type: 'image', mediaId: image.mediaId, width: null, height: null }}
          onOpen={() => setImageOpen(true)}
        />
      )}
      {image && imageOpen && (
        <Lightbox
          items={[{ mediaId: image.mediaId, key: image.mediaId }]}
          index={0}
          onClose={() => setImageOpen(false)}
        />
      )}
      {voice && <LegacyVoice mediaId={voice.mediaId} />}
      {favorite.mediaStatus === 'unavailable' && (
        <p className="notice-bar">{legacyFavoriteMediaNotice(favorite.mediaIssue)}</p>
      )}
      {!favorite.message.content && !image && !voice && favorite.mediaStatus !== 'unavailable' && (
        <p>这条旧收藏的消息快照已保留。</p>
      )}
    </div>
  );
}

export function LegacyFavoritesSection() {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  const ownerKey = owner ? `${owner.userId}:${owner.sessionId}` : null;
  const transfer = useLegacyFavoritesTransfer();
  const status = transfer.owner === ownerKey ? transfer : null;
  const remote = useRemote(
    LegacyFavoritesEndpoints.list,
    { query: { limit: 20 }, networkOnly: true },
    !!owner,
  );
  const refreshLegacy = remote.refresh;
  const [extra, setExtra] = useState<LegacyFavorite[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    return () => {
      mounted.current = false;
      for (const request of active) request.abort();
      active.clear();
    };
  }, []);
  useEffect(() => {
    if (remote.data) {
      setExtra([]);
      setCursor(remote.data.nextCursor);
    }
  }, [remote.data]);
  useEffect(() => {
    const refresh = () => refreshLegacy();
    window.addEventListener('weiban:legacy-favorites-updated', refresh);
    return () => window.removeEventListener('weiban:legacy-favorites-updated', refresh);
  }, [refreshLegacy]);
  const items = [...(remote.data?.items ?? []), ...extra].filter(
    (item, index, all) =>
      !hidden.includes(item.favoriteId) &&
      all.findIndex((other) => other.favoriteId === item.favoriteId) === index,
  );
  const live = () => mounted.current && !!owner && api.owns(owner);
  async function more() {
    if (!cursor || pending || !live()) return;
    const controller = new AbortController();
    requests.current.add(controller);
    setPending(true);
    setError('');
    try {
      const page = await api.call(LegacyFavoritesEndpoints.list, {
        query: { limit: 20, cursor },
        networkOnly: true,
        signal: controller.signal,
      });
      if (!live()) return;
      setExtra((old) => [...old, ...page.items]);
      setCursor(page.nextCursor);
    } catch (failure) {
      if (live() && !controller.signal.aborted) setError(friendlyError(failure));
    } finally {
      requests.current.delete(controller);
      if (live()) setPending(false);
    }
  }
  async function remove(id: string) {
    if (pending || !live()) return;
    const controller = new AbortController();
    requests.current.add(controller);
    setPending(true);
    setError('');
    try {
      await api.call(LegacyFavoritesEndpoints.remove, {
        params: { favoriteId: id },
        networkOnly: true,
        signal: controller.signal,
      });
      if (!live()) return;
      setHidden((old) => [...old, id]);
      showToast('已取消旧版收藏', 2000, 'success');
    } catch (failure) {
      if (live() && !controller.signal.aborted) setError(friendlyError(failure));
    } finally {
      requests.current.delete(controller);
      if (live()) setPending(false);
    }
  }
  const importing = status?.phase === 'checking' || status?.phase === 'importing';
  return (
    <section className="legacy-favorites" aria-labelledby="legacy-favorites-title">
      <h2 id="legacy-favorites-title" className="section-title">
        旧版收藏
      </h2>
      <p className="legacy-favorites-intro">这里保留从旧版微伴迁入的消息收藏。</p>
      {importing && (
        <p role="status" className="notice-bar">
          {status.phase === 'checking'
            ? '正在核对本机旧收藏…'
            : `正在保存旧收藏 ${status.processed} / ${status.total}…`}
        </p>
      )}
      {status?.phase === 'failed' && (
        <div className="notice-bar" role="alert">
          <p>{status.error}</p>
          {status.retryable && (
            <button type="button" className="text-button" onClick={retryLegacyFavoritesTransfer}>
              重试保存旧收藏
            </button>
          )}
        </div>
      )}
      {status?.phase === 'unavailable' && (
        <p className="notice-bar">
          暂未确认可迁入的旧收藏来源，原数据仍保留。
          <button type="button" className="text-button" onClick={retryLegacyFavoritesTransfer}>
            重新检查
          </button>
        </p>
      )}
      {status?.phase === 'complete' && status.total > 0 && (
        <p role="status" className="notice-bar">
          {status.unavailableMedia > 0
            ? `旧收藏快照已保存，其中 ${status.unavailableMedia} 条附件暂不可读取；原数据仍保留。`
            : '旧收藏已保存，旧设备中的原始数据仍保留。'}
        </p>
      )}
      {status?.unscopedPresent && (
        <p className="notice-bar">
          另有未确认账号归属的旧收藏仍保留在本机，请联系支持核实后再迁入。
        </p>
      )}
      {status?.phase === 'incomplete' && (
        <div className="notice-bar" role="status">
          <p>
            旧收藏快照已保存，另有 {status.unavailableMedia}{' '}
            条附件尚未完成；原文件仍保留。可查看每条收藏下的具体提示。
          </p>
          <button type="button" className="text-button" onClick={retryLegacyFavoritesTransfer}>
            重试未完成的附件
          </button>
        </div>
      )}
      {items.map((favorite) => (
        <article className="favorite-card simple-favorite" key={favorite.favoriteId}>
          <div className="legacy-favorite-head">
            <strong>{favorite.chatTitle || '旧版会话'}</strong>
            <time dateTime={favorite.savedAt}>
              收藏于 {new Date(favorite.savedAt).toLocaleString('zh-CN')}
            </time>
          </div>
          <p className="legacy-favorite-author">
            {favorite.message.author || (favorite.message.isMine ? '我' : '旧版消息')}
          </p>
          <LegacyFavoriteBody favorite={favorite} />
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => void remove(favorite.favoriteId)}
          >
            取消旧版收藏
          </button>
        </article>
      ))}
      {remote.loading && !remote.data && <p className="empty">正在读取旧版收藏…</p>}
      {!remote.loading && !remote.error && items.length === 0 && !importing && (
        <p className="empty">暂无已迁入的旧版收藏。</p>
      )}
      {(error || remote.error) && (
        <p role="alert" className="notice-bar">
          {error || remote.error}
        </p>
      )}
      {remote.error && (
        <button type="button" className="text-button full" onClick={remote.refresh}>
          重试读取旧版收藏
        </button>
      )}
      {cursor && (
        <button
          type="button"
          className="text-button full"
          disabled={pending}
          onClick={() => void more()}
        >
          {pending ? '正在读取…' : '加载更多旧版收藏'}
        </button>
      )}
    </section>
  );
}
