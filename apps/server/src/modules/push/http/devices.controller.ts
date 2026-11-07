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
import { PushDeliveryEngine } from '../application/delivery-engine.js';
import { PUSH_CHANNELS, type PushChannelPort } from '../infra/channels.js';
@Controller('api/v1/push')
@RequireAuth('user')
export class PushDevicesController {
  constructor(
    @Inject(PushDeviceService) private readonly devices: PushDeviceService,
    @Inject(PushDeliveryEngine) private readonly engine: PushDeliveryEngine,
    @Inject(PUSH_CHANNELS) private readonly channels: PushChannelPort,
  ) {}
  @Get('local/:pushDeviceId')
  async pollLocal(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.pollLocal.params!)) params: { pushDeviceId: string },
  ) {
    return { items: await this.engine.pollLocal(p.userId, p.sessionId, params.pushDeviceId) };
  }
  @Post('local/:pushDeviceId/ack')
  @HttpCode(204)
  async acknowledgeLocal(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.acknowledgeLocal.params!)) params: { pushDeviceId: string },
    @Body(new ContractPipe(E.acknowledgeLocal.body!)) body: { notificationIds: string[] },
  ) {
    await this.engine.acknowledgeLocal(
      p.userId,
      p.sessionId,
      params.pushDeviceId,
      body.notificationIds,
    );
  }
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
