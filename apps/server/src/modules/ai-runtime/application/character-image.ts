/** 卡片/宠物底图保留原用途；普通聊天、朋友圈不再借日常图库或网页封面发图。 */
import { Inject, Injectable } from '@nestjs/common';
import type { MediaAssetReadPort, MediaReadPort, PolicyPort } from '@weiban/contracts';
import { MEDIA_ASSET_READ_PORT, MEDIA_READ_PORT } from '../../media/index.js';
import { POLICY_PORT } from '../../policy/index.js';

export type ImageUse = 'chat' | 'moments' | 'card' | 'pet';
export interface GenerateCharacterImageInput {
  userId: string;
  characterId: string;
  conversationId?: string;
  scene: string;
  use: ImageUse;
  cardKind?: string;
  /** 兼容旧调用方；不生成角色肖像。 */
  wantCharacter?: boolean;
  idempotencyKey: string;
  countAsBackground?: boolean;
  ecologyTask?: boolean;
  /** 兼容旧调用方；不能据此启用未核人物/出处/时间的旧封面搜索。 */
  searchPublic?: boolean;
  /** 可信联网图片主链接入前不会发起搜索，也不会回报虚构费用。 */
  onSearchCharged?: (chargedMicros: number) => void;
}
export interface CharacterImageResult {
  mediaId: string;
  source: 'web' | 'library';
  width: number | null;
  height: number | null;
  sizeBytes?: number;
  chargedMicros?: number;
  sourceUrl?: string;
}

@Injectable()
export class CharacterImageService {
  constructor(
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
  ) {}

  /** 保留方法名兼容调用方；没有可信普通图时宁可不发，绝不抽日常图库或拿网页封面凑数。 */
  async generate(input: GenerateCharacterImageInput): Promise<CharacterImageResult | null> {
    if (input.use === 'chat' || input.use === 'moments') return null;
    const kind = input.use === 'pet' ? 'pet' : (input.cardKind ?? 'moment');
    if (kind === 'daily_photo') return null;
    const policy = await this.policy.getCharacterPolicy(input.userId, input.characterId);
    if (!policy) return null;
    const list = await this.assets
      .listCardTemplates(kind, policy.isRealPerson, policy.isHistorical)
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
