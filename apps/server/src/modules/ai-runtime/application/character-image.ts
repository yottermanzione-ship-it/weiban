/**
 * T-072 角色发图（MED-02，D-L5-05）。说明见 docs/ai/call-and-image.md 第 2 节。
 *
 * - 真人角色：只生成「TA 视角」的景物、食物、物品、宠物、场景，提示词明确不出现人物；生成后用识图模型做人脸检查，
 *   有人脸就丢弃（删除媒体）并改用素材库。
 * - 历史人物：一律古风插画（policy.checkImageGeneration 的 style = classical_illustration）。
 * - 虚构 / 原创角色：可以画角色形象（depictsCharacter = true，经 policy 允许），不以「像某位真人」为目标。
 * - 平台未开通图片服务、余额不足或生成失败：从素材库（卡面模板库，真人角色只取无肖像模板）选一张；没有就不发。
 * - 计费：按张（网关 image 单位）；人脸检查按识图 token。
 *
 * 对外：generate() 给私聊配图、朋友圈配图、卡片画面（T-076 / T-082 经 ai-runtime 调用）、宠物照片（T-082）共用。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  MediaAssetReadPort,
  MediaSystemPort,
  MediaReadPort,
  ModelGatewayMediaPort,
  ModelGatewayPort,
  PolicyPort,
  CharacterReadPort,
} from '@weiban/contracts';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { MEDIA_ASSET_READ_PORT, MEDIA_SYSTEM_PORT, MEDIA_READ_PORT } from '../../media/index.js';
import { MODEL_GATEWAY_MEDIA_PORT, MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';

export type ImageUse = 'chat' | 'moments' | 'card' | 'pet';

export interface GenerateCharacterImageInput {
  userId: string;
  characterId: string;
  conversationId?: string;
  /** 画面内容（日常事件、卡片主题、宠物描述）。 */
  scene: string;
  use: ImageUse;
  /** 卡片用：卡片种类（素材库兜底时按种类取模板）。 */
  cardKind?: string;
  /** 想画角色本人（仅虚构 / 原创角色可能被允许）。 */
  wantCharacter?: boolean;
  idempotencyKey: string;
  /** 系统主动发起（朋友圈、主动分享）计入后台预算。 */
  countAsBackground?: boolean;
}

export interface CharacterImageResult {
  mediaId: string;
  source: 'generated' | 'library';
  width: number | null;
  height: number | null;
  sizeBytes?: number;
}

@Injectable()
export class CharacterImageService {
  constructor(
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(MODEL_GATEWAY_MEDIA_PORT) private readonly media: ModelGatewayMediaPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly files: MediaSystemPort,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
  ) {}

  async generate(input: GenerateCharacterImageInput): Promise<CharacterImageResult | null> {
    const policy = await this.policy.getCharacterPolicy(input.userId, input.characterId);
    if (!policy) return null;
    const style = policy.isHistorical ? 'classical_illustration' : 'unspecified';
    let depicts = !!input.wantCharacter && !policy.isRealPerson;
    let decision = await this.policy.checkImageGeneration({
      userId: input.userId,
      characterId: input.characterId,
      depictsCharacter: depicts,
      style,
    });
    if (!decision.allowed && depicts) {
      depicts = false;
      decision = await this.policy.checkImageGeneration({
        userId: input.userId,
        characterId: input.characterId,
        depictsCharacter: false,
        style,
      });
    }
    if (decision.allowed && (await this.media.isServiceEnabled('image_generation'))) {
      const role = await this.characters.getForRuntime(input.userId, input.characterId);
      const scene = input.scene.slice(0, 400);
      const prompt = policy.isRealPerson
        ? `第一人称视角拍摄的生活照片：${scene}。画面中只有景物、食物、物品、宠物或场景，绝对不出现任何人物、人脸、人体或人像海报。`
        : depicts
          ? `原创角色插画：${role?.profile.name ?? '角色'}，${role?.profile.intro.slice(0, 120) ?? ''}。场景：${scene}。原创形象，不模仿任何真实人物。`
          : `第一人称视角的生活照片：${scene}。画面以景物、食物、物品或场景为主，不出现可识别的真实人物。`;
      const generated = await this.media.generateImage({
        userId: input.userId,
        purpose: 'image_generation',
        billingOwner: 'user',
        characterId: input.characterId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        prompt,
        style,
        size: '1024x1024',
        ownerUserId: input.userId,
        idempotencyKey: `img:${input.idempotencyKey}`,
        ...(input.countAsBackground ? { countAsBackground: true } : {}),
      });
      if (generated.ok) {
        // MED-02：真人角色（含历史人物）生成后人脸检查，有人脸就丢弃。
        const faceFree =
          !policy.isRealPerson || (await this.noFace(input, generated.value.mediaId));
        if (faceFree)
          return {
            mediaId: generated.value.mediaId,
            source: 'generated',
            width: 1024,
            height: 1024,
            sizeBytes: (await this.mediaRead.getMedia(input.userId, generated.value.mediaId))
              .sizeBytes,
          };
        await this.files.deleteObject(generated.value.mediaId).catch(() => undefined);
      }
    }
    return this.fromLibrary(input, policy.isRealPerson);
  }

  /** 人脸检查：识图模型判断；判断不了（未开通 / 失败）按「可能有人脸」处理，宁可不发。 */
  private async noFace(input: GenerateCharacterImageInput, mediaId: string): Promise<boolean> {
    const result = await this.gateway.generateText({
      userId: input.userId,
      characterId: input.characterId,
      purpose: 'vision',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'text',
      maxOutputTokens: 5,
      idempotencyKey: `img-face:${mediaId}`,
      ...(input.countAsBackground ? { countAsBackground: true } : {}),
      messages: [
        {
          role: 'system',
          content:
            '判断图片里是否出现任何人脸、人像（含照片、海报、画像中的人脸，侧脸也算）。只回答 YES 或 NO。',
        },
        {
          role: 'user',
          content: '图里有人脸吗？',
          images: [{ mediaId, ownerUserId: input.userId }],
        },
      ],
    });
    return result.ok && /^\s*NO\b/i.test(result.value.text);
  }

  private async fromLibrary(
    input: GenerateCharacterImageInput,
    portraitFreeOnly: boolean,
  ): Promise<CharacterImageResult | null> {
    const kind =
      input.use === 'card' ? (input.cardKind ?? 'moment') : input.use === 'pet' ? 'pet' : 'moment';
    const list = await this.assets.listCardTemplates(kind, portraitFreeOnly).catch(() => []);
    if (!list.length) return null;
    let h = 0;
    for (const ch of input.idempotencyKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = list[h % list.length]!;
    return {
      mediaId: pick.mediaId,
      source: 'library',
      width: null,
      height: null,
      sizeBytes: (await this.mediaRead.getMedia(input.userId, pick.mediaId)).sizeBytes,
    };
  }
}
