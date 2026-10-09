/**
 * 链接预览与可访问性检查（MED-05）。契约：MediaExtraEndpoints.previewLink、ports/media.ts LinkPreviewPort。
 *
 * 安全（docs/architecture/security-and-privacy.md）：
 * - 只访问 http(s)，端口只允许 80 / 443；
 * - 每一跳先解析域名，所有地址都必须是公网地址，并把连接固定到已检查的地址（防 DNS 重绑定）；
 * - 最多 3 次跳转，每跳重新检查；超时 6 秒；页面最多读 512 KB，封面图最多 5 MB；
 * - 不带 Cookie、不带用户身份。
 */
import { Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LinkPreview, LinkPreviewPort } from '@weiban/contracts';
import { AppError, CLOCK, type Clock } from '../../../platform/index.js';
import { MediaService } from './media.js';

const TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** 每用户每分钟 20 次（契约 previewLink 摘要）。 */
const RATE_LIMIT = 20;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}
function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/') as [string, string];
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];
/** 只允许公网地址。 */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !PRIVATE_V4.some((c) => inV4(ip, c));
  if (family === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (v === '::' || v === '::1') return false;
    if (/^(fc|fd)/.test(v)) return false; // 唯一本地
    if (/^fe[89ab]/.test(v)) return false; // 链路本地
    if (/^ff/.test(v)) return false; // 组播
    if (v.startsWith('2001:db8')) return false; // 文档
    if (v.startsWith('64:ff9b')) return false; // NAT64
    return true;
  }
  return false;
}

const SOURCES: Array<{ host: RegExp; source: string; hint: 'music' | 'video' | 'web' }> = [
  { host: /(^|\.)music\.163\.com$|(^|\.)163cn\.tv$/, source: '网易云音乐', hint: 'music' },
  { host: /(^|\.)y\.qq\.com$|(^|\.)c\.y\.qq\.com$/, source: 'QQ 音乐', hint: 'music' },
  { host: /(^|\.)kugou\.com$/, source: '酷狗音乐', hint: 'music' },
  { host: /(^|\.)kuwo\.cn$/, source: '酷我音乐', hint: 'music' },
  { host: /(^|\.)music\.apple\.com$/, source: 'Apple Music', hint: 'music' },
  { host: /(^|\.)spotify\.com$/, source: 'Spotify', hint: 'music' },
  { host: /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/, source: '哔哩哔哩', hint: 'video' },
  { host: /(^|\.)v\.qq\.com$/, source: '腾讯视频', hint: 'video' },
  { host: /(^|\.)iqiyi\.com$/, source: '爱奇艺', hint: 'video' },
  { host: /(^|\.)youku\.com$/, source: '优酷', hint: 'video' },
  { host: /(^|\.)mgtv\.com$/, source: '芒果 TV', hint: 'video' },
  { host: /(^|\.)douyin\.com$/, source: '抖音', hint: 'video' },
  { host: /(^|\.)ixigua\.com$/, source: '西瓜视频', hint: 'video' },
  { host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, source: 'YouTube', hint: 'video' },
  { host: /(^|\.)weibo\.com$|(^|\.)weibo\.cn$/, source: '微博', hint: 'web' },
  { host: /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/, source: '小红书', hint: 'web' },
  { host: /(^|\.)zhihu\.com$/, source: '知乎', hint: 'web' },
  { host: /(^|\.)douban\.com$/, source: '豆瓣', hint: 'web' },
];
export function classifyHost(host: string): {
  source: string | null;
  hint: 'music' | 'video' | 'web';
} {
  const h = host.toLowerCase();
  const found = SOURCES.find((s) => s.host.test(h));
  return found ? { source: found.source, hint: found.hint } : { source: null, hint: 'web' };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
function clean(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const text = decodeEntities(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return [...text].slice(0, max).join('');
}
function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`,
      'i',
    );
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return content;
  }
  return null;
}

interface FetchResult {
  status: number;
  finalUrl: URL;
  contentType: string;
  body: Buffer;
}

export interface ParsedPreview {
  reachable: boolean;
  title: string | null;
  description: string | null;
  source: string | null;
  imageUrl: string | null;
  finalUrl: string;
  hint: 'music' | 'video' | 'web';
}

@Injectable()
export class LinkPreviewService implements LinkPreviewPort {
  private readonly hits = new Map<string, number[]>();
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 解析并检查一个地址；不合规返回 null。 */
  private async resolvePublic(url: URL): Promise<string | null> {
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return isPublicAddress(host) ? host : null;
    if (/\.(local|localhost|internal|lan|home|corp)$/i.test(host) || !host.includes('.'))
      return null;
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) return null;
      return addresses[0]!.address;
    } catch {
      return null;
    }
  }

  private requestOnce(url: URL, address: string, maxBytes: number): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WeibanLinkPreview/1.0)',
            Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
          },
          timeout: TIMEOUT_MS,
          // 连接固定到已检查的地址；TLS 仍按域名校验证书。
          lookup: (_host, _opts, cb) =>
            (cb as (e: Error | null, a: string, f: number) => void)(null, address, isIP(address)),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              // 只需要开头部分（标题、meta），超过上限直接截断。
              chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (size - chunk.length))));
              res.destroy();
              resolve({
                status: res.statusCode ?? 0,
                finalUrl: url,
                contentType: String(res.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks),
              });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              finalUrl:
                res.statusCode && res.statusCode >= 300 && res.statusCode < 400
                  ? new URL(String(res.headers.location ?? ''), url)
                  : url,
              contentType: String(res.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  /** 安全地抓取（跟随最多 3 次跳转）。失败返回 null。 */
  async safeFetch(raw: string, maxBytes: number): Promise<FetchResult | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const address = await this.resolvePublic(url);
      if (!address) return null;
      let result: FetchResult;
      try {
        result = await this.requestOnce(url, address, maxBytes);
      } catch {
        return null;
      }
      if (result.status >= 300 && result.status < 400 && result.finalUrl.href !== url.href) {
        url = result.finalUrl;
        continue;
      }
      return { ...result, finalUrl: url };
    }
    return null;
  }

  async inspect(raw: string): Promise<ParsedPreview> {
    let parsed: URL | null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
    }
    const host = parsed?.hostname ?? '';
    const base = classifyHost(host);
    const result = await this.safeFetch(raw, MAX_HTML_BYTES);
    if (!result || result.status < 200 || result.status >= 400)
      return {
        reachable: false,
        title: null,
        description: null,
        source: base.source,
        imageUrl: null,
        finalUrl: raw,
        hint: base.hint,
      };
    const finalHost = classifyHost(result.finalUrl.hostname);
    const hint = base.hint !== 'web' ? base.hint : finalHost.hint;
    const isHtml = /html|xml/i.test(result.contentType) || !result.contentType;
    const charset = /charset=([\w-]+)/i.exec(result.contentType)?.[1]?.toLowerCase();
    let html = '';
    if (isHtml) {
      try {
        html = new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(
          result.body,
        );
      } catch {
        html = result.body.toString('utf8');
      }
      const metaCharset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(html)?.[1]?.toLowerCase();
      if (!charset && metaCharset && !['utf-8', 'utf8'].includes(metaCharset)) {
        try {
          html = new TextDecoder(metaCharset).decode(result.body);
        } catch {
          // 不认识的编码按 UTF-8。
        }
      }
    }
    const title = clean(
      meta(html, ['og:title', 'twitter:title']) ??
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1],
      100,
    );
    const description = clean(
      meta(html, ['og:description', 'description', 'twitter:description']),
      200,
    );
    const siteName = clean(meta(html, ['og:site_name', 'application-name']), 30);
    let imageUrl: string | null = null;
    const image = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
    if (image) {
      try {
        imageUrl = new URL(decodeEntities(image), result.finalUrl).toString();
      } catch {
        imageUrl = null;
      }
    }
    return {
      reachable: true,
      title,
      description,
      source: base.source ?? finalHost.source ?? siteName,
      imageUrl,
      finalUrl: result.finalUrl.toString(),
      hint,
    };
  }

  /** LinkPreviewPort：AI 分享链接前的可访问性检查（不转存封面）。 */
  async preview(url: string): Promise<{
    reachable: boolean;
    title: string | null;
    description: string | null;
    source: string | null;
  }> {
    const r = await this.inspect(url);
    return { reachable: r.reachable, title: r.title, description: r.description, source: r.source };
  }

  private checkRate(userId: string): void {
    const now = this.clock.nowMs();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RATE_LIMIT) {
      this.hits.set(userId, recent);
      throw new AppError('rate_limited', '操作太频繁，请稍后再试');
    }
    recent.push(now);
    this.hits.set(userId, recent);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < 60_000)) this.hits.delete(k);
    }
  }

  /** POST /links/preview：用户发链接、发朋友圈前取标题与封面；封面转存为本人的 chat_image。 */
  async previewForUser(userId: string, url: string): Promise<LinkPreview> {
    this.checkRate(userId);
    const r = await this.inspect(url);
    let coverMediaId: string | null = null;
    if (r.reachable && r.imageUrl) {
      const cover = await this.safeFetch(r.imageUrl, MAX_COVER_BYTES);
      const type = cover?.contentType.split(';')[0]!.trim().toLowerCase() ?? '';
      if (cover && cover.status >= 200 && cover.status < 300 && type.startsWith('image/')) {
        try {
          const media = await this.media.putObject({
            ownerUserId: userId,
            purpose: 'chat_image',
            bytes: cover.body,
            mimeType: type === 'image/jpg' ? 'image/jpeg' : type,
          });
          coverMediaId = media.mediaId;
        } catch {
          coverMediaId = null;
        }
      }
    }
    let fallbackTitle = url;
    try {
      const u = new URL(url);
      fallbackTitle = u.hostname + (u.pathname === '/' ? '' : u.pathname);
    } catch {
      // 保留原文。
    }
    return {
      url,
      title: r.title ?? [...fallbackTitle].slice(0, 100).join(''),
      source: r.source,
      description: r.description,
      coverMediaId,
      appHint: r.hint,
      reachable: r.reachable,
    };
  }
}
