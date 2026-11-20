import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, cursorPage, defineEndpoint } from '../common.js';
import { AdminUserLabel } from './admin-users.js';
import { ModelPurpose } from '../ports/model-gateway.js';

export const AdminTaskState = z.enum([
  'message_saved',
  'proactive_sent',
  'thought_visible',
  'thought_filtered',
  'result_saved',
  'result_filtered',
  'summary_saved',
  'retry_pending',
  'blocked_balance',
  'blocked_concurrency',
  'blocked_budget',
  'blocked_request',
  'cancelled',
  'undelivered',
  'running',
  'unverified',
]);
export type AdminTaskState = z.infer<typeof AdminTaskState>;
export const AdminTaskFilter = z.object({
  from: Timestamp,
  to: Timestamp,
  state: AdminTaskState.optional(),
  rescued: z.boolean().optional(),
  userIds: z.array(Id).min(1).max(50).optional(),
  usageRecordId: Id.optional(),
  purpose: ModelPurpose.optional(),
  modelKey: z.string().min(1).max(220).optional(),
  upstreamId: Id.optional(),
  errorCode: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
});
export type AdminTaskFilter = z.infer<typeof AdminTaskFilter>;
const value = z.number().int().nonnegative();
export const AdminModelTask = z.object({
  taskKey: Id,
  userId: Id,
  userLabel: AdminUserLabel.nullable(),
  conversationKind: z.string().nullable(),
  promptTemplateVersion: z.string().nullable(),
  startedAt: Timestamp,
  updatedAt: Timestamp,
  purpose: z.string(),
  state: AdminTaskState,
  retryAt: Timestamp.nullable(),
  reason: z.string().max(80).nullable(),
  attemptCount: value,
  failedAttempts: value,
  modelCount: value,
  firstModel: z.string().nullable(),
  lastModel: z.string().nullable(),
  rescued: z.boolean(),
  chargedMicros: value,
  refundedMicros: value.nullable(),
  reportedCostMicros: value,
  estimatedCostMicros: value,
  pendingCosts: value,
});
export type AdminModelTask = z.infer<typeof AdminModelTask>;
const diagnostic = z.object({
  stage: z.string().optional(),
  httpStatus: value.optional(),
  providerCode: z.string().optional(),
  requestId: z.string().optional(),
  retryAfterMs: value.optional(),
  lastDataMs: value.optional(),
  lastProgressMs: value.optional(),
  firstProgressMs: value.optional(),
  emptyKind: z.string().optional(),
  requestField: z.string().optional(),
  switchReason: z.string().optional(),
  failureDomain: z.string().optional(),
  rateLimitScope: z.string().optional(),
});
export const VoiceCancellationReason = z.enum([
  'authorization_denied',
  'realtime_open_failed',
  'unused_asr_segment',
  'unused_realtime_segment',
  'realtime_time_limit',
  'realtime_insufficient_balance',
  'realtime_failed',
  'clone_not_started',
]);
export type VoiceCancellationReason = z.infer<typeof VoiceCancellationReason>;
export const AdminTaskAttempt = z.object({
  usageRecordId: Id,
  createdAt: Timestamp,
  completedAt: Timestamp.nullable(),
  modelKey: z.string(),
  upstreamId: Id,
  upstreamName: z.string().nullable(),
  upstreamModelId: z.string(),
  ordinal: value.nullable(),
  requestPriceLimit: z
    .object({ estimatedSellMicros: value, limitMicros: value, priceVersionId: Id })
    .nullable()
    .optional(),
  cancellationReason: VoiceCancellationReason.nullable().optional(),
  holdStatus: z.enum(['active', 'settled', 'released', 'expired']).nullable().optional(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  errorCode: z.string().nullable(),
  sent: z.enum(['sent', 'authorized', 'not_sent', 'unknown']),
  costMicros: value,
  chargedMicros: value,
  refundedMicros: value.nullable(),
  absorbedCostMicros: value,
  costKnown: z.boolean(),
  estimated: z.boolean(),
  latencyMs: value,
  inputTokens: value,
  cachedInputTokens: value,
  cacheWrite5mTokens: value,
  cacheWrite1hTokens: value,
  outputTokens: value,
  reasoningTokens: value.nullable(),
  priceVersionId: Id.nullable(),
  priceVersionLabel: z.string().nullable(),
  overallRemainingMs: value.nullable(),
  crossModelReserveMs: value.nullable(),
  routePriority: value.nullable(),
  deadlineMs: value.nullable(),
  timeoutMs: value.nullable(),
  progressTimeoutMs: value.nullable(),
  adapterElapsedMs: value.nullable(),
  diagnostic: diagnostic.nullable(),
});
export type AdminTaskAttempt = z.infer<typeof AdminTaskAttempt>;
const page = {
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).default(40),
};
export const adminTaskEndpoints = {
  modelTaskOverview: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/tasks/overview`,
    auth: 'admin',
    body: z.object({ filter: AdminTaskFilter }),
    response: z.object({
      total: value,
      rescued: value,
      states: z.array(z.object({ state: AdminTaskState, count: value })),
    }),
    summary: '任务结果计数，不加载明细或模型内容',
  }),
  listModelTasks: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/tasks`,
    auth: 'admin',
    body: z.object({ filter: AdminTaskFilter, ...page }),
    response: cursorPage(AdminModelTask),
    summary: '按业务任务汇总模型结果，分页读取',
  }),
  listTaskAttempts: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/tasks/attempts`,
    auth: 'admin',
    body: z.object({ taskKey: Id, ...page }),
    response: cursorPage(AdminTaskAttempt),
    summary: '按发生顺序查询任务的原始调用尝试与结构化诊断',
  }),
  exportModelTasks: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/tasks/export`,
    auth: 'admin',
    body: z.object({ filter: AdminTaskFilter }),
    response: z.object({ items: z.array(AdminModelTask), truncated: z.boolean() }),
    summary: '导出按筛选匹配的任务结果并登记审计',
  }),
};
