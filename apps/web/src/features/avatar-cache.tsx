/*
 * F1-6 头像 / 图片缓存（2026-10-25 重做：快速上下滑动时会话列表 / 聊天里的头像和图片又闪一下）。
 *
 * 为什么以前拦住不：媒体的下载响应头是 `Cache-Control: private, no-store`
 * （删图后旧链接必须立刻失效，属安全设计），浏览器根本不缓存图片字节。
 * 虚拟列表快速滑动会把刚滚过的行卸载掉，行再挂回来是一个新的 <img>，必然重新下载 + 重新解码；
 * 链接缓存和「已加载过的 URL」只能省掉一次 JSON 请求，省不掉图片本身，所以还是会闪。
 *
 * 现在按 mediaId 记四样东西（都按账号隔离、都有上限、只在换账号 / 401 时整体清空）：
 * 1. 签名链接：有效期内稳定复用同一个 URL，资料刷新给了新签名也不换 src；
 * 2. 图片字节：画成功一次就把字节存成本地 object URL，重挂载第一帧直接从内存出图，不再请求网络；
 * 3. 已画状态：按 mediaId 记（不是按 URL），链接换了也不丢「已经显示过」的状态；
 * 4. 角色上次用的头像 mediaId：资料还没读到时也能先把图挂上，不先退回文字占位。
 *
 * 2026-10-25 第二轮（快速滚动复测）：
 * - 重挂载时「已有同一 mediaKey 的 blob」优先，绝不再探测 / 下载；以前 effect 会把 blob src
 *   改回网络 URL（paintedSource 命中或 probe new Image），每次重挂载又下一次。
 * - mediaKey / 账号（ownerKey）在同一个组件实例里变化时，state 与在途结果一起作废，不会显示
 *   上一个 mediaKey / 上一个账号的图。
 * - 资料顺带来的 hint 链接过期后不再延长期限：失效就走正式 getMedia；图片报错可以真刷新。
 * - 第一次出现的图（eager + 可缓存）用一次 fetch 换 blob，避免「<img> 一次 + 缓存再一次」。
 * - 原图缺少 mimeType 时先取元信息，不把旧版 MP4 当图片画。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MediaEndpoints, type MediaObject } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/use-remote.js';

/** 媒体链接是服务器签的 5 分钟；快过期时留 30 秒余量，避免把马上失效的链接交给页面。 */
const MARGIN_MS = 30_000;
/** 资料接口顺带给的头像链接也是 5 分钟签名，按 4 分钟用：不再每 30~60 秒换一次 src。 */
const HINT_TTL_MS = 4 * 60_000;
/** 缓存上限：刷得再久也不会无限涨，同时远大于一屏会话 / 聊天的图片数量，不会互相挤掉。 */
const LINK_LIMIT = 2000;
const LOADED_LIMIT = 5000;
const BLOB_LIMIT = 800;
const BLOB_BYTES = 24 * 1024 * 1024;
/** 单张超过 2 MB 的图不留在内存里（大图交给浏览器，别把内存吃光）。 */
const BLOB_ITEM_BYTES = 2 * 1024 * 1024;
/** 角色 → 上次用过的头像 mediaId。 */
const PICTURE_LIMIT = 4000;
/** 同时最多几个字节请求：快速滑一整屏时不要把连接池占满。 */
const MAX_TRANSFERS = 4;
/** 并发满了以后排队等槽的图片数；只是“等缓存”，不是用户还能看到的行，够用且有界。 */
const PENDING_BYTES_LIMIT = 64;
/** 记已经确认太大的链接，避免同一张大图每次挂载都白下 2 MB。 */
const TOO_BIG_LIMIT = 200;

export type MediaLink = {
  url: string;
  thumbnailUrl?: string | null;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  expiresAt: number;
  /** 资料接口顺带给的临时链接：没有正式链接时先用它显示。 */
  hint?: boolean;
};

const links = new Map<string, MediaLink>();
/** 已经确认失效的 hint 签名：同一个 URL 不再拿来「续命」，必须走正式 getMedia。 */
const deadHints = new Map<string, string>();
/** 被「重新加载」判死的签名：强制回源期间旧数据先接着画，但新签名一到必须能替换。 */
const staleLinks = new Map<string, string>();
/** 图片缓存键 → 上次画成功用的链接（按 mediaId 记，不按 URL）。 */
const painted = new Map<string, string>();
/** 图片缓存键 → 本地 object URL（字节缓存在内存里）。 */
const blobs = new Map<string, { url: string; bytes: number }>();
/** 角色 ID → 头像 mediaId。 */
const avatarOf = new Map<string, string>();
/** 图片缓存键 → 正在进行的字节请求。 */
const inFlight = new Map<string, Promise<string | undefined>>();
/** 图片缓存键 → 可撤销的字节请求。 */
const transfers = new Map<string, AbortController>();
/**
 * 并发满了时的等待队列（缓存键 → 链接）。
 * 关键：以前这里满了就直接丢掉，被丢掉的那张图永远没有 blob，重挂载又走 <img> 下载。
 */
const pendingBytes = new Map<string, string>();
/** 已经确认超过 2 MB 的链接。 */
const tooBig = new Map<string, true>();
let blobBytes = 0;
let scope = '';
/** 换账号时 +1：在途的字节缓存回来发现代号变了，就不许写进新账号的缓存。 */
let generation = 0;

/** 换账号（含 401 退出）时清空：别的账号的签名链接、图片字节和已画状态都不能复用。 */
export function ensureScope(): void {
  const next = api.ownerKey();
  if (next === scope) return;
  scope = next;
  generation += 1;
  for (const controller of transfers.values()) controller.abort();
  transfers.clear();
  inFlight.clear();
  pendingBytes.clear();
  links.clear();
  deadHints.clear();
  staleLinks.clear();
  painted.clear();
  avatarOf.clear();
  tooBig.clear();
  for (const entry of blobs.values()) URL.revokeObjectURL(entry.url);
  blobs.clear();
  blobBytes = 0;
}

/** 简单 LRU：取用时挪到队尾，超上限时从头淘汰。 */
function touch<K, V>(map: Map<K, V>, key: K): V | undefined {
  const hit = map.get(key);
  if (hit === undefined) return undefined;
  map.delete(key);
  map.set(key, hit);
  return hit;
}
function trim<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

// ---------- 链接 ----------

function freshLink(mediaId: string): MediaLink | undefined {
  const hit = touch(links, mediaId);
  if (!hit) return undefined;
  return hit.expiresAt - MARGIN_MS > Date.now() ? hit : undefined;
}

function fromMedia(media: MediaObject): MediaLink {
  const expiresAt = Date.parse(media.urlExpiresAt);
  return {
    url: media.url,
    thumbnailUrl: media.thumbnailUrl ?? null,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs ?? null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + HINT_TTL_MS,
  };
}

/** 把正式链接里的元信息补到已显示的链路上：URL 不换，避免换签名导致重新下载。 */
function copyMeta(target: MediaLink, source: MediaLink): void {
  if (source.mimeType) target.mimeType = source.mimeType;
  if (source.width != null) target.width = source.width;
  if (source.height != null) target.height = source.height;
  if (source.durationMs != null) target.durationMs = source.durationMs;
  if (!target.thumbnailUrl && source.thumbnailUrl) target.thumbnailUrl = source.thumbnailUrl;
}

/**
 * 记一条链接。有效期内的链接一律不换：服务器重新签名会让 URL 变，而 URL 一变
 * 浏览器就得重新下载（no-store），正好是要修的那个「闪一下」。
 * 只有「同一 URL」才延长有效期；hint 换正式链接时不换 URL，只补元信息。
 * 例外：上次图片报错 / 主动刷新（staleLinks 里记着这份死签名）时，新签名必须能替换它。
 */
function rememberLink(mediaId: string, next: MediaLink): void {
  const existing = links.get(mediaId);
  if (existing && existing.expiresAt - MARGIN_MS > Date.now()) {
    if (existing.url === next.url) {
      existing.expiresAt = Math.max(existing.expiresAt, next.expiresAt);
      copyMeta(existing, next);
      return;
    }
    if (staleLinks.get(mediaId) === existing.url) {
      // 强制回源拿到新签名：换掉刚判死的链接（旧数据在回源期间会被 useRemote 先画出来，
      // 但不能因为它还「有效」就把新签名丢掉）。
      links.delete(mediaId);
      links.set(mediaId, next);
      staleLinks.delete(mediaId);
      return;
    }
    if (existing.hint && !next.hint) {
      // 资料给的 hint 已经画出来了：继续用这个 URL，只把 mimeType 等元信息补上。
      copyMeta(existing, next);
      return;
    }
    // 换了签名的链接等它过期再换，别在有效期里制造一闪。
    return;
  }
  links.delete(mediaId);
  links.set(mediaId, next);
  staleLinks.delete(mediaId);
  trim(links, LINK_LIMIT);
}

/**
 * 资料里带的链接先用上，但绝不覆盖还有效的**正式**链接。
 * - 同一个 hint URL 过期后不再延长 expiresAt（旧实现会把失效签名反复续命）。
 * - 资料重新给了另一个 hint 签名（冷启动先画 IndexedDB 里的旧资料，随后网络资料到达）：
 *   换掉旧 hint，不能让它继续占 4 分钟；已有 blob 时换 URL 也不会重新下载。
 * - 正式链接始终优先；过期就返回 undefined，让 useMediaLink 走正式 getMedia。
 */
function adoptHint(mediaId: string, hintUrl: string): MediaLink | undefined {
  const existing = links.get(mediaId);
  if (existing && existing.expiresAt - MARGIN_MS > Date.now()) {
    if (existing.url === hintUrl) return existing;
    if (existing.hint) {
      existing.url = hintUrl;
      existing.expiresAt = Date.now() + HINT_TTL_MS;
    }
    return existing;
  }
  if (existing) {
    if (existing.hint) {
      // 这份签名已经超过我们按 4 分钟估的有效期：记死，别下一次又从 hint 重新起算。
      deadHints.set(mediaId, existing.url);
      trim(deadHints, LINK_LIMIT);
      if (existing.url === hintUrl) return undefined;
    } else {
      // 正式链接过期了：正式链接比 hint 权威，等 getMedia，不要降级成 hint。
      return undefined;
    }
  }
  if (deadHints.get(mediaId) === hintUrl) return undefined;
  const hint: MediaLink = { url: hintUrl, expiresAt: Date.now() + HINT_TTL_MS, hint: true };
  rememberLink(mediaId, hint);
  return links.get(mediaId);
}

/**
 * 把当前链接标记成「已判死」：强制回源期间仍接着画它（不空白），
 * 新签名一到就可以替换（见 rememberLink 的 staleLinks 分支）。
 */
function markStale(mediaId: string): void {
  const existing = links.get(mediaId);
  if (!existing) return;
  if (existing.hint) deadHints.set(mediaId, existing.url);
  staleLinks.set(mediaId, existing.url);
  trim(staleLinks, LINK_LIMIT);
}

export type MediaLinkResult = {
  link: MediaLink | undefined;
  error: boolean;
  /** 链接取不到（过期 / 失败）时重新请求一次；即使当前 hook 是 enabled=false 也强制回源。 */
  reload(): void;
};

/**
 * 媒体的访问链接；有效期内的链接直接复用，不重复请求。
 * hintUrl 是资料接口顺带给的链接：正式链接还没取到时先用它显示，省一次往返。
 * needMetadata：原图（可能是旧版 MP4）没有 mimeType 时，先向服务器取元信息。
 */
export function useMediaLink(
  mediaId: string | null | undefined,
  hintUrl?: string,
  options: { networkOnly?: boolean; needMetadata?: boolean } = {},
): MediaLinkResult {
  ensureScope();
  /** 强制刷新计数：broken 图点「重新加载」时即使有可用链接也要真的回源一次。 */
  const [nonce, setNonce] = useState(0);
  const known = mediaId ? freshLink(mediaId) : undefined;
  // 即使已经有 hint 也要把资料最新给的 hint 交给 adoptHint：冷启动的旧资料 hint 会被新资料替换。
  const hinted = mediaId && hintUrl ? adoptHint(mediaId, hintUrl) : undefined;
  const current = mediaId ? (hinted ?? known ?? links.get(mediaId)) : undefined;
  // 原图还缺 mimeType：先取元信息再决定画 <img> 还是 <video>，别把旧版 MP4 当图片。
  const wantMetadata = Boolean(options.needMetadata && mediaId && current && !current.mimeType);
  const enabled = Boolean(mediaId) && (nonce > 0 || wantMetadata || (!known && !hinted));
  const remote = useRemote(
    MediaEndpoints.getMedia,
    { params: { mediaId: mediaId ?? '' }, networkOnly: options.networkOnly ?? true },
    // 已经有能用的链接（含资料顺带给的）就不再问服务器要新链接。
    enabled,
  );
  const data = remote.data && remote.data.mediaId === mediaId ? remote.data : undefined;
  if (data && mediaId) rememberLink(mediaId, fromMedia(data));
  // 过期的链接也返回：先接着画上次那张，正式链接到了再换，不先空白一帧。
  const link = mediaId ? (freshLink(mediaId) ?? hinted ?? links.get(mediaId)) : undefined;
  const reload = () => {
    if (mediaId) markStale(mediaId);
    // useRemote 在 enabled=false 时不会请求：这里同时拉高 nonce 让它真的回源一次。
    setNonce((value) => value + 1);
    remote.refresh();
  };
  return { link, error: Boolean(remote.error), reload };
}

/** 只需要 URL 的旧入口（聊天背景等）；链接本身走同一套按 mediaId 的缓存。 */
export function useMediaUrl(
  mediaId: string | null | undefined,
  hintUrl?: string,
): string | undefined {
  return useMediaLink(mediaId, hintUrl).link?.url;
}

// ---------- 图片字节 ----------

/** 某个 mediaId（+ 尺寸变体）已经缓存的本地图片地址。 */
export function pictureSource(key: string): string | undefined {
  return touch(blobs, key)?.url;
}

/** 某个 mediaId（+ 尺寸变体）上次画成功用的链接。 */
export function paintedSource(key: string): string | undefined {
  return touch(painted, key);
}

export function markPainted(key: string, url: string): void {
  painted.delete(key);
  painted.set(key, url);
  trim(painted, LOADED_LIMIT);
}

function forgetBytes(key: string): void {
  const hit = blobs.get(key);
  if (!hit) return;
  blobs.delete(key);
  blobBytes -= hit.bytes;
  URL.revokeObjectURL(hit.url);
}

/** 带上限地存一张图；被淘汰 / 覆盖的 object URL 立刻回收。 */
function storeBytes(key: string, blob: Blob): void {
  forgetBytes(key);
  blobs.set(key, { url: URL.createObjectURL(blob), bytes: blob.size });
  blobBytes += blob.size;
  while (blobs.size > BLOB_LIMIT || (blobBytes > BLOB_BYTES && blobs.size > 1)) {
    const oldest = blobs.keys().next();
    if (oldest.done) break;
    forgetBytes(oldest.value);
  }
}

function rememberTooBig(url: string): void {
  tooBig.set(url, true);
  trim(tooBig, TOO_BIG_LIMIT);
}

/**
 * 真正发一次字节请求（并发槽由 loadBytes / enqueueBytes 控制）。
 * 换账号后返回的在途结果直接丢弃；超过 2 MB 的不留在内存里，交给 <img> 走网络。
 * 关键：重挂载时先查 blobs，命中就直接返回，绝不会再请求网络。
 */
function startTransfer(key: string, url: string): Promise<string | undefined> {
  const owner = scope;
  const startedAt = generation;
  const controller = new AbortController();
  const job = fetch(url, { credentials: 'omit', signal: controller.signal })
    .then((response) => {
      if (!response.ok) return undefined;
      const length = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(length) && length > BLOB_ITEM_BYTES) {
        rememberTooBig(url);
        controller.abort();
        return undefined;
      }
      return response.blob();
    })
    .then((blob) => {
      if (!blob || blob.size === 0) return undefined;
      if (blob.size > BLOB_ITEM_BYTES) {
        rememberTooBig(url);
        return undefined;
      }
      if (startedAt !== generation || owner !== scope) return undefined;
      storeBytes(key, blob);
      return blobs.get(key)?.url;
    })
    .catch(() => undefined)
    .finally(() => {
      // 换账号时 ensureScope 已经清过 map；这里只在仍是同一账号时收尾，别误删新账号的请求。
      if (startedAt === generation && owner === scope) {
        inFlight.delete(key);
        transfers.delete(key);
      }
      // 槽位空出来，接着缓存排队中的图。
      drainPending();
    });
  inFlight.set(key, job);
  transfers.set(key, controller);
  return job;
}

/**
 * 并发满了的时候排队等槽，而不是直接丢掉。
 * 之前 loadBytes 在 inFlight.size >= 4 时 return undefined，且 cacheBytes 不重试：
 * 被丢的那张图永远没有 blob；快速滚动重挂载时只能再走 <img> 下载一次（真机 8~19 次重复请求）。
 */
function enqueueBytes(key: string, url: string): void {
  if (blobs.has(key) || tooBig.has(url) || inFlight.has(key) || pendingBytes.has(key)) return;
  pendingBytes.set(key, url);
  while (pendingBytes.size > PENDING_BYTES_LIMIT) {
    const oldest = pendingBytes.keys().next();
    if (oldest.done) break;
    pendingBytes.delete(oldest.value);
  }
  drainPending();
}

/** 槽位空出来后按排队顺序继续发；同一个 mediaKey 不会重复。 */
function drainPending(): void {
  if (typeof fetch !== 'function') return;
  while (inFlight.size < MAX_TRANSFERS && pendingBytes.size > 0) {
    const next = pendingBytes.entries().next();
    if (next.done) return;
    const [key, url] = next.value;
    pendingBytes.delete(key);
    if (blobs.has(key) || tooBig.has(url) || inFlight.has(key)) continue;
    void startTransfer(key, url);
  }
}

/**
 * 前台要图：能立刻发就发；并发满时马上返回 undefined（调用方先退回 <img> 出图），
 * 同时把字节缓存排进队列，稍后一定要补上 —— 否则下次重挂载又会下载。
 */
function loadBytes(key: string, url: string): Promise<string | undefined> {
  const cached = blobs.get(key);
  if (cached) return Promise.resolve(cached.url);
  if (tooBig.has(url)) return Promise.resolve(undefined);
  const running = inFlight.get(key);
  if (running) return running;
  if (typeof fetch !== 'function') return Promise.resolve(undefined);
  if (inFlight.size >= MAX_TRANSFERS) {
    enqueueBytes(key, url);
    return Promise.resolve(undefined);
  }
  return startTransfer(key, url);
}

/**
 * 画成功之后把字节存进内存：下次重挂载（快速滑动最常见）直接用本地地址出图。
 * 懒加载的图（缩略图）第一次仍会走 <img>，这里补一次字节缓存；重挂载就只读内存。
 * 以前并发满时这里直接放弃，懒加载组图在快速滚动里会被反复下载；现在排队补齐。
 */
function cacheBytes(key: string, url: string): void {
  enqueueBytes(key, url);
}

/** 图片加载失败时清掉缓存：下次重试走网络，不会一直拿坏掉的地址。 */
export function forgetPicture(key: string): void {
  painted.delete(key);
  forgetBytes(key);
}

// ---------- 图片组件 ----------

type PictureState = { src: string | undefined; loaded: boolean; failed: boolean };

/**
 * 首帧状态：
 * 1. 同一 mediaKey 已有 blob → 直接用，绝不再探测 / 下载（重挂载 0 请求）；
 * 2. 上次画成功的就是当前链接 → 先用它，不白屏；
 * 3. 第一次出现且可缓存 + eager → 留空等一次 fetch 换 blob（只有一次网络请求）；
 * 4. 其余情况直接上链接（懒加载缩略图 / 大图查看器）。
 */
function initialPicture(
  mediaKey: string,
  url: string | undefined,
  cache: boolean,
  eager: boolean,
): PictureState {
  const local = cache ? pictureSource(mediaKey) : undefined;
  if (local) return { src: local, loaded: true, failed: false };
  const remembered = paintedSource(mediaKey);
  if (!url) return { src: remembered, loaded: Boolean(remembered), failed: false };
  if (remembered === url) return { src: url, loaded: true, failed: false };
  if (cache && eager) return { src: undefined, loaded: false, failed: false };
  return { src: url, loaded: false, failed: false };
}

/**
 * 一张按 mediaId 缓存的图片。
 * - 首帧就有 src：内存里画过就直接给本地地址，否则给当前链接，绝不再先探测、空白一帧；
 * - 已有 blob 时链接变化 / 重挂载都不换 src，也不探测网络（以前这里会把 blob 改回网络）；
 * - mediaKey 或账号变化时 state 整体重置，不显示上一个 mediaKey / 账号的图或链接结果；
 * - 链接变了（旧链接过期）才探测新链接，加载完成前保留正在显示的旧图；
 * - 尺寸固定，不会因为图片晚到把行撑开。
 */
export function CachedImage({
  mediaKey,
  url,
  className,
  alt = '',
  width,
  height,
  eager = true,
  fade = false,
  cache = true,
  fallback = null,
  onBroken,
  onLinkBroken,
}: {
  mediaKey: string;
  url?: string;
  className?: string;
  alt?: string;
  width?: number;
  height?: number;
  /** 已加载过的图要 eager，不能等进了视口再请求。 */
  eager?: boolean;
  /** 第一次出现的图用淡入（聊天图片）；已画过的不淡入。 */
  fade?: boolean;
  /** 是否把字节留在内存里（大图查看器传 false）。 */
  cache?: boolean;
  fallback?: ReactNode;
  onBroken?(): void;
  /** 网络链接（hint / 旧签名）加载失败：交给上层回源正式 getMedia。 */
  onLinkBroken?(): void;
}) {
  ensureScope();
  const owner = api.ownerKey();
  // 同一个组件实例里 mediaKey / 账号变了：state 必须整体重置（不能等卸载）。
  const identity = `${owner}|${mediaKey}`;
  const [identityState, setIdentityState] = useState(identity);
  const [state, setState] = useState<PictureState>(() =>
    initialPicture(mediaKey, url, cache, eager),
  );
  if (identityState !== identity) {
    setIdentityState(identity);
    setState(initialPicture(mediaKey, url, cache, eager));
  }
  // 首帧之后才到的新链接：先探测，确认能显示再换，避免把正在显示的图清空。
  useEffect(() => {
    if (!url) return;
    const local = cache ? pictureSource(mediaKey) : undefined;
    if (local) {
      // 内存里已经有这张图：保持 blob，不做任何网络探测（重挂载的关键路径）。
      if (state.src !== local) setState({ src: local, loaded: true, failed: false });
      return;
    }
    if (state.src === url) return;
    if (paintedSource(mediaKey) === url) {
      setState({ src: url, loaded: true, failed: false });
      return;
    }
    if (!state.src) {
      if (cache && eager) {
        // 第一次出现：一次 fetch 拿字节，成功直接出 blob（只有一次网络下载）。
        let live = true;
        void loadBytes(mediaKey, url).then((src) => {
          if (!live || api.ownerKey() !== owner) return;
          if (src) setState({ src, loaded: true, failed: false });
          else setState({ src: url, loaded: false, failed: false });
        });
        return () => {
          live = false;
        };
      }
      // 还没有画面（首次解析）：直接上，不必先探测一次再下载一次。
      setState({ src: url, loaded: false, failed: false });
      return;
    }
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      markPainted(mediaKey, url);
      if (cache) cacheBytes(mediaKey, url);
      if (live) setState({ src: url, loaded: true, failed: false });
    };
    probe.onerror = () => {
      if (!live) return;
      // 新链接不能显示：保留还在显示的那张（如果有），同时让上层回源正式链接。
      setState((previous) => (previous.src ? previous : { ...previous, failed: true }));
      onLinkBroken?.();
    };
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url, state.src, mediaKey, cache, eager, owner]);
  if (state.failed) return <>{fallback}</>;
  if (!state.src) return null;
  const classes = [className, fade && state.loaded ? 'loaded' : ''].filter(Boolean).join(' ');
  return (
    <img
      className={classes || undefined}
      src={state.src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={width}
      height={height}
      // 已经画过的图（本轮或之前）不再 lazy：等进了视口才请求就又空白一帧。
      loading={eager || state.loaded ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={() => {
        if (url) {
          markPainted(mediaKey, url);
          // blob 已经在内存里时 cacheBytes 会直接返回；懒加载的图在这里补一次字节缓存。
          if (cache) cacheBytes(mediaKey, url);
        }
        setState((previous) => (previous.loaded ? previous : { ...previous, loaded: true }));
      }}
      onError={() => {
        if (state.src?.startsWith('blob:')) {
          // 内存里的地址被回收了：清掉缓存，退回网络链接再试一次。
          forgetBytes(mediaKey);
          if (url) {
            setState({ src: url, loaded: false, failed: false });
            return;
          }
        }
        // 换到新链接后，旧 <img> 的报错才晚到：不能把新链接也一起判死。
        if (url && state.src && state.src !== url) return;
        forgetPicture(mediaKey);
        setState((previous) => ({ ...previous, failed: true }));
        onBroken?.();
        onLinkBroken?.();
      }}
    />
  );
}

/**
 * 头像 / 聊天图片共用的「按 mediaId 记住链接 + 字节」图片组件（头像入口）。
 * 链接与“图片加载失败 → 回源正式 getMedia”都在这里闭环：冷启动先画的旧资料 hint
 * 失效时，不需要用户刷新就能自己恢复；每个失败 URL 只补一次，避免无意义重试。
 */
export function CachedPicture({
  mediaId,
  hintUrl,
  className,
  width,
  height,
  fallback = null,
}: {
  mediaId: string;
  /** 资料顺带给的签名链接；没有时由 useMediaLink 自己取正式链接。 */
  hintUrl?: string;
  className?: string;
  /** 固定宽高，图片晚到也不撑开行。 */
  width?: number;
  height?: number;
  /** 图片加载失败时显示（如昵称缩写）。 */
  fallback?: ReactNode;
}) {
  const { link, reload } = useMediaLink(mediaId, hintUrl);
  const url = link?.url;
  // 同一个 URL 只回源一次；服务器给了新签名（URL 变化）后允许再试一次。
  const retried = useRef<{ mediaId: string; url: string | null } | null>(null);
  const recover = () => {
    if (!url) return;
    if (retried.current?.mediaId === mediaId && retried.current.url === url) return;
    retried.current = { mediaId, url };
    reload();
  };
  return (
    <CachedImage
      mediaKey={`a:${mediaId}`}
      url={url}
      className={className}
      width={width}
      height={height}
      fallback={fallback}
      onLinkBroken={recover}
    />
  );
}

// ---------- 角色头像 mediaId ----------

/** 记住角色这次用的头像 mediaId：资料还没读到时先挂图，不先闪文字占位。 */
export function rememberCharacterAvatar(characterId: string, mediaId: string | null | undefined) {
  ensureScope();
  if (!characterId) return;
  if (!mediaId) {
    avatarOf.delete(characterId);
    return;
  }
  avatarOf.delete(characterId);
  avatarOf.set(characterId, mediaId);
  trim(avatarOf, PICTURE_LIMIT);
}

export function recallCharacterAvatar(characterId: string): string | undefined {
  ensureScope();
  return characterId ? touch(avatarOf, characterId) : undefined;
}

// ---------- 当前账号自己的头像 ----------

/** 当前账号自己的头像 mediaId（资料还没读到时先用上次的，避免闪占位）。按账号区分。 */
const myAvatar = new Map<string, string | null>();
export function rememberMyAvatar(userId: string | undefined, mediaId: string | null | undefined) {
  if (userId && mediaId !== undefined) myAvatar.set(userId, mediaId);
}
export function recallMyAvatar(userId: string | undefined): string | null | undefined {
  return userId ? myAvatar.get(userId) : undefined;
}
