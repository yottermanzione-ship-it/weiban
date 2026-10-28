import { describe, expect, it } from 'vitest';
import {
  createQqClient,
  parseQqInbound,
  qqGatewayUrl,
  qqCodeHash,
  readQqPairingCode,
} from './domain/qq-openapi.js';
import { channelRuntimeConfig } from './application/channel-config.js';
import { loadConfig } from '../../platform/config/config.js';
const credentials = { appId: '1234567890', appSecret: 'QQ-CANARY-NOT-A-REAL-SECRET' };
const now = new Date('2026-10-28T12:00:00Z');
describe('QQ官方机器人线协议（全部假上游）', () => {
  it('只把 AppID/clientSecret 交给固定鉴权端点；网关与回复使用 QQBot 头', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const client = createQqClient(
      credentials,
      () => now.getTime(),
      async (url, init) => {
        requests.push({ url: String(url), init: init! });
        if (String(url).endsWith('/getAppAccessToken'))
          return Response.json({ access_token: 'TOKEN-CANARY', expires_in: '7200' });
        if (String(url).endsWith('/gateway'))
          return Response.json({ url: 'wss://api.bot.qq.com/websocket/' });
        return Response.json({ id: 'reply-1' });
      },
    );
    expect(await client.gateway()).toEqual({
      url: 'wss://api.bot.qq.com/websocket/',
      token: 'TOKEN-CANARY',
    });
    await client.send('opaque-peer', '普通回复', 'incoming-id', 1);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
      appId: credentials.appId,
      clientSecret: credentials.appSecret,
    });
    expect(requests.every((row) => row.init.redirect === 'error')).toBe(true);
    const sent = requests.at(-1)!;
    expect(sent.url).toBe('https://api.bot.qq.com/v2/users/opaque-peer/messages');
    expect(sent.init.headers).toMatchObject({
      Authorization: 'QQBot TOKEN-CANARY',
      'X-Union-Appid': credentials.appId,
    });
    expect(JSON.parse(String(sent.init.body))).toEqual({
      content: '普通回复',
      msg_type: 0,
      msg_id: 'incoming-id',
      msg_seq: 1,
    });
    expect(requests.filter((row) => row.url.endsWith('getAppAccessToken'))).toHaveLength(1);
  });
  it('HTTP错误不带上游回显的凭据、正文或请求体', async () => {
    const client = createQqClient(
      credentials,
      () => now.getTime(),
      async () => new Response(credentials.appSecret, { status: 401 }),
    );
    try {
      await client.gateway();
      throw new Error('未拒绝');
    } catch (error) {
      expect(String(error)).toContain('qq_token_401');
      expect(String(error)).not.toContain(credentials.appSecret);
    }
  });
  it('终止信号在发送前生效，不偷偷改发主动消息', async () => {
    let calls = 0;
    const client = createQqClient(
      credentials,
      () => now.getTime(),
      async () => {
        calls++;
        return Response.json({});
      },
    );
    const abort = new AbortController();
    abort.abort();
    await expect(client.send('peer', 'text', 'inbound', 1, abort.signal)).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(client.send('peer', 'text', '', 1)).rejects.toThrow();
  });
  it.each([
    'ws://api.bot.qq.com/websocket',
    'wss://evil.test/ws',
    'wss://api.bot.qq.com.evil.test/ws',
    'wss://name:secret@api.bot.qq.com/ws',
    'wss://api.bot.qq.com:8443/ws',
    'wss://api.bot.qq.com/ws?token=secret',
  ])('不把 token 交给非官方/混淆网关：%s', (url) => {
    expect(() => qqGatewayUrl(url)).toThrow();
  });
  it('只接官方 C2C 正文，文件空消息与群消息均不进入聊天', () => {
    const packet = {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'message',
        author: { user_openid: 'peer' },
        content: ' 普通文字 ',
        timestamp: '2026-10-28T11:59:50Z',
      },
    };
    expect(parseQqInbound(packet, now)).toMatchObject({
      messageId: 'message',
      peer: 'peer',
      text: '普通文字',
    });
    expect(parseQqInbound({ ...packet, t: 'GROUP_AT_MESSAGE_CREATE' }, now)).toBeNull();
    expect(
      parseQqInbound({ ...packet, d: { ...packet.d, content: '', attachments: [{}] } }, now),
    ).toBeNull();
    expect(
      parseQqInbound({ ...packet, d: { ...packet.d, author: { id: 'not-a-c2c-openid' } } }, now),
    ).toBeNull();
  });
  it('短码必须明确发送绑定命令，摘要绑定行号与凭据代际', () => {
    expect(readQqPairingCode('绑定 abcdef0123')).toBe('ABCDEF0123');
    expect(readQqPairingCode('abcdef0123')).toBeNull();
    expect(qqCodeHash('one', 1, 'ABCDEF0123').equals(qqCodeHash('one', 2, 'ABCDEF0123'))).toBe(
      false,
    );
    expect(qqCodeHash('one', 1, 'ABCDEF0123').equals(qqCodeHash('two', 1, 'ABCDEF0123'))).toBe(
      false,
    );
  });
  it('QQ默认关闭，开启但空名单仍拒绝，不沿用微博白名单', () => {
    const user = '11111111-2222-4333-8444-555555555555';
    const config = loadConfig({
      DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
      CHANNEL_QQ_ENABLED: '1',
      CHANNEL_WEIBO_ALLOWED_USER_IDS: user,
    });
    expect(channelRuntimeConfig(config, 'qq', user).integration).toBe('not_integrated');
    const allowed = loadConfig({
      DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
      CHANNEL_QQ_ENABLED: '1',
      CHANNEL_QQ_ALLOWED_USER_IDS: user,
    });
    expect(channelRuntimeConfig(allowed, 'qq', user).integration).toBe('live');
  });
});
