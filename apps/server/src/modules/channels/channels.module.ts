/**
 * channels 模块（3.42，中层）：设置 › 插件 › 微信 / 微博接入。
 *
 * 2026-10-25：按真实旧协议重做——服务器自己跑 iLink 长轮询（微信）与 OpenIM WSS（微博），
 * 不再假设存在一个「外部网关」，也不再有 webhook 回调入口。
 * 依赖其他模块的**端口**（chat / contacts / characters / identity），不读别人的表。
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { ContactsModule } from '../contacts/index.js';
import { IdentityModule } from '../identity/index.js';
import { ChannelBridge } from './application/channel-bridge.js';
import { ChannelStore } from './application/channel-store.js';
import { ChannelsService } from './application/channels.service.js';
import { ChannelsWorker } from './application/channels.worker.js';
import { WechatRuntime } from './application/wechat-runtime.js';
import { WeiboRuntime } from './application/weibo-runtime.js';
import { ChannelsController } from './http/channels.controller.js';
import { PluginsController } from './http/plugins.controller.js';

@Module({
  imports: [IdentityModule, ChatModule, ContactsModule, CharactersModule],
  controllers: [ChannelsController, PluginsController],
  providers: [
    ChannelStore,
    ChannelsService,
    ChannelBridge,
    WechatRuntime,
    WeiboRuntime,
    ChannelsWorker,
  ],
})
export class ChannelsModule {}
