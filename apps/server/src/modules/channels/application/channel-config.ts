/**
 * 渠道运行配置（3.42，2026-10-25 按真实协议重做；同日补内测白名单）：
 * 把平台配置翻译成「这个用户看到什么、能不能发起绑定、worker 要不要理他」。
 *
 * - live           运维显式打开（CHANNEL_*_ENABLED=1），并开启 PUBLIC_ACCESS 或用户在白名单内，
 *                  依赖也齐：可以走真实协议。
 * - not_configured 打开了但依赖缺项（例如 iLink 节点为空）：页面提示「尚未配置」，接口 422。
 * - not_integrated 没打开、或未公开且用户不在白名单（默认受限）：页面显示「未联调」，
 *                  接口 422；worker 也不会连接、不会轮询、不会发送。
 *
 * 默认仍为受限内测，空白名单不放行。只有显式 PUBLIC_ACCESS=1 才向所有已登录用户开放；不导入旧绑定。
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
 * 微博龙虾助手使用私信发放的专属 AppID / AppSecret，连接归属由凭据绑定决定。
 * 不向用户额外索取个人 UID；回信目标由该鉴权连接的入站消息自动取得并固定，见 ChannelBridge。
 * 是否公开由运维的 PUBLIC_ACCESS 明确控制；绑定只来自新版用户主动操作。
 */

/** Public access is opt-in and independent of provider enable/dependency checks. */
export function isChannelPublic(config: AppConfig, channel: ChannelId): boolean {
  const settings =
    channel === 'qq'
      ? config.channels.qq
      : channel === 'wechat'
        ? config.channels.wechat
        : config.channels.weibo;
  return settings?.publicAccess === true;
}

/** 某渠道的内测白名单（公开开关关闭时，空数组 = 谁都不行）。 */
export function channelAllowedUsers(config: AppConfig, channel: ChannelId): readonly string[] {
  if (channel === 'qq') return config.channels.qq?.allowedUserIds ?? [];
  const settings = channel === 'wechat' ? config.channels.wechat : config.channels.weibo;
  return settings.allowedUserIds;
}

/** 用户是否有渠道访问资格：公开模式或内测白名单。空 id 一律拒绝，worker 与入站共用。 */
export function isChannelUserAllowed(
  config: AppConfig,
  channel: ChannelId,
  userId: string | null | undefined,
): boolean {
  const id = String(userId ?? '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return isChannelPublic(config, channel) || channelAllowedUsers(config, channel).includes(id);
}

/**
 * userId 省略时按「全局能力」返回（worker 用它判断这条渠道要不要干活）；
 * 传了 userId 就是「这个用户」的视角；受限模式下不在白名单才是 not_integrated。
 */
export function channelRuntimeConfig(
  config: AppConfig,
  channel: ChannelId,
  userId?: string,
): ChannelRuntimeConfig {
  const userAllowed = userId === undefined ? true : isChannelUserAllowed(config, channel, userId);
  if (channel === 'qq')
    return {
      channel,
      integration: config.channels.qq?.enabled && userAllowed ? 'live' : 'not_integrated',
      ilinkBaseUrl: '',
      weibo: null,
    };
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
    settings.enabled && userAllowed ? 'live' : 'not_integrated';
  return {
    channel,
    integration,
    ilinkBaseUrl: '',
    weibo: { tokenEndpoint: settings.tokenEndpoint, wsEndpoint: settings.wsEndpoint },
  };
}
