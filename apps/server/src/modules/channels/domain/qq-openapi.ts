/** 官方 QQ Bot v2：AppID/AppSecret 换 access_token，鉴权网关收 C2C，HTTP 被动回复。
 * 端点与线协议同时参考旧版 lib/qq/official_bot_client.js 及 tencent-connect SDK。
 * 没有个人 QQ 登录、Cookie、任意地址代理，也不从 access_token 推断聊天人的身份。
 */
import { createHash, randomBytes } from 'node:crypto';

export const QQ_CLIENT_FACTORY = Symbol('channels.qqClientFactory');
export const QQ_WS_FACTORY = Symbol('channels.qqWsFactory');
export const QQ_INTENTS = 1 << 25;
export const QQ_PAIRING_TTL_MS = 5 * 60_000;
/** 本站保守地只发送最近会话的至多五条被动回复，不尝试主动群发。 */
export const QQ_REPLY_TTL_MS = 5 * 60_000;
export const QQ_REPLY_MAX = 5;
const TOKEN_URLS = [
  'https://api.bot.qq.com/app/getAppAccessToken',
  'https://bots.qq.com/app/getAppAccessToken',
];
const API_BASES = ['https://api.bot.qq.com', 'https://api.sgroup.qq.com'];
const GATEWAY_HOSTS = new Set(['api.bot.qq.com', 'api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com']);
export const qqAad = (id: string, field: 'appid' | 'secret' | 'peer' | 'reply') =>
  `channels:binding:${id}:qq_${field}`;
export const qqFingerprint = (appId: string) =>
  'qq-app:' + createHash('sha256').update(appId.trim()).digest('hex');
export const qqPairingCode = () => randomBytes(5).toString('hex').toUpperCase();
export const qqCodeHash = (id: string, generation: number, code: string) =>
  createHash('sha256').update(`${id}:${generation}:${code.toUpperCase()}`).digest();
export function readQqPairingCode(text: string): string | null {
  return /^绑定\s+([a-f0-9]{10})$/i.exec(text.trim())?.[1]?.toUpperCase() ?? null;
}
export class QqApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: 'token' | 'gateway' | 'reply',
  ) {
    super(`qq_${operation}_${status}`);
  }
}
export function qqGatewayUrl(value: unknown): string {
  const url = new URL(String(value ?? ''));
  if (
    url.protocol !== 'wss:' ||
    !GATEWAY_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new QqApiError(0, 'gateway');
  return url.href;
}
export interface QqInbound {
  messageId: string;
  peer: string;
  text: string;
  createdAt: Date;
}
export function parseQqInbound(packet: unknown, now: Date): QqInbound | null {
  const root = packet as {
    op?: number;
    t?: string;
    d?: {
      id?: unknown;
      content?: unknown;
      timestamp?: unknown;
      author?: { user_openid?: unknown };
    };
  } | null;
  if (root?.op !== 0 || root.t !== 'C2C_MESSAGE_CREATE') return null;
  const d = root.d;
  if (
    !d ||
    typeof d.id !== 'string' ||
    !d.id ||
    d.id.length > 256 ||
    typeof d.author?.user_openid !== 'string' ||
    !d.author.user_openid ||
    d.author.user_openid.length > 256 ||
    typeof d.content !== 'string' ||
    !d.content.trim()
  )
    return null;
  const timestamp = typeof d.timestamp === 'string' ? new Date(d.timestamp) : now;
  return {
    messageId: d.id,
    peer: d.author.user_openid,
    text: d.content.trim(),
    createdAt: Number.isFinite(timestamp.getTime()) && timestamp <= now ? timestamp : now,
  };
}
export interface QqClient {
  gateway(): Promise<{ url: string; token: string }>;
  send(
    peer: string,
    text: string,
    replyTo: string,
    sequence: number,
    signal?: AbortSignal,
  ): Promise<void>;
}
export type QqClientFactory = (
  credentials: { appId: string; appSecret: string },
  nowMs: () => number,
) => QqClient;
export function createQqClient(
  credentials: { appId: string; appSecret: string },
  nowMs: () => number,
  fetchImpl: typeof fetch = fetch,
): QqClient {
  let accessToken = '';
  let expiresAt = 0;
  let apiBase = API_BASES[0]!;
  let inFlight: Promise<void> | null = null;
  async function request(
    url: string,
    operation: 'token' | 'gateway' | 'reply',
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: init.signal
          ? AbortSignal.any([AbortSignal.timeout(12_000), init.signal])
          : AbortSignal.timeout(12_000),
      });
    } catch {
      throw new QqApiError(0, operation);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new QqApiError(response.status, operation);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new QqApiError(response.status, operation);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new QqApiError(response.status, operation);
    return data as Record<string, unknown>;
  }
  async function refresh(): Promise<void> {
    if (accessToken && nowMs() < expiresAt - 60_000) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let error: unknown = new QqApiError(0, 'token');
      for (const url of TOKEN_URLS) {
        try {
          const data = await request(url, 'token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.appSecret }),
          });
          const token = data.access_token ?? data.accessToken;
          if (typeof token !== 'string' || !token) throw new QqApiError(200, 'token');
          accessToken = token;
          const seconds = Number(data.expires_in ?? data.expiresIn);
          expiresAt =
            nowMs() +
            Math.min(86_400, Math.max(120, Number.isFinite(seconds) ? seconds : 7200)) * 1000;
          return;
        } catch (caught) {
          error = caught;
        }
      }
      throw error;
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }
  const headers = () => ({
    Authorization: `QQBot ${accessToken}`,
    'X-Union-Appid': credentials.appId,
    'Content-Type': 'application/json',
  });
  return {
    async gateway() {
      await refresh();
      let error: unknown = new QqApiError(0, 'gateway');
      for (const base of API_BASES) {
        try {
          const data = await request(base + '/gateway', 'gateway', {
            method: 'GET',
            headers: headers(),
          });
          const url = qqGatewayUrl(data.url);
          apiBase = base;
          return { url, token: accessToken };
        } catch (caught) {
          error = caught;
        }
      }
      throw error;
    },
    async send(peer, text, replyTo, sequence, signal) {
      if (!peer || !text || !replyTo || sequence < 1 || sequence > QQ_REPLY_MAX)
        throw new QqApiError(0, 'reply');
      if (signal?.aborted) throw new QqApiError(0, 'reply');
      await refresh();
      if (signal?.aborted) throw new QqApiError(0, 'reply');
      try {
        await request(`${apiBase}/v2/users/${encodeURIComponent(peer)}/messages`, 'reply', {
          signal,
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ content: text, msg_type: 0, msg_id: replyTo, msg_seq: sequence }),
        });
      } catch (error) {
        if (error instanceof QqApiError && error.status === 401) {
          accessToken = '';
          expiresAt = 0;
        }
        throw error;
      }
    },
  };
}
