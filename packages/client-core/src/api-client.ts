import { z } from 'zod';
import { ApiError, AuthResponse, CurrentUser, type EndpointDef } from '@weiban/contracts';
import type { LocalStore } from './local-store.js';
type Input<S> = S extends z.ZodType ? z.input<S> : never;
export interface RequestOptions<E extends EndpointDef> {
  params?: Input<E['params']>;
  query?: Input<E['query']>;
  body?: Input<E['body']>;
  idempotencyKey?: string;
  /** 媒体契约的 multipart 字段 file；浏览器自动生成边界。 */
  file?: Blob;
  /** 同步游标/快照必须来自服务器，不能用缓存伪装成功。 */
  networkOnly?: boolean;
  /** 驱动停止或账号切换时取消在途请求。 */
  signal?: AbortSignal;
  keepalive?: boolean;
}
export interface ApiFailureRecord {
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  status: number;
  durationMs: number;
  requestId?: string;
  timeout?: boolean;
}
export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: ApiError['error']['details'],
  ) {
    super(message);
  }
}
/** 内存里最多留多少条上次的结果：页面切回来时先画出来，不用无上限增长。 */
const MEMORY_LIMIT = 300;
/** 媒体签名链接 5 分钟过期（服务器 LINK_TTL_MS），内存结果只留 4 分钟。 */
const MEMORY_MAX_AGE_MS = 4 * 60 * 1000;
/** 链接过期前留 30 秒余量，避免把马上失效的图交给页面。 */
const LINK_MARGIN_MS = 30_000;
/** 媒体链接快过期就别再用旧结果（MediaObject 自带 urlExpiresAt）。 */
function expiredLink(value: unknown): boolean {
  const expiresAt = (value as { urlExpiresAt?: unknown } | null | undefined)?.urlExpiresAt;
  if (typeof expiresAt !== 'string') return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - LINK_MARGIN_MS <= Date.now();
}
export class ApiClient {
  private failureObserver: ((event: ApiFailureRecord) => void) | undefined;
  private ownerObserver: ((userId: string | null) => void) | undefined;
  observeOwner(observer: (userId: string | null) => void): void {
    this.ownerObserver = observer;
  }
  private notifyOwner(): void {
    try {
      this.ownerObserver?.(this.auth?.user.userId ?? null);
    } catch {
      /* optional observer */
    }
  }
  observeFailures(observer: (event: ApiFailureRecord) => void): void {
    this.failureObserver = observer;
  }
  private reportFailure(
    endpoint: EndpointDef,
    startedAt: number,
    status: number,
    requestId?: string,
    timeout = false,
  ): void {
    if (endpoint.path.includes('/client-logs') || (status > 0 && status < 500)) return;
    try {
      this.failureObserver?.({
        route: endpoint.path,
        method: endpoint.method as ApiFailureRecord['method'],
        status,
        durationMs: Math.min(120000, Math.max(0, Date.now() - startedAt)),
        ...(requestId ? { requestId } : {}),
        ...(timeout ? { timeout: true } : {}),
      });
    } catch {
      /* telemetry must not break requests */
    }
  }
  private auth: AuthResponse | null = null;
  private writes: Promise<void> = Promise.resolve();
  /** 内存里最近成功的结果：组件重新挂载时同步取出先画出来。按账号清空，容量和时间都有上限。 */
  private readonly memory = new Map<string, { value: unknown; at: number }>();
  /** 同一个 GET 的并发请求合并成一次；请求不随某个调用方卸载而取消。 */
  private readonly inflight = new Map<string, Promise<unknown>>();
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(work);
    this.writes = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  constructor(
    private readonly store: LocalStore,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onUnauthenticated: () => void = () => {},
    private readonly cacheResponses = true,
  ) {}
  async restore(): Promise<AuthResponse | null> {
    const parsed = AuthResponse.safeParse(await this.store.get('session'));
    this.auth = parsed.success ? parsed.data : null;
    this.clearMemory();
    this.notifyOwner();
    return this.auth;
  }
  async authenticate(auth: AuthResponse): Promise<void> {
    const validated = AuthResponse.parse(auth);
    this.auth = null;
    this.clearMemory();
    this.notifyOwner();
    await this.enqueue(async () => {
      await this.store.clear();
      await this.store.set('session', validated);
      this.auth = validated;
      this.notifyOwner();
    });
  }
  async forget(): Promise<void> {
    this.auth = null;
    this.clearMemory();
    this.notifyOwner();
    await this.enqueue(() => this.store.clear());
  }
  owns(owner: { userId: string; sessionId: string }): boolean {
    return (
      this.auth?.user.userId === owner.userId && this.auth.session.sessionId === owner.sessionId
    );
  }
  /** 页面级内存缓存按它区分账号：退出登录或换账号后与之前不同。 */
  ownerKey(): string {
    return this.auth ? `${this.auth.user.userId}:${this.auth.session.sessionId}` : 'public';
  }
  /** 退出、401、换账号都要断开旧账号的内存结果，迟到的请求也不能再写进来。 */
  private clearMemory(): void {
    this.memory.clear();
    this.inflight.clear();
  }
  private remember(key: string, value: unknown): void {
    this.memory.delete(key);
    this.memory.set(key, { value, at: Date.now() });
    if (this.memory.size <= MEMORY_LIMIT) return;
    const oldest = this.memory.keys().next();
    if (!oldest.done) this.memory.delete(oldest.value);
  }
  /**
   * 同步取上次成功的结果：组件重新挂载时先画出来，不必先清空成占位或空列表。
   * 显式 networkOnly、非 GET、未登录接口一律不读；媒体链接过期前 30 秒也不再返回。
   */
  peek<E extends EndpointDef>(
    endpoint: E,
    options: RequestOptions<E> = {},
  ): { value: z.output<E['response']>; ageMs: number } | undefined {
    if (!this.cacheResponses || endpoint.method !== 'GET' || endpoint.auth === 'none')
      return undefined;
    if (options.networkOnly) return undefined;
    let key: string;
    try {
      key = this.key(endpoint, this.url(endpoint, options));
    } catch {
      return undefined;
    }
    const hit = this.memory.get(key);
    if (!hit) return undefined;
    const ageMs = Date.now() - hit.at;
    if (ageMs <= MEMORY_MAX_AGE_MS && !expiredLink(hit.value))
      return { value: hit.value as z.output<E['response']>, ageMs };
    this.memory.delete(key);
    return undefined;
  }
  /** 旧WebSocket的失效通知不能退出刚切换的新会话。 */
  async forgetIf(owner: { userId: string; sessionId: string }): Promise<boolean> {
    if (!this.owns(owner)) return false;
    await this.forget();
    this.onUnauthenticated();
    return true;
  }
  async updateUser(user: CurrentUser): Promise<AuthResponse> {
    const parsed = CurrentUser.parse(user);
    const auth = this.auth;
    if (!auth || auth.user.userId !== parsed.userId)
      throw new ApiFailure('session_changed', '登录状态已改变', 0);
    return this.enqueue(async () => {
      if (this.auth !== auth) throw new ApiFailure('session_changed', '登录状态已改变', 0);
      auth.user = parsed;
      await this.store.set('session', auth);
      return { ...auth };
    });
  }
  private url<E extends EndpointDef>(endpoint: E, options: RequestOptions<E>): string {
    let path = endpoint.path;
    const params: unknown = endpoint.params?.parse(options.params);
    if (params && typeof params === 'object')
      for (const [name, value] of Object.entries(params))
        path = path.replace(`:${name}`, encodeURIComponent(String(value)));
    if (/:[A-Za-z]/.test(path)) throw new Error('缺少路径参数');
    const query: unknown = endpoint.query?.parse(options.query ?? {});
    const search = new URLSearchParams();
    if (query && typeof query === 'object')
      for (const [name, value] of Object.entries(query))
        if (value !== undefined && value !== null) search.set(name, String(value));
    return path + (search.size ? `?${search.toString()}` : '');
  }
  private key(endpoint: EndpointDef, url: string): string {
    return `${this.auth?.user.userId ?? 'public'}:${endpoint.method}:${url}`;
  }
  async cached<E extends EndpointDef>(
    endpoint: E,
    options: RequestOptions<E> = {},
  ): Promise<z.output<E['response']> | undefined> {
    if (!this.cacheResponses || endpoint.auth === 'none') return undefined;
    const parsed = endpoint.response.safeParse(
      await this.store.get(this.key(endpoint, this.url(endpoint, options))),
    );
    return parsed.success ? (parsed.data as z.output<E['response']>) : undefined;
  }
  async call<E extends EndpointDef>(
    endpoint: E,
    options: RequestOptions<E> = {},
  ): Promise<z.output<E['response']>> {
    // GET 没有取消信号时按资源合并并发请求：一个组件卸载不会取消别的组件还在等的同一请求。
    if (endpoint.method !== 'GET' || options.signal) return this.request(endpoint, options);
    if (endpoint.auth !== 'none' && !this.auth)
      throw new ApiFailure('unauthenticated', '请先登录', 401);
    const key = this.key(endpoint, this.url(endpoint, options));
    const running = this.inflight.get(key);
    if (running) return running as Promise<z.output<E['response']>>;
    const started = this.request(endpoint, options);
    this.inflight.set(key, started);
    void started
      .finally(() => {
        if (this.inflight.get(key) === started) this.inflight.delete(key);
      })
      .catch(() => {});
    return started;
  }
  private async request<E extends EndpointDef>(
    endpoint: E,
    options: RequestOptions<E> = {},
  ): Promise<z.output<E['response']>> {
    if (endpoint.auth !== 'none' && !this.auth)
      throw new ApiFailure('unauthenticated', '请先登录', 401);
    const url = this.url(endpoint, options);
    const auth = this.auth;
    const localKey = this.key(endpoint, url);
    const headers = new Headers({ Accept: 'application/json' });
    if (endpoint.auth !== 'none')
      headers.set('Authorization', `Bearer ${this.auth!.session.token}`);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    const body: unknown = endpoint.body?.parse(options.body);
    if (endpoint.body) headers.set('Content-Type', 'application/json');
    let payload: BodyInit | undefined = endpoint.body ? JSON.stringify(body) : undefined;
    if (options.file) {
      if (endpoint.body || endpoint.method !== 'POST') throw new Error('此接口不支持文件上传');
      const form = new FormData();
      form.set('file', options.file, 'avatar');
      payload = form;
    }
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, url, {
        method: endpoint.method,
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        ...(options.keepalive ? { keepalive: true } : {}),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
        ...(payload !== undefined ? { body: payload } : {}),
      });
    } catch (error) {
      if (endpoint.auth !== 'none' && this.auth !== auth)
        throw new ApiFailure('session_changed', '登录状态已改变，请重新打开页面', 0);
      if (options.signal?.aborted) throw new ApiFailure('request_cancelled', '请求已取消', 0);
      this.reportFailure(
        endpoint,
        startedAt,
        0,
        undefined,
        error instanceof DOMException && error.name === 'TimeoutError',
      );
      if (endpoint.method === 'GET' && !options.networkOnly) {
        const local = await this.cached(endpoint, options);
        if (local !== undefined) return local;
      }
      throw new ApiFailure('network_error', '网络暂不可用，请稍后重试', 0);
    }
    if (options.signal?.aborted) throw new ApiFailure('request_cancelled', '请求已取消', 0);
    const raw: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (options.signal?.aborted) throw new ApiFailure('request_cancelled', '请求已取消', 0);
    if (!response.ok) {
      if (endpoint.auth === 'none' || this.auth === auth)
        this.reportFailure(
          endpoint,
          startedAt,
          response.status,
          response.headers.get('x-request-id') ?? undefined,
        );
      const error = ApiError.safeParse(raw);
      const code = error.success ? error.data.error.code : 'unsupported';
      if (code === 'unauthenticated' && endpoint.auth !== 'none' && this.auth === auth) {
        await this.forget();
        this.onUnauthenticated();
      }
      throw new ApiFailure(
        code,
        error.success ? error.data.error.message : '操作未完成，请稍后重试',
        response.status,
        error.success ? error.data.error.details : undefined,
      );
    }
    const data = endpoint.response.parse(raw);
    if (endpoint.auth !== 'none' && this.auth !== auth)
      throw new ApiFailure('session_changed', '登录状态已改变，请重新打开页面', 0);
    // 迟到的旧账号结果在上一行就被挡掉了，能记下来的都是当前账号的数据。
    // networkOnly 是调用方明确要求实时、不进缓存的数据（同步游标、消息列表等），也不占内存。
    if (
      this.cacheResponses &&
      endpoint.auth !== 'none' &&
      endpoint.method === 'GET' &&
      !options.networkOnly
    )
      this.remember(localKey, data);
    if (this.cacheResponses && endpoint.auth !== 'none' && !options.networkOnly) {
      return this.enqueue(async () => {
        if (this.auth !== auth)
          throw new ApiFailure('session_changed', '登录状态已改变，请重新打开页面', 0);
        await this.store.set(localKey, data);
        return endpoint.response.parse(await this.store.get(localKey)) as z.output<E['response']>;
      });
    }
    return data as z.output<E['response']>;
  }
}
