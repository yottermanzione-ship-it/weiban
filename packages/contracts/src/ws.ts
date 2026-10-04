/**
 * WebSocket 帧协议：wss://{host}/api/v1/ws
 * 规则见 docs/architecture/message-reliability.md。
 *
 * - 每一帧是一个 JSON 对象：{ v: 1, type, ref?, data }。
 * - ref：客户端请求帧可带一个自定义字符串，服务器的对应回复帧原样带回，便于对应请求与响应。
 * - 连接建立后，客户端必须在 10 秒内发送 auth 帧，否则服务器关闭连接（关闭码 4401）。
 * - 心跳：客户端每 25 秒发 ping；45 秒未收到 pong 视为断线并重连（0.5、1、2、4、8、10 秒退避，带随机抖动）。
 * - 连接只负责「快」，不负责「全」：任何丢失都靠 updateSeq 补拉（GET /api/v1/sync/updates）。
 */
import { z } from 'zod';
import { ClientMsgId, DeviceInfo, ErrorCode, Id, UpdateSeq } from './common.js';
import { MessageAck, SendMessageRequest } from './http/chat.js';
import { UserUpdate } from './http/sync.js';

export const WS_PATH = '/api/v1/ws' as const;

/** 服务器主动关闭连接时使用的关闭码。 */
export const WsCloseCode = {
  /** 未在规定时间内鉴权，或令牌无效 / 过期：客户端应回到登录页。 */
  unauthenticated: 4401,
  /** 客户端版本过旧，需要更新 APK / 刷新网页。 */
  clientTooOld: 4426,
  /** 同一会话在别处建立了新连接时的旧连接（正常情况，不提示用户）。 */
  replaced: 4409,
} as const;

function frame<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.object({
    v: z.literal(1),
    type: z.literal(type),
    ref: z.string().max(64).optional(),
    data,
  });
}

// ---------- 客户端 → 服务器 ----------

export const ClientAuthFrame = frame(
  'auth',
  z.object({
    token: z.string().min(32),
    contractVersion: z.string(),
    device: DeviceInfo,
    /** 客户端本地已处理到的更新序号，服务器据此判断是否需要提示补拉。 */
    lastUpdateSeq: UpdateSeq,
  }),
);

export const ClientPingFrame = frame('ping', z.object({}));

/** 发送消息，效果与 HTTP POST /conversations/:id/messages 完全相同（幂等）。 */
export const ClientSendMessageFrame = frame(
  'message.send',
  SendMessageRequest.extend({ conversationId: Id }),
);

/**
 * 前台状态：当前正在看哪个会话。用于「用户正在该会话界面时不推送」（CHAT-10 第 6 条）
 * 和「用户正在聊天」判断（P-09）。App 切到后台时发送 { conversationId: null, foreground: false }。
 */
export const ClientPresenceFrame = frame(
  'presence.focus',
  z.object({
    conversationId: Id.nullable(),
    foreground: z.boolean(),
  }),
);

export const ClientFrame = z.discriminatedUnion('type', [
  ClientAuthFrame,
  ClientPingFrame,
  ClientSendMessageFrame,
  ClientPresenceFrame,
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

// ---------- 服务器 → 客户端 ----------

export const ServerAuthOkFrame = frame(
  'auth.ok',
  z.object({
    userId: Id,
    sessionId: Id,
    /** 服务器当前最新更新序号；大于客户端本地值时，客户端调用补拉接口。 */
    latestUpdateSeq: UpdateSeq,
    minClientVersion: z.string(),
    serverTime: z.iso.datetime(),
  }),
);

export const ServerPongFrame = frame('pong', z.object({ serverTime: z.iso.datetime() }));

/** 发送成功：消息已存好并分配 seq，界面显示「已送达」。 */
export const ServerMessageAckFrame = frame('message.ack', MessageAck);

/** 发送失败。retryable = true 时客户端用同一 clientMsgId 自动重试；false 时显示红色感叹号。 */
export const ServerMessageErrorFrame = frame(
  'message.error',
  z.object({
    clientMsgId: ClientMsgId,
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
  }),
);

/** 一条用户更新（与补拉接口返回的元素完全相同）。 */
export const ServerUpdateFrame = frame('update', UserUpdate);

/**
 * 正在输入（CHAT-06）：不写入更新日志，丢了无所谓。
 * 客户端 6 秒内没收到同一参与者的新 typing 帧就自动隐藏。
 */
export const ServerTypingFrame = frame(
  'typing',
  z.object({
    conversationId: Id,
    participantId: Id,
    state: z.enum(['start', 'stop']),
  }),
);

export const ServerErrorFrame = frame(
  'error',
  z.object({ code: ErrorCode, message: z.string() }),
);

export const ServerFrame = z.discriminatedUnion('type', [
  ServerAuthOkFrame,
  ServerPongFrame,
  ServerMessageAckFrame,
  ServerMessageErrorFrame,
  ServerUpdateFrame,
  ServerTypingFrame,
  ServerErrorFrame,
]);
export type ServerFrame = z.infer<typeof ServerFrame>;
