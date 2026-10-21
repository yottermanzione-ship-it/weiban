/**
 * 时间线摘要接口（D-L3-05）：用户重新打开 App 时查看「你不在时 TA 过了怎样的一天」。
 * 数据来源：推演引擎（T-051）的 daily_events / mood_states。
 * 摘要生成走后台网关（behavior_planning 用途，countAsBackground=true）。
 * PRD：SIM-11。
 *
 * v2.5（T-054）：新增。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';

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

// ---------- 3.0：时间线列表（设计缺口第 5 条） ----------

/** 时间线条目来源。新增取值是次版本变更（接收端容错）。 */
export const TimelineEntrySource = z.enum([
  'daily_event', // 推演日常事件
  'moments_post', // 角色发的朋友圈
  'character_interaction', // 和其他角色的互动（共同事件、互评）
  'public_update', // 管理员审核生效的公开动态
  'shared_episode', // 本人与角色共同经历，可删除并同步忘记
]);

export const TimelineEntry = z.object({
  entryId: Id,
  source: tolerantEnum(TimelineEntrySource),
  /** 事件发生时间（推演事件为其计划时刻）。 */
  occurredAt: Timestamp,
  kind: tolerantEnum(TimelineEventKind).nullable(),
  summary: z.string().max(200),
  moodAfter: tolerantEnum(TimelineMood).nullable(),
  /** 涉及的其他角色（只列当前用户通讯录里的）。 */
  withCharacterIds: z.array(Id),
  /** 来源链接：朋友圈动态 ID、公开动态链接等；没有为 null。 */
  ref: z
    .object({ kind: z.enum(['moments_post', 'public_update', 'url']), id: z.string().max(2000) })
    .nullable(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

// ---------- 接口定义 ----------

export const TimelineEndpoints = {
  removeEpisode: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/characters/:characterId/episodes/:episodeId`,
    auth: 'user',
    params: z.object({ characterId: Id, episodeId: Id }),
    response: NoContent,
    summary: '3.32：删除本人与角色的一条共同经历，同步清理近况与归档；不允许旧任务重新写回',
  }),
  getStatus: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/status`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: z.object({ mood: TimelineMood.nullable(), updatedAt: Timestamp.nullable() }),
    summary: '3.12：本人active好友的已有推演心情；纯只读，无状态返回null，不触发模型或摘要',
  }),
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
  listTimeline: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/timeline`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: z.object({ items: z.array(TimelineEntry), nextCursor: z.string().nullable() }),
    summary:
      '3.0：角色时间线（SIM-11，资料页「TA 的日常」）：日常事件、朋友圈、和其他角色的互动、公开动态，时间倒序分页。' +
      '只含对当前用户可见的内容；不含成人模式与经期相关内容',
  }),
} as const;
