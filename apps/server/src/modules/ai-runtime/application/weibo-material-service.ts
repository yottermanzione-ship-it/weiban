/**
 * 角色微博公开素材的图片提供方（T-20261025）：实现消费方端口 WeiboMomentMaterialPort。
 *
 * 数据来源只有一条：微博同步已经写进 ai_runtime.weibo_items 的那条公开帖子（正文/来源/真实日期），
 * 图片只从**该帖自己的公开页面**里取（domain/weibo-media 的严格核验：同一条帖子、已核实账号、发布时间、
 * 配文、只认新浪图床）。页面被微博访客/反爬拦截、抓取失败、页面没有图 → 照实返回 0 张图（只发文字），
 * 绝不换图库/AI/随机风景图，也不绕过登录或人机验证。
 *
 * 存储与资金/隐私边界：
 * - 图片经既有媒体端口（MediaSystemPort.putObject）转存，owner 为空、purpose = weibo_material（平台公共素材），
 *   不接受用户上传，也不放任何用户私人图；媒体服务负责格式、像素、缩略图与大小校验。
 * - 按图片地址摘要（image_key）跨条目共享：同一张图只下载/入库一次，不为每个用户重复下载；
 *   采集结果按条目落库（weibo_item_media），同一用户再次发圈不会重新抓取或换图。
 * - 采集失败/被拦截写入 media_state = unavailable 并按时间冷却，不反复抓同一个页面。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CharacterReadPort, MediaSystemPort, PublicUpdateReadPort } from '@weiban/contracts';
import { MEDIA_LIMITS } from '@weiban/contracts';
import { CLOCK, DATABASE, type Clock, type Database } from '../../../platform/index.js';
import { PUBLIC_UPDATE_READ_PORT } from '../../characters/index.js';
import { LinkPreviewService, MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { weiboPostUrl } from '../domain/weibo.js';
import {
  MAX_WEIBO_PAGE_BYTES,
  weiboGateHit,
  weiboMediaFromPage,
  weiboPageAllowed,
  weiboPickImage,
  type WeiboMediaCandidate,
} from '../domain/weibo-media.js';
import { characterView, roleWeiboMarker } from './character-view.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import type {
  WeiboMomentImage,
  WeiboMomentMaterial,
  WeiboMomentMaterialPort,
} from './weibo-material.js';

/** 帖子页面只读头部；图片单张上限沿用媒体服务的图片上限。 */
const PAGE_TIMEOUT_BYTES = MAX_WEIBO_PAGE_BYTES;
/** 采集失败后的冷却：被拦截/无图的条目一天内不再重抓。 */
const RETRY_AFTER_MS = 24 * 3600_000;
/** 同一实例正在抓取时的租约（多实例重复抓取只是浪费一次请求，不会写重复行）。 */
const FETCH_LEASE_MS = 10 * 60_000;
/** 微博公开资料允许的陈旧度：素材保留原帖真实日期，不假装是今天的；只在有效窗口（30 天）内取旧帖。 */
const MAX_POST_AGE_MS = 45 * 24 * 3600_000;

export interface WeiboItemRow {
  id: string;
  characterId: string;
  publicUpdateId: string;
  sourceUrl: string;
  content: string;
  publishedOn: string;
  mediaState: string | null;
}

export interface StoredWeiboMedia {
  mediaId: string;
  imageKey: string;
  sourceUrl: string;
  position: number;
}

/** 采集用的最小抓取接口（由媒体模块 LinkPreviewService.safeFetch 提供：SSRF/DNS/重定向/超时/字节上限）。 */
export interface WeiboPageFetcher {
  safeFetch(
    raw: string,
    maxBytes: number,
  ): Promise<{
    status: number;
    finalUrl: URL;
    contentType: string;
    body: Buffer;
  } | null>;
}

@Injectable()
export class WeiboMediaStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 只取「这个角色的这条公开动态」对应的同步条目，不跨角色。 */
  async item(characterId: string, publicUpdateId: string): Promise<WeiboItemRow | null> {
    const result = await this.db.query<{
      id: string;
      character_id: string;
      public_update_id: string;
      source_url: string;
      content: string;
      published_on: string;
      media_state: string | null;
    }>(
      'SELECT id,character_id,public_update_id,source_url,content,published_on,media_state FROM ai_runtime.weibo_items WHERE character_id=$1 AND public_update_id=$2',
      [characterId, publicUpdateId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          characterId: row.character_id,
          publicUpdateId: row.public_update_id,
          sourceUrl: row.source_url,
          content: row.content,
          publishedOn: row.published_on,
          mediaState: row.media_state,
        }
      : null;
  }

  /** 抢一次采集权：失败/无图的条目按冷却时间重试；别的实例正在抓时返回 false。 */
  async claim(itemId: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE ai_runtime.weibo_items SET media_state='fetching', media_attempted_at=$2
       WHERE id=$1 AND (
         media_state IS NULL
         OR (media_state='fetching' AND media_attempted_at IS NOT NULL AND media_attempted_at < $3)
         OR (media_state IN ('none','unavailable') AND media_attempted_at IS NOT NULL AND media_attempted_at < $4)
       ) RETURNING id`,
      [
        itemId,
        now,
        new Date(now.getTime() - FETCH_LEASE_MS),
        new Date(now.getTime() - RETRY_AFTER_MS),
      ],
    );
    return result.rows.length > 0;
  }

  async media(itemId: string): Promise<StoredWeiboMedia[]> {
    const result = await this.db.query<{
      media_id: string;
      image_key: string;
      source_url: string;
      position: number;
    }>(
      'SELECT media_id,image_key,source_url,position FROM ai_runtime.weibo_item_media WHERE item_id=$1 ORDER BY position',
      [itemId],
    );
    return result.rows.map((row) => ({
      mediaId: row.media_id,
      imageKey: row.image_key,
      sourceUrl: row.source_url,
      position: row.position,
    }));
  }

  /** 按图片摘要找别的条目已经入库的同一张图（共享缓存，不重复下载）。 */
  async sharedImage(imageKey: string): Promise<string | null> {
    const result = await this.db.query<{ media_id: string }>(
      'SELECT media_id FROM ai_runtime.weibo_item_media WHERE image_key=$1 LIMIT 1',
      [imageKey],
    );
    return result.rows[0]?.media_id ?? null;
  }

  async save(input: {
    itemId: string;
    mediaId: string;
    imageKey: string;
    position: number;
    sourceUrl: string;
    at: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_runtime.weibo_item_media(item_id,position,image_key,media_id,source_url,created_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [input.itemId, input.position, input.imageKey, input.mediaId, input.sourceUrl, input.at],
    );
  }

  async finish(itemId: string, state: 'ready' | 'none' | 'unavailable', at: Date): Promise<void> {
    await this.db.query(
      'UPDATE ai_runtime.weibo_items SET media_state=$2, media_attempted_at=$3 WHERE id=$1',
      [itemId, state, at],
    );
  }
}

@Injectable()
export class WeiboMaterialService implements WeiboMomentMaterialPort {
  constructor(
    @Inject(WeiboMediaStore) private readonly store: WeiboMediaStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(AI_CHARACTER_READ) private readonly characters?: CharacterReadPort,
    @Optional() @Inject(MEDIA_SYSTEM_PORT) private readonly media?: MediaSystemPort,
    @Optional() @Inject(PUBLIC_UPDATE_READ_PORT) private readonly updates?: PublicUpdateReadPort,
    @Optional() @Inject(LinkPreviewService) private readonly fetcher?: WeiboPageFetcher,
  ) {}

  /** 最近一条仍生效的微博素材（只读该角色自己的条目）；没有就返回 null，由消费方明示没有素材。 */
  async latest(userId: string, characterId: string): Promise<WeiboMomentMaterial | null> {
    const found = await this.weiboItem(userId, characterId);
    if (!found) return null;
    const images = await this.imagesFor(userId, found.item);
    return {
      updateId: found.updateId,
      content: found.content || found.item.content,
      sourceUrl: found.sourceUrl || found.item.sourceUrl,
      publishedOn: found.publishedOn ?? found.item.publishedOn,
      images,
    };
  }

  /** 「按用户稳定选一张」的便捷方法（与消费方同一公式）；没有素材/没有图时返回 null。 */
  async pick(userId: string, characterId: string): Promise<WeiboMomentImage | null> {
    const material = await this.latest(userId, characterId);
    if (!material) return null;
    return weiboPickImage(material.images ?? [], userId, material.updateId);
  }

  private async weiboItem(
    userId: string,
    characterId: string,
  ): Promise<{
    item: WeiboItemRow;
    updateId: string;
    content: string;
    sourceUrl: string;
    publishedOn: string | null;
  } | null> {
    if (!this.updates) return null;
    const today = this.clock.now().toISOString().slice(0, 10);
    const updates = await this.updates
      .listEffective(characterId, today, { limit: 5, pastDays: 30 })
      .catch(() => []);
    for (const update of updates) {
      if (!/weibo\.(com|cn)/iu.test(update.sourceUrl)) continue;
      if ((update.content ?? '').trim().length < 4) continue;
      const item = await this.store.item(characterId, update.updateId);
      if (!item) continue;
      return {
        item,
        updateId: update.updateId,
        content: update.content,
        sourceUrl: update.sourceUrl,
        publishedOn: update.effectiveDate ?? null,
      };
    }
    return null;
  }

  private async imagesFor(userId: string, item: WeiboItemRow): Promise<WeiboMomentImage[]> {
    const existing = await this.store.media(item.id);
    if (existing.length) return existing.map((row) => ({ mediaId: row.mediaId }));
    if (item.mediaState === 'none' || item.mediaState === 'unavailable') return [];
    if (!this.media || !this.fetcher || !this.characters) return [];
    const sourceUrl = weiboPostUrl(item.sourceUrl);
    if (!sourceUrl || !weiboPageAllowed(sourceUrl)) return [];
    const marker = await this.marker(userId, item.characterId);
    if (!marker) return [];
    const now = this.clock.now();
    if (!(await this.store.claim(item.id, now))) return [];

    const page = await this.fetcher.safeFetch(sourceUrl, PAGE_TIMEOUT_BYTES);
    if (!page) {
      await this.store.finish(item.id, 'unavailable', now);
      return [];
    }
    const html = page.body.toString('utf8');
    if (
      page.status !== 200 ||
      weiboGateHit({ status: page.status, finalUrl: page.finalUrl.href, html }) ||
      !weiboPageAllowed(page.finalUrl.href)
    ) {
      // 命中访客/反爬拦截（未带凭据所试路径返回 302 到 visitor/passport 或 432；真实帖子可访问性未验证）：
      // 按公开获取失败处理，只发文字，不重试绕过，也不换替代图。
      await this.store.finish(item.id, 'unavailable', now);
      return [];
    }
    const parsed = weiboMediaFromPage(
      html,
      {
        postUrl: sourceUrl,
        authorId: marker.userId,
        nickname: marker.nickname,
        now,
        maxAgeMs: MAX_POST_AGE_MS,
      },
      weiboPostUrl,
    );
    if (!parsed.ok) {
      await this.store.finish(item.id, parsed.reason === 'no_image' ? 'none' : 'unavailable', now);
      return [];
    }
    for (const candidate of parsed.images) await this.storeCandidate(item, candidate, now);
    const stored = await this.store.media(item.id);
    await this.store.finish(item.id, stored.length ? 'ready' : 'none', now);
    return stored.map((row) => ({ mediaId: row.mediaId }));
  }

  /** 一条候选图：先看有没有同一张图已在库里（跨条目共享），没有才下载并经媒体服务入库。 */
  private async storeCandidate(
    item: WeiboItemRow,
    candidate: WeiboMediaCandidate,
    now: Date,
  ): Promise<void> {
    const media = this.media;
    const fetcher = this.fetcher;
    if (!media || !fetcher) return;
    const shared = await this.store.sharedImage(candidate.imageKey);
    let mediaId = shared;
    if (!mediaId) {
      const response = await fetcher.safeFetch(candidate.sourceUrl, MEDIA_LIMITS.imageMaxBytes);
      if (!response || response.status !== 200) return;
      const mime = (response.contentType.split(';')[0] ?? '').trim().toLowerCase();
      if (!(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(mime)) return;
      if (!weiboImageFinalAllowed(response.finalUrl)) return;
      try {
        const object = await media.putObject({
          ownerUserId: null,
          purpose: 'weibo_material',
          bytes: response.body,
          mimeType: mime,
        });
        mediaId = object.mediaId;
      } catch {
        // 图片格式/像素/大小不合规：跳过这一张，绝不转存。
        return;
      }
    }
    await this.store.save({
      itemId: item.id,
      mediaId,
      imageKey: candidate.imageKey,
      position: candidate.position,
      sourceUrl: candidate.sourceUrl,
      at: now,
    });
  }

  private async marker(
    userId: string,
    characterId: string,
  ): Promise<{ nickname: string; userId: string } | null> {
    if (!this.characters) return null;
    const role = await this.characters.getForRuntime(userId, characterId).catch(() => null);
    if (!role) return null;
    const marker = roleWeiboMarker(characterView(role));
    // 没有已核实微博账号的角色无法核对「这张图是不是该账号原帖」，就不取图（只发文字）。
    if (!marker?.userId) return null;
    return { nickname: marker.nickname, userId: marker.userId };
  }
}

/** 图片最终地址只允许图床：重定向后仍必须是受信域名，避免被跳到任意站点。 */
function weiboImageFinalAllowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    ['.sinaimg.cn', '.weibo.com', '.weibo.cn'].some((suffix) => host.endsWith(suffix))
  );
}
