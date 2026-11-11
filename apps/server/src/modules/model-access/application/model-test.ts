/**
 * 7.11：后台「测试模型」——对模型当前启用的每条线路发一条最小文本请求。
 *
 * 解决「账号连通测试通过、但具体模型一直 上游错误」看不出原因的问题：
 * 账号测试只请求 `/models` 列表，中转站分组里某个模型被限流 / 下线 / 路由错时它仍然通过。
 * 这里对每条线路直接发 `你好`（最多 8 token），返回 HTTP 状态、供应商错误码、耗时与 token 数。
 *
 * 不扣用户、不写用量记录（避免污染账单与统计）；只写审计 `model.tested`。
 * 只支持文本类协议（OpenAI 兼容 / 百炼 / Anthropic）；图片、语音等模型返回 skipped。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AdminModelTestResult, AdminModelTestRoute } from '@weiban/contracts';
import { AUDIT_LOG, CLOCK, DATABASE, type AuditLog, type Clock, type Database } from '../../../platform/index.js';
import { anthropicHeaders, anthropicUrl } from '../infra/anthropic-adapter.js';
import { ModelAdminService } from './models.js';
import { UpstreamService } from './upstreams.js';

const PROBE_TIMEOUT_MS = 20_000;
const PROBE_TEXT = '你好';
const PROBE_MAX_TOKENS = 8;
const TEXT_KINDS = new Set(['openai_compatible', 'dashscope', 'anthropic']);

interface ProbeOutcome {
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

function errorCodeOf(status: number, body: unknown): string {
  const candidate = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  const raw = candidate?.code ?? candidate?.type;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 80);
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 404) return 'invalid_model';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exhausted';
  return status >= 500 ? 'provider_error' : `http_${status}`;
}

function messageOf(body: unknown): string | null {
  const candidate = (body as { error?: { message?: unknown }; message?: unknown } | null)?.error;
  const raw =
    (candidate as { message?: unknown } | null)?.message ??
    (body as { message?: unknown } | null)?.message;
  if (typeof raw !== 'string') return null;
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

function usageOf(body: unknown): { input: number | null; output: number | null } {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    input: num(usage?.prompt_tokens) ?? num(usage?.input_tokens),
    output: num(usage?.completion_tokens) ?? num(usage?.output_tokens),
  };
}

async function probeText(input: {
  kind: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<ProbeOutcome> {
  const anthropic = input.kind === 'anthropic';
  const url = anthropic
    ? anthropicUrl(input.baseUrl, 'messages')
    : `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = anthropic
    ? anthropicHeaders(input.apiKey)
    : { Authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' };
  const body = anthropic
    ? { model: input.model, max_tokens: PROBE_MAX_TOKENS, messages: [{ role: 'user', content: PROBE_TEXT }] }
    : {
        model: input.model,
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
        messages: [{ role: 'user', content: PROBE_TEXT }],
      };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const usage = usageOf(parsed);
    if (!response.ok)
      return {
        statusCode: response.status,
        errorCode: errorCodeOf(response.status, parsed),
        errorMessage: messageOf(parsed) ?? (text.replace(/\s+/g, ' ').trim().slice(0, 300) || null),
        inputTokens: usage.input,
        outputTokens: usage.output,
      };
    return {
      statusCode: response.status,
      errorCode: null,
      errorMessage: null,
      inputTokens: usage.input,
      outputTokens: usage.output,
    };
  } catch (error) {
    return {
      statusCode: null,
      errorCode: controller.signal.aborted ? 'timeout' : 'network_error',
      errorMessage: controller.signal.aborted
        ? `超过 ${PROBE_TIMEOUT_MS / 1000} 秒未返回`
        : '网络请求失败',
      inputTokens: null,
      outputTokens: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class ModelTestService {
  constructor(
    @Inject(ModelAdminService) private readonly models: ModelAdminService,
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async test(adminId: string, modelKey: string): Promise<AdminModelTestResult> {
    const all = await this.models.list();
    const model = all.find((m) => m.modelKey === modelKey && !m.deletedAt);
    if (!model) return { modelKey, enabled: false, routes: [], skipped: '模型不存在或已删除' };
    const upstreams = await this.upstreams.list();
    const byId = new Map(upstreams.map((u) => [u.upstreamId, u]));
    const targets =
      model.routes?.length && model.routes.length > 0
        ? model.routes
            .filter((r) => r.enabled)
            .slice(0, 8)
            .map((r) => ({
              upstreamId: r.upstreamId,
              upstreamModelId: r.upstreamModelId,
            }))
        : [{ upstreamId: model.upstreamId, upstreamModelId: model.upstreamModelId }];
    const unsupported = targets.find((t) => {
      const kind = byId.get(t.upstreamId)?.kind;
      return kind ? !TEXT_KINDS.has(kind) : true;
    });
    if (targets.length === 0 || unsupported)
      return {
        modelKey,
        enabled: model.enabled,
        routes: [],
        skipped: '该模型类型不支持一键文本测试（图片 / 语音等请在真实场景验证）',
      };

    const routes: AdminModelTestRoute[] = [];
    for (const target of targets) {
      const upstream = byId.get(target.upstreamId);
      if (!upstream) {
        routes.push({
          upstreamId: target.upstreamId,
          upstreamName: '（已删除的上游）',
          upstreamModelId: target.upstreamModelId,
          kind: 'unknown',
          ok: false,
          statusCode: null,
          latencyMs: 0,
          errorCode: 'upstream_missing',
          errorMessage: '上游账号不存在',
          inputTokens: null,
          outputTokens: null,
        });
        continue;
      }
      const started = this.clock.nowMs();
      let outcome: ProbeOutcome;
      try {
        outcome = await this.upstreams.withApiKey(target.upstreamId, (apiKey) =>
          probeText({
            kind: upstream.kind,
            baseUrl: upstream.baseUrl,
            apiKey,
            model: target.upstreamModelId,
          }),
        );
      } catch {
        outcome = {
          statusCode: null,
          errorCode: 'invalid_key',
          errorMessage: '读取上游密钥失败',
          inputTokens: null,
          outputTokens: null,
        };
      }
      routes.push({
        upstreamId: target.upstreamId,
        upstreamName: upstream.name,
        upstreamModelId: target.upstreamModelId,
        kind: upstream.kind,
        ok: outcome.errorCode === null,
        statusCode: outcome.statusCode,
        latencyMs: Math.min(120000, Math.max(0, this.clock.nowMs() - started)),
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
      });
    }

    await this.database
      .transaction(async (tx) =>
        this.audit.record(
          {
            module: 'model_access',
            action: 'model.tested',
            actorType: 'admin',
            actorId: adminId,
            targetType: 'model',
            targetId: modelKey,
            details: {
              routes: routes.map((r) => ({
                upstreamId: r.upstreamId,
                ok: r.ok,
                statusCode: r.statusCode,
                latencyMs: r.latencyMs,
                errorCode: r.errorCode,
              })),
            },
          },
          tx,
        ),
      )
      .catch(() => undefined);

    return { modelKey, enabled: model.enabled, routes, skipped: null };
  }
}
