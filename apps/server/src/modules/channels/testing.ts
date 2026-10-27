/** 渠道集成测试装配入口，不扩大生产模块端口。 */
export { ChannelStore, type BindingRow, type OutboundRow } from './application/channel-store.js';
export { ChannelsService } from './application/channels.service.js';
export { ChannelBridge } from './application/channel-bridge.js';
export { ChannelsWorker } from './application/channels.worker.js';
export { WeiboRuntime } from './application/weibo-runtime.js';
