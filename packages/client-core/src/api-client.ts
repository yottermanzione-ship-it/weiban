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
}
export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export class ApiClient {
  private auth: AuthResponse | null = null;
  private writes: Promise<void> = Promise.resolve();
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
    return this.auth;
  }
  async authenticate(auth: AuthResponse): Promise<void> {
    const validated = AuthResponse.parse(auth);
    this.auth = null;
    await this.enqueue(async () => {
      await this.store.clear();
      await this.store.set('session', validated);
      this.auth = validated;
    });
  }
  async forget(): Promise<void> {
    this.auth = null;
    await this.enqueue(() => this.store.clear());
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
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, url, {
        method: endpoint.method,
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
        ...(payload !== undefined ? { body: payload } : {}),
      });
    } catch {
      if (endpoint.auth !== 'none' && this.auth !== auth)
        throw new ApiFailure('session_changed', '登录状态已改变，请重新打开页面', 0);
      if (endpoint.method === 'GET') {
        const local = await this.cached(endpoint, options);
        if (local !== undefined) return local;
      }
      throw new ApiFailure('network_error', '网络暂不可用，请稍后重试', 0);
    }
    const raw: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
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
      );
    }
    const data = endpoint.response.parse(raw);
    if (endpoint.auth !== 'none' && this.auth !== auth)
      throw new ApiFailure('session_changed', '登录状态已改变，请重新打开页面', 0);
    if (this.cacheResponses && endpoint.auth !== 'none') {
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
