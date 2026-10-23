/**
 * 普通人物照片的「出处核验」纯规则（无网络、无数据库）。
 *
 * 总经理 2026-10-23 的要求：普通图片不要随机图库、不要拿网页封面凑，必须是能核对
 * **人物、出处、原始时间**的真实图片，且能说明配文与图片的对应关系；不能把公开旧图说成刚拍的自拍。
 *
 * 本模块只做判断，不做抓取：输入是「已经抓到的原帖页面 HTML」和期望身份，输出是
 * 「可以附带哪张图、发布于何时、需要附上什么出处」。抓取必须复用既有的安全出站链路，
 * 由服务层接线后才会真正生效。
 */

/** 认可的图片域名后缀：微博/新浪图片 CDN。其它站点一律视为「网页封面」，不是原帖图片。 */
const IMAGE_HOST_SUFFIXES = ['.sinaimg.cn', '.weibo.com', '.weibo.cn'];
/** 原帖发布时间的允许误差与最大陈旧度。 */
const CLOCK_SKEW_MS = 5 * 60_000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface PostPhotoExpectation {
  /** 规范化后的原帖地址（`weiboPostUrl` 的结果）。 */
  postUrl: string;
  /** 已核实的人物账号 ID；缺失时必须拒绝，不能凭昵称猜。 */
  authorId: string;
  /** 期望的昵称（仅用于二次一致性核对）。 */
  nickname: string;
  now: Date;
  maxAgeMs?: number;
}

export type PostPhotoRejection =
  | 'no_page_url'
  | 'page_url_mismatch'
  | 'no_image'
  | 'image_host_rejected'
  | 'author_mismatch'
  | 'time_unverified'
  | 'no_caption';

export type PostPhotoResult =
  | {
      ok: true;
      /** 原帖本身的图片地址（https、受信 CDN）。 */
      imageUrl: string;
      /** 原帖发布时间（ISO）；这是「发布」时间，不是拍摄时间。 */
      publishedAt: string;
      authorId: string;
      postUrl: string;
      /** 原帖配文，用于让文案与图片对应；为空则拒绝。 */
      caption: string;
    }
  | { ok: false; reason: PostPhotoRejection };

function metaContent(html: string, matchers: readonly RegExp[]): string | null {
  for (const matcher of matchers) {
    const match = matcher.exec(html);
    if (match) {
      const value = match[1]?.trim();
      if (value) return value;
    }
  }
  return null;
}

const attr = (name: string) => [
  new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    'i',
  ),
  new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`,
    'i',
  ),
];

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#(\d{1,6});/gu, (_, code: string) => String.fromCodePoint(Number(code)));
}

function trustedImageHost(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 只接受 ISO 8601 且能被解析的时间；不做「今天」「昨天」这类自然语言猜测。 */
function parsePublishedAt(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/u.test(raw)) return null;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * 判断原帖页面能否作为「可追溯的真实照片」来源。
 * 任何一项核不上都返回拒绝原因，绝不降级成「拿首图凑」。
 */
export function verifyPostPhoto(
  html: string,
  expected: PostPhotoExpectation,
  canonicalize: (raw: string) => string | null,
): PostPhotoResult {
  const pageUrl = metaContent(html, attr('og:url'));
  if (!pageUrl) return { ok: false, reason: 'no_page_url' };
  if (canonicalize(decodeEntities(pageUrl)) !== expected.postUrl)
    return { ok: false, reason: 'page_url_mismatch' };

  const author = metaContent(html, [
    ...attr('article:author'),
    ...attr('author'),
    ...attr('og:article:author'),
  ]);
  if (!expected.authorId || !author || !author.includes(expected.authorId))
    return { ok: false, reason: 'author_mismatch' };

  const image = metaContent(html, attr('og:image'));
  if (!image) return { ok: false, reason: 'no_image' };
  const imageUrl = trustedImageHost(decodeEntities(image));
  if (!imageUrl) return { ok: false, reason: 'image_host_rejected' };

  const published = parsePublishedAt(
    metaContent(html, [...attr('article:published_time'), ...attr('og:published_time')]) ?? '',
  );
  const now = expected.now.getTime();
  const maxAge = expected.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!published) return { ok: false, reason: 'time_unverified' };
  const at = published.getTime();
  if (at > now + CLOCK_SKEW_MS || at < now - maxAge)
    return { ok: false, reason: 'time_unverified' };

  const caption = decodeEntities(
    metaContent(html, [...attr('og:description'), ...attr('description')]) ?? '',
  )
    .replace(/\s+/gu, ' ')
    .trim();
  if (caption.length < 4) return { ok: false, reason: 'no_caption' };
  if (
    expected.nickname &&
    !caption.includes(expected.nickname) &&
    !author.includes(expected.nickname)
  ) {
    // 昵称对不上说明页面主体不是这个人；宁可拒绝。
    return { ok: false, reason: 'author_mismatch' };
  }

  return {
    ok: true,
    imageUrl,
    publishedAt: published.toISOString(),
    authorId: expected.authorId,
    postUrl: expected.postUrl,
    caption: caption.slice(0, 500),
  };
}

/** 文案里必须体现这是原帖图片而不是刚拍的自拍（对外说明用）。 */
export function attributionLine(result: Extract<PostPhotoResult, { ok: true }>): string {
  const day = result.publishedAt.slice(0, 10);
  return `配图来自公开原帖（${day} 发布），非实时拍摄`;
}
