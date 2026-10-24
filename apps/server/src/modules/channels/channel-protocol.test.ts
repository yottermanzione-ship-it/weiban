/**
 * channels 真实协议 / 加密 / 权限的针对性测试（2026-10-25）。
 *
 * 只跑这一个文件：
 *   pnpm vitest run apps/server/src/modules/channels/channel-protocol.test.ts
 *
 * 覆盖的是「改错就会出安全或对接事故」的部分，不发真实网络请求：
 * - iLink 服务节点 / 扫码轮询节点 / liteapp 绑定链接的白名单（token 不能外送）。
 * - get_bot_qrcode / get_qrcode_status / sendmessage 的请求形状与返回值判定。
 * - 会话永久失效（errcode -14）与配额（ret -2）不能混为一谈。
 * - 入站正文提取与去重键。
 * - 微博 ws_token / WSS 地址 / 入站帧 / 长文本拆帧。
 * - 信封加密的 AAD 绑定（凭据与正文按「哪一行」加密，挪到别的行解不开）。
 * - PRO+ 校验：未开通 403 membership_required，已开通放行。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IdentityMembershipReadPort } from '@weiban/contracts';
import { aesGcmOpen, aesGcmSeal } from '../../platform/crypto/envelope.js';
import {
  IlinkHttpError,
  createIlinkClient,
  dedupeKeyOf,
  extractInboundText,
  isQuotaExhausted,
  isRevoked,
  isSendAccepted,
  normalizeBindUrl,
  normalizeIlinkBaseUrl,
  normalizeQrPollBaseUrl,
} from './domain/ilink.js';
import {
  buildWeiboSendFrames,
  fetchWeiboToken,
  parseWeiboInbound,
  splitWeiboText,
  weiboStreamUrl,
} from './domain/weibo-openim.js';
import { CHANNEL_BENEFIT, assertChannelProPlus } from './application/channel-access.js';
import { isOwnPeer } from './domain/peer.js';
import { WEIBO_PEER_UID_VERIFIABLE, channelRuntimeConfig } from './application/channel-config.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 假 fetch：按顺序返回预设响应，并记录每次调用的形状。 */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): {
  calls: RecordedCall[];
  fetchImpl: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    calls.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('iLink 服务节点白名单（token 不能外送）', () => {
  it('只接受 iLink 官方 HTTPS 节点', () => {
    expect(normalizeIlinkBaseUrl('https://ilinkai.weixin.qq.com')).toBe(
      'https://ilinkai.weixin.qq.com',
    );
    expect(normalizeIlinkBaseUrl('https://edge.ilinkai.weixin.qq.com')).toBe(
      'https://edge.ilinkai.weixin.qq.com',
    );
    expect(() => normalizeIlinkBaseUrl('https://evil.example')).toThrow('微信服务节点无效');
    expect(() => normalizeIlinkBaseUrl('http://ilinkai.weixin.qq.com')).toThrow('微信服务节点无效');
    expect(() => normalizeIlinkBaseUrl('https://ilinkai.weixin.qq.com:8443')).toThrow(
      '微信服务节点无效',
    );
    expect(() => normalizeIlinkBaseUrl('https://user:pass@ilinkai.weixin.qq.com')).toThrow(
      '微信服务节点无效',
    );
  });

  it('扫码轮询节点放宽到微信域名，但拒绝其它主机与路径', () => {
    expect(normalizeQrPollBaseUrl('edge.ilinkai.weixin.qq.com')).toBe(
      'https://edge.ilinkai.weixin.qq.com',
    );
    expect(normalizeQrPollBaseUrl('https://evil.example')).toBe('');
    expect(normalizeQrPollBaseUrl('https://liteapp.weixin.qq.com/q/1')).toBe('');
    expect(normalizeQrPollBaseUrl('')).toBe('');
  });

  it('绑定链接只接受官方 liteapp 主机', () => {
    expect(normalizeBindUrl('https://liteapp.weixin.qq.com/q/abc?qrcode=1')).toBe(
      'https://liteapp.weixin.qq.com/q/abc?qrcode=1',
    );
    expect(() => normalizeBindUrl('https://evil.example/q/abc')).toThrow('非官方绑定地址');
    // http 也归到「非官方地址」：官方只会给 https。
    expect(() => normalizeBindUrl('http://liteapp.weixin.qq.com/q/abc')).toThrow('非官方绑定地址');
  });
});

describe('微信 iLink 协议形状', () => {
  it('出码：POST get_bot_qrcode?bot_type=3，正文只有空的 local_token_list', async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          qrcode: 'abc123',
          qrcode_img_content: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc123&bot_type=3',
          ret: 0,
        },
      },
    ]);
    const client = createIlinkClient({ fetchImpl });
    const qrcode = await client.createBindQrcode();
    expect(qrcode.qrcode).toBe('abc123');
    expect(qrcode.bindUrl).toMatch(/liteapp\.weixin\.qq\.com/);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toMatch(/get_bot_qrcode\?bot_type=3$/);
    expect(calls[0]!.body).toEqual({ local_token_list: [] });
    expect(calls[0]!.headers['iLink-App-Id']).toBe('bot');
    expect(calls[0]!.headers['iLink-App-ClientVersion']).toBe(String((2 << 16) | (4 << 8) | 9));
    expect(calls[0]!.headers['Authorization']).toBeUndefined();
  });

  it('扫码状态：GET 不带 token；确认时带回 bot_token / bot_id / ilink_user_id / baseurl', async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          status: 'confirmed',
          bot_token: 'tok-1',
          ilink_bot_id: '357449926908@im.bot',
          ilink_user_id: 'o9cq@im.wechat',
          baseurl: 'https://ilinkai.weixin.qq.com',
        },
      },
    ]);
    const client = createIlinkClient({ fetchImpl });
    const status = await client.pollQrcodeStatus('q-1');
    expect(status.confirmed).toBe(true);
    expect(status.botToken).toBe('tok-1');
    expect(status.botId).toBe('357449926908@im.bot');
    expect(status.ilinkUserId).toBe('o9cq@im.wechat');
    expect(status.baseUrl).toBe('https://ilinkai.weixin.qq.com');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toMatch(/get_qrcode_status\?qrcode=q-1$/);
    expect(calls[0]!.headers['Authorization']).toBeUndefined();
  });

  it('扫码被指到别的微信节点：只接受 weixin.qq.com 域', async () => {
    const ok = stubFetch([
      { body: { status: 'scaned_but_redirect', redirect_host: 'edge.ilinkai.weixin.qq.com' } },
    ]);
    const allowed = await createIlinkClient({ fetchImpl: ok.fetchImpl }).pollQrcodeStatus('q');
    expect(allowed.nextPollBaseUrl).toBe('https://edge.ilinkai.weixin.qq.com');

    const bad = stubFetch([
      { body: { status: 'scaned_but_redirect', redirect_host: 'evil.example' } },
    ]);
    const blocked = await createIlinkClient({ fetchImpl: bad.fetchImpl }).pollQrcodeStatus('q');
    expect(blocked.nextPollBaseUrl).toBe('');
  });

  it('发消息：带 Bearer token 与 UIN 头；只认 ret=0 或空对象为已接受', async () => {
    const { calls, fetchImpl } = stubFetch([{ body: { ret: 0 } }]);
    const client = createIlinkClient({ fetchImpl });
    const result = await client.sendText({
      token: 'tok-1',
      toUserId: 'o9cq@im.wechat',
      text: 'hi',
      contextToken: 'ctx-1',
      clientId: 'wb-out-1',
    });
    expect(result.submitted).toBe(true);
    expect(calls[0]!.url).toMatch(/sendmessage$/);
    expect(calls[0]!.headers['Authorization']).toBe('Bearer tok-1');
    expect(calls[0]!.headers['AuthorizationType']).toBe('ilink_bot_token');
    expect(calls[0]!.headers['X-WECHAT-UIN']).toMatch(/^[A-Za-z0-9+/=]+$/);
    const body = calls[0]!.body as { msg: { item_list: Array<{ text_item: { text: string } }> } };
    expect(body.msg.item_list[0]!.text_item.text).toBe('hi');
    expect(isSendAccepted({ ret: 0 })).toBe(true);
    expect(isSendAccepted({ ret: -2 })).toBe(false);
    expect(isSendAccepted({})).toBe(true);
    expect(isSendAccepted({ message_id: 'm-1' })).toBe(true);
  });

  it('会话永久失效与配额是两件事', () => {
    expect(isRevoked({ errcode: -14 })).toBe(true);
    expect(isRevoked({ errmsg: 'session timeout' })).toBe(true);
    expect(isRevoked({ ret: -2 })).toBe(false);
    expect(isQuotaExhausted({ ret: -2 })).toBe(true);
    expect(isQuotaExhausted({ errcode: -14 })).toBe(false);
  });

  it('HTTP 错误带上状态与可重试标记，供 worker 决定退避', async () => {
    const { fetchImpl } = stubFetch([{ status: 502, body: { ret: -1 } }]);
    const client = createIlinkClient({ fetchImpl });
    await expect(client.createBindQrcode()).rejects.toBeInstanceOf(IlinkHttpError);
    try {
      await client.createBindQrcode();
    } catch (error) {
      expect((error as IlinkHttpError).status).toBe(502);
      expect((error as IlinkHttpError).retryable).toBe(true);
    }
  });
});

describe('微信入站消息解析', () => {
  it('取文字与语音转写；去重键优先 client_id', () => {
    expect(
      extractInboundText({
        item_list: [{ text_item: { text: 'a' } }, { voice_item: { text: 'b' } }],
      }),
    ).toBe('a b');
    // 超过 2^53 的 message_id 用可精确表示的表达式：验证的是「有 client_id 时优先 client_id」。
    expect(dedupeKeyOf({ client_id: 'c-1', message_id: 2 ** 53 + 1 })).toBe('c-1');
    expect(dedupeKeyOf({ item_list: [{ msg_id: 'm-1' }] })).toBe('m-1');
    expect(dedupeKeyOf({ message_id: '9007199254740993' })).toBe('9007199254740993');
    expect(dedupeKeyOf({})).toBe('');
  });
});

describe('微博 OpenIM 协议', () => {
  it('ws_token：POST app_id/app_secret，取 data.token 与 uid', async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: { data: { token: 'ws-token-1', uid: '77', expire_in: 3600 } } },
    ]);
    const token = await fetchWeiboToken({ appId: 'app-1', appSecret: 'secret-1', fetchImpl });
    expect(token.token).toBe('ws-token-1');
    expect(token.uid).toBe('77');
    expect(token.expireIn).toBe(3600);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({ app_id: 'app-1', app_secret: 'secret-1' });
  });

  it('ws_token：没有 token 或 HTTP 失败都算失败（绑定不能假装成功）', async () => {
    const empty = stubFetch([{ body: { data: {} } }]);
    await expect(
      fetchWeiboToken({ appId: 'a', appSecret: 'b', fetchImpl: empty.fetchImpl }),
    ).rejects.toThrow('微博没有返回 token');
    const denied = stubFetch([{ status: 401, body: { message: 'denied' } }]);
    await expect(
      fetchWeiboToken({ appId: 'a', appSecret: 'b', fetchImpl: denied.fetchImpl }),
    ).rejects.toThrow('HTTP 401');
  });

  it('WSS 地址必须是 wss 且带 app_id / token / version', () => {
    const url = new URL(weiboStreamUrl({ appId: 'app-1', token: 'tok' }));
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('app_id')).toBe('app-1');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('version')).toBe('weiban-2.0.1');
    expect(() =>
      weiboStreamUrl({ appId: 'a', token: 't', wsEndpoint: 'ws://evil.example/ws' }),
    ).toThrow('必须是 wss://');
  });

  it('入站帧：只认 message 帧，取 fromUserId / messageId / text', () => {
    expect(parseWeiboInbound(JSON.stringify({ type: 'pong' }))).toBeNull();
    expect(parseWeiboInbound('not-json')).toBeNull();
    const inbound = parseWeiboInbound(
      JSON.stringify({
        type: 'message',
        payload: { fromUserId: 'u-1', messageId: 'm-1', text: 'hello', timestamp: 1700000000000 },
      }),
    );
    expect(inbound).toMatchObject({ fromUserId: 'u-1', messageId: 'm-1', text: 'hello' });
    const withInput = parseWeiboInbound(
      JSON.stringify({
        type: 'message',
        payload: {
          fromUserId: 'u-1',
          messageId: 'm-2',
          input: [
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'again' }] },
          ],
        },
      }),
    );
    expect(withInput?.text).toBe('again');
  });

  it('长文本按 2000 字符拆帧，只有最后一帧 done', () => {
    const frames = buildWeiboSendFrames({
      toUserId: 'u-1',
      text: 'a'.repeat(4500),
      messageId: 'out-1',
    });
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => (frame['payload'] as { done: boolean }).done)).toEqual([
      false,
      false,
      true,
    ]);
    expect(splitWeiboText('short')).toEqual(['short']);
  });
});

describe('信封加密的 AAD 绑定（凭据与正文按行加密）', () => {
  it('同一把密钥、AAD 不同就解不开（密文挪到别的绑定行会失效）', () => {
    const key = createHash('sha256').update('test-kek').digest();
    const sealed = aesGcmSeal(
      key,
      'weiban:data:user-1:channels:binding:b-1:token',
      Buffer.from('bot'),
    );
    expect(
      aesGcmOpen(key, 'weiban:data:user-1:channels:binding:b-1:token', sealed).toString('utf8'),
    ).toBe('bot');
    expect(() =>
      aesGcmOpen(key, 'weiban:data:user-1:channels:binding:b-2:token', sealed),
    ).toThrow();
  });
});

describe('入站发送者必须就是绑定的对面账号（foreign_sender 一律拒绝）', () => {
  it('微信：只有绑定时确认的 ilink_user_id 本人能触发聊天与计费', () => {
    expect(isOwnPeer('wechat', 'o9cq@im.wechat', 'o9cq@im.wechat')).toBe(true);
    expect(isOwnPeer('wechat', 'o9cq@im.wechat', 'someone@im.wechat')).toBe(false);
    expect(isOwnPeer('wechat', null, 'o9cq@im.wechat')).toBe(false);
    expect(isOwnPeer('wechat', 'o9cq@im.wechat', '')).toBe(false);
  });

  it('微博：没有可验证的对方身份时，任何 sender 都不能通过', () => {
    // ws_token 只给出 bot 自己的 uid，不能证明私信者是谁。
    expect(isOwnPeer('weibo', 'bot-uid-77', 'random-stranger')).toBe(false);
    expect(isOwnPeer('weibo', null, 'random-stranger')).toBe(false);
    // 关键回归：第一个「发消息的人」不能因此变成主人，后来的也不能。
    const botUid = 'bot-uid-77';
    expect(isOwnPeer('weibo', botUid, 'first-sender')).toBe(false);
    expect(isOwnPeer('weibo', botUid, 'second-sender')).toBe(false);
  });

  it('微博通道固定不按「已联通」处理（即使运维打开了开关）', () => {
    expect(WEIBO_PEER_UID_VERIFIABLE).toBe(false);
    const config = {
      channels: {
        wechat: { enabled: true, ilinkBaseUrl: 'https://ilinkai.weixin.qq.com' },
        weibo: { enabled: true, tokenEndpoint: null, wsEndpoint: null },
      },
    } as unknown as Parameters<typeof channelRuntimeConfig>[0];
    expect(channelRuntimeConfig(config, 'wechat').integration).toBe('live');
    expect(channelRuntimeConfig(config, 'weibo').integration).toBe('not_integrated');
    const disabled = {
      channels: {
        wechat: { enabled: false, ilinkBaseUrl: 'https://ilinkai.weixin.qq.com' },
        weibo: { enabled: false, tokenEndpoint: null, wsEndpoint: null },
      },
    } as unknown as Parameters<typeof channelRuntimeConfig>[0];
    expect(channelRuntimeConfig(disabled, 'wechat').integration).toBe('not_integrated');
  });
});

describe('PRO+ 服务端校验', () => {
  const membership = (pro: boolean): IdentityMembershipReadPort =>
    ({ isProPlus: async () => pro }) as unknown as IdentityMembershipReadPort;

  it('不是 PRO+ 时抛 403 membership_required，并指出是哪项权益', async () => {
    await expect(assertChannelProPlus(membership(false), 'u-1', 'new_qr')).rejects.toMatchObject({
      code: 'membership_required',
      status: 403,
      details: { benefit: CHANNEL_BENEFIT, action: 'new_qr', requiredTier: 'pro_plus' },
    });
  });

  it('是 PRO+ 时放行', async () => {
    await expect(assertChannelProPlus(membership(true), 'u-1', 'bind')).resolves.toBeUndefined();
  });
});
