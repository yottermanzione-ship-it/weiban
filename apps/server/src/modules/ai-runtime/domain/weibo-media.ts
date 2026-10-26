/**
 * 角色微博公开素材的图片链路纯规则（无网络、无数据库；T-20261025）。
 *
 * 只认「已同步的那条微博自己的公开页面」声明过的图片：页面必须能核对成同一条帖子、同一个已核实账号、
 * 带发布时间与配文（复用 post-photo 的严格核验），图片还必须在新浪/微博图床。其它站点图、http、data:、
 * 搜索缩略图一律不认。
 * 实测边界（2026-10-25，未带任何凭据）：所试路径——微博站点根、占位帖子地址（非已知真实帖子）、公开 API——
 * 返回 302 到 visitor/passport 或 432；真实帖子的可访问性未验证。命中这类拦截时按「公开获取失败」处理，
 * 上游只发文字、绝不换图，也不绕过登录/人机验证。
 */
import { createHash } from 'node:crypto';
import { ecoRandom } from './ecology.js';
import {
  verifyPostPhoto,
  type PostPhotoExpectation,
  type PostPhotoRejection,
} from './post-photo.js';

/** 只允许抓这两类公开帖子页面（规范化由 weiboPostUrl 负责）。 */
export const WEIBO_PAGE_HOSTS = ['weibo.com', 'm.weibo.cn'] as const;
/** 认可的图片域名后缀：新浪图床。页面封面/头像不在这里额外放行。 */
const IMAGE_HOST_SUFFIXES = ['.sinaimg.cn', '.weibo.com', '.weibo.cn'] as const;
/** 一条微博最多转存几张：够稳定选图，也不把整条相册搬进来。 */
export const MAX_WEIBO_IMAGES = 4;
/** 帖子页面最多读这么多字节（只取头部 meta 与 pics 数组）。 */
export const MAX_WEIBO_PAGE_BYTES = 512 * 1024;

export type WeiboMediaRejection = PostPhotoRejection;

export interface WeiboMediaCandidate {
  /** 原图地址（https、受信图床），只用于下载与审计。 */
  sourceUrl: string;
  /** 按地址（去掉查询串的签名参数）算的摘要：跨条目共享同一张图、跨用户不重复下载。 */
  imageKey: string;
  position: number;
}

export type WeiboMediaPageResult =
  | {
      ok: true;
      postUrl: string;
      publishedAt: string;
      caption: string;
      /** 按帖子顺序稳定排列，第一张是 og:image。 */
      images: WeiboMediaCandidate[];
    }
  | { ok: false; reason: WeiboMediaRejection };

/** 抓取前先确认是允许的微博帖子地址（不属于的一律不请求）。 */
export function weiboPageAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return (WEIBO_PAGE_HOSTS as readonly string[]).includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 微博的访客/反爬拦截：302 到 visitor/passport、432/403/418，或页面本身就是 Sina Visitor System。
 * 命中就代表「公开获取失败」，照实记为 unavailable，不重试绕过。
 */
export function weiboGateHit(input: { status: number; finalUrl: string; html?: string }): boolean {
  if ([403, 418, 429, 432].includes(input.status)) return true;
  let host = '';
  try {
    host = new URL(input.finalUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (
    /passport\.weibo\.(com|cn)$|^visitor\./u.test(host) ||
    /passport\.weibo/u.test(input.finalUrl)
  )
    return true;
  if (input.status >= 300 && input.status < 400) return true;
  return (
    !!input.html &&
    /Sina Visitor System|visitor\/visitor|passport\.weibo/u.test(input.html.slice(0, 4000))
  );
}

/** 图片地址摘要：协议 + 域名 + 路径（丢掉签名查询串），同一张图跨帖子/跨用户只下载一次。 */
export function weiboImageKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    if (host.endsWith('weibo.com') || host.endsWith('weibo.cn')) {
      // 微博自己的页面地址不是图床；只有明确带图片扩展名才收。
      if (!/\.(?:jpe?g|png|webp|gif)$/iu.test(url.pathname)) return null;
    }
    return createHash('sha256').update(`${url.origin}${url.pathname}`).digest('hex');
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

/** 页面里所有 og:image（正反两种属性顺序）。 */
function ogImages(html: string): string[] {
  const pattern =
    /<meta[^>]+(?:property|name)\s*=\s*["']og:image(?::url)?["'][^>]*content\s*=\s*["']([^"']*)["']/giu;
  const reverse =
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']og:image(?::url)?["']/giu;
  const out: string[] = [];
  for (const matcher of [pattern, reverse])
    for (const match of html.matchAll(matcher))
      if (match[1]) out.push(decodeEntities(match[1].trim()));
  return out;
}

/** 该帖自己的图片数组：页面 JSON 的 `"pics":[{...}]`（转义成字符串的也认）。 */
function picsImages(html: string): string[] {
  const out: string[] = [];
  const blocks = [
    ...html.matchAll(/"pics"\s*:\s*(\[[^\]]{0,20000}\])/gsu),
    ...html.matchAll(/\\"pics\\"\s*:\s*(\[[^\]]{0,20000}\])/gsu),
  ];
  for (const block of blocks) {
    // 页面 JSON 里的 URL 常被转义成 https:\/\/…、引号写成 \"…\"，先还原再取。
    const text = (block[1] ?? '').replace(/\\"/gu, '"').replace(/\\\//gu, '/');
    for (const match of text.matchAll(
      /"(?:url|largeUrl|originalUrl)"\s*:\s*"(https?:\/\/[^"]+)"/gu,
    )) {
      if (match[1]) out.push(match[1]);
    }
  }
  return out;
}

function dedupeCandidates(urls: readonly string[]): WeiboMediaCandidate[] {
  const seen = new Set<string>();
  const out: WeiboMediaCandidate[] = [];
  for (const raw of urls) {
    const sourceUrl = decodeEntities(raw.trim());
    const imageKey = weiboImageKey(sourceUrl);
    if (!imageKey || seen.has(imageKey)) continue;
    seen.add(imageKey);
    out.push({ sourceUrl, imageKey, position: out.length });
    if (out.length >= MAX_WEIBO_IMAGES) break;
  }
  return out;
}

/**
 * 从已抓到的帖子页面里取「可追溯、同一条微博自己的」图片。
 * 任何一项核不上都返回拒绝原因；页面确实没有图片时返回 no_image，
 * 上游据此只发文字，绝不拿封面/图库/AI 图补。
 */
export function weiboMediaFromPage(
  html: string,
  expected: PostPhotoExpectation,
  canonicalize: (raw: string) => string | null,
): WeiboMediaPageResult {
  const verified = verifyPostPhoto(html, expected, canonicalize);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const images = dedupeCandidates([verified.imageUrl, ...ogImages(html), ...picsImages(html)]);
  if (!images.length) return { ok: false, reason: 'no_image' };
  return {
    ok: true,
    postUrl: verified.postUrl,
    publishedAt: verified.publishedAt,
    caption: verified.caption,
    images,
  };
}

/** 按「这条素材 + 这位用户」稳定选一张：与消费方用的 ecoRandom 同一公式，刷新/重试不换图。 */
export function weiboPickImage<T>(
  images: readonly T[],
  userId: string,
  updateId: string,
): T | null {
  if (!images.length) return null;
  const index = Math.floor(ecoRandom(`weibo:${updateId}:${userId}`) * images.length);
  return images[Math.min(index, images.length - 1)] ?? null;
}
