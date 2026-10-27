/**
 * 渠道运行配置（3.42，2026-10-25 按真实协议重做；同日补内测白名单）：
 * 把平台配置翻译成「这个用户看到什么、能不能发起绑定、worker 要不要理他」。
 *
 * - live           运维显式打开（CHANNEL_*_ENABLED=1）**且**该用户在 CHANNEL_*_ALLOWED_USER_IDS 里，
 *                  依赖也齐：可以走真实协议。
 * - not_configured 打开了但依赖缺项（例如 iLink 节点为空）：页面提示「尚未配置」，接口 422。
 * - not_integrated 没打开、或这个用户不在白名单（**默认就是这样**）：页面显示「未联调」，
 *                  接口 422；worker 也不会连接、不会轮询、不会发送。
 *
 * 白名单是「内测」而不是「公测开关」：列表为空 = 谁都不行，避免误把通道开给所有人。
 * 这一层只做判定，不打印任何凭据信息。
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
 * 所以即使运维设了 CHANNEL_WEIBO_ENABLED=1 且把用户加进白名单，微博也仍然按「未联调」处理。
 */
export const WEIBO_PEER_UID_VERIFIABLE = false;

/** 某渠道的内测白名单（空数组 = 谁都不行）。 */
export function channelAllowedUsers(config: AppConfig, channel: ChannelId): readonly string[] {
  const settings = channel === 'wechat' ? config.channels.wechat : config.channels.weibo;
  return settings.allowedUserIds;
}

/** 这个用户是否在内测白名单里（大小写不敏感；空 id 一律 false）。worker 与入站投递也用它。 */
export function isChannelUserAllowed(
  config: AppConfig,
  channel: ChannelId,
  userId: string | null | undefined,
): boolean {
  const id = String(userId ?? '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return channelAllowedUsers(config, channel).includes(id);
}

/**
 * userId 省略时按「全局能力」返回（worker 用它判断这条渠道要不要干活）；
 * 传了 userId 就是「这个用户」的视角（页面与接口用），不在白名单一律 not_integrated。
 */
export function channelRuntimeConfig(
  config: AppConfig,
  channel: ChannelId,
  userId?: string,
): ChannelRuntimeConfig {
  const userAllowed = userId === undefined ? true : isChannelUserAllowed(config, channel, userId);
  if (channel === 'wechat') {
    const settings = config.channels.wechat;
    const integration: ChannelIntegrationStatus =
      !settings.enabled || !userAllowed
        ? 'not_integrated'
        : settings.ilinkBaseUrl
          ? 'live'
          : 'not_configured';
    return { channel, integration, ilinkBaseUrl: settings.ilinkBaseUrl, weibo: null };
  }
  const settings = config.channels.weibo;
  const integration: ChannelIntegrationStatus =
    settings.enabled && userAllowed && WEIBO_PEER_UID_VERIFIABLE ? 'live' : 'not_integrated';
  return {
    channel,
    integration,
    ilinkBaseUrl: '',
    weibo: { tokenEndpoint: settings.tokenEndpoint, wsEndpoint: settings.wsEndpoint },
  };
}
