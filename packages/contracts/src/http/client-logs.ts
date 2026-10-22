/** 3.33：客户端运行记录。只接收固定分类和技术坐标，不接收异常原文。 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const ClientLogKind = z.enum([
  'js_error',
  'unhandled_rejection',
  'render_error',
  'chunk_load_error',
  'api_failure',
  'realtime_issue',
  'app_crash',
  'push_issue',
]);
export const ClientLogApp = z.enum(['web', 'pwa', 'android']);
export const ClientLogStatus = z.enum(['open', 'resolved', 'ignored']);
export const ClientLogCode = z.enum([
  'unknown',
  'type_error',
  'reference_error',
  'syntax_error',
  'range_error',
  'network_error',
  'timeout',
  'server_error',
  'chunk_load_failed',
  'render_failed',
  'realtime_reconnect',
  'app_crash',
  'push_failed',
]);
export const ClientLogVersion = z.string().regex(/^(?:\d{1,4}\.\d{1,4}\.\d{1,4}|dev|unknown)$/);
export const ClientLogBuild = z.string().regex(/^(?:[a-fA-F0-9]{1,12}|dev|unknown)$/);
export const ClientLogEnvironment = z
  .object({
    os: z.enum(['android', 'ios', 'windows', 'macos', 'linux', 'other']),
    browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'webview', 'native', 'other']),
    major: z.number().int().min(0).max(999),
    screen: z.enum(['small', 'medium', 'large']),
    language: z.enum(['zh', 'en', 'other']),
    network: z.enum(['wifi', 'cellular', 'ethernet', 'offline', 'unknown']),
  })
  .strict();
export const ClientLogFrame = z
  .object({
    file: z.enum(['app.js', 'app.kt']),
    line: z.number().int().min(0).max(10000000),
    column: z.number().int().min(0).max(1000000),
    /** 代码文件的短指纹；不含原始 URL、文件名或本机目录。 */
    asset: z
      .string()
      .regex(/^[a-f0-9]{8}$/)
      .optional(),
  })
  .strict();
/** 路由还要在客户端和服务端按静态词表归一化；本 schema 只限定形态 / 长度。 */
export const ClientLogRoute = z
  .string()
  .max(180)
  .regex(/^\/(?:v1|[a-z-]+|:id)?(?:\/(?:v1|[a-z-]+|:id))*$/);
export const ClientRuntimeEvent = z
  .object({
    clientEventId: Id,
    sessionId: Id,
    occurredAt: Timestamp,
    kind: ClientLogKind,
    appKind: ClientLogApp,
    version: ClientLogVersion,
    build: ClientLogBuild,
    page: ClientLogRoute,
    code: ClientLogCode,
    frames: z.array(ClientLogFrame).max(20),
    environment: ClientLogEnvironment,
    count: z.number().int().min(1).max(10000),
    components: z
      .array(z.string().regex(/^[a-f0-9]{8}$/))
      .max(20)
      .optional(),
    api: z
      .object({
        route: ClientLogRoute,
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        status: z.number().int().min(0).max(599),
        durationMs: z.number().int().min(0).max(120000),
        requestId: Id.optional(),
      })
      .strict()
      .optional(),
    reconnects: z.number().int().min(0).max(10000).optional(),
    offlineSeconds: z.number().int().min(0).max(86400).optional(),
  })
  .strict();
export type ClientRuntimeEvent = z.infer<typeof ClientRuntimeEvent>;
export const ClientLogBatch = z
  .object({
    sessionId: Id,
    appKind: ClientLogApp,
    version: ClientLogVersion,
    build: ClientLogBuild,
    events: z.array(ClientRuntimeEvent).max(20),
  })
  .strict();
export const ClientLogIssue = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  kind: ClientLogKind,
  appKind: ClientLogApp,
  title: z.string().max(200),
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
  totalCount: z.number().int().nonnegative(),
  affectedUsers: z.number().int().nonnegative(),
  firstVersion: ClientLogVersion,
  lastVersion: ClientLogVersion,
  status: ClientLogStatus,
  note: z.string().max(1000),
});
export type ClientLogIssue = z.infer<typeof ClientLogIssue>;
export const ClientLogSample = z.object({
  id: Id,
  userId: Id.nullable(),
  receivedAt: Timestamp,
  event: ClientRuntimeEvent,
});
export const ClientLogListQuery = z.object({
  appKind: ClientLogApp.optional(),
  kind: ClientLogKind.optional(),
  status: ClientLogStatus.optional(),
  version: ClientLogVersion.optional(),
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  cursor: z.string().max(180).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const fingerprintParams = z.object({ fingerprint: ClientLogIssue.shape.fingerprint });
const receipt = z.object({ accepted: z.literal(true) });
export const ClientLogEndpoints = {
  reportAnonymous: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/client-logs`,
    auth: 'none',
    body: ClientLogBatch,
    response: receipt,
    summary: '匿名技术日志；超限仍返回成功；不保存 IP',
  }),
  report: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/me/client-logs`,
    auth: 'user',
    body: ClientLogBatch,
    response: receipt,
    summary: '本人技术日志，用户 ID 从会话取得；超限仍返回成功',
  }),
} as const;
export const ClientLogAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/client-logs`,
    auth: 'admin',
    query: ClientLogListQuery,
    response: z.object({
      items: z.array(ClientLogIssue),
      nextCursor: z.string().nullable(),
      todayIssues: z.number().int().nonnegative(),
      versions: z.array(
        z.object({
          version: ClientLogVersion,
          sessions: z.number().int().nonnegative(),
          affectedSessions: z.number().int().nonnegative(),
        }),
      ),
    }),
    summary: '问题列表与今日已上报会话中的受影响比例（不是全站报错率）',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/client-logs/:fingerprint`,
    auth: 'admin',
    params: fingerprintParams,
    response: z.object({
      issue: ClientLogIssue,
      samples: z.array(ClientLogSample),
      days: z.array(z.object({ day: z.string(), count: z.number().int().nonnegative() })),
      users: z.array(z.object({ userId: Id, lastSeenAt: Timestamp })),
    }),
    summary: '问题详情：最近 20 条、30 天趋势、最近受影响用户',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/client-logs/:fingerprint`,
    auth: 'admin',
    params: fingerprintParams,
    body: z.object({ status: ClientLogStatus, note: z.string().trim().max(1000) }).strict(),
    response: ClientLogIssue,
    summary: '标记处理与备注；已解决后在不同版本重现自动重新打开',
  }),
  user: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/users/:userId/client-logs`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    response: z.object({ items: z.array(ClientLogSample) }),
    summary: '用户最近 50 条客户端运行记录',
  }),
  ticket: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/support/tickets/:ticketId/client-logs`,
    auth: 'admin',
    params: z.object({ ticketId: Id }),
    response: z.object({ items: z.array(ClientRuntimeEvent) }),
    summary: '反馈自动附带的最近 20 条技术记录',
  }),
} as const;
