/**
 * T-20261103g：私聊里按素材分享照片的素材来源（对照表 v3 第 12 项）。规则与提示词见 domain/photo-marker.ts，
 * 硬规则见 domain/reply-media-rules.ts photoRoom，发不发由 media-ai planExtras 决定。
 *
 * - 只发已入库、已审核的微博素材图：角色最近几条仍生效的微博公开动态在 weibo_item_media 里已经转存好的图
 *   （WeiboMaterialService.shareable）。不生图、不找网图、不用风景图；聊天时不抓页面。没有素材就不发。
 * - 选图：从最新的那条微博起，排除这个用户已经收到过的图，按「用户 + 素材」稳定挑一张
 *   （weiboPickImage，与 #44 删掉的生态 weiboPhotoForEcology、朋友圈转发同一公式）。
 * - 「收到过」：聊天记录里角色发过的图（调用方传入）+ 图片描述存档里这个用户已有记录的图
 *   （照片发出后由 remember 写入；存档跨越聊天窗口，几百条以前发过的也不会再发）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MediaReadPort, MessageContent } from '@weiban/contracts';
import { MEDIA_READ_PORT } from '../../media/index.js';
import { weiboPickImage } from '../domain/weibo-media.js';
import {
  photoCaption,
  photoExcerpt,
  photoMaterialAllowed,
  type PhotoOffer,
} from '../domain/photo-marker.js';
import { ImageCaptionStore } from './image-captions.js';
import { WeiboMaterialService } from './weibo-material-service.js';

type Policy = { isMinor: boolean; isRealPerson: boolean; romanceAllowed: boolean };

@Injectable()
export class ChatPhotoService {
  constructor(
    @Inject(WeiboMaterialService)
    private readonly weibo: Pick<WeiboMaterialService, 'shareable'>,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
    @Optional()
    @Inject(ImageCaptionStore)
    private readonly captions?: Pick<ImageCaptionStore, 'load' | 'save'>,
  ) {}

  /** 这个用户还没收到过的一张可分享素材图；没有返回 null。 */
  async offer(input: {
    userId: string;
    characterId: string;
    /** 聊天记录里角色已经发过的图。 */
    received: ReadonlySet<string>;
    /** 素材文字要过的日常范围规则（角色的违禁词口径）。 */
    policy: Policy;
  }): Promise<PhotoOffer | null> {
    const posts = (await this.weibo.shareable(input.characterId).catch(() => [])).filter((p) =>
      photoMaterialAllowed(p.content, input.policy),
    );
    const ids = [...new Set(posts.flatMap((p) => p.mediaIds))].filter(
      (id) => !input.received.has(id),
    );
    if (!ids.length) return null;
    const archived = (await this.captions?.load(input.userId, ids, ['normal'])) ?? new Map();
    for (const post of posts) {
      const left = post.mediaIds.filter((id) => !input.received.has(id) && !archived.has(id));
      const mediaId = weiboPickImage(left, input.userId, post.updateId);
      if (mediaId)
        return {
          mediaId,
          updateId: post.updateId,
          excerpt: photoExcerpt(post.content),
          publishedOn: post.publishedOn,
        };
    }
    return null;
  }

  /**
   * 发送前复核并拼出图片消息：这张图仍在角色当前可分享的素材里（动态没被撤下）、媒体还在且是图片。
   * 不满足返回 null（这轮不发图）。
   */
  async content(
    userId: string,
    characterId: string,
    mediaId: string,
  ): Promise<MessageContent | null> {
    const posts = await this.weibo.shareable(characterId).catch(() => []);
    if (!posts.some((p) => p.mediaIds.includes(mediaId))) return null;
    const media = await this.mediaRead.getMedia(userId, mediaId).catch(() => null);
    if (!media || !media.mimeType.startsWith('image/')) return null;
    return {
      type: 'image',
      mediaId: media.mediaId,
      width: media.width,
      height: media.height,
      sizeBytes: media.sizeBytes,
    };
  }

  /**
   * 照片发出后记一笔：存进图片描述存档（按用户加密，关联这条消息）。之后聊天记录里显示
   * 「[你发了一张图片：微博配图（…）]」，角色接着聊时知道发的是什么；这个用户也不会再收到同一张。
   */
  async remember(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    offer: PhotoOffer;
  }): Promise<void> {
    await this.captions?.save({
      userId: input.userId,
      mediaId: input.offer.mediaId,
      scope: 'normal',
      messageId: input.messageId,
      conversationId: input.conversationId,
      caption: photoCaption(input.offer),
      modelKey: null,
    });
  }
}
