/**
 * 联网取图的纯规则层：查询怎么拼、候选怎么挑、出处怎么显示。
 * 不做网络、不写库，便于离线测试与复用。
 */

export interface PhotoCandidate {
  title: string;
  pageUrl: string;
  imageUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  author: string | null;
  licence: string | null;
  takenAt: string | null;
}

export interface PickedPhoto extends PhotoCandidate {
  sourceName: string;
  credit: string;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
/** 单张图上限 8MB；低于 400px 的图在聊天里糊得没法看。 */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const MIN_EDGE = 400;

/** 采集/搜索关键词：只取场景词，去掉引号换行与过长内容，避免把私聊原文带出去。 */
export function buildPhotoQuery(scene: string): string | null {
  const text = scene
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (text.length < 2) return null;
  return text;
}

function httpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function plainText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** 出处要能被用户核对：没有作者或许可的图不进候选。 */
export function normalizeCandidate(input: {
  title: string;
  pageUrl: string;
  imageUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  author: string | null;
  licence: string | null;
  takenAt: string | null;
  sourceName?: string;
}): PhotoCandidate | null {
  const pageUrl = httpsUrl(input.pageUrl);
  const imageUrl = httpsUrl(input.imageUrl);
  if (!pageUrl || !imageUrl) return null;
  if (!ALLOWED_MIME.includes(input.mime)) return null;
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height)) return null;
  if (input.width < MIN_EDGE || input.height < MIN_EDGE) return null;
  if (!Number.isFinite(input.bytes) || input.bytes <= 0 || input.bytes > PHOTO_MAX_BYTES)
    return null;
  const author = plainText(input.author);
  const licence = plainText(input.licence);
  if (!author || !licence) return null;
  return {
    title: input.title.trim().slice(0, 160),
    pageUrl,
    imageUrl,
    mime: input.mime,
    width: Math.round(input.width),
    height: Math.round(input.height),
    bytes: Math.round(input.bytes),
    author,
    licence,
    takenAt: input.takenAt ? (plainText(input.takenAt)?.slice(0, 40) ?? null) : null,
  };
}

/** 同一批候选里挑一张：先要能核对出处，再按长边取清晰但不过大的。 */
export function pickPhoto(
  candidates: PhotoCandidate[],
  sourceName = '维基共享资源',
): PickedPhoto | null {
  const usable = candidates.filter((c) => c.author && c.licence && c.pageUrl);
  if (!usable.length) return null;
  const scored = [...usable].sort((a, b) => {
    const edge = (x: PhotoCandidate) => Math.max(x.width, x.height);
    const aFit = edge(a) >= 1000 ? 1 : 0;
    const bFit = edge(b) >= 1000 ? 1 : 0;
    if (aFit !== bFit) return bFit - aFit;
    return a.bytes - b.bytes;
  });
  const best = scored[0]!;
  return {
    ...best,
    sourceName,
    credit: `来源：${sourceName} · ${best.author} · ${best.licence}`,
  };
}
