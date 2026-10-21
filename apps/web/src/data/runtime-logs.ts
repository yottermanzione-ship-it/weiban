import { IndexedLocalStore } from '@weiban/client-core';
import {
  ClientLogBatch,
  ClientRuntimeEvent,
  clientLogRoute,
  clientLogCodeId,
  type ClientLogCode,
  type ClientLogEnvironment,
} from '@weiban/contracts';
import { z } from 'zod';

type Code = z.infer<typeof ClientLogCode>;
type Environment = z.infer<typeof ClientLogEnvironment>;
type Batch = z.infer<typeof ClientLogBatch>;
type Transport = (batch: Batch, owner: string | null, keepalive: boolean) => Promise<void>;
const version = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(__WEB_VERSION__) ? __WEB_VERSION__ : 'dev';
const build = String(__WEB_BUILD__).match(/^[0-9]{1,12}$/)?.[0] ?? 'dev';
const Saved = z.object({
  owner: z.string().nullable(),
  events: z.array(ClientRuntimeEvent).max(200),
});
function environment(): Environment {
  const ua = navigator.userAgent;
  const os: Environment['os'] = /Android/.test(ua)
    ? 'android'
    : /iPhone|iPad/.test(ua)
      ? 'ios'
      : /Windows/.test(ua)
        ? 'windows'
        : /Mac/.test(ua)
          ? 'macos'
          : /Linux/.test(ua)
            ? 'linux'
            : 'other';
  const match = ua.match(/(Edg|Firefox|Chrome|Version)\/(\d{1,3})/);
  const names: Record<string, Environment['browser']> = {
    Edg: 'edge',
    Firefox: 'firefox',
    Chrome: 'chrome',
    Version: 'safari',
  };
  return {
    os,
    browser: match ? (names[match[1]!] ?? 'other') : 'other',
    major: Math.min(999, Number(match?.[2] ?? 0)),
    screen: innerWidth < 480 ? 'small' : innerWidth < 1024 ? 'medium' : 'large',
    language: navigator.language.startsWith('zh')
      ? 'zh'
      : navigator.language.startsWith('en')
        ? 'en'
        : 'other',
    network: navigator.onLine ? 'unknown' : 'offline',
  };
}
/** Extract only numeric source positions from our JS assets, never exception messages / URLs. */
function frames(error: unknown): ClientRuntimeEvent['frames'] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
  const result: ClientRuntimeEvent['frames'] = [];
  for (const line of error.stack.split('\n').slice(1, 31)) {
    const m = line.match(
      /(\/assets\/[A-Za-z0-9_-]+\.js|\/src\/[A-Za-z0-9_./-]+\.tsx?)(?:\?[^\s:)]*)?:(\d{1,7}):(\d{1,6})/,
    );
    if (m)
      result.push({
        file: 'app.js',
        asset: clientLogCodeId(m[1]!),
        line: Math.min(10000000, Number(m[2])),
        column: Math.min(1000000, Number(m[3])),
      });
    if (result.length === 20) break;
  }
  return result;
}
function classify(error: unknown): Code {
  if (error instanceof TypeError) return 'type_error';
  if (error instanceof ReferenceError) return 'reference_error';
  if (error instanceof SyntaxError) return 'syntax_error';
  if (error instanceof RangeError) return 'range_error';
  return 'unknown';
}
class RuntimeLogs {
  private storage: IndexedLocalStore | undefined;
  private owner: string | null | undefined;
  private session = crypto.randomUUID();
  private generation = 0;
  private ready = false;
  private queue: ClientRuntimeEvent[] = [];
  private recent: ClientRuntimeEvent[] = [];
  private known = new Map<string, ClientRuntimeEvent>();
  private sentSession = false;
  private transport: Transport | undefined;
  private sending = false;
  private writes: Promise<unknown> = Promise.resolve();
  private offlineAt = 0;
  private reconnects = 0;
  private hour = { start: Date.now(), count: 0 };
  constructor() {
    try {
      this.storage = new IndexedLocalStore('weiban-runtime-logs');
    } catch {
      /* memory-only fallback */
    }
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('weiban:runtime-rate') ?? 'null');
      const p = z
        .object({ start: z.number(), count: z.number().int().nonnegative() })
        .safeParse(saved);
      if (p.success) this.hour = p.data;
    } catch {
      /* storage optional */
    }
    window.addEventListener(
      'error',
      (event) => {
        if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement)
          this.record('chunk_load_error', 'chunk_load_failed');
        else this.record('js_error', classify(event.error), { frames: frames(event.error) });
      },
      true,
    );
    window.addEventListener('unhandledrejection', (event) =>
      this.record('unhandled_rejection', classify(event.reason), { frames: frames(event.reason) }),
    );
    window.addEventListener('pagehide', () => void this.flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush(true);
    });
    window.addEventListener('online', () => {
      void this.flush();
    });
    window.addEventListener('offline', () => this.connection(false));
    window.setInterval(() => {
      if (this.offlineAt && Date.now() - this.offlineAt >= 60000)
        this.record('realtime_issue', 'realtime_reconnect', {
          reconnects: this.reconnects,
          offlineSeconds: Math.min(86400, Math.floor((Date.now() - this.offlineAt) / 1000)),
        });
      void this.flush();
    }, 30000);
  }
  configure(transport: Transport) {
    this.transport = transport;
  }
  setOwner(owner: string | null) {
    if (this.owner === owner) return;
    this.owner = owner;
    this.session = crypto.randomUUID();
    const generation = ++this.generation;
    this.ready = false;
    this.queue = [];
    this.recent = [];
    this.known.clear();
    this.sentSession = false;
    this.offlineAt = navigator.onLine ? 0 : Date.now();
    this.reconnects = 0;
    void Promise.resolve(this.storage?.get('queue'))
      .then((saved) => {
        if (generation !== this.generation) return;
        const parsed = Saved.safeParse(saved);
        if (parsed.success && parsed.data.owner === owner) {
          const currentIds = new Set(this.queue.map((e) => e.clientEventId));
          this.queue = [
            ...parsed.data.events.filter((e) => !currentIds.has(e.clientEventId)),
            ...this.queue,
          ].slice(-200);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (generation === this.generation) {
          this.ready = true;
          this.persist();
          void this.flush();
        }
      });
  }
  private persist() {
    if (!this.ready || this.owner === undefined) return;
    const generation = this.generation;
    const value = { owner: this.owner, events: structuredClone(this.queue) };
    this.writes = this.writes
      .catch(() => {})
      .then(() => (generation === this.generation ? this.storage?.set('queue', value) : undefined))
      .catch(() => {});
  }
  record(
    kind: ClientRuntimeEvent['kind'],
    code: Code,
    extra: Partial<
      Pick<ClientRuntimeEvent, 'frames' | 'components' | 'api' | 'reconnects' | 'offlineSeconds'>
    > = {},
  ) {
    if (this.owner === undefined) return;
    const now = Date.now();
    if (now - this.hour.start >= 3600000 || now < this.hour.start)
      this.hour = { start: now, count: 0 };
    if (this.hour.count >= 50) return;
    this.hour.count++;
    try {
      localStorage.setItem('weiban:runtime-rate', JSON.stringify(this.hour));
    } catch {
      /* optional */
    }
    const appKind = window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web';
    const parsed = ClientRuntimeEvent.safeParse({
      clientEventId: crypto.randomUUID(),
      sessionId: this.session,
      occurredAt: new Date(now).toISOString(),
      kind,
      appKind,
      version,
      build,
      page: clientLogRoute(location.pathname),
      code,
      frames: [],
      environment: environment(),
      count: 1,
      ...extra,
    });
    if (!parsed.success) return;
    const fresh = parsed.data;
    const key = JSON.stringify([
      kind,
      code,
      fresh.page,
      fresh.api?.route,
      fresh.api?.method,
      fresh.api?.status,
      fresh.frames,
      fresh.components,
    ]);
    const previous = this.known.get(key);
    const event = previous ? { ...previous, count: Math.min(10000, previous.count + 1) } : fresh;
    this.known.set(key, event);
    this.queue = [
      ...this.queue.filter((e) => e.clientEventId !== event.clientEventId),
      event,
    ].slice(-200);
    this.recent = [
      ...this.recent.filter((e) => e.clientEventId !== event.clientEventId),
      event,
    ].slice(-20);
    this.persist();
    if (this.queue.length >= 20) void this.flush();
  }
  captureRender(error: unknown, componentStack?: string | null) {
    const components = (componentStack ?? '')
      .split('\n')
      .map((line) => line.match(/^\s*(?:at|in) ([A-Za-z][A-Za-z0-9_]{0,80})(?:\s|$)/)?.[1])
      .filter((name): name is string => !!name)
      .slice(0, 20)
      .map(clientLogCodeId);
    this.record('render_error', 'render_failed', { frames: frames(error), components });
  }
  apiFailure(event: {
    route: string;
    method: NonNullable<ClientRuntimeEvent['api']>['method'];
    status: number;
    durationMs: number;
    requestId?: string;
    timeout?: boolean;
  }) {
    const requestId = z.uuid().safeParse(event.requestId);
    this.record(
      'api_failure',
      event.status >= 500 ? 'server_error' : event.timeout ? 'timeout' : 'network_error',
      {
        api: {
          route: clientLogRoute(event.route),
          method: event.method,
          status: event.status,
          durationMs: event.durationMs,
          ...(requestId.success ? { requestId: requestId.data } : {}),
        },
      },
    );
  }
  connection(connected: boolean, attempts = 0) {
    if (connected) {
      this.offlineAt = 0;
      this.reconnects = 0;
      return;
    }
    this.offlineAt ||= Date.now();
    this.reconnects = Math.max(this.reconnects, attempts);
    if (attempts >= 3)
      this.record('realtime_issue', 'realtime_reconnect', {
        reconnects: Math.min(10000, attempts),
        offlineSeconds: Math.min(86400, Math.floor((Date.now() - this.offlineAt) / 1000)),
      });
  }
  snapshot() {
    return this.owner === undefined ? [] : structuredClone(this.recent.slice(-20));
  }
  async flush(keepalive = false) {
    if (
      !this.ready ||
      !this.transport ||
      this.owner === undefined ||
      this.sending ||
      !navigator.onLine
    )
      return;
    const first = this.queue[0];
    if (!first && this.sentSession) return;
    const batch: Batch = {
      sessionId: first?.sessionId ?? this.session,
      appKind: first?.appKind ?? (matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web'),
      version: first?.version ?? version,
      build: first?.build ?? build,
      events: [],
    };
    batch.events = this.queue
      .filter(
        (e) =>
          e.sessionId === batch.sessionId &&
          e.version === batch.version &&
          e.build === batch.build &&
          e.appKind === batch.appKind,
      )
      .slice(0, 20);
    while (new TextEncoder().encode(JSON.stringify(batch)).length > 30000) batch.events.pop();
    const generation = this.generation;
    const transport = this.transport;
    this.sending = true;
    try {
      await transport(batch, this.owner, keepalive);
      if (generation !== this.generation) return;
      const counts = new Map(batch.events.map((e) => [e.clientEventId, e.count]));
      this.queue = this.queue.filter((e) => counts.get(e.clientEventId) !== e.count);
      if (batch.sessionId === this.session) this.sentSession = true;
      this.persist();
    } catch {
      /* offline queue; telemetry never reports its own failure */
    } finally {
      this.sending = false;
    }
  }
}
export const runtimeLogs = new RuntimeLogs();
