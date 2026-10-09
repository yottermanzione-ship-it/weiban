/**
 * 主动消息与节日事件管理接口（D-L3-02）。
 * 管理端：节日清单的增删改查。
 * 设计见 docs/product/prd-v1/06-simulation-proactive.md SIM-09。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Timestamp, defineEndpoint } from '../common.js';

// ---------- 节日/纪念日事件 ----------

/**
 * 日期类型：
 * - once：某年某月某日（一次性，如某届活动）
 * - annual：每年固定月日（如元旦 1-1、圣诞 12-25）
 */
export const HolidayDateType = z.enum(['once', 'annual']);
export type HolidayDateType = z.infer<typeof HolidayDateType>;

export const HolidayEvent = z.object({
  holidayId: Id,
  name: z.string().trim().min(1).max(100),
  dateType: HolidayDateType,
  /** dateType = once 时为完整日期 YYYY-MM-DD；annual 时为 MM-DD。 */
  dateValue: z.string().regex(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})$/, '格式 YYYY-MM-DD 或 MM-DD'),
  /** 是否带恋爱含义（七夕、情人节等），只在恋爱关系或恋爱情景模式时使用恋爱口吻。 */
  romantic: z.boolean(),
  /** 是否已启用（停用后不参与调度）。 */
  enabled: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type HolidayEvent = z.infer<typeof HolidayEvent>;

export const CreateHolidayRequest = z
  .object({
    name: z.string().trim().min(1).max(100),
    dateType: HolidayDateType,
    dateValue: z.string().regex(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})$/),
    romantic: z.boolean().default(false),
  })
  .strict();
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequest>;

export const UpdateHolidayRequest = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    dateValue: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})$/)
      .optional(),
    romantic: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type UpdateHolidayRequest = z.infer<typeof UpdateHolidayRequest>;

const holidayParams = z.object({ holidayId: Id });

export const HolidayAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/proactive/holidays`,
    auth: 'admin',
    query: z.object({
      enabled: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      cursor: z.string().optional(),
    }),
    response: z.object({
      items: z.array(HolidayEvent),
      nextCursor: z.string().nullable(),
    }),
    summary: 'ADM 节日清单（SIM-09），可过滤启用状态',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/proactive/holidays`,
    auth: 'admin',
    body: CreateHolidayRequest,
    response: HolidayEvent,
    summary: '新增节日/纪念日（SIM-09 第 1 条）',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/proactive/holidays/:holidayId`,
    auth: 'admin',
    params: holidayParams,
    body: UpdateHolidayRequest,
    response: HolidayEvent,
    summary: '修改节日（名称/日期/启停）',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/proactive/holidays/:holidayId`,
    auth: 'admin',
    params: holidayParams,
    response: NoContent,
    summary: '删除节日（物理删除，影响历史统计，建议改用停用）',
  }),
} as const;

// ---------- 角色日常事件（日报记录） ----------

/**
 * 一件日常事件（推演生成，ai-runtime 写入，后端存储）。
 * 事件 source 区分推演生成 / 公开动态（SIM-01、SIM-03）。
 */
export const DailyEventSource = z.enum(['simulation', 'public_feed']);
export type DailyEventSource = z.infer<typeof DailyEventSource>;

export const DailyEvent = z.object({
  eventId: Id,
  userId: Id,
  characterId: Id,
  /** 事件所属的用户本地日期（YYYY-MM-DD）。 */
  eventDate: LocalDate,
  /** 事件发生的大致时间描述（"上午" / "14:30"），可为空。 */
  eventTime: z.string().max(20).nullable(),
  summary: z.string().min(1).max(500),
  /** 涉及的另一个角色 ID（关系网中），可为空。 */
  withCharacterId: Id.nullable(),
  /** 心情影响描述，可为空。 */
  moodEffect: z.string().max(200).nullable(),
  source: DailyEventSource,
  createdAt: Timestamp,
});
export type DailyEvent = z.infer<typeof DailyEvent>;

export const CreateDailyEventRequest = z
  .object({
    eventId: Id,
    userId: Id,
    characterId: Id,
    eventDate: LocalDate,
    eventTime: z.string().max(20).optional(),
    summary: z.string().min(1).max(500),
    withCharacterId: Id.optional(),
    moodEffect: z.string().max(200).optional(),
    source: DailyEventSource,
  })
  .strict();
export type CreateDailyEventRequest = z.infer<typeof CreateDailyEventRequest>;

const dailyEventParams = z.object({ eventId: Id });
const characterDateParams = z.object({ characterId: Id });

export const DailyEventEndpoints = {
  /** ai-runtime 批量写入当天事件（T-053 调度后调用）。 */
  createBatch: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/internal/proactive/daily-events/batch`,
    auth: 'admin',
    body: z.object({ events: z.array(CreateDailyEventRequest).min(1).max(50) }),
    response: z.object({ created: z.number().int().nonnegative() }),
    summary: '管理员批量写入角色日报；服务端调用 DailyEventPort',
  }),
  /** 客户端查询某角色的时间线（SIM-11）。 */
  listByCharacter: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/daily-events`,
    auth: 'user',
    params: characterDateParams,
    query: z.object({
      from: LocalDate.optional(),
      to: LocalDate.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().optional(),
    }),
    response: z.object({
      items: z.array(DailyEvent),
      nextCursor: z.string().nullable(),
    }),
    summary: '时间线（SIM-11）：某角色最近 90 天日常事件，按时间倒序',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/internal/proactive/daily-events/:eventId`,
    auth: 'admin',
    params: dailyEventParams,
    response: NoContent,
    summary: '删除一件日常事件（管理后台纠错用）',
  }),
} as const;
