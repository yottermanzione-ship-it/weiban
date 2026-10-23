/**
 * 朋友圈随机风景图（沿用旧版做法：picsum 按内容哈希取一张固定风景照）。
 *
 * 旧版参数：约 22% 的朋友圈带图，比例上限 30%；同一条内容永远对应同一张。
 * 这里把图下载后存进我们自己的加密媒体库（不再外链），并保留来源标记 `scenic`。
 * 只访问 picsum 白名单域名，失败就当没有图，绝不换一张别的凑数。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { MediaObject, MediaSystemPort } from '@weiban/contracts';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';

export const MOMENT_IMAGE_RATIO = 0.22;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_HOSTS = ['picsum.photos', 'fastly.picsum.photos'];

export type SceneryFetcher = (
  url: string,
) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

export const MOMENT_SCENERY_FETCHER = Symbol('weiban.moment-scenery-fetcher');

function hash(input: string): number {
  let h = 2166136261;
  for (const ch of input) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 同一条动态是否配图，由内容哈希决定；换成同一段文字永远得到同一结论。 */
export function wantsSceneryImage(seed: string, ratio = MOMENT_IMAGE_RATIO): boolean {
  if (ratio <= 0) return false;
  return (hash(`weiban-moment:${seed}`) % 10_000) / 10_000 < Math.min(ratio, 0.3);
}

export function sceneryUrl(seed: string): string {
  return `https://picsum.photos/seed/${hash(`weiban-moment:${seed}`).toString(36)}/1080/1080`;
}

function magicOk(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mimeType === 'image/png')
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === 'image/webp')
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  return false;
}

/** 真实抓取：只允许 picsum 域名，最多跟随两次跳转，超限即放弃。 */
export async function fetchScenery(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) return null;
    const response = await fetch(parsed, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) return null;
      current = new URL(next, parsed).toString();
      continue;
    }
    if (!response.ok) return null;
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_BYTES) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;
    return { bytes: buffer, mimeType: response.headers.get('content-type')?.split(';')[0] ?? '' };
  }
  return null;
}

@Injectable()
export class MomentSceneryService {
  constructor(
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(MOMENT_SCENERY_FETCHER) private readonly fetcher: SceneryFetcher,
  ) {}

  /** 需要且取到图时返回入库后的媒体；任何一步失败都返回 null（这条动态就纯文字）。 */
  async pick(input: { userId: string; seed: string }): Promise<MediaObject | null> {
    if (!wantsSceneryImage(input.seed)) return null;
    const file = await this.fetcher(sceneryUrl(input.seed)).catch(() => null);
    if (!file || !magicOk(file.bytes, file.mimeType)) return null;
    try {
      return await this.media.putObject({
        ownerUserId: input.userId,
        purpose: 'chat_image',
        bytes: file.bytes,
        mimeType: file.mimeType,
      });
    } catch {
      return null;
    }
  }
}
