/**
 * 主动消息与节日事件管理接口（D-L3-02）。
 * 管理端：节日清单的增删改查。
 * 设计见 docs/product/prd-v1/06-simulation-proactive.md SIM-09。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  LocalDate,
  NoContent,
  Timestamp,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';

// ---------- 节日/纪念日事件 ----------

/**
 * 日期类型：
 * - once：某年某月某日（一次性，如某届活动）
 * - annual：每年固定公历月日（如元旦 1-1、圣诞 12-25）
 * - lunar_annual（3.0.2，T-076）：每年固定农历月日（如中秋 08-15），服务器换算成每年的公历日期；
 *   不支持闰月；农历当月没有这一天（如小月的三十）的年份跳过。
 */
export const HolidayDateType = z.enum(['once', 'annual', 'lunar_annual']);
export type HolidayDateType = z.infer<typeof HolidayDateType>;

/** 3.0.2：节日类型（`admin-content.md` 第 2 节，只用于筛选）。 */
export const HolidayCategory = z.enum(['traditional', 'common']);
export type HolidayCategory = z.infer<typeof HolidayCategory>;

/**
 * 3.0.2：节日适用的角色分类（由角色分类 basis / realPersonKind 推出）。空数组 = 全部角色。
 * celebrity 公众人物、historical 历史人物、private_person 身边真人、fictional 虚构、original 原创。
 */
export const HolidayCharacterCategory = z.enum([
  'celebrity',
  'historical',
  'private_person',
  'fictional',
  'original',
]);
export type HolidayCharacterCategory = z.infer<typeof HolidayCharacterCategory>;

const HolidayDateValue = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})$/, '格式 YYYY-MM-DD 或 MM-DD');

export const HolidayEvent = z.object({
  holidayId: Id,
  name: z.string().trim().min(1).max(100),
  dateType: HolidayDateType,
  /** dateType = once 时为完整日期 YYYY-MM-DD；annual 时为公历 MM-DD；lunar_annual 时为农历 MM-DD。 */
  dateValue: HolidayDateValue,
  /** 是否带恋爱含义（七夕、情人节等），只在恋爱关系或恋爱情景模式时使用恋爱口吻。 */
  romantic: z.boolean(),
  /** 是否已启用（停用后不参与调度）。 */
  enabled: z.boolean(),
  /** 3.0.2：节日类型。 */
  category: tolerantEnum(HolidayCategory).default('common'),
  /** 3.0.2：节日当天和角色聊天是否发节日卡（GRW-05），默认 true。 */
  sendCard: z.boolean().default(true),
  /** 3.0.2：节日卡用的卡面模板（素材库 holiday 类型）；null = 按角色分类自动挑选。 */
  cardTemplateId: Id.nullable().default(null),
  /** 3.0.2：适用角色分类；空数组 = 全部。 */
  characterCategories: z.array(tolerantEnum(HolidayCharacterCategory)).default([]),
  /** 3.0.2：从今天（北京时间）起最近两次对应的公历日期（农历节日用于展示「今年是 10 月 6 日」）。 */
  upcomingDates: z.array(LocalDate).max(2).default([]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type HolidayEvent = z.infer<typeof HolidayEvent>;

export const CreateHolidayRequest = z
  .object({
    name: z.string().trim().min(1).max(100),
    dateType: HolidayDateType,
    dateValue: HolidayDateValue,
    romantic: z.boolean().default(false),
    /** 3.0.2 起的可选字段，不传取默认值。 */
    category: HolidayCategory.optional(),
    sendCard: z.boolean().optional(),
    cardTemplateId: Id.nullable().optional(),
    characterCategories: z.array(HolidayCharacterCategory).max(5).optional(),
  })
  .strict();
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequest>;

export const UpdateHolidayRequest = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    /** 3.0.2：允许修改日期规则；改规则时必须同时传 dateValue。 */
    dateType: HolidayDateType.optional(),
    dateValue: HolidayDateValue.optional(),
    romantic: z.boolean().optional(),
    enabled: z.boolean().optional(),
    category: HolidayCategory.optional(),
    sendCard: z.boolean().optional(),
    cardTemplateId: Id.nullable().optional(),
    characterCategories: z.array(HolidayCharacterCategory).max(5).optional(),
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
      /** 3.0.2：按节日类型、恋爱向筛选。 */
      category: HolidayCategory.optional(),
      romantic: z
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
