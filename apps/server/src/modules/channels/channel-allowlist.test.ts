/**
 * 渠道内测白名单（2026-10-25）：只开放给名单内的账号，普通用户继续「未开放」。
 *
 * 这个文件只测两件最容易写错、且一旦写错就等于「对外全开」的事：
 * 1. 环境变量解析：逗号分隔、去空白、转小写、去重，非法 UUID 直接拒绝启动。
 * 2. 判定：不在名单 = not_integrated（页面「未联调」+ 接口 422 + worker 不轮询），
 *    而不是「开关打开就对所有人 live」。微博也必须同时满足开关和用户白名单。
 */
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../platform/config/config.js';
import { ConfigError, loadConfig } from '../../platform/config/config.js';
import {
  channelAllowedUsers,
  channelRuntimeConfig,
  isChannelUserAllowed,
} from './application/channel-config.js';

const OWNER = '9a76a467-fe83-41c1-9e3c-6270aefb8447';
const STRANGER = '11111111-2222-3333-4444-555555555555';

/** 只构造判定用得到的字段，其余按 AppConfig 形状补齐（测试不碰数据库/网络）。 */
function configOf(input: {
  wechatEnabled: boolean;
  wechatAllowed: readonly string[];
  ilinkBaseUrl?: string;
  weiboEnabled?: boolean;
  weiboAllowed?: readonly string[];
}): AppConfig {
  return {
    channels: {
      wechat: {
        enabled: input.wechatEnabled,
        ilinkBaseUrl: input.ilinkBaseUrl ?? 'https://ilinkai.weixin.qq.com',
        allowedUserIds: input.wechatAllowed,
      },
      weibo: {
        enabled: input.weiboEnabled ?? false,
        tokenEndpoint: null,
        wsEndpoint: null,
        allowedUserIds: input.weiboAllowed ?? [],
      },
    },
  } as unknown as AppConfig;
}

describe('内测白名单：环境变量解析', () => {
  it('逗号分隔、去空白、转小写、去重', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://weiban:weiban@127.0.0.1:5432/weiban',
      CHANNEL_WECHAT_ENABLED: '1',
      CHANNEL_WECHAT_ALLOWED_USER_IDS: ` ${OWNER.toUpperCase()} , ${OWNER} ,${STRANGER} `,
    });
    expect(config.channels.wechat.enabled).toBe(true);
    expect(config.channels.wechat.allowedUserIds).toEqual([OWNER, STRANGER]);
  });

  it('不填 = 空名单（谁都不能用），不是「谁都能用」', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://weiban:weiban@127.0.0.1:5432/weiban',
    });
    expect(config.channels.wechat.allowedUserIds).toEqual([]);
    expect(config.channels.weibo.allowedUserIds).toEqual([]);
    expect(isChannelUserAllowed(config, 'wechat', OWNER)).toBe(false);
  });

  it('非法 UUID 直接拒绝启动（不静默忽略，避免以为开了其实没开）', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://weiban:weiban@127.0.0.1:5432/weiban',
        CHANNEL_WECHAT_ALLOWED_USER_IDS: 'not-a-uuid',
      }),
    ).toThrow(ConfigError);
  });
});

describe('内测白名单：服务端判定', () => {
  it('开关打开后，只有名单内用户是 live，其他人仍是未联调', () => {
    const config = configOf({ wechatEnabled: true, wechatAllowed: [OWNER] });
    expect(channelRuntimeConfig(config, 'wechat', OWNER).integration).toBe('live');
    expect(channelRuntimeConfig(config, 'wechat', STRANGER).integration).toBe('not_integrated');
    expect(channelRuntimeConfig(config, 'wechat', undefined).integration).toBe('live');
    expect(channelAllowedUsers(config, 'wechat')).toEqual([OWNER]);
  });

  it('开关关闭时名单内也不可用（名单只管「谁能用」，开关只管「开没开」）', () => {
    const config = configOf({ wechatEnabled: false, wechatAllowed: [OWNER] });
    expect(channelRuntimeConfig(config, 'wechat', OWNER).integration).toBe('not_integrated');
    // 名单本身仍然包含他；不可用来自开关。入站投递用的是 channelRuntimeConfig，不是名单本身。
    expect(isChannelUserAllowed(config, 'wechat', OWNER)).toBe(true);
  });

  it('开关打开但缺节点 = not_configured（页面提示尚未配置）', () => {
    const config = configOf({ wechatEnabled: true, wechatAllowed: [OWNER], ilinkBaseUrl: '' });
    expect(channelRuntimeConfig(config, 'wechat', OWNER).integration).toBe('not_configured');
  });

  it('大小写不敏感，空 id 一律拒绝', () => {
    const config = configOf({ wechatEnabled: true, wechatAllowed: [OWNER] });
    expect(isChannelUserAllowed(config, 'wechat', OWNER.toUpperCase())).toBe(true);
    expect(isChannelUserAllowed(config, 'wechat', '')).toBe(false);
    expect(isChannelUserAllowed(config, 'wechat', null)).toBe(false);
  });

  it('微博龙虾助手凭据接入：名单内可绑定，名单外仍拒绝', () => {
    const config = configOf({
      wechatEnabled: true,
      wechatAllowed: [OWNER],
      weiboEnabled: true,
      weiboAllowed: [OWNER],
    });
    expect(isChannelUserAllowed(config, 'weibo', OWNER)).toBe(true);
    expect(channelRuntimeConfig(config, 'weibo', OWNER).integration).toBe('live');
    expect(channelRuntimeConfig(config, 'weibo', STRANGER).integration).toBe('not_integrated');
  });
});
