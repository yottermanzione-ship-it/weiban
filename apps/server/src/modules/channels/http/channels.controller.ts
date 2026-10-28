/** 3.42：设置 › 插件 › 微信 / 微博接入（契约 ChannelEndpoints，真实 iLink / OpenIM 协议）。 */
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
} from '@nestjs/common';
import {
  ChannelEndpoints as E,
  type ChannelId,
  type ChannelCharacterRequest,
  type WechatQrRequest,
  type WeiboConnectRequest,
  type QqConnectRequest,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ChannelsService } from '../application/channels.service.js';

const channelParams = new ContractPipe(E.unbind.params!);
const attemptParams = new ContractPipe(E.wechatQrStatus.params!);
const qrBody = new ContractPipe(E.wechatQr.body!);
const characterBody = new ContractPipe(E.setCharacter.body!);
const qqBody = new ContractPipe(E.qqConnect.body!);
const weiboBody = new ContractPipe(E.weiboConnect.body!);

@Controller('api/v1/channels')
@RequireAuth('user')
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.channels.list(p.userId);
  }

  @Post('wechat/qr')
  @HttpCode(200)
  wechatQr(@CurrentPrincipal() p: AuthPrincipal, @Body(qrBody) body: WechatQrRequest) {
    return this.channels.wechatQr(p.userId, body.characterId);
  }

  @Get('wechat/qr/:attemptId')
  wechatQrStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(attemptParams) params: { attemptId: string },
  ) {
    return this.channels.wechatQrStatus(p.userId, params.attemptId);
  }

  @Patch(':channel/binding')
  setCharacter(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(channelParams) params: { channel: ChannelId },
    @Body(characterBody) body: ChannelCharacterRequest,
  ) {
    return this.channels.setCharacter(p.userId, params.channel, body.characterId);
  }

  @Post('weibo/binding')
  @HttpCode(200)
  weiboConnect(@CurrentPrincipal() p: AuthPrincipal, @Body(weiboBody) body: WeiboConnectRequest) {
    return this.channels.weiboConnect(p.userId, body);
  }

  @Post('qq/binding')
  @HttpCode(200)
  qqConnect(@CurrentPrincipal() p: AuthPrincipal, @Body(qqBody) body: QqConnectRequest) {
    return this.channels.qqConnect(p.userId, body);
  }

  @Post('qq/pairing')
  @HttpCode(200)
  qqPairing(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(characterBody) body: ChannelCharacterRequest,
  ) {
    return this.channels.qqPairing(p.userId, body.characterId);
  }

  @Delete(':channel/binding')
  unbind(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(channelParams) params: { channel: ChannelId },
  ) {
    return this.channels.unbind(p.userId, params.channel);
  }
}
