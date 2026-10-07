import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { PushEndpoints as E } from '@weiban/contracts';
import {
  AppError,
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PushDeviceService } from '../application/devices.js';
import { PUSH_CHANNELS, type PushChannelPort } from '../infra/channels.js';
@Controller('api/v1/push')
@RequireAuth('user')
export class PushDevicesController {
  constructor(
    @Inject(PushDeviceService) private readonly devices: PushDeviceService,
    @Inject(PUSH_CHANNELS) private readonly channels: PushChannelPort,
  ) {}
  @Get('vapid-public-key')
  getPublicKey() {
    const publicKey = this.channels.publicKey();
    if (!publicKey) throw new AppError('service_unavailable', '网页推送尚未配置');
    return { publicKey };
  }
  @Post('devices')
  register(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.registerDevice.body!)) input: unknown,
  ) {
    return this.devices.register(p.userId, p.sessionId, input);
  }
  @Delete('devices/:pushDeviceId')
  @HttpCode(204)
  async unregister(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.unregisterDevice.params!)) params: { pushDeviceId: string },
  ) {
    await this.devices.unregister(p.userId, p.sessionId, params.pushDeviceId);
  }
}
