/*
 * F1-6 头像缓存：切页面时头像不再先闪一下文字占位。
 * - 媒体签名链接按 mediaId 记在内存里，未过期就直接复用同一个链接（浏览器缓存命中，立即画出）；
 * - 资料里自带的临时链接先用来画首屏，快过期时再补一个按有效期复用的正式链接；
 * - 已加载成功的链接记成「已加载」，重新挂载时直接显示，不再从透明淡入；
 * - 换新链接 / 新图时，新图加载完成前保留旧图；缓存按账号隔离，容量有上限。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { MediaEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/use-remote.js';

const urls = new Map<string, { url: string; expiresAt: number }>();
const loaded = new Set<string>();
/** 链接过期前留 30 秒余量，避免拿到马上失效的链接。 */
const MARGIN_MS = 30_000;
/** 资料里带的链接不知道有效期，只当首次显示的临时链接。 */
const HINT_MS = 60_000;
/** 两个内存缓存都有上限，长期使用不会无限增长。 */
const URL_LIMIT = 300;
const LOADED_LIMIT = 500;
let scope = '';

/** 换账号时清空：别的账号的签名链接和已加载状态不能拿来复用。 */
function ownScope(): void {
  const next = api.ownerKey();
  if (next === scope) return;
  scope = next;
  urls.clear();
  loaded.clear();
}

function markLoaded(url: string): void {
  loaded.add(url);
  if (loaded.size <= LOADED_LIMIT) return;
  const oldest = loaded.values().next();
  if (!oldest.done) loaded.delete(oldest.value);
}

function freshUrl(mediaId: string | null | undefined): string | undefined {
  if (!mediaId) return undefined;
  const hit = urls.get(mediaId);
  if (!hit) return undefined;
  if (hit.expiresAt - MARGIN_MS > Date.now()) return hit.url;
  urls.delete(mediaId);
  return undefined;
}

function remember(mediaId: string, url: string, expiresAt: number): void {
  urls.delete(mediaId);
  urls.set(mediaId, { url, expiresAt });
  if (urls.size <= URL_LIMIT) return;
  const oldest = urls.keys().next();
  if (!oldest.done) urls.delete(oldest.value);
}

/** 资料自带的链接只当临时链接：没取到正式链接前先显示，快过期时再补一个。 */
function rememberHint(mediaId: string, url: string): string | undefined {
  remember(mediaId, url, Date.now() + HINT_MS);
  return freshUrl(mediaId);
}

/**
 * 媒体的访问链接；未过期的链接直接复用，不重复请求。
 * hintUrl 是资料接口顺带给的链接：媒体链接还没取到时先用它显示，省一次往返。
 */
export function useMediaUrl(
  mediaId: string | null | undefined,
  hintUrl?: string,
): string | undefined {
  ownScope();
  const cached = freshUrl(mediaId);
  const hinted =
    !cached && mediaId && hintUrl && !urls.has(mediaId)
      ? rememberHint(mediaId, hintUrl)
      : undefined;
  const remote = useRemote(
    MediaEndpoints.getMedia,
    { params: { mediaId: mediaId ?? '' }, networkOnly: true },
    !!mediaId && !cached && !hinted,
  );
  const data = remote.data && remote.data.mediaId === mediaId ? remote.data : undefined;
  if (data && mediaId) {
    const expiresAt = Date.parse(data.urlExpiresAt);
    const entry = urls.get(mediaId);
    if (!entry || entry.url !== data.url)
      remember(mediaId, data.url, Number.isFinite(expiresAt) ? expiresAt : 0);
  }
  const valid =
    data && Date.parse(data.urlExpiresAt) - MARGIN_MS > Date.now() ? data.url : undefined;
  return cached ?? hinted ?? valid ?? (mediaId ? urls.get(mediaId)?.url : undefined);
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
  ownScope();
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
      markLoaded(url);
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
