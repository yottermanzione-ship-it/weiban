/**
 * 年度回忆（10-25 会员 v6，PRO+ 权益）。
 *
 * 产品边界（总经理裁定）：
 * - 服务端在每年 12 月 31 日 22:00（北京时间）自动生成一次，统计窗口固定为当年 1 月 1 日 00:00 至
 *   12 月 31 日 22:00（含头不含尾）；页面与推送都明示这个截止时刻，不宣称包含最后一秒。
 * - **没有手动生成、年度列表、按年份查询的入口**。客户端只能拉「服务器已经生成、我还没看过」的那一份
 *   （GET /me/recap/pending），看完确认后不再自动弹出；提前把手机日期改到明年也看不到，因为服务端只认
 *   自己生成过的行。
 * - 内容只有真实统计 + 确定性模板文案，不调用模型、不改模型配置、不扣用户积分；私密模式原文、
 *   系统提示、已撤回 / 已删除 / 已清空的消息都不进入统计。
 * - 正文与统计整体按用户自己的 DEK 信封加密存库，只有本人能解开（见 recap 模块）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Timestamp, defineEndpoint } from '../common.js';

/** 夜间口径：22:00 至次日 06:00；凌晨的消息在比较时算前一晚，展示仍用真实发送日期与时刻。 */
export const RECAP_NIGHT_START_HOUR = 22 as const;
export const RECAP_NIGHT_END_HOUR = 6 as const;
/** 生成时刻：12 月 31 日 22:00（北京时间），也是统计窗口的截止点。 */
export const RECAP_CUTOFF_HOUR = 22 as const;

/** 一条夜间消息。date / time 都是真实发送时间，不表示「这一晚」的日期。 */
export const RecapNightMessage = z.object({
  date: LocalDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  conversationId: Id,
  /** 私聊给角色 id，群聊为 null（群消息不归属到单个角色）。 */
  characterId: Id.nullable(),
});
export type RecapNightMessage = z.infer<typeof RecapNightMessage>;

/** 年度统计。全部是按真实数据算出的数字，没有数据的项为 0 / 空数组 / null，不编造。 */
export const RecapStats = z.object({
  /** 可见消息总数：每条消息只算一次（群消息不会按成员重复计）。 */
  totalMessages: z.number().int().nonnegative(),
  /** 其中「你」发的（按发送者参与者 refId = 本人判定，不把其他群成员算成你）。 */
  userMessages: z.number().int().nonnegative(),
  /** 其中角色发的。 */
  characterMessages: z.number().int().nonnegative(),
  groupMessages: z.number().int().nonnegative(),
  directMessages: z.number().int().nonnegative(),
  /** 私聊里聊过的角色数（按会话去重）。 */
  characterCount: z.number().int().nonnegative(),
  /** 有「你」发言的北京日期数。 */
  activeDays: z.number().int().nonnegative(),
  /** 1～12 月各月「你」发的消息数，缺月为 0。 */
  monthlyUserMessages: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        count: z.number().int().nonnegative(),
      }),
    )
    .length(12),
  /** 私聊中「你」发言最多的角色（最多 5 个，按消息数降序）。 */
  topCharacters: z
    .array(
      z.object({
        characterId: Id,
        name: z.string().max(60),
        userMessages: z.number().int().nonnegative(),
        lastMessageAt: Timestamp,
      }),
    )
    .max(5),
  /** 「你」发言最多的一天（最多 5 天，按消息数降序、同日取较近的）。 */
  busiestDays: z
    .array(
      z.object({
        date: LocalDate,
        userMessages: z.number().int().nonnegative(),
        totalMessages: z.number().int().nonnegative(),
      }),
    )
    .max(5),
  /** 「你」在夜间（22:00–次日 06:00）发得最深的一条；按夜间时间轴比较，展示真实日期与时刻。 */
  latestNight: RecapNightMessage.nullable(),
  /** 有「你」在夜间发言的晚数（按自然夜去重）。 */
  nightCount: z.number().int().nonnegative(),
  /** 最长连续活跃天数（按北京日期）。 */
  streak: z
    .object({
      days: z.number().int().positive(),
      from: LocalDate,
      to: LocalDate,
    })
    .nullable(),
  /** 其中从旧版迁移来的消息条数；> 0 时页面要如实说明日期精度。 */
  migratedMessages: z.number().int().nonnegative(),
});
export type RecapStats = z.infer<typeof RecapStats>;

export const AnnualRecap = z.object({
  recapId: Id,
  year: z.number().int().min(2026).max(9999),
  generatedAt: Timestamp,
  /** 统计窗口，含头不含尾。 */
  windowStart: Timestamp,
  windowEnd: Timestamp,
  /** 给人看的口径与截止说明（含「统计截至 12 月 31 日 22:00」）。 */
  cutoffNote: z.string().max(400),
  /** 确定性文字回顾（服务端生成，只含真实数字）。 */
  lines: z.array(z.string().max(200)).max(20),
  /** 如实说明的限制；没有为 null。 */
  caveat: z.string().max(300).nullable(),
  stats: RecapStats,
});
export type AnnualRecap = z.infer<typeof AnnualRecap>;

export const RecapEndpoints = {
  pending: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/recap/pending`,
    auth: 'user',
    response: z.object({ recap: AnnualRecap.nullable() }),
    summary:
      '服务器已经生成、我还没看过的年度回忆（没有则 recap = null）。只读：不触发生成、不能按年份或提前查看；已确认看过的不再返回',
  }),
  markSeen: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/recap/pending/seen`,
    auth: 'user',
    response: NoContent,
    summary: '确认看过待展示的年度回忆（幂等）；之后不再自动弹出',
  }),
} as const;
