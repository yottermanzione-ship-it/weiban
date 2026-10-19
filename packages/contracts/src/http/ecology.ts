/**
 * 3.19：角色生态 v1（docs/refactor/17-ecology-settings.md、docs/ai/ecology-v1.md）。数据归 ai-runtime。
 * - 用户：总开关、全局「活跃程度」四档、每种动作一个全局开关、每个角色一个开关（PRO+ 专属）；
 * - 碎碎念：角色每次「想一想」写的一两句第一人称日记，附「做了什么、花了多少积分」；
 * - 角色在生态里更新的「状态」和「个性签名」（只对该用户可见）；
 * - 管理端：决策模型、四档次数、动作总开关、唤醒时段；运行记录。
 * 不做免打扰、不做花费上限、不做主动打电话、不做角色自己换头像（17 号 §3、§4.7、§6）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

// ---------- 动作清单（17 号 §4；新增动作 = 次版本变更，接收端容错） ----------

export const ECOLOGY_ACTION_KEYS = [
  // 4.1 和你聊天
  'message',
  'greeting',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'share_link',
  // 4.2 朋友圈
  'moment_post',
  'moment_interact',
  'moment_reply',
  'moment_peer',
  // 4.3 TA 自己的生活（碎碎念每次都写，不设开关）
  'status',
  'signature',
  // 4.4 关心你
  'care_period',
  'care_weather',
  'care_anniversary',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  // 4.5 小程序与玩法
  'play_letter',
  'play_wish',
  'play_focus',
  'play_daily_question',
  'play_pet',
  'play_reminder',
  // 4.6 群聊
  'group_talk',
] as const;
export const EcologyActionKey = z.enum(ECOLOGY_ACTION_KEYS);
export type EcologyActionKey = z.infer<typeof EcologyActionKey>;

export const EcologyActionGroup = z.enum(['chat', 'moments', 'life', 'care', 'play', 'group']);
export type EcologyActionGroup = z.infer<typeof EcologyActionGroup>;

/** 活跃程度（= 每天「醒来想一想」的次数，17 号 §2）：偶尔冒泡 / 时常出现 / 常伴左右 / 形影不离。 */
export const EcologyActivityLevel = z.enum(['occasional', 'often', 'close', 'inseparable']);
export type EcologyActivityLevel = z.infer<typeof EcologyActivityLevel>;

export const EcologyAction = z.object({
  key: tolerantEnum(EcologyActionKey),
  group: tolerantEnum(EcologyActionGroup),
  label: z.string().max(30),
  /** 平台能否执行：执行器已接通、后台没有关掉、所需服务（语音合成、图片）已开通。false 时开关置灰。 */
  available: z.boolean(),
  /** 不可用时的一句说明，例「平台未开通语音合成」「即将上线」。 */
  unavailableReason: z.string().max(40).nullable(),
  /** 用户的开关（默认全开）。 */
  enabled: z.boolean(),
});
export type EcologyAction = z.infer<typeof EcologyAction>;

export const EcologyLevelOption = z.object({
  level: tolerantEnum(EcologyActivityLevel),
  label: z.string().max(10),
  minPerDay: z.number().int().min(0).max(48),
  maxPerDay: z.number().int().min(0).max(48),
  /** 约每个角色每天多少积分（按决策模型报价与最近 7 天实际平均估算）；无法估算为 null。 */
  pointsPerCharacterPerDay: z.number().nonnegative().nullable(),
});
export type EcologyLevelOption = z.infer<typeof EcologyLevelOption>;

export const EcologyCharacterSwitch = z.object({ characterId: Id, enabled: z.boolean() });
export type EcologyCharacterSwitch = z.infer<typeof EcologyCharacterSwitch>;

export const EcologySettings = z.object({
  /** 总开关（默认关）。 */
  enabled: z.boolean(),
  activityLevel: tolerantEnum(EcologyActivityLevel),
  actions: z.array(EcologyAction),
  levels: z.array(EcologyLevelOption),
  /** 每个好友角色一个开关（没设置过 = 开）。 */
  characters: z.array(EcologyCharacterSwitch),
  /** 是否 PRO+（生态专属）。false 时总开关不可打开。 */
  eligible: z.boolean(),
  /** 平台是否已配置决策模型；false 时生态不运行，界面提示「平台暂未开放」。 */
  runnable: z.boolean(),
  /** 积分不足时静默暂停（16 号 §8）；充值后自动恢复。 */
  pausedReason: z.enum(['insufficient_balance']).nullable(),
  /** 第一次打开总开关时是否已看过说明（会员专属、按动作消耗积分）。 */
  introSeen: z.boolean(),
  /** 按当前档位和已开角色估算的每天积分；无法估算为 null。 */
  estimatedPointsPerDay: z.number().nonnegative().nullable(),
  updatedAt: Timestamp.nullable(),
});
export type EcologySettings = z.infer<typeof EcologySettings>;

export const UpdateEcologySettings = z
  .object({
    enabled: z.boolean().optional(),
    activityLevel: EcologyActivityLevel.optional(),
    /** 只传要改的动作。 */
    actions: z.partialRecord(EcologyActionKey, z.boolean()).optional(),
    introSeen: z.literal(true).optional(),
  })
  .strict();
export type UpdateEcologySettings = z.infer<typeof UpdateEcologySettings>;

// ---------- 碎碎念（17 号 §5） ----------

export const EcologyMurmur = z.object({
  murmurId: Id,
  characterId: Id,
  /** 第一人称一两句，角色口吻的日记；不是模型原始思考。 */
  text: z.string().max(200),
  /** 这次做了什么；什么也没做为 null。 */
  actionKey: tolerantEnum(EcologyActionKey).nullable(),
  /** 灰色小字「做了什么」，例「给你发了条消息」「发了一条朋友圈」「看了看手机，没什么事」。 */
  actionSummary: z.string().max(60),
  /** 这次花的积分（1 积分 = 10000 微元，保留 2 位小数）。 */
  points: z.number().nonnegative(),
  /** ecology = 生态唤醒；user_request = 你在聊天里让 TA 做的（不受生态开关限制）。 */
  origin: z.enum(['ecology', 'user_request']),
  createdAt: Timestamp,
});
export type EcologyMurmur = z.infer<typeof EcologyMurmur>;

/** 角色在生态里更新的状态与个性签名，只对当前用户可见；没有为 null。 */
export const EcologyCharacterProfile = z.object({
  characterId: Id,
  statusText: z.string().max(30).nullable(),
  statusUpdatedAt: Timestamp.nullable(),
  signature: z.string().max(60).nullable(),
  signatureUpdatedAt: Timestamp.nullable(),
  /** 该角色是否参与生态（与角色开关同一个值，聊天信息页用）。 */
  ecologyEnabled: z.boolean(),
});
export type EcologyCharacterProfile = z.infer<typeof EcologyCharacterProfile>;

export const EcologyEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/ecology`,
    auth: 'user',
    response: EcologySettings,
    summary: '3.19：角色生态设置（总开关、活跃程度、动作开关、角色开关、预计积分）',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/ecology`,
    auth: 'user',
    body: UpdateEcologySettings,
    response: EcologySettings,
    summary: '3.19：修改生态设置；打开总开关需 PRO+（否则 403 forbidden）',
  }),
  setCharacter: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/ecology/characters/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({ enabled: z.boolean() }).strict(),
    response: EcologyCharacterSwitch,
    summary: '3.19：某个角色是否参与生态（聊天信息页与生态页是同一个开关）',
  }),
  listMurmurs: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/murmurs`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    query: z.object({
      cursor: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: z.object({ items: z.array(EcologyMurmur), nextCursor: z.string().nullable() }),
    summary: '3.19：TA 的碎碎念，按时间倒序（角色资料页入口）',
  }),
  getCharacterProfile: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/ecology-profile`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: EcologyCharacterProfile,
    summary: '3.19：角色在生态里更新的状态 / 个性签名（只对本人可见）与生态开关',
  }),
} as const;

// ---------- 管理端 ----------

export const EcologyLevelRange = z
  .object({ min: z.number().int().min(0).max(48), max: z.number().int().min(0).max(48) })
  .refine((v) => v.min <= v.max, { message: 'min 不能大于 max' });

export const EcologyConfig = z.object({
  /** 决策模型（必须在模型目录里且有价格）。null = 未配置：生态不运行，不回退用户聊天模型。 */
  decisionModelKey: z.string().max(200).nullable(),
  /** 四档每天唤醒次数（每个角色）。 */
  levels: z.object({
    occasional: EcologyLevelRange,
    often: EcologyLevelRange,
    close: EcologyLevelRange,
    inseparable: EcologyLevelRange,
  }),
  /** 平台关掉的动作（所有用户都不执行，用户端置灰）。 */
  disabledActions: z.array(EcologyActionKey),
  /** 唤醒分布的当地时段（时），例 8–24；角色仍会按人设和时间自己判断要不要动。 */
  wakeWindow: z
    .object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24) })
    .refine((v) => v.startHour < v.endHour, { message: '开始必须早于结束' }),
  /** 决策调用最大输出 token。 */
  decisionMaxOutputTokens: z.number().int().min(100).max(2000),
});
export type EcologyConfig = z.infer<typeof EcologyConfig>;

export const EcologyRunStatus = z.enum([
  'scheduled',
  'running',
  'done',
  'idle',
  'skipped',
  'failed',
  'paused',
]);
export type EcologyRunStatus = z.infer<typeof EcologyRunStatus>;

/** 运行记录：不含碎碎念和消息原文（加密存储，只有用户本人能看）。 */
export const EcologyRunRecord = z.object({
  runId: Id,
  userId: Id,
  characterId: Id,
  origin: z.enum(['ecology', 'user_request']),
  status: tolerantEnum(EcologyRunStatus),
  actionKey: tolerantEnum(EcologyActionKey).nullable(),
  /** 结果说明，例 sent、no_action、insufficient_balance、model_not_configured、executor_failed:xxx。 */
  outcome: z.string().max(200).nullable(),
  modelKey: z.string().nullable(),
  points: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  scheduledAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export type EcologyRunRecord = z.infer<typeof EcologyRunRecord>;

export const EcologyAdminOverview = z.object({
  config: EcologyConfig,
  /** 决策模型是否可用（已配置、在目录中且有价格）。 */
  decisionModelReady: z.boolean(),
  /** 后台提示，例「未配置决策模型，生态不会运行」。 */
  warnings: z.array(z.string().max(200)),
  /** 最近 24 小时：开着生态的用户数、唤醒次数、执行动作次数、花费积分合计。 */
  last24h: z.object({
    enabledUsers: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    points: z.number().nonnegative(),
  }),
});
export type EcologyAdminOverview = z.infer<typeof EcologyAdminOverview>;

export const EcologyAdminEndpoints = {
  getOverview: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ai/ecology`,
    auth: 'admin',
    response: EcologyAdminOverview,
    summary: '3.19：生态参数、决策模型状态与最近 24 小时概况',
  }),
  updateConfig: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/ai/ecology`,
    auth: 'admin',
    body: EcologyConfig,
    response: EcologyAdminOverview,
    summary: '3.19：修改生态参数（决策模型须在目录中且有价格，否则 422）',
  }),
  listRuns: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ai/ecology/runs`,
    auth: 'admin',
    query: z.object({
      userId: Id.optional(),
      status: EcologyRunStatus.optional(),
      cursor: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: z.object({ items: z.array(EcologyRunRecord), nextCursor: z.string().nullable() }),
    summary: '3.19：生态运行记录（按时间倒序；不含碎碎念与消息原文）',
  }),
} as const;
