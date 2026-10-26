/**
 * 微信 ClawBot（iLink）协议客户端：纯 HTTPS，和旧版服务器（C:/wb-ref/old-weiban/server/lib/wechat）
 * 走同一套线协议，不依赖 OpenClaw 进程、也不依赖任何「外部网关」。
 *
 * 这套 API 的返回值普遍不可信（2026-08 实测结论，照抄旧版注释免得再踩）：
 *   · errcode -14「session timeout」名字像瞬时超时，实为**永久失效**：同一个微信再绑一次会拿到新 bot_id，
 *     旧 token 立刻返回这个码。当瞬时错误重试会对着死绑定空转，用户那头一直没回音而我方毫不知情。
 *     所以必须停轮询、标记 revoked、提示重绑（见 worker 里的 isRevoked 处理）。
 *   · ret -2「prepare failed」= 配额耗尽（连发约 8 条），用户说一句话即恢复，可重试。
 *   · sendmessage 返回 message_id **不保证送达**，只能当「已提交」，不能当「已送达」。
 *
 * 两条硬约束：
 *   · 每调一次 get_bot_qrcode，上一张码立刻作废 → 码只能「用户点了才出」，不能预生成 / 缓存 / 后台定时刷。
 *     实测寿命 124 秒。
 *   · 媒体消息必须带 context_token（本轮只做文字：文字不带也能发，带上更稳）。
 *
 * 安全：Bearer token 只允许发往受控 iLink 官方 HTTPS 节点（normalizeIlinkBaseUrl 白名单）；
 * 扫码状态轮询不带 token，允许的主机放宽到 *.weixin.qq.com（normalizeQrPollBaseUrl）。
 */
import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 与官方 openclaw-weixin@2.4.9 对齐（channel_version / 请求头 / bot_agent）。 */
export const CHANNEL_VERSION = '2.4.9';
export const ILINK_APP_ID = 'bot';
/** uint32：0x00MMNNPP → 2.4.9 = (2<<16)|(4<<8)|9 = 132105。 */
export const ILINK_APP_CLIENT_VERSION = ((2 & 0xff) << 16) | ((4 & 0xff) << 8) | (9 & 0xff);
/** 自定义 Name/Version。不要写成 OpenClaw/…，否则微信会来审 OpenClaw 运行环境。 */
export const BOT_AGENT = 'Weiban/2.4.9';

export const ILINK_POLL_TIMEOUT_MS = 38_000;
export const ILINK_QR_STATUS_TIMEOUT_MS = 8_000;
export const ILINK_API_TIMEOUT_MS = 15_000;

/** 微信返回的绑定链接只允许这一个官方主机（和旧版 BIND_URL_HOST 一致）。 */
export const BIND_URL_HOST = 'liteapp.weixin.qq.com';

export class IlinkHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryable: boolean;
  constructor(status: number, body: unknown) {
    super(`iLink HTTP ${status}`);
    this.name = 'IlinkHttpError';
    this.status = Number(status) || 0;
    this.body = body;
    this.retryable =
      this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500;
  }
}

export class IlinkProtocolError extends Error {
  constructor(status: number) {
    super(`iLink 返回的不是合法 JSON（HTTP ${status}）`);
    this.name = 'IlinkProtocolError';
  }
}

/** 服务节点白名单：只接受 iLink 官方 HTTPS 节点，且必须裸域名（无账号、端口、路径）。 */
export function normalizeIlinkBaseUrl(value: string | null | undefined): string {
  const raw = String(value ?? '').trim() || DEFAULT_ILINK_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('微信服务节点无效');
  }
  const allowed =
    parsed.hostname === 'ilinkai.weixin.qq.com' ||
    parsed.hostname.endsWith('.ilinkai.weixin.qq.com');
  if (
    parsed.protocol !== 'https:' ||
    !allowed ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('微信服务节点无效');
  }
  return parsed.origin;
}

/** 扫码状态轮询不带 bot token：允许的主机比带凭证的 Bot API 宽，但仍只认微信域名。 */
export function normalizeQrPollBaseUrl(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let parsed: URL;
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com');
  if (
    parsed.protocol !== 'https:' ||
    !allowed ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    return '';
  }
  return parsed.origin;
}

/** 页面渲染二维码用的绑定链接：必须是 https://liteapp.weixin.qq.com/…。 */
export function normalizeBindUrl(value: string | null | undefined): string {
  let url: URL;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('微信返回了无效的绑定地址');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== BIND_URL_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('微信返回了非官方绑定地址');
  }
  return url.toString();
}

export function buildBaseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

/** X-WECHAT-UIN：随机 uint32 的十进制字符串再 base64（和官方插件一致）。 */
export function randomWechatUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64');
}

export function buildCommonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
}

export function buildPostHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
  };
  const botToken = String(token ?? '').trim();
  if (botToken) headers['Authorization'] = 'Bearer ' + botToken;
  return headers;
}

/** 绑定是否已被永久作废（errcode -14 / session timeout）：不能重试。 */
export function isRevoked(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b['errcode'] === -14 || String(b['errmsg'] ?? '').includes('session timeout');
}

/** 是否撞上「连发多少条就得等用户说话」的配额：可恢复。 */
export function isQuotaExhausted(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as Record<string, unknown>)['ret'] === -2;
}

/** sendmessage 是否被接受（只代表已提交）。 */
export function isSendAccepted(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(b, 'ret')) return Number(b['ret']) === 0;
  if (b['message_id']) return true;
  return Object.keys(b).length === 0;
}

export interface IlinkQrcode {
  /** 换 bot_token 用的 qrcode（按凭据处理，加密落库）。 */
  qrcode: string;
  /** 页面渲染用的 liteapp 链接。 */
  bindUrl: string;
}

export interface IlinkQrStatus {
  /** wait / scaned / scaned_but_redirect / confirmed / expired / need_verifycode / verify_code_blocked / binded_redirect */
  status: string;
  confirmed: boolean;
  botToken: string;
  botId: string;
  ilinkUserId: string;
  baseUrl: string;
  redirectHost: string;
  nextPollBaseUrl: string;
}

export interface IlinkUpdates {
  revoked: boolean;
  messages: IlinkInboundMessage[];
  cursor: string;
}

export interface IlinkSendResult {
  submitted: boolean;
  messageId: string;
  revoked: boolean;
  quotaExhausted: boolean;
}

/** getupdates 里的一条消息（只声明用到的字段）。 */
export interface IlinkInboundMessage {
  msg_id?: string | number;
  client_id?: string;
  from_user_id?: string;
  context_token?: string;
  create_time_ms?: number;
  message_id?: string | number;
  item_list?: Array<{
    text_item?: { text?: string };
    voice_item?: { text?: string };
    msg_id?: string;
  }>;
}

type FetchLike = typeof fetch;

export function createIlinkClient(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}): {
  createBindQrcode(): Promise<IlinkQrcode>;
  pollQrcodeStatus(qrcode: string, baseUrl?: string): Promise<IlinkQrStatus>;
  getUpdates(token: string, cursor: string, baseUrl?: string): Promise<IlinkUpdates>;
  sendText(input: {
    token: string;
    toUserId: string;
    text: string;
    contextToken?: string;
    clientId?: string;
    baseUrl?: string;
  }): Promise<IlinkSendResult>;
  notifyPresence(input: {
    token: string;
    kind: 'start' | 'stop';
    baseUrl?: string;
  }): Promise<boolean>;
} {
  const base = normalizeIlinkBaseUrl(options.baseUrl);
  const doFetch: FetchLike = options.fetchImpl ?? fetch;

  async function call(
    method: 'GET' | 'POST',
    path: string,
    options: {
      token?: string;
      body?: unknown;
      timeoutMs?: number;
      baseUrl?: string;
      headerMode?: 'qr-status';
    } = {},
  ): Promise<Record<string, unknown>> {
    const requestBase =
      options.headerMode === 'qr-status'
        ? normalizeQrPollBaseUrl(options.baseUrl ?? base) || base
        : normalizeIlinkBaseUrl(options.baseUrl ?? base);
    const response = await doFetch(requestBase + path, {
      method,
      headers:
        options.headerMode === 'qr-status' ? buildCommonHeaders() : buildPostHeaders(options.token),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? ILINK_API_TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!response.ok) throw new IlinkHttpError(response.status, parsed);
    if (parsed === null || typeof parsed !== 'object') {
      throw new IlinkProtocolError(response.status);
    }
    return parsed as Record<string, unknown>;
  }

  return {
    /** 出一张绑定码。每调一次上一张就废；正文固定为空的 local_token_list，不带任何用户凭证。 */
    async createBindQrcode(): Promise<IlinkQrcode> {
      const d = await call('POST', '/ilink/bot/get_bot_qrcode?bot_type=3', {
        body: { local_token_list: [] },
      });
      return {
        qrcode: String(d['qrcode'] ?? ''),
        bindUrl: normalizeBindUrl(String(d['qrcode_img_content'] ?? '')),
      };
    },

    /** 查一次扫码状态。超时 / 网络错误按 wait 处理（页面 2 秒后再问）。 */
    async pollQrcodeStatus(qrcode: string, baseUrl?: string): Promise<IlinkQrStatus> {
      const requestBase = normalizeQrPollBaseUrl(baseUrl ?? '') || base;
      const waiting: IlinkQrStatus = {
        status: 'wait',
        confirmed: false,
        botToken: '',
        botId: '',
        ilinkUserId: '',
        baseUrl: requestBase,
        redirectHost: '',
        nextPollBaseUrl: '',
      };
      let d: Record<string, unknown>;
      try {
        d = await call(
          'GET',
          '/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(String(qrcode ?? '')),
          { timeoutMs: ILINK_QR_STATUS_TIMEOUT_MS, baseUrl: requestBase, headerMode: 'qr-status' },
        );
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') return waiting;
        throw error;
      }
      const status = String(d['status'] ?? '');
      const redirectHost = String(d['redirect_host'] ?? '').trim();
      const nextPollBaseUrl =
        status === 'scaned_but_redirect' ? normalizeQrPollBaseUrl(redirectHost) : '';
      let credentialBase = requestBase;
      const rawBase = String(d['baseurl'] ?? '');
      if (rawBase) {
        try {
          credentialBase = normalizeIlinkBaseUrl(rawBase);
        } catch {
          return waiting;
        }
      }
      return {
        status,
        confirmed: Boolean(d['bot_token']),
        botToken: String(d['bot_token'] ?? ''),
        botId: String(d['ilink_bot_id'] ?? ''),
        ilinkUserId: String(d['ilink_user_id'] ?? ''),
        baseUrl: credentialBase,
        redirectHost,
        nextPollBaseUrl,
      };
    },

    /** 长轮询取新消息。cursor 就是 get_updates_buf，必须持久化后回传，否则重启会重放。 */
    async getUpdates(token: string, cursor: string, baseUrl?: string): Promise<IlinkUpdates> {
      const d = await call('POST', '/ilink/bot/getupdates', {
        token,
        baseUrl,
        timeoutMs: ILINK_POLL_TIMEOUT_MS,
        body: { get_updates_buf: String(cursor ?? ''), base_info: buildBaseInfo() },
      });
      const msgs = Array.isArray(d['msgs']) ? (d['msgs'] as IlinkInboundMessage[]) : [];
      return {
        revoked: isRevoked(d),
        messages: msgs,
        cursor: String(d['get_updates_buf'] ?? cursor ?? ''),
      };
    },

    /** 发一条文本。contextToken 可省（文本不强制），带上更稳。 */
    async sendText(input): Promise<IlinkSendResult> {
      const msg: Record<string, unknown> = {
        to_user_id: String(input.toUserId ?? ''),
        message_type: 2,
        message_state: 2,
        client_id: String(input.clientId ?? '').trim() || newClientId(),
        item_list: [{ type: 1, text_item: { text: String(input.text ?? '') } }],
      };
      if (input.contextToken) msg['context_token'] = input.contextToken;
      const d = await call('POST', '/ilink/bot/sendmessage', {
        token: input.token,
        baseUrl: input.baseUrl,
        body: { msg, base_info: buildBaseInfo() },
      });
      return {
        submitted: isSendAccepted(d),
        messageId: String(d['message_id'] ?? ''),
        revoked: isRevoked(d),
        quotaExhausted: isQuotaExhausted(d),
      };
    },

    /** 告诉微信这条绑定的服务上线 / 下线。失败不抛，免得拖垮收消息。 */
    async notifyPresence(input): Promise<boolean> {
      const token = String(input.token ?? '').trim();
      if (!token) return false;
      try {
        await call(
          'POST',
          input.kind === 'stop' ? '/ilink/bot/msg/notifystop' : '/ilink/bot/msg/notifystart',
          {
            token,
            baseUrl: input.baseUrl,
            timeoutMs: 10_000,
            body: { base_info: buildBaseInfo() },
          },
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

let clientIdCounter = 0;

/**
 * 出站消息的 client_id：只要「同一进程内单调、跨进程不撞」即可，不需要读时钟（R7 也不允许直接取当前时间）。
 * 用随机 6 字节 + 进程内计数，语义不变（每条发送一个唯一幂等 id）。
 */
function newClientId(): string {
  clientIdCounter = (clientIdCounter + 1) % 100_000;
  return 'wb-' + randomBytes(6).toString('hex') + '-' + clientIdCounter.toString(36);
}

/** 从一条 iLink 消息里取文字（文字项 + 语音转写）；取不到返回空串。 */
export function extractInboundText(message: IlinkInboundMessage | null | undefined): string {
  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  const parts: string[] = [];
  for (const item of items) {
    if (!item) continue;
    const text = item.text_item?.text;
    if (text) parts.push(String(text));
    else if (item.voice_item?.text) parts.push(String(item.voice_item.text));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** 入站去重键：优先 client_id，其次 item.msg_id，最后 message_id（超长整数只取字符串形式）。 */
export function dedupeKeyOf(message: IlinkInboundMessage | null | undefined): string {
  if (!message) return '';
  const clientId = String(message.client_id ?? '').trim();
  if (clientId) return clientId;
  const items = Array.isArray(message.item_list) ? message.item_list : [];
  for (const item of items) {
    if (item?.msg_id) return String(item.msg_id);
  }
  return String(message.message_id ?? '');
}

/** 稳定短 ID（日志/客户端去重用；不含正文与 token）。 */
export function shortHash(...parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
}

/**
 * 日志里只写错误的「种类」，不写原始错误：
 * 上游错误的 message / cause 里可能带请求地址（含 qrcode）或其它凭据，日志和告警是长期留存的。
 */
export function describeIlinkError(error: unknown): string {
  if (error instanceof IlinkHttpError) return `ilink_http_${error.status}`;
  if (error instanceof IlinkProtocolError) return 'ilink_bad_json';
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'ilink_timeout';
  return name ? `ilink_${name}` : 'ilink_unknown';
}
