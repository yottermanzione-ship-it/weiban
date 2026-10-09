/**
 * calls 模块（L5，D-L5-07～D-L5-09）：语音通话会话与主动来电（MED-06、MED-07）。设计见 ADR-0025。
 * 数据归 calls（表 call_sessions）。calls 不知道 AI：通话里「角色怎么听、怎么说」由 ai-runtime 实现
 * CallAgentPort（ports/calls.ts），组合根注入；角色发起来电由 ai-runtime 调 CallSessionPort.startIncomingCall。
 *
 * 音频走单独的 WebSocket（见 CallStream* 定义）：信令（拨打、接听、挂断）走本文件的 HTTP 接口，
 * 状态变化经每用户更新 call.updated 同步到所有设备（另一台设备接听后其余设备停止响铃）。
 * 拨打前、通话中、结束后都不出现费用提示（MED-06 第 10 条）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';
import { CallDirection, CallOutcome } from './chat.js';

/** 单次通话时长上限与提醒（P-31）。 */
export const CALL_LIMITS = {
  maxDurationSec: 60 * 60,
  reminderAtSec: 55 * 60,
  /** 来电响铃超时视为未接（MED-07 第 4 条）。 */
  ringTimeoutSec: 30,
  /** 拨出后角色接听前的响铃（MED-06 第 4 条）。 */
  outgoingRingMinSec: 2,
  outgoingRingMaxSec: 5,
  /** 网络中断后等待重连的时间，超时结束（design/pages/call.md 第 3 节）。 */
  reconnectGraceSec: 10,
} as const;

export const CallState = z.enum(['ringing', 'connecting', 'active', 'ended']);
export type CallState = z.infer<typeof CallState>;

/** 接入音频流的凭证。只发给发起 / 接听的那台设备；过期前未连接需重新获取。 */
export const CallStreamTicket = z.object({
  /** 例 "/api/v1/calls/{callId}/stream"（相对路径，客户端拼接当前服务器地址，ws/wss）。 */
  path: z.string().startsWith('/'),
  token: z.string().min(16).max(512),
  expiresAt: Timestamp,
});

export const CallSession = z.object({
  callId: Id,
  characterId: Id,
  conversationId: Id,
  direction: CallDirection,
  state: tolerantEnum(CallState),
  /** state = ended 时的结果；进行中为 null。 */
  outcome: tolerantEnum(CallOutcome).nullable(),
  createdAt: Timestamp,
  answeredAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  /** 接通后的时长（秒）；以服务器为准。 */
  durationSec: z.number().int().nonnegative(),
  /** 只在拨打 / 接听接口的响应中出现；其他场合为 null。 */
  stream: CallStreamTicket.nullable(),
});
export type CallSession = z.infer<typeof CallSession>;

/** 能不能打（入口是否显示 / 可点，MED-06 第 8、11 条）。 */
export const CallUnavailableReason = z.enum([
  'service_disabled', // 平台未开通语音服务：入口不显示
  'insufficient_balance', // 「余额不足，暂时无法通话」
  'busy', // 已有进行中的通话
  'contact_inactive',
]);

export const CallAvailability = z.object({
  available: z.boolean(),
  reason: tolerantEnum(CallUnavailableReason).nullable(),
});

const CallParams = z.object({ callId: Id });

export const CallEndpoints = {
  getAvailability: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/calls/availability`,
    auth: 'user',
    query: z.object({ characterId: Id }),
    response: CallAvailability,
    summary: '语音通话入口状态（iPhone 网页版是否支持由客户端自行判断，MED-06 第 8 条）',
  }),
  startCall: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/calls`,
    auth: 'user',
    body: z.object({ characterId: Id, clientRequestId: Id }),
    response: CallSession,
    summary:
      '拨打（MED-06），成功 201，返回 ringing 状态与音频流凭证。余额不足 422 insufficient_balance；已在通话 409 call_busy；未开通 422 service_disabled。幂等',
  }),
  answerCall: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/calls/:callId/answer`,
    auth: 'user',
    params: CallParams,
    response: CallSession,
    summary: '接听角色来电（MED-07）；已被其他设备接听或已超时返回 409 conflict',
  }),
  declineCall: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/calls/:callId/decline`,
    auth: 'user',
    params: CallParams,
    response: CallSession,
    summary:
      '拒接来电：私聊写「未接来电」记录，ai-runtime 随后让角色发一条消息、当天不再来电（MED-07 第 5 条）',
  }),
  hangUp: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/calls/:callId/hangup`,
    auth: 'user',
    params: CallParams,
    response: CallSession,
    summary: '挂断 / 取消拨打（幂等）。私聊写通话记录，发出 calls.call_ended',
  }),
  getCall: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/calls/:callId`,
    auth: 'user',
    params: CallParams,
    response: CallSession,
    summary: '通话状态（安卓收到来电推送后核对是否仍在响铃）',
  }),
  getActiveCall: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/calls/active`,
    auth: 'user',
    response: z.object({ call: CallSession.nullable() }),
    summary: '当前进行中或响铃中的通话（App 启动、断线重连后恢复「通话中」胶囊）',
  }),
  renewStreamTicket: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/calls/:callId/stream-ticket`,
    auth: 'user',
    params: CallParams,
    response: CallStreamTicket,
    summary: '重新获取音频流凭证（网络中断重连，CALL_LIMITS.reconnectGraceSec 内）',
  }),
} as const;

// ---------- 音频流 WebSocket 协议（ADR-0025） ----------
// 地址：CallStreamTicket.path，查询参数 ?token=。
// 二进制消息 = 音频：上行（客户端→服务器）PCM 16-bit 小端、单声道、16 kHz，每帧 20～100 ms；
//                    下行（服务器→客户端）格式见 call.ready 帧的 outputSampleRate（PCM 16-bit 小端、单声道）。
// 文本消息 = 下面的 JSON 控制帧。打断（MED-06 第 2 条）由客户端做语音活动检测后发 barge_in。

function callFrame<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.object({ type: z.literal(type), data });
}

export const CallStreamClientFrame = z.discriminatedUnion('type', [
  callFrame('hello', z.object({ inputSampleRate: z.literal(16000), clientTime: Timestamp })),
  callFrame('barge_in', z.object({ at: Timestamp })),
  callFrame('mute', z.object({ muted: z.boolean() })),
  callFrame('ping', z.object({ clientTime: Timestamp })),
]);
export type CallStreamClientFrame = z.infer<typeof CallStreamClientFrame>;

export const CallStreamServerFrame = z.discriminatedUnion('type', [
  callFrame(
    'call.ready',
    z.object({ callId: Id, outputSampleRate: z.number().int().positive(), serverTime: Timestamp }),
  ),
  callFrame(
    'call.state',
    z.object({ state: tolerantEnum(CallState), durationSec: z.number().int().nonnegative() }),
  ),
  /** 角色开始 / 停止说话（头像下方声波）。 */
  callFrame('call.agent_speaking', z.object({ speaking: z.boolean() })),
  /** 服务器要结束通话（到达上限、余额用完角色已道别、对方挂断），随后关闭连接。 */
  callFrame('call.ending', z.object({ outcome: tolerantEnum(CallOutcome) })),
  callFrame('call.error', z.object({ code: z.string(), message: z.string() })),
  callFrame('pong', z.object({ serverTime: Timestamp })),
]);
export type CallStreamServerFrame = z.infer<typeof CallStreamServerFrame>;
