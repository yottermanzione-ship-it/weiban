/**
 * 联网取图（角色主动/用户索要）：搜索开放图库 → 核验 → 加密入库 → 带出处返回。
 *
 * 成本归属：本服务只使用**免费且自带出处**的开放图库，不调用付费搜索；
 * 后续若要加"用模型判断这张图是否切题"，那次调用必须用 `billingOwner: 'user'` 与用户自己的模型，
 * 平台不补贴。开关关闭时整条链路不运行。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { MediaObject, MediaSystemPort } from '@weiban/contracts';
import { APP_CONFIG, type AppConfig } from '../../../platform/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import {
  buildPhotoQuery,
  normalizeCandidate,
  pickPhoto,
  type PhotoCandidate,
} from '../domain/web-photo.js';

/** 开放图库的来源端：返回候选与原始字节；实现方负责只访问固定域名。 */
export interface PublicPhotoSource {
  search(query: string): Promise<PhotoCandidate[]>;
  download(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export const PUBLIC_PHOTO_SOURCE = Symbol('weiban.public-photo-source');

export interface WebPhoto {
  media: MediaObject;
  credit: string;
  pageUrl: string;
  title: string;
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

@Injectable()
export class WebPhotoService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PUBLIC_PHOTO_SOURCE) private readonly source: PublicPhotoSource,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
  ) {}

  /**
   * 取一张能核实的真实照片。任何一步不满足都返回 null —— 宁可不发，也不发来路不明的图。
   * 调用方负责把 `credit`/`pageUrl` 随消息展示，不能把图片说成角色自己拍的。
   */
  async fetch(input: { userId: string; scene: string }): Promise<WebPhoto | null> {
    if (!this.config.characterPublicPictureSearchEnabled) return null;
    const query = buildPhotoQuery(input.scene);
    if (!query) return null;
    const raw = await this.source.search(query).catch(() => []);
    const candidates = raw
      .map((item) =>
        normalizeCandidate({
          title: item.title,
          pageUrl: item.pageUrl,
          imageUrl: item.imageUrl,
          mime: item.mime,
          width: item.width,
          height: item.height,
          bytes: item.bytes,
          author: item.author,
          licence: item.licence,
          takenAt: item.takenAt,
        }),
      )
      .filter((item): item is PhotoCandidate => item !== null);
    const picked = pickPhoto(candidates);
    if (!picked) return null;
    const file = await this.source.download(picked.imageUrl).catch(() => null);
    if (!file) return null;
    const magic = MAGIC[picked.mime];
    if (!magic || !magic(file.bytes)) return null;
    if (file.bytes.length > picked.bytes + 1024) return null;
    try {
      const media = await this.media.putObject({
        ownerUserId: input.userId,
        purpose: 'chat_image',
        bytes: file.bytes,
        mimeType: picked.mime,
      });
      return { media, credit: picked.credit, pageUrl: picked.pageUrl, title: picked.title };
    } catch {
      return null;
    }
  }
}
