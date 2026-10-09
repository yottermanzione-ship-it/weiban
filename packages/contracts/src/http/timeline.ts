/**
 * 时间线摘要接口（D-L3-05）：用户重新打开 App 时查看「你不在时 TA 过了怎样的一天」。
 * 数据来源：推演引擎（T-051）的 daily_events / mood_states。
 * 摘要生成走后台网关（behavior_planning 用途，countAsBackground=true）。
 * PRD：SIM-11。
 *
 * v2.5（T-054）：新增。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

// ---------- 事件类型 ----------

export const TimelineEventKind = z.enum([
  'work',
  'social',
  'leisure',
  'errand',
  'rest',
  'unexpected',
]);
export type TimelineEventKind = z.infer<typeof TimelineEventKind>;

export const TimelineMood = z.enum([
  'happy',
  'neutral',
  'tired',
  'annoyed',
  'excited',
  'sad',
  'anxious',
]);
export type TimelineMood = z.infer<typeof TimelineMood>;

// ---------- 响应体 ----------

export const TimelineEvent = z.object({
  id: Id,
  seq: z.number().int().nonnegative(),
  kind: TimelineEventKind,
  summary: z.string(),
  detail: z.string().optional(),
  moodAfter: TimelineMood.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TimelineSummaryResponse = z.object({
  /**
   * 摘要文本。为 null 时表示：离线时长不足 P-18 的 12 小时、后台预算耗尽、或缺席期间无推演事件。
   * 客户端收到 null 时不显示「你不在时」卡片。
   */
  summary: z.string().nullable(),
  /** 缺席期间推演事件，按生成时间倒序、同日 seq 倒序，最多 5 条。summary 为 null 时也可能有事件。 */
  events: z.array(TimelineEvent),
  /** 角色当前心情。 */
  currentMood: TimelineMood,
  /** 本次统计的离线时长（秒）；P-18 摘要门槛为 43200 秒。 */
  offlineSeconds: z.number().int().nonnegative(),
});
export type TimelineSummaryResponse = z.infer<typeof TimelineSummaryResponse>;

// ---------- 接口定义 ----------

export const TimelineEndpoints = {
  getSummary: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/timeline-summary`,
    auth: 'user',
    params: z.object({ conversationId: Id }),
    query: z.object({ characterId: Id, lastActiveAt: Timestamp }),
    response: TimelineSummaryResponse,
    summary:
      '获取「你不在时」摘要卡片（SIM-11/P-18）。离线不足 12 小时或无事件时 summary 为 null。',
  }),
} as const;
