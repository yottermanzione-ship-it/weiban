import { Controller, Get } from '@nestjs/common';
import { PluginEndpoints, type Plugin } from '@weiban/contracts';
import { RequireAuth } from '../../../platform/index.js';
@Controller('api/v1/plugins')
@RequireAuth(PluginEndpoints.list.auth)
export class PluginsController {
  @Get() list(): { items: Plugin[] } {
    return {
      items: [
        {
          pluginId: 'wechat',
          name: '微信接入',
          description: '在微信中与角色聊天，外部接入暂未开放',
          status: 'coming_soon',
        },
        {
          pluginId: 'qq',
          name: 'QQ接入',
          description: '在QQ中与角色聊天，外部接入暂未开放',
          status: 'coming_soon',
        },
        {
          pluginId: 'weibo',
          name: '微博接入',
          description: '微博渠道接入暂未开放',
          status: 'coming_soon',
        },
      ],
    };
  }
}
