import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelId, IdentityMembershipReadPort } from '@weiban/contracts';
import { ConfigError, loadConfig } from '../../platform/config/config.js';
import { assertChannelAccess, hasChannelAccess } from './application/channel-access.js';
import { channelRuntimeConfig, isChannelUserAllowed } from './application/channel-config.js';
import { ChannelBridge } from './application/channel-bridge.js';
import type { BindingRow } from './application/channel-store.js';
const channels: ChannelId[] = ['wechat', 'qq', 'weibo'];
const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '22222222-3333-4444-8555-666666666666';
const CHARACTER = '33333333-4444-4555-8666-777777777777';
function config(channel: ChannelId, enabled = true, publicAccess = true) {
  const prefix = `CHANNEL_${channel.toUpperCase()}`;
  return loadConfig({
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/weiban_test',
    [`${prefix}_ENABLED`]: enabled ? '1' : '0',
    [`${prefix}_PUBLIC_ACCESS`]: publicAccess ? '1' : '0',
  });
}
describe('三个渠道的显式公开模式', () => {
  for (const channel of channels) {
    it(`${channel}：公开后名单外的已登录用户可用，空身份仍拒绝`, () => {
      const cfg = config(channel);
      expect(channelRuntimeConfig(cfg, channel, OWNER).integration).toBe('live');
      expect(channelRuntimeConfig(cfg, channel, OTHER).integration).toBe('live');
      expect(isChannelUserAllowed(cfg, channel, '')).toBe(false);
      expect(isChannelUserAllowed(cfg, channel, null)).toBe(false);
      for (const other of channels.filter((id) => id !== channel))
        expect(channelRuntimeConfig(cfg, other, OWNER).integration).toBe('not_integrated');
    });
    it(`${channel}：公开不绕过运行开关，默认空白名单仍关闭`, () => {
      expect(channelRuntimeConfig(config(channel, false, true), channel, OWNER).integration).toBe(
        'not_integrated',
      );
      expect(channelRuntimeConfig(config(channel, true, false), channel, OWNER).integration).toBe(
        'not_integrated',
      );
    });
    it(`${channel}：免费账号可绑定/换角色，其他会员权益不变`, async () => {
      const isProPlus = vi.fn(async () => false);
      const membership = { isProPlus } as unknown as IdentityMembershipReadPort;
      const cfg = config(channel);
      expect(await hasChannelAccess(cfg, channel, membership, OWNER)).toBe(true);
      for (const action of ['bind', 'new_qr', 'switch_character'] as const)
        await expect(
          assertChannelAccess(cfg, channel, membership, OWNER, action),
        ).resolves.toBeUndefined();
      expect(isProPlus).not.toHaveBeenCalled();
      await expect(
        assertChannelAccess(config(channel, true, false), channel, membership, OWNER, 'bind'),
      ).rejects.toMatchObject({ code: 'membership_required' });
    });
  }
  it('非法公开开关直接拒绝启动，不把拼错的值当作公开', () =>
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/weiban_test',
        CHANNEL_QQ_PUBLIC_ACCESS: 'oops',
      }),
    ).toThrow(ConfigError));
});

function bridgeFor(channel: ChannelId, scope = 'normal') {
  const binding = {
    id: '44444444-5555-4666-8777-888888888888',
    user_id: OWNER,
    channel,
    status: 'active',
    generation: 1,
    character_id: CHARACTER,
    account_id: 'owner-peer',
    context_token_sealed: Buffer.from('test-sealed-peer'),
  } as unknown as BindingRow;
  const store = {
    bindingById: vi.fn(async () => binding),
    insertInbound: vi.fn(async () => ({ id: 'inbound-test', clientMsgId: 'client-test' })),
    finishInbound: vi.fn(async () => {}),
    touchEvent: vi.fn(async () => {}),
    pinWeiboPeer: vi.fn(async () => Buffer.from('owner-peer')),
  };
  const qq = { setReply: vi.fn(async () => true), consume: vi.fn(async () => true) };
  const membership = { isProPlus: vi.fn(async () => false) };
  const chatRead = {
    findDirectConversation: vi.fn(async () => ({
      conversationId: 'direct-test',
      contentScope: scope,
    })),
  };
  const chat = { sendMessage: vi.fn(async () => ({ message: { messageId: 'message-test' } })) };
  const bridge = new ChannelBridge(
    store as never,
    qq as never,
    { now: () => new Date('2026-10-30T00:00:00Z') } as never,
    { warn: vi.fn() } as never,
    {
      seal: vi.fn(async () => Buffer.from('sealed-test')),
      open: vi.fn(async () => Buffer.from('owner-peer')),
    } as never,
    membership as never,
    chatRead as never,
    chat as never,
    config(channel),
  );
  const input = {
    externalId: 'external-test',
    senderId: 'owner-peer',
    text: '普通测试文字',
    contextToken: '',
    createdAt: new Date('2026-10-30T00:00:00Z'),
    weiboSession: { bindingId: binding.id, generation: 1 },
    qqSession: { bindingId: binding.id, generation: 1 },
  };
  return { binding, store, qq, membership, chatRead, chat, bridge, input };
}
describe('公开模式仍隔离本人消息、角色和私密范围（全为内存假上游）', () => {
  for (const channel of channels) {
    it(`${channel}：免费账号日常文字仍交给原聊天计费入口`, async () => {
      const t = bridgeFor(channel);
      expect(await t.bridge.ingest(t.binding, t.input)).toBe('accepted');
      expect(t.chat.sendMessage).toHaveBeenCalledWith(
        OWNER,
        'direct-test',
        expect.objectContaining({ content: { type: 'text', text: '普通测试文字' } }),
      );
      expect(t.chatRead.findDirectConversation).toHaveBeenCalledWith(OWNER, CHARACTER);
      expect(t.membership.isProPlus).not.toHaveBeenCalled();
    });
    it(`${channel}：私密会话不调用聊天/模型计费入口`, async () => {
      const t = bridgeFor(channel, 'adult');
      expect(await t.bridge.ingest(t.binding, t.input)).toBe('rejected');
      expect(t.chat.sendMessage).not.toHaveBeenCalled();
    });
  }
  for (const channel of ['wechat', 'qq'] as const)
    it(`${channel}：公开后陌生发件人仍不能借绑定调用角色`, async () => {
      const t = bridgeFor(channel);
      expect(await t.bridge.ingest(t.binding, { ...t.input, senderId: 'stranger-peer' })).toBe(
        'rejected',
      );
      expect(t.chat.sendMessage).not.toHaveBeenCalled();
    });
  it('QQ免费账号的一次性配对不发送聊天消息，不调用模型或计费', async () => {
    const t = bridgeFor('qq');
    t.binding.status = 'unbound';
    expect(await t.bridge.pairQq(t.binding, { ...t.input, text: '绑定 ABCD123456' })).toBe(true);
    expect(t.qq.consume).toHaveBeenCalledOnce();
    expect(t.chat.sendMessage).not.toHaveBeenCalled();
  });
  it('旧代际或不属于候选账号的绑定仍拒绝，不迁移或改写归属', async () => {
    const t = bridgeFor('qq');
    const candidate = { ...t.binding, user_id: OTHER };
    expect(await t.bridge.ingest(candidate, t.input)).toBe('rejected');
    expect(
      await t.bridge.ingest(t.binding, {
        ...t.input,
        qqSession: { bindingId: t.binding.id, generation: 0 },
      }),
    ).toBe('rejected');
    expect(t.chat.sendMessage).not.toHaveBeenCalled();
  });
});
