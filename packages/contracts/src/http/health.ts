/**
 * health 模块 HTTP 接口（用户侧）。
 * 需求：PLAY-01（经期日记）；隐私与加密设计见 docs/architecture/health-data.md。
 *
 * 所有日期字段均以明文传输（仅用户本人可见，服务器解密后响应）。
 * 预测结果始终带「仅供参考」标注（PLAY-01 第 3 条）。
 * 备注（notes）只在用户本人的接口响应中出现，不进入任何端口或其他接口。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, defineEndpoint, cursorPage } from '../common.js';

// ---------- 枚举 ----------

/** 经期流量（少 / 中 / 多）。 */
export const PeriodFlow = z.enum(['light', 'medium', 'heavy']);
export type PeriodFlow = z.infer<typeof PeriodFlow>;

/** 痛感等级（无 / 轻 / 中 / 重）。 */
export const PeriodPain = z.enum(['none', 'mild', 'moderate', 'severe']);
export type PeriodPain = z.infer<typeof PeriodPain>;

/** 预测可信度：数据正常 / 周期不规律 / 记录不足。 */
export const PredictionConfidence = z.enum(['normal', 'irregular', 'insufficient_data']);
export type PredictionConfidence = z.infer<typeof PredictionConfidence>;

// ---------- 每日记录 ----------

/**
 * 某一天的经期日记（flow / pain / symptoms / notes 均可选）。
 * notes 最多 200 字（PLAY-01 第 2 条），**只给用户本人查看**，不流向任何端口或其他接口。
 */
export const DayLog = z.object({
  date: LocalDate,
  flow: PeriodFlow.nullable(),
  pain: PeriodPain.nullable(),
  /** 症状标签来自管理员维护的列表（ADM-04），此处存标签名。 */
  symptoms: z.array(z.string().min(1).max(20)).max(20),
  /** 最多 200 字，只给用户自己看（PLAY-01 第 2 条）。 */
  notes: z.string().max(200).nullable(),
});
export type DayLog = z.infer<typeof DayLog>;

// ---------- 经期记录（一次经期） ----------

/** 一次经期的完整记录，含该周期内所有日记条目。 */
export const CycleRecord = z.object({
  cycleId: Id,
  startDate: LocalDate,
  endDate: LocalDate.nullable(),
  dayLogs: z.array(DayLog),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type CycleRecord = z.infer<typeof CycleRecord>;

// ---------- 请求体 ----------

/** 开始记录一次新经期（PLAY-01 第 2 条）。 */
export const CreateCycleRequest = z.object({
  startDate: LocalDate,
});
export type CreateCycleRequest = z.infer<typeof CreateCycleRequest>;

/**
 * 更新经期记录：补记结束日 和/或 添加/更新某天的日记。
 * 两个字段均可选，但至少提供一个（由服务器校验）。
 */
export const UpdateCycleRequest = z
  .object({
    /** 结束日（补记时填写）。 */
    endDate: LocalDate.optional(),
    /** 新增或覆盖某一天的日记条目。 */
    dayLog: DayLog.optional(),
  })
  .refine((v) => v.endDate !== undefined || v.dayLog !== undefined, {
    message: 'endDate 和 dayLog 至少填写一个',
  });
export type UpdateCycleRequest = z.infer<typeof UpdateCycleRequest>;

// ---------- 预测结果 ----------

/**
 * 经期预测结果（PLAY-01 第 3 条）。
 * 界面必须始终展示 disclaimer 字段（「仅供参考」文案）。
 */
export const PredictionResult = z.object({
  predictedNextStart: LocalDate.nullable(),
  predictedDays: z.number().int().positive().nullable(),
  confidence: PredictionConfidence,
  /** 界面必须展示的「仅供参考」文案，由服务器提供。 */
  disclaimer: z.string(),
});
export type PredictionResult = z.infer<typeof PredictionResult>;

// ---------- 授权 ----------

/** 单个角色的授权状态（是否被用户勾选为「知道经期信息」）。 */
export const CharacterAuthEntry = z.object({
  characterId: Id,
  authorized: z.boolean(),
});
export type CharacterAuthEntry = z.infer<typeof CharacterAuthEntry>;

export const AuthorizationResponse = z.object({
  authorizedCharacterIds: z.array(Id),
});
export type AuthorizationResponse = z.infer<typeof AuthorizationResponse>;

/** 全量覆盖授权列表（PLAY-01 第 4 条）。 */
export const UpdateAuthorizationRequest = z.object({
  authorizedCharacterIds: z.array(Id),
});
export type UpdateAuthorizationRequest = z.infer<typeof UpdateAuthorizationRequest>;

// ---------- 路由参数 ----------

const CycleParams = z.object({ cycleId: Id });

// ---------- 接口 ----------

export const HealthEndpoints = {
  /** 记录经期开始日（PLAY-01 第 2 条）。 */
  createCycle: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/health/cycles`,
    auth: 'user',
    body: CreateCycleRequest,
    response: CycleRecord,
    summary: 'PLAY-01 记录一次新经期',
  }),

  /** 补记结束日或添加当天日记（PLAY-01 第 2 条）。 */
  updateCycle: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/health/cycles/:cycleId`,
    auth: 'user',
    params: CycleParams,
    body: UpdateCycleRequest,
    response: CycleRecord,
    summary: 'PLAY-01 更新经期记录（补结束日 / 添加日记）',
  }),

  /** 删除整条经期记录（含该周期所有日记，PLAY-01 第 8 条）。 */
  deleteCycle: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/me/health/cycles/:cycleId`,
    auth: 'user',
    params: CycleParams,
    response: z.null(),
    summary: 'PLAY-01 删除单条经期记录',
  }),

  /** 查询全部历史经期，按开始日倒序，游标分页（PLAY-01 第 2 条）。 */
  listCycles: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/health/cycles`,
    auth: 'user',
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    response: cursorPage(CycleRecord),
    summary: 'PLAY-01 历史经期列表（含各周期日记）',
  }),

  /**
   * 预测下次经期开始日与经期天数（PLAY-01 第 3 条）。
   * 响应中 disclaimer 字段必须展示在界面上。
   */
  getPrediction: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/health/prediction`,
    auth: 'user',
    response: PredictionResult,
    summary: 'PLAY-01 预测下次经期（含仅供参考标注）',
  }),

  /** 查询已授权的角色列表（PLAY-01 第 4 条）。 */
  getAuthorization: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/health/authorization`,
    auth: 'user',
    response: AuthorizationResponse,
    summary: 'PLAY-01 查询已授权角色',
  }),

  /**
   * 全量覆盖授权列表（PLAY-01 第 4 条）。
   * 传空数组即撤销全部授权；撤销立即生效，角色下次生成起不再读取经期数据。
   */
  updateAuthorization: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/health/authorization`,
    auth: 'user',
    body: UpdateAuthorizationRequest,
    response: AuthorizationResponse,
    summary: 'PLAY-01 更新授权角色列表（全量覆盖）',
  }),
} as const;
