/**
 * 微博 OpenIM 协议（和旧版 C:/wb-ref/old-weiban/server/lib/weibo/open_im_client.js 同一套线协议，
 * 对齐 cc-connect / openclaw-weibo）：
 *
 *   鉴权：POST https://open-im.api.weibo.com/open/auth/ws_token  { app_id, app_secret }
 *         → { data: { token, uid, expire_in } }
 *   长连：wss://open-im.api.weibo.com/ws/stream?app_id=…&token=…&version=…
 *         入站帧 { type: 'message', payload: { fromUserId, messageId, text, timestamp, input? } }
 *         出站帧 { type: 'send_message', payload: { toUserId, text, messageId, chunkId, done } }
 *         心跳   { type: 'ping' } → { type: 'pong' }；关闭码 4002 = token 失效，必须重新换 token。
 *
 * 这里只放「纯协议」部分：换 token、拼 WSS 地址、拆长文本、解析入站帧。真正的 socket 生命周期在
 * application/weibo-runtime.ts（用服务器已有的 ws 依赖）。
 */
import { CHANNEL_OUTBOUND_TEXT_MAX } from '@weiban/contracts';

export const DEFAULT_WEIBO_TOKEN_ENDPOINT = 'https://open-im.api.weibo.com/open/auth/ws_token';
export const DEFAULT_WEIBO_WS_ENDPOINT = 'wss://open-im.api.weibo.com/ws/stream';
export const WEIBO_CLIENT_VERSION = 'weiban-2.0.1';
/** token 失效的关闭码（旧版实测）。 */
export const WEIBO_TOKEN_EXPIRED_CLOSE_CODE = 4002;

export interface WeiboToken {
  token: string;
  uid: string;
  /** 秒。 */
  expireIn: number;
}

export class WeiboError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'WeiboError';
  }
}

/** 用 AppID / AppSecret 换 ws_token（真实网络调用；绑定时的校验也走它）。 */
export async function fetchWeiboToken(input: {
  appId: string;
  appSecret: string;
  tokenEndpoint?: string;
  fetchImpl?: typeof fetch;
}): Promise<WeiboToken> {
  const appId = String(input.appId ?? '').trim();
  const appSecret = String(input.appSecret ?? '').trim();
  if (!appId || !appSecret) throw new WeiboError('缺少微博 AppID / AppSecret');
  const endpoint = input.tokenEndpoint || DEFAULT_WEIBO_TOKEN_ENDPOINT;
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new WeiboError(`微博 ws_token HTTP ${response.status}`, response.status);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WeiboError('微博 ws_token 返回的不是合法 JSON', response.status);
  }
  const data = ((parsed as { data?: unknown } | null)?.data ?? {}) as Record<string, unknown>;
  const token = String(data['token'] ?? '').trim();
  if (!token) throw new WeiboError('微博没有返回 token', response.status);
  return {
    token,
    uid: String(data['uid'] ?? '').trim(),
    expireIn: Number(data['expire_in']) || 3600,
  };
}

/** 拼 WSS 地址（token 只进查询串，不落库、不打日志）。 */
export function weiboStreamUrl(input: {
  appId: string;
  token: string;
  wsEndpoint?: string;
  version?: string;
}): string {
  const url = new URL(input.wsEndpoint || DEFAULT_WEIBO_WS_ENDPOINT);
  if (url.protocol !== 'wss:') throw new WeiboError('微博长连必须是 wss://');
  url.searchParams.set('app_id', input.appId);
  url.searchParams.set('token', input.token);
  url.searchParams.set('version', input.version || WEIBO_CLIENT_VERSION);
  return url.toString();
}

/** 按码点拆长文本（微博单条 2000 字符）。 */
export function splitWeiboText(text: string, limit = CHANNEL_OUTBOUND_TEXT_MAX): string[] {
  const runes = Array.from(String(text ?? ''));
  if (runes.length <= limit) return [String(text ?? '')];
  const chunks: string[] = [];
  for (let index = 0; index < runes.length; index += limit) {
    chunks.push(runes.slice(index, index + limit).join(''));
  }
  return chunks;
}

/** 出站「发消息」帧（长文本拆成多帧，只有最后一帧 done = true）。 */
export function buildWeiboSendFrames(input: {
  toUserId: string;
  text: string;
  messageId: string;
}): Array<Record<string, unknown>> {
  const target = String(input.toUserId ?? '').trim();
  if (!target) throw new WeiboError('微博发送缺少 toUserId');
  const chunks = splitWeiboText(input.text);
  return chunks.map((chunk, index) => ({
    type: 'send_message',
    payload: {
      toUserId: target,
      text: chunk,
      messageId: input.messageId,
      chunkId: index,
      done: index === chunks.length - 1,
    },
  }));
}

export interface WeiboInbound {
  fromUserId: string;
  messageId: string;
  text: string;
  timestamp: number;
}

/** 解析入站帧；不是 message 帧（pong / 其它事件）返回 null。fallbackTimestampMs 由调用方用平台时钟给。 */
export function parseWeiboInbound(raw: string, fallbackTimestampMs = 0): WeiboInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = (parsed ?? {}) as Record<string, unknown>;
  if (String(frame['type'] ?? '') !== 'message') return null;
  const payload = (frame['payload'] ?? {}) as Record<string, unknown>;
  const fromUserId = String(payload['fromUserId'] ?? '').trim();
  const messageId = String(payload['messageId'] ?? '').trim();
  let text = String(payload['text'] ?? '').trim();
  const input = Array.isArray(payload['input']) ? payload['input'] : [];
  const parts: string[] = [];
  for (const item of input) {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (entry['type'] !== 'message' || entry['role'] !== 'user') continue;
    for (const part of Array.isArray(entry['content']) ? entry['content'] : []) {
      const piece = (part ?? {}) as Record<string, unknown>;
      if (piece['type'] === 'input_text' && piece['text']) parts.push(String(piece['text']));
    }
  }
  if (parts.length) text = parts.join('\n').trim();
  if (!fromUserId || !text) return null;
  return {
    fromUserId,
    messageId,
    text,
    // 上游没带时间戳时用调用方给的时钟值（这里不读系统时间：R7 要求服务器时间只来自 platform/clock）。
    timestamp: Number(payload['timestamp']) || fallbackTimestampMs,
  };
}
