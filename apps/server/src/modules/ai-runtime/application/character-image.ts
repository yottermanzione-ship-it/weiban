/** 角色分享图片：仅合规素材库或安全公开网页封面，不调用生图和收费人脸复检。 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  LinkPreviewPort,
  MediaAssetReadPort,
  MediaReadPort,
  ModelGatewayMediaPort,
  PolicyPort,
} from '@weiban/contracts';
import { LINK_PREVIEW_PORT, MEDIA_ASSET_READ_PORT, MEDIA_READ_PORT } from '../../media/index.js';
import { MODEL_GATEWAY_MEDIA_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { APP_CONFIG, type AppConfig } from '../../../platform/index.js';

export type ImageUse = 'chat' | 'moments' | 'card' | 'pet';
export interface GenerateCharacterImageInput {
  userId: string;
  characterId: string;
  conversationId?: string;
  scene: string;
  use: ImageUse;
  cardKind?: string;
  /** 兼容旧调用方；不再生成任何角色肖像。 */
  wantCharacter?: boolean;
  idempotencyKey: string;
  countAsBackground?: boolean;
  ecologyTask?: boolean;
  /** 仅明确分享图片动作允许联网；旧日常/朋友圈/卡片不自动增加搜索费用。 */
  searchPublic?: boolean;
  /** 即使没有可发送图片，也回报网关已经实际结算的搜索费。 */
  onSearchCharged?: (chargedMicros: number) => void;
}
export interface CharacterImageResult {
  mediaId: string;
  source: 'web' | 'library';
  width: number | null;
  height: number | null;
  sizeBytes?: number;
  /** 仅可能包含现行 web_search 的费用；没有图片生成费用。 */
  chargedMicros?: number;
  sourceUrl?: string;
}

/** 只输出固定公开主题，不把聊天原文、私人线索或角色真实姓名交给搜索供应商。 */
export function publicPictureQuery(scene: string): string | null {
  const topics: Array<[RegExp, string]> = [
    [/猫|小猫/u, '猫咪'],
    [/狗|小狗/u, '狗狗'],
    [/花|花园/u, '花卉'],
    [/树|森林/u, '森林'],
    [/海|沙滩/u, '海滩'],
    [/天空|云|夕阳|日落/u, '天空 日落'],
    [/山|风景/u, '自然风景'],
    [/咖啡/u, '咖啡'],
    [/蛋糕|甜点/u, '甜点'],
  ];
  const topic = topics.find(([pattern]) => pattern.test(scene))?.[1];
  return topic ? `${topic} 公开图片` : null;
}

@Injectable()
export class CharacterImageService {
  constructor(
    @Inject(MODEL_GATEWAY_MEDIA_PORT) private readonly media: ModelGatewayMediaPort,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
    @Inject(LINK_PREVIEW_PORT) private readonly links: LinkPreviewPort,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  /** 保留内部方法名兼容旧调用方；此方法不再生成图片。 */
  async generate(input: GenerateCharacterImageInput): Promise<CharacterImageResult | null> {
    const policy = await this.policy.getCharacterPolicy(input.userId, input.characterId);
    if (!policy) return null;
    let chargedMicros = 0;
    const query =
      this.config?.characterPublicPictureSearchEnabled === true &&
      input.searchPublic &&
      input.use === 'chat' &&
      !policy.isRealPerson &&
      !policy.isHistorical
        ? publicPictureQuery(input.scene)
        : null;
    if (
      query &&
      this.links.previewForUser &&
      (await this.media.isServiceEnabled('web_search').catch(() => false))
    ) {
      const found = await this.media
        .webSearch({
          userId: input.userId,
          purpose: 'web_search',
          billingOwner: 'user',
          characterId: input.characterId,
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          query,
          maxResults: 3,
          idempotencyKey: `picture-search:${input.idempotencyKey}`,
          ...(input.countAsBackground ? { countAsBackground: true } : {}),
          ...(input.ecologyTask ? { ecologyTask: true } : {}),
        })
        .catch(() => null);
      if (found?.ok) {
        chargedMicros = found.value.chargedMicros;
        input.onSearchCharged?.(chargedMicros);
        for (const item of found.value.items.slice(0, 3)) {
          // Existing media facility handles DNS pinning, public IPs, every redirect,
          // bounded reads, rate limiting and image re-encoding. Never fetch here.
          const preview = await this.links.previewForUser(input.userId, item.url).catch(() => null);
          if (!preview?.reachable || !preview.coverMediaId) continue;
          const image = await this.mediaRead
            .getMedia(input.userId, preview.coverMediaId)
            .catch(() => null);
          if (!image) continue;
          return {
            mediaId: image.mediaId,
            source: 'web',
            width: image.width,
            height: image.height,
            sizeBytes: image.sizeBytes,
            chargedMicros,
            sourceUrl: item.url,
          };
        }
      }
    }
    const image = await this.fromLibrary(input, policy.isRealPerson, policy.isHistorical);
    return image ? { ...image, chargedMicros } : null;
  }

  private async fromLibrary(
    input: GenerateCharacterImageInput,
    portraitFreeOnly: boolean,
    classicalStyleOnly: boolean,
  ): Promise<CharacterImageResult | null> {
    const kind =
      input.use === 'card'
        ? (input.cardKind ?? 'moment')
        : input.use === 'pet'
          ? 'pet'
          : 'daily_photo';
    const list = await this.assets
      .listCardTemplates(kind, portraitFreeOnly, classicalStyleOnly)
      .catch(() => []);
    if (!list.length) return null;
    let h = 0;
    for (const ch of input.idempotencyKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = list[h % list.length]!;
    const image = await this.mediaRead.getMedia(input.userId, pick.mediaId).catch(() => null);
    if (!image) return null;
    return {
      mediaId: pick.mediaId,
      source: 'library',
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
      chargedMicros: 0,
    };
  }
}
