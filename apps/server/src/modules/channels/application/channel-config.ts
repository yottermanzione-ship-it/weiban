/**
 * 渠道运行配置（3.42，2026-10-25 按真实协议重做）：把平台配置翻译成「页面该怎么显示、能不能发起绑定」。
 *
 * - live           运维显式打开（CHANNEL_*_ENABLED=1）且依赖可用：可以走真实协议。
 * - not_configured 打开了但依赖缺项（例如 iLink 节点为空）：页面提示「尚未配置」，接口 422。
 * - not_integrated 没打开（**默认就是这一档**）：页面显示「未联调」，接口 422，
 *                  worker 也不会连接、不会轮询、不会发送任何东西。
 *
 * 微信没有服务器侧长期密钥：bot_token 是用户本人扫码后才产生的，按用户 DEK 加密存库。
 * 微博的 AppID / AppSecret 同样是用户本人填、加密存库；这里只有开关与端点。
 */
import type { ChannelId, ChannelIntegrationStatus } from '@weiban/contracts';
import type { AppConfig } from '../../../platform/index.js';

export interface ChannelRuntimeConfig {
  readonly channel: ChannelId;
  readonly integration: ChannelIntegrationStatus;
  /** iLink 服务节点（只有微信有；已校验过的官方 HTTPS 节点）。 */
  readonly ilinkBaseUrl: string;
  /** 微博端点（只有微博有）。 */
  readonly weibo: {
    readonly tokenEndpoint: string | null;
    readonly wsEndpoint: string | null;
  } | null;
}

/**
 * 微博能不能按「已联通」处理。
 *
 * **本轮固定 false**：ws_token 只能证明「AppID / AppSecret → bot 自己的 uid」，
 * 证明不了「私信进来的是不是这个账号的主人」。在能验证对方身份之前开放绑定，
 * 等于任意私信者都能改绑、触发本人付费聊天并收到私密回复——比「未联调」危险得多。
 * 所以即使运维设了 CHANNEL_WEIBO_ENABLED=1，微博也仍然按「未联调」显示、接口 422。
 * 等协议侧能给出可验证的对方 uid（并在 domain/peer.ts 落地判定）再打开这里。
 */
export const WEIBO_PEER_UID_VERIFIABLE = false;

export function channelRuntimeConfig(config: AppConfig, channel: ChannelId): ChannelRuntimeConfig {
  if (channel === 'wechat') {
    const settings = config.channels.wechat;
    const integration: ChannelIntegrationStatus = !settings.enabled
      ? 'not_integrated'
      : settings.ilinkBaseUrl
        ? 'live'
        : 'not_configured';
    return { channel, integration, ilinkBaseUrl: settings.ilinkBaseUrl, weibo: null };
  }
  const settings = config.channels.weibo;
  const integration: ChannelIntegrationStatus =
    settings.enabled && WEIBO_PEER_UID_VERIFIABLE ? 'live' : 'not_integrated';
  return {
    channel,
    integration,
    ilinkBaseUrl: '',
    weibo: { tokenEndpoint: settings.tokenEndpoint, wsEndpoint: settings.wsEndpoint },
  };
}
