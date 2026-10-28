/**
 * 设置 › 插件 › 微信接入 / 微博接入（3.42，2026-10-25 按真实旧协议重做）。
 *
 * 与旧版（C:/wb-ref/old-weiban/server）一致的真实协议：
 *
 * 微信：微信 ClawBot（iLink）协议，**服务器主动长轮询**，没有「外部网关」，也没有 webhook。
 *   1. POST {base}/ilink/bot/get_bot_qrcode?bot_type=3   → { qrcode, qrcode_img_content }
 *      · 每调一次上一张码立刻作废，实测寿命约 124 秒；所以二维码只能用户点了才出。
 *   2. GET  {base}/ilink/bot/get_qrcode_status?qrcode=…  → 扫码状态（长轮询）
 *      · wait / scaned / scaned_but_redirect / confirmed（带 bot_token、ilink_bot_id、ilink_user_id、baseurl）
 *   3. POST {base}/ilink/bot/getupdates   → 入站消息（长轮询，回传 get_updates_buf 游标）
 *   4. POST {base}/ilink/bot/sendmessage  → 出站文字
 *
 * 微博：微博 OpenIM，**服务器用 AppID / AppSecret 换 ws_token，再连 WSS**：
 *   POST https://open-im.api.weibo.com/open/auth/ws_token { app_id, app_secret } → { data: { token, uid, expire_in } }
 *   WSS  wss://open-im.api.weibo.com/ws/stream?app_id=…&token=…&version=…
 *
 * 数据模型（微信、微博共用一套状态机）：
 *
 *   unbound ──用户发起（微信出码 / 微博填凭据）──▶ pending ──对方确认──▶ active
 *     ▲                                                                   │
 *     └──────────────────── 本人解绑 / 对方撤销授权 / 会话失效 ─────────────┘
 *
 * 安全约定：
 * - 用户选的出口角色、绑定时快照的角色名、对方账号（掩码后）进数据库；**原始 bot_token / 微博 app_secret /
 *   消息正文一律用该用户的 DEK 信封加密后落库**，接口只返回掩码与展示名，明文不出服务器、不进日志。
 * - 微信出码拿到的 qrcode 本身能换 bot_token，按凭据处理：加密存库，只在本进程内解密后换 token。
 * - 本契约只服务「本新站用户主动新绑的账号」：没有任何导入旧站凭据的入口，也不会去轮询旧站记录。
 *
 * 权限：发起绑定 / 查询二维码状态是 PRO+ 权益（403 membership_required）；**解绑与查看状态不需要 PRO+**
 * （降级后仍必须能解绑、仍能看到当前绑定），它们只要求已登录。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

/** 微信官方绑定链接的唯一主机，服务端验证与客户端唤起共用。 */
export const WECHAT_BIND_URL_HOST = 'liteapp.weixin.qq.com';

/** 已接入的外部渠道。QQ 仍是「暂未开放」，不在本契约内。 */
export const ChannelId = z.enum(['wechat', 'weibo']);
export type ChannelId = z.infer<typeof ChannelId>;

/** unbound 未绑定；pending 等对方确认（微信已出码 / 微博凭据已保存）；active 已绑定；revoked 被外部解除或账号改绑。 */
export const ChannelBindingStatus = z.enum(['unbound', 'pending', 'active', 'revoked']);
export type ChannelBindingStatus = z.infer<typeof ChannelBindingStatus>;

/**
 * live 真实协议可用（运维显式打开且依赖满足）；not_configured 服务器没配依赖；
 * not_integrated 本轮没有开通（默认关闭，页面显示「未联调」，接口 422，绝不冒称可用）。
 */
export const ChannelIntegrationStatus = z.enum(['live', 'not_configured', 'not_integrated']);
export type ChannelIntegrationStatus = z.infer<typeof ChannelIntegrationStatus>;

export const ChannelState = z.object({
  channel: tolerantEnum(ChannelId),
  /** 「微信接入」/「微博接入」，与设置页那一行一致。 */
  name: z.string().max(20),
  description: z.string().max(120),
  status: tolerantEnum(ChannelBindingStatus),
  integration: tolerantEnum(ChannelIntegrationStatus),
  /** 出口角色（用户在微伴里选的那个好友）；未选择时为 null。 */
  characterId: Id.nullable(),
  /** 出口角色名（绑定时快照，用户改备注后这里是当时的角色名）。 */
  characterName: z.string().max(64).nullable(),
  /** 对面账号的展示名（微信 iLink 用户 id 原样不展示，这里放绑定时能拿到的展示名，没有则 null）。 */
  accountName: z.string().max(64).nullable(),
  /** 对面账号 id 的掩码（只留前 4 位）；未绑定为 null。完整 id 不下发客户端。 */
  accountMasked: z.string().max(24).nullable(),
  boundAt: Timestamp.nullable(),
  /** 最近一次收到该渠道消息的时间（入站、出站都算）。 */
  lastEventAt: Timestamp.nullable(),
  /** 最近一次失败原因（给人看的中文说明）；没有失败为 null。 */
  lastError: z.string().max(200).nullable(),
  /** 待确认状态的过期时间（微信二维码）；没有待确认的为 null。 */
  pendingExpiresAt: Timestamp.nullable(),
});
export type ChannelState = z.infer<typeof ChannelState>;

/** 可作为出口角色的好友（通讯录里 active 的角色）。 */
export const ChannelCharacter = z.object({
  characterId: Id,
  /** 用户看到的名字：备注优先，其次角色名。 */
  name: z.string().max(64),
});
export type ChannelCharacter = z.infer<typeof ChannelCharacter>;

/**
 * 微信二维码的对外状态（只暴露三种，上游那些 scaned / need_verifycode 细节不外泄）：
 * wait 等待扫码 / confirmed 已确认 / expired 已过期（含验证码拦截）。
 */
export const WechatQrStatus = z.enum(['wait', 'confirmed', 'expired']);
export type WechatQrStatus = z.infer<typeof WechatQrStatus>;

export const WechatQrAttempt = z.object({
  attemptId: Id,
  status: tolerantEnum(WechatQrStatus),
  /**
   * 微信返回的绑定链接（只接受 https://liteapp.weixin.qq.com/…）。页面用它画二维码；
   * 同一部手机可以复制到「文件传输助手」再点开。链接里不含 bot_token。
   */
  bindUrl: z.url(),
  characterId: Id,
  characterName: z.string().max(64),
  /** 二维码过期时间（约 124 秒）；过期后要重新生成（旧码立即作废）。 */
  expiresAt: Timestamp,
  lastError: z.string().max(200).nullable(),
  /** 确认成功后回填，页面据此直接切到「已绑定」。 */
  binding: ChannelState.nullable().optional(),
});
export type WechatQrAttempt = z.infer<typeof WechatQrAttempt>;

export const WechatQrRequest = z.object({ characterId: Id });
export type WechatQrRequest = z.infer<typeof WechatQrRequest>;

/** 已绑定后换出口角色（不重新扫码；改的是「谁在微信里回你」）。 */
export const ChannelCharacterRequest = z.object({ characterId: Id });
export type ChannelCharacterRequest = z.infer<typeof ChannelCharacterRequest>;

/**
 * 微博连入：用户在微博开放平台拿到的 AppID / AppSecret。
 * 服务器立刻用它们换一次 ws_token 校验（失败 → 422 upstream_test_failed，不落库）。
 */
export const WeiboConnectRequest = z.object({
  characterId: Id,
  appId: z.string().trim().min(8).max(256),
  appSecret: z.string().trim().min(8).max(256),
});
export type WeiboConnectRequest = z.infer<typeof WeiboConnectRequest>;

const channelParams = z.object({ channel: ChannelId });
const attemptParams = z.object({ attemptId: Id });

export const ChannelEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/channels`,
    auth: 'user',
    response: z.object({
      items: z.array(ChannelState),
      /** 可选出口角色（通讯录里 active 的角色）。微信 / 微博共用。 */
      characters: z.array(ChannelCharacter),
    }),
    summary:
      '3.42：微信 / 微博接入状态 + 可选出口角色（状态、账号掩码、绑定时间、最近事件、配置状态）',
  }),
  wechatQr: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/channels/wechat/qr`,
    auth: 'user',
    body: WechatQrRequest,
    response: WechatQrAttempt,
    summary:
      '3.42：生成微信绑定二维码（真实 iLink get_bot_qrcode；旧码立即作废、约 124 秒有效；非 PRO+ 403、未开通 422）',
  }),
  wechatQrStatus: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/channels/wechat/qr/:attemptId`,
    auth: 'user',
    params: attemptParams,
    response: WechatQrAttempt,
    summary:
      '3.42：查一次微信扫码状态（真实 get_qrcode_status；同一张码上游是长轮询，这里最多挂 8 秒就返回 wait）',
  }),
  setCharacter: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/channels/:channel/binding`,
    auth: 'user',
    params: channelParams,
    body: ChannelCharacterRequest,
    response: ChannelState,
    summary: '3.42：换出口角色（已绑定时可用；不重新授权、不重新扫码）',
  }),
  weiboConnect: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/channels/weibo/binding`,
    auth: 'user',
    body: WeiboConnectRequest,
    response: ChannelState,
    summary:
      '3.42：微博连入（用 AppID / AppSecret 真实换 ws_token 校验后加密保存；校验失败 422；未开通 422）',
  }),
  unbind: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/channels/:channel/binding`,
    auth: 'user',
    params: channelParams,
    response: ChannelState,
    summary: '3.42：解除绑定（幂等；清空对面账号与全部加密凭据；不需要 PRO+）',
  }),
} as const;

/** 微信二维码有效期（毫秒）：官方实测每张码 124 秒，出新码会让旧码立即作废。 */
export const CHANNEL_QR_TTL_MS = 124_000;
/** iLink 长轮询：服务端最多挂 35 秒，客户端留 3 秒余量。 */
export const CHANNEL_ILINK_POLL_TIMEOUT_MS = 38_000;
/** 二维码状态长轮询：上游按 35 秒算，我们只等 8 秒就返回 wait（页面 2 秒轮一次，不能超过客户端 20 秒超时）。 */
export const CHANNEL_QR_STATUS_TIMEOUT_MS = 8_000;
/** 入站消息正文入库上限（字符）。 */
export const CHANNEL_INBOUND_TEXT_MAX = 2000;
/** 出站一条消息的字符上限（iLink 长文本会被拆段；这里单条上限）。 */
export const CHANNEL_OUTBOUND_TEXT_MAX = 2000;
