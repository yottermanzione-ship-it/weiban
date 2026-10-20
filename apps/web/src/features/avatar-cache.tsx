/*
 * F1-6 头像缓存：切页面时头像不再先闪一下文字占位。
 * - 媒体签名链接按 mediaId 记在内存里，未过期就直接复用同一个链接（浏览器内存缓存命中，立即画出）；
 * - 已加载成功的链接记成「已加载」，重新挂载时直接显示，不再从透明淡入；
 * - 换新链接 / 新图时，新图加载完成前保留旧图。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { MediaEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';

const urls = new Map<string, { url: string; expiresAt: number }>();
const loaded = new Set<string>();
/** 链接过期前留 30 秒余量，避免拿到马上失效的链接。 */
const MARGIN_MS = 30_000;

function freshUrl(mediaId: string | null | undefined): string | undefined {
  if (!mediaId) return undefined;
  const hit = urls.get(mediaId);
  return hit && hit.expiresAt - MARGIN_MS > Date.now() ? hit.url : undefined;
}

/** 私有媒体（用户头像 / 自定义角色头像）的访问链接；未过期的链接直接复用，不重复请求。 */
export function useMediaUrl(mediaId: string | null | undefined): string | undefined {
  const cached = freshUrl(mediaId);
  const remote = useRemote(
    MediaEndpoints.getMedia,
    { params: { mediaId: mediaId ?? '' }, networkOnly: true },
    !!mediaId && !cached,
  );
  const data = remote.data && remote.data.mediaId === mediaId ? remote.data : undefined;
  if (data && mediaId) {
    const expiresAt = Date.parse(data.urlExpiresAt);
    if (!urls.has(mediaId) || urls.get(mediaId)!.url !== data.url)
      urls.set(mediaId, { url: data.url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 });
  }
  return cached ?? data?.url;
}

/** 已加载过的图直接显示；新图加载完成前保留上一张。url 为空时也保留上一张（等新链接）。 */
export function CachedPicture({
  url,
  className,
  fallback = null,
}: {
  url?: string;
  className?: string;
  /** 图片加载失败时显示（如昵称缩写）。 */
  fallback?: ReactNode;
}) {
  const [shown, setShown] = useState<string | undefined>(() =>
    url && loaded.has(url) ? url : undefined,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url || url === shown) return;
    if (loaded.has(url)) {
      setShown(url);
      setFailed(false);
      return;
    }
    let active = true;
    const probe = new Image();
    probe.onload = () => {
      loaded.add(url);
      if (active) {
        setShown(url);
        setFailed(false);
      }
    };
    probe.onerror = () => {
      if (active && !shown) setFailed(true);
    };
    probe.src = url;
    return () => {
      active = false;
    };
  }, [url, shown]);
  if (failed) return <>{fallback}</>;
  if (!shown) return null;
  return (
    <img
      className={className}
      src={shown}
      alt=""
      aria-hidden="true"
      onError={() => {
        loaded.delete(shown);
        setFailed(true);
      }}
    />
  );
}

/** 当前账号自己的头像 mediaId（资料还没读到时先用上次的，避免闪占位）。按账号区分。 */
const myAvatar = new Map<string, string | null>();
export function rememberMyAvatar(userId: string | undefined, mediaId: string | null | undefined) {
  if (userId && mediaId !== undefined) myAvatar.set(userId, mediaId);
}
export function recallMyAvatar(userId: string | undefined): string | null | undefined {
  return userId ? myAvatar.get(userId) : undefined;
}
