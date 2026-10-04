/**
 * 产品参数（PRD 第 5.1 节 P-01～P-33）在代码中的唯一映射处（engineering-standards.md 第 2 节）。
 *
 * 规则：
 * - 数字的定义权在产品负责人（docs/product/prd-v1.md 第 5.1 节「全文唯一定义处」）。PRD 改数字时只改这个文件。
 * - 其他代码只 import 这里的常量，不在别处写同样的数字。
 * - 常量名带编号，注释写明来源。时长统一用毫秒（后缀 _MS）或秒（后缀 _SECONDS），金额用微元（后缀 _MICROS，
 *   1 元 = 1,000,000 微元，engineering-standards.md 第 5 节第 7 条）。
 *
 * 当前对照 PRD v1.2（2026-10-05）。
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const YUAN_MICROS = 1_000_000;

/** 来源：PRD 第 5 节 P-01。关闭秒回时的回复延迟：按回复长度 3–20 秒；从送达到第一条气泡最长 60 秒（含生成时间）。CHAT-04 */
export const P01_REPLY_DELAY = {
  minMs: 3 * SECOND_MS,
  maxMs: 20 * SECOND_MS,
  firstBubbleDeadlineMs: 60 * SECOND_MS,
} as const;

/** 来源：PRD 第 5 节 P-02。拆条：一次回复 1–4 条气泡，气泡间隔 1–4 秒。CHAT-05 */
export const P02_SPLIT_BUBBLES = {
  minBubbles: 1,
  maxBubbles: 4,
  minIntervalMs: 1 * SECOND_MS,
  maxIntervalMs: 4 * SECOND_MS,
} as const;

/** 来源：PRD 第 5 节 P-03。每个角色每天主动消息上限（一次可含多条气泡）。SIM-05 */
export const P03_PROACTIVE_PER_CHARACTER_PER_DAY = 3;

/** 来源：PRD 第 5 节 P-04。所有角色合计每天主动消息上限。SIM-05 */
export const P04_PROACTIVE_TOTAL_PER_DAY = 8;

/** 来源：PRD 第 5 节 P-05。活跃时段数据不足时的默认可发时段（用户时区，HH:mm）。SIM-05 */
export const P05_DEFAULT_ACTIVE_WINDOW = { start: '09:00', end: '23:00' } as const;

/** 来源：PRD 第 5 节 P-06。活跃时段学习：看最近 14 天，至少 5 天有聊天记录才启用。SIM-05 */
export const P06_ACTIVE_WINDOW_LEARNING = { lookbackDays: 14, minActiveDays: 5 } as const;

/** 来源：PRD 第 5 节 P-07。主动消息话题去重窗口。SIM-05 */
export const P07_PROACTIVE_TOPIC_DEDUP_MS = 7 * DAY_MS;

/** 来源：PRD 第 5 节 P-08。久未联系阈值 72 小时；每次缺席最多 1 条。SIM-08 */
export const P08_LONG_ABSENCE = { thresholdMs: 72 * HOUR_MS, maxMessagesPerAbsence: 1 } as const;

/** 来源：PRD 第 5 节 P-09。用户 5 分钟内在任一会话发过消息则延后其他角色主动消息；最长延后 60 分钟，超时放弃。SIM-05 */
export const P09_PROACTIVE_DEFER_WHILE_CHATTING = {
  recentActivityMs: 5 * MINUTE_MS,
  maxDeferMs: 60 * MINUTE_MS,
} as const;

/** 来源：PRD 第 5 节 P-10。主动来电：每角色每 7 天最多 1 次；全部角色每 7 天最多 3 次；要求熟悉度 L3 及以上。MED-07 */
export const P10_PROACTIVE_CALL = {
  windowMs: 7 * DAY_MS,
  perCharacter: 1,
  total: 3,
  minFamiliarityLevel: 3,
} as const;

/** 来源：PRD 第 5 节 P-11。已读不回：每角色每天最多 1 次；延迟 30 秒–3 分钟后必须回复。CHAT-07 */
export const P11_READ_NO_REPLY = {
  perCharacterPerDay: 1,
  minDelayMs: 30 * SECOND_MS,
  maxDelayMs: 3 * MINUTE_MS,
} as const;

/** 来源：PRD 第 5 节 P-12。撤回重发：每角色每天最多 1 次。CHAT-08 */
export const P12_RECALL_RESEND_PER_CHARACTER_PER_DAY = 1;

/** 来源：PRD 第 5 节 P-13。打错字更正：每角色每天最多 2 次。CHAT-08 */
export const P13_TYPO_CORRECTION_PER_CHARACTER_PER_DAY = 2;

/** 来源：PRD 第 5 节 P-14。负面心情：每角色每 7 天最多 2 天；单次最长 24 小时。SIM-12 */
export const P14_NEGATIVE_MOOD = {
  windowMs: 7 * DAY_MS,
  maxDays: 2,
  maxDurationMs: DAY_MS,
} as const;

/** 来源：PRD 第 5 节 P-15。推演日常事件数：每角色每天 3–6 件。SIM-01 */
export const P15_DAILY_EVENTS_PER_CHARACTER = { min: 3, max: 6 } as const;

/** 来源：PRD 第 5 节 P-16。朋友圈：每角色每天最多 1 条；默认每周 2–4 条（按人设调整）。SOC-07 */
export const P16_MOMENTS_FREQUENCY = { maxPerDay: 1, perWeekMin: 2, perWeekMax: 4 } as const;

/** 来源：PRD 第 5 节 P-17。用户连续 7 天未打开 App 则暂停推演。SIM-01 */
export const P17_SIMULATION_PAUSE_AFTER_INACTIVE_MS = 7 * DAY_MS;

/** 来源：PRD 第 5 节 P-18。「你不在时」摘要：距上次进入该私聊 ≥ 12 小时且期间有日常事件；最多 5 条。SIM-11 */
export const P18_WHILE_AWAY_SUMMARY = { minAbsenceMs: 12 * HOUR_MS, maxItems: 5 } as const;

/** 来源：PRD 第 5 节 P-19。群聊回应：每条用户消息后最多 3 个角色回应；无用户新发言时角色连续消息最多 6 条。SOC-04 */
export const P19_GROUP_RESPONSES = {
  maxRespondersPerUserMessage: 3,
  maxConsecutiveCharacterMessages: 6,
} as const;

/** 来源：PRD 第 5 节 P-20。群聊自发话题：每群每天最多 1 次，每次最多 10 条；仅限 7 天内用户发过言的群。SOC-05 */
export const P20_GROUP_SPONTANEOUS_TOPIC = {
  perGroupPerDay: 1,
  maxMessages: 10,
  userActiveWithinMs: 7 * DAY_MS,
} as const;

/** 来源：PRD 第 5 节 P-21。群成员上限：9 个角色 + 用户。SOC-03 */
export const P21_GROUP_MAX_CHARACTERS = 9;

/** 来源：PRD 第 5 节 P-22。角色主动拉群：全部角色合计每 7 天最多 1 次。SOC-06 */
export const P22_CHARACTER_CREATED_GROUP = { windowMs: 7 * DAY_MS, total: 1 } as const;

/** 来源：PRD 第 5 节 P-23。用户撤回自己消息的时限：2 分钟。CHAT-02 */
export const P23_RECALL_WINDOW_MS = 2 * MINUTE_MS;

/** 来源：PRD 第 5 节 P-24。单张分享图消息数上限。EXP-01 */
export const P24_SHARE_IMAGE_MAX_MESSAGES = 30;

/**
 * 来源：PRD 第 5 节 P-25。熟悉度：升级累计点数与每日上限、各行为得分。GRW-03
 * levelThresholds[n] 表示升到 L(n) 需要的累计点数（L1 为 0）。
 */
export const P25_FAMILIARITY = {
  levelThresholds: { 1: 0, 2: 30, 3: 100, 4: 300, 5: 700 },
  maxPointsPerCharacterPerDay: 20,
  points: {
    activeChatDay: 10,
    replyToProactive: 2,
    momentsInteraction: 2,
    anniversaryChat: 10,
    firstTimeInteraction: 5,
  },
} as const;

/** 来源：PRD 第 5 节 P-26。通讯录角色数上限。CHR-03、SIM-13 */
export const P26_CONTACT_LIMIT = 50;

/** 来源：PRD 第 5 节 P-27。名片推荐：所有角色合计每 7 天最多主动推荐 1 次；「不感兴趣」后该角色冷却 90 天。CHR-04 */
export const P27_CARD_RECOMMENDATION = {
  windowMs: 7 * DAY_MS,
  total: 1,
  notInterestedCooldownMs: 90 * DAY_MS,
} as const;

/** 来源：PRD 第 5 节 P-28。开启秒回时：不加人为延迟；每条气泡前「正在输入」至少显示 1 秒。CHAT-04 */
export const P28_INSTANT_REPLY_MIN_TYPING_MS = 1 * SECOND_MS;

/** 来源：PRD 第 5 节 P-29。朋友圈回复时限：角色回复评论、点赞或评论用户动态最晚 2 小时内。SOC-08、SOC-09 */
export const P29_MOMENTS_REPLY_DEADLINE_MS = 2 * HOUR_MS;

/** 来源：PRD 第 5 节 P-30。添加角色后「通过好友申请」的时间：3–30 秒随机。CHR-03 */
export const P30_CONTACT_ACCEPT_DELAY = { minMs: 3 * SECOND_MS, maxMs: 30 * SECOND_MS } as const;

/** 来源：PRD 第 5 节 P-31。单次语音通话时长上限 60 分钟；到 55 分钟时角色自然提醒。MED-06 */
export const P31_VOICE_CALL = {
  maxDurationMs: 60 * MINUTE_MS,
  reminderAtMs: 55 * MINUTE_MS,
} as const;

/** 来源：PRD 第 5 节 P-32（v1.2 新增）。低余额提醒线：5 元。MDL-10、SVC-01 */
export const P32_LOW_BALANCE_ALERT_MICROS = 5 * YUAN_MICROS;

/** 来源：PRD 第 5 节 P-33（v1.2 新增）。后台功能保留线：1 元，低于此值时后台功能停止，余额留给聊天回复。MDL-05、MDL-10 */
export const P33_BACKGROUND_RESERVE_MICROS = 1 * YUAN_MICROS;
