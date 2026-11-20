import { createHash } from 'node:crypto';
import { SystemClock } from '../../../platform/index.js';
const httpClock = new SystemClock();

export interface ProviderDiagnostic {
  stage: 'connect' | 'headers' | 'read' | 'decode' | 'complete';
  failureDomain: string;
  httpStatus?: number;
  providerCode?: string;
  requestField?: string;
  requestId?: string;
  retryAfterMs?: number;
  rateLimitScope?: 'account' | 'model';
  lastDataMs?: number;
  firstProgressMs?: number;
  lastProgressMs?: number;
  emptyKind?: 'absent' | 'whitespace' | 'reasoning_only';
  switchReason:
    | 'no_backup'
    | 'guard_armed'
    | 'progress_observed'
    | 'backup_unavailable'
    | 'progress_timeout'
    | 'non_streaming'
    | 'terminal_frame';
}

const codes = new Set([
  'invalid_api_key',
  'authentication_error',
  'invalid_key',
  'invalid_request_error',
  'invalid_parameter',
  'unsupported_parameter',
  'unsupported_value',
  'model_not_found',
  'invalid_model',
  'permission_error',
  'permission_denied',
  'insufficient_permissions',
  'model_access_denied',
  'model_not_allowed',
  'insufficient_quota',
  'insufficient_balance',
  'quota_exhausted',
  'rate_limit_error',
  'rate_limit_exceeded',
  'rate_limited',
  'too_many_requests',
  'server_error',
  'internal_error',
  'api_error',
  'overloaded_error',
  'service_unavailable',
  'content_filter',
  'content_policy_violation',
  'policy_violation',
]);
const fields = new Set([
  'model',
  'messages',
  'max_tokens',
  'max_completion_tokens',
  'response_format',
  'temperature',
  'stream',
  'stream_options',
  'thinking',
  'reasoning_effort',
  'output_config',
  'tools',
  'tool_choice',
]);
export function providerDomain(url: string): string {
  // Same network origin, even for different API paths or accounts. No URL is retained.
  try {
    return createHash('sha256').update(new URL(url).origin).digest('hex').slice(0, 16);
  } catch {
    return 'unknown';
  }
}
export function retryAfterMs(value: string | null, now = httpClock.nowMs()): number | undefined {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= Number.MAX_SAFE_INTEGER - now
    ? ms
    : undefined;
}
export type ProviderTimeout = 'timeout_idle' | 'timeout_deadline' | 'timeout_progress';
interface ObserveInput {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  deadlineMs?: number;
  failover?: { progressTimeoutMs: number; backupAvailable(): boolean };
  onDiagnostic?: (value: ProviderDiagnostic) => void;
}
/** One physical request. Only allowlisted protocol metadata can reach the attempt ledger. */
export class ProviderObservation {
  readonly controller = new AbortController();
  readonly diagnostic: ProviderDiagnostic;
  timeout?: ProviderTimeout;
  private readonly started = performance.now();
  private readonly deadline: number;
  private readonly hardTimer: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private progressTimer?: NodeJS.Timeout;
  private progressEnabled: boolean;
  constructor(
    private readonly input: ObserveInput,
    stream = true,
  ) {
    this.deadline = this.started + (input.deadlineMs ?? Math.max(input.timeoutMs, 120000));
    this.progressEnabled = stream && !!input.failover;
    this.diagnostic = {
      stage: 'connect',
      failureDomain: providerDomain(input.baseUrl),
      switchReason: !stream ? 'non_streaming' : input.failover ? 'guard_armed' : 'no_backup',
    };
    this.hardTimer = setTimeout(
      () => this.abort('timeout_deadline'),
      Math.max(1, this.deadline - performance.now()),
    );
    this.armIdle();
    this.armProgress();
  }
  private abort(reason: ProviderTimeout) {
    this.timeout ??= reason;
    this.controller.abort();
  }
  private armIdle() {
    clearTimeout(this.idleTimer);
    if (performance.now() + this.input.timeoutMs < this.deadline)
      this.idleTimer = setTimeout(() => this.abort('timeout_idle'), this.input.timeoutMs);
  }
  private armProgress() {
    clearTimeout(this.progressTimer);
    const guard = this.input.failover;
    if (
      !this.progressEnabled ||
      !guard ||
      performance.now() + guard.progressTimeoutMs >= this.deadline
    )
      return;
    this.progressTimer = setTimeout(() => {
      if (!guard.backupAvailable()) {
        this.diagnostic.switchReason = 'backup_unavailable';
        return;
      }
      this.diagnostic.switchReason = 'progress_timeout';
      this.abort('timeout_progress');
    }, guard.progressTimeoutMs);
  }
  headers(r: Response) {
    this.diagnostic.stage = 'headers';
    this.diagnostic.httpStatus = r.status;
    const id = r.headers.get('x-request-id') ?? r.headers.get('request-id');
    if (
      id &&
      !this.input.apiKey.includes(id) &&
      /^(?:[a-f\d]{16,64}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}|req[_-][a-zA-Z\d]{8,64})$/i.test(
        id,
      ) &&
      !id.includes(this.input.apiKey)
    )
      this.diagnostic.requestId = id;
    if (r.status === 429 || r.status === 503)
      this.diagnostic.retryAfterMs = retryAfterMs(r.headers.get('retry-after'));
    const scope = r.headers.get('x-ratelimit-scope');
    if (r.status === 429 && ['global', 'account', 'model'].includes(scope ?? ''))
      this.diagnostic.rateLimitScope = scope === 'model' ? 'model' : 'account';
    if (!r.ok) this.endProgress('terminal_frame');
  }
  error(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const e = value as Record<string, unknown>;
    for (const raw of [e.code, e.type])
      if (typeof raw === 'string' && codes.has(raw)) {
        this.diagnostic.providerCode = raw;
        break;
      }
    if (typeof e.param === 'string' && fields.has(e.param)) this.diagnostic.requestField = e.param;
  }
  data() {
    this.diagnostic.stage = 'read';
    this.diagnostic.lastDataMs = Math.round(performance.now() - this.started);
    this.armIdle();
  }
  progress() {
    const ms = Math.round(performance.now() - this.started);
    this.diagnostic.firstProgressMs ??= ms;
    this.diagnostic.lastProgressMs = ms;
    if (this.progressEnabled) this.diagnostic.switchReason = 'progress_observed';
    this.armProgress();
  }
  endProgress(why: 'terminal_frame' | 'non_streaming') {
    this.progressEnabled = false;
    clearTimeout(this.progressTimer);
    this.diagnostic.switchReason = why;
  }
  empty(raw: string, reasoning: boolean) {
    this.diagnostic.emptyKind = reasoning ? 'reasoning_only' : raw.length ? 'whitespace' : 'absent';
  }
  close() {
    clearTimeout(this.hardTimer);
    clearTimeout(this.progressTimer);
    clearTimeout(this.idleTimer);
    this.input.onDiagnostic?.(this.diagnostic);
  }
}
