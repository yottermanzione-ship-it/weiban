/**
 * 3.15 契约的 GET /api/v1/plugins（兼容入口，字段只增不减）。
 * 页面已经改用 ChannelEndpoints.list；旧客户端仍可能读这个接口，所以状态跟着真实绑定关系走，不再写死 coming_soon。
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { PluginEndpoints } from '@weiban/contracts';
import { CurrentPrincipal, RequireAuth, type AuthPrincipal } from '../../../platform/index.js';
import { ChannelsService } from '../application/channels.service.js';

@Controller('api/v1/plugins')
@RequireAuth(PluginEndpoints.list.auth)
export class PluginsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.channels.plugins(p.userId);
  }
}
