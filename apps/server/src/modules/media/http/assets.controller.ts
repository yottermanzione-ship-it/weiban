/**
 * 素材库 HTTP（T-069）：StickerEndpoints、StickerAdminEndpoints、VoiceEndpoints、VoiceAdminEndpoints、
 * CardTemplateAdminEndpoints（契约 http/assets.ts）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  CardTemplateAdminEndpoints as T,
  StickerAdminEndpoints as SA,
  StickerEndpoints as S,
  VoiceAdminEndpoints as VA,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MediaAssetService } from '../application/assets.js';

@Controller('api/v1')
@RequireAuth('user')
export class StickerController {
  constructor(@Inject(MediaAssetService) private readonly assets: MediaAssetService) {}
  @Get('stickers/packs')
  listPacks(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.listUserPacks(me.userId);
  }
  @Get('me/stickers')
  listMine(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.listMyStickers(me.userId);
  }
  @Post('me/stickers')
  @HttpCode(201)
  add(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(S.addMySticker.body!))
    body:
      | { from: 'message'; conversationId: string; messageId: string }
      | { from: 'upload'; mediaId: string },
  ) {
    return this.assets.addMySticker(me.userId, body);
  }
  @Put('me/stickers/order')
  @HttpCode(204)
  async reorder(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(S.reorderMyStickers.body!)) body: { stickerIds: string[] },
  ) {
    await this.assets.reorderMyStickers(me.userId, body.stickerIds);
  }
  @Delete('me/stickers/:stickerId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(S.deleteMySticker.params!)) p: { stickerId: string },
  ) {
    await this.assets.deleteMySticker(me.userId, p.stickerId);
  }
  @Get('voices')
  listVoices(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.listUserVoices(me.userId);
  }
}

@Controller('api/v1/admin')
@RequireAuth('admin')
export class AssetAdminController {
  constructor(@Inject(MediaAssetService) private readonly assets: MediaAssetService) {}
  // 表情包
  @Get('stickers/packs')
  listPacks(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.adminListPacks(me.userId);
  }
  @Post('stickers/packs')
  @HttpCode(201)
  createPack(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(SA.createPack.body!)) body: unknown,
  ) {
    return this.assets.createPack(me.userId, body);
  }
  @Patch('stickers/packs/:packId')
  updatePack(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(SA.updatePack.params!)) p: { packId: string },
    @Body(new ContractPipe(SA.updatePack.body!)) body: unknown,
  ) {
    return this.assets.updatePack(me.userId, p.packId, body);
  }
  @Post('stickers/packs/:packId/stickers')
  @HttpCode(201)
  addSticker(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(SA.addSticker.params!)) p: { packId: string },
    @Body(new ContractPipe(SA.addSticker.body!)) body: unknown,
  ) {
    return this.assets.addLibrarySticker(me.userId, p.packId, body);
  }
  @Delete('stickers/:stickerId')
  @HttpCode(204)
  async deleteSticker(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(SA.deleteSticker.params!)) p: { stickerId: string },
  ) {
    await this.assets.deleteLibrarySticker(me.userId, p.stickerId);
  }
  // 音色
  @Get('voices')
  listVoices(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.adminListVoices(me.userId);
  }
  @Post('voices')
  @HttpCode(201)
  createVoice(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(VA.createVoice.body!)) body: unknown,
  ) {
    return this.assets.createVoice(me.userId, body);
  }
  @Patch('voices/:voiceId')
  updateVoice(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(VA.updateVoice.params!)) p: { voiceId: string },
    @Body(new ContractPipe(VA.updateVoice.body!)) body: unknown,
  ) {
    return this.assets.updateVoice(me.userId, p.voiceId, body);
  }
  // 卡面模板
  @Get('card-templates')
  listTemplates(@CurrentPrincipal() me: AuthPrincipal) {
    return this.assets.adminListTemplates(me.userId);
  }
  @Post('card-templates')
  @HttpCode(201)
  createTemplate(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(T.createTemplate.body!)) body: unknown,
  ) {
    return this.assets.createTemplate(me.userId, body);
  }
  @Patch('card-templates/:templateId')
  updateTemplate(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(T.updateTemplate.params!)) p: { templateId: string },
    @Body(new ContractPipe(T.updateTemplate.body!)) body: unknown,
  ) {
    return this.assets.updateTemplate(me.userId, p.templateId, body);
  }
}
