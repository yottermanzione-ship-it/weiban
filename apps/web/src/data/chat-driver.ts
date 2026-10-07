import {
  ChatEndpoints,
  ClientFrame,
  ServerFrame,
  SyncEndpoints,
  WS_PATH,
  WsCloseCode,
  CONTRACT_VERSION,
  type AuthResponse,
  type ClientSyncOperation,
} from '@weiban/contracts';
import {
  LocalSyncState,
  SyncRunner,
  freshSyncState,
  type ApiClient,
  type IndexedLocalStore,
} from '@weiban/client-core';
import { syncHttp } from './sync-http.js';
export interface ChatDriverObserver {
  state(state: LocalSyncState): void;
  connection(online: boolean): void;
  typing(conversationId: string, participantId: string, active: boolean): void;
  error(message: string): void;
}
export class ChatDriver {
  private runner: SyncRunner | null = null;
  private socket: WebSocket | null = null;
  private stopped = false;
  private paused = false;
  private authenticated = false;
  private replaced = false;
  private bootstrapping = false;
  private polling = false;
  private canSync = false;
  private focusId: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | undefined;
  private timer: number | undefined;
  private lastPing = 0;
  private lastPong = 0;
  private openedAt = 0;
  private lastPoll = 0;
  private lifetime = new AbortController();
  private readonly owner;
  private readonly key: string;
  constructor(
    private readonly api: ApiClient,
    private readonly store: IndexedLocalStore,
    private readonly session: AuthResponse,
    private readonly observer: ChatDriverObserver,
  ) {
    this.owner = { userId: session.user.userId, sessionId: session.session.sessionId };
    this.key = `sync-state:${this.owner.userId}:${this.owner.sessionId}`;
  }
  get ownerKey(): string {
    return `${this.owner.userId}:${this.owner.sessionId}`;
  }
  async start(): Promise<void> {
    const parsed = LocalSyncState.safeParse(await this.store.get(this.key));
    if (this.stopped) return;
    this.runner = new SyncRunner(parsed.success ? parsed.data : freshSyncState(), {
      save: (state) => this.store.setOwned(this.owner, this.key, state),
      execute: (effect, signal) => syncHttp(this.api, effect, signal),
      changed: (state) => {
        if (state.initialized) this.bootstrapping = false;
        this.observer.state(state);
      },
      failed: () => {
        if (this.stopped) return;
        if (this.runner?.active === false) {
          this.stop();
          this.observer.connection(false);
          this.observer.error('本机保存失败，请检查设备存储后重新打开微伴');
          return;
        }
        this.bootstrapping = false;
        this.canSync = false;
        this.observer.connection(false);
        this.observer.error('同步暂未完成，将自动重试');
        void this.runner?.dispatch({ type: 'offline' }).catch(() => {});
      },
    });
    this.observer.state(this.runner.state);
    this.connect();
    void this.poll();
    this.timer = window.setInterval(() => this.tick(), 250);
    window.addEventListener('online', this.online);
    window.addEventListener('offline', this.offline);
    document.addEventListener('visibilitychange', this.visibility);
  }
  stop(): void {
    this.stopped = true;
    this.lifetime.abort();
    this.runner?.stop();
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.timer);
    this.socket?.close();
    this.socket = null;
    window.removeEventListener('online', this.online);
    window.removeEventListener('offline', this.offline);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  async pause(): Promise<void> {
    this.paused = true;
    this.lifetime.abort();
    window.clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          socket.removeEventListener('close', done);
          resolve();
        };
        const timer = window.setTimeout(done, 1000);
        socket.addEventListener('close', done);
        socket.close();
      });
    }
    await this.runner?.dispatch({ type: 'offline' });
  }
  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.bootstrapping = false;
    this.lifetime = new AbortController();
    this.connect();
    void this.poll();
  }
  async dispatch(operation: ClientSyncOperation): Promise<void> {
    const runner = this.runner;
    if (!runner || this.stopped || !runner.active) throw new Error('聊天尚未准备好');
    await runner.dispatch(operation);
    if (!runner.active) throw new Error('聊天未保存，请重新打开微伴');
  }
  focus(conversationId: string | null): void {
    this.focusId = conversationId;
    this.presence();
    if (conversationId)
      void this.runner?.dispatch({ type: 'inspect', conversationId }).catch(() => {});
  }
  async older(id: string, beforeSeq: number): Promise<boolean> {
    if (!this.runner || this.stopped) throw new Error('聊天尚未准备好');
    const page = await this.api.call(ChatEndpoints.listMessages, {
      params: { conversationId: id },
      query: { beforeSeq, limit: 50 },
      networkOnly: true,
      signal: this.lifetime.signal,
    });
    if (this.stopped) return false;
    await this.runner.history(id, beforeSeq, page);
    return page.hasMore;
  }
  async clearHistory(id: string): Promise<void> {
    const runner = this.runner;
    if (!runner || this.stopped || !runner.active || !this.api.owns(this.owner))
      throw new Error('聊天尚未准备好');
    const confirmed = await this.api.call(ChatEndpoints.clearHistory, {
      params: { conversationId: id },
      networkOnly: true,
      signal: this.lifetime.signal,
    });
    if (this.stopped || this.runner !== runner || !this.api.owns(this.owner))
      throw new Error('聊天会话已改变');
    await runner.clearHistory(id, confirmed.clearedThroughSeq);
    if (!runner.active) throw new Error('聊天未保存，请重新打开微伴');
  }
  async synchronize(): Promise<void> {
    const runner = this.runner;
    if (!runner || this.stopped || this.paused || !runner.active || !this.api.owns(this.owner))
      throw new Error('聊天尚未准备好');
    const state = await this.api.call(SyncEndpoints.getState, {
      networkOnly: true,
      signal: this.lifetime.signal,
    });
    await this.reconnect(state.latestUpdateSeq);
    const deadline = Date.now() + 10_000;
    while (!runner.state.initialized || runner.state.lastUpdateSeq < state.latestUpdateSeq) {
      if (
        this.stopped ||
        this.paused ||
        !runner.active ||
        !this.api.owns(this.owner) ||
        Date.now() >= deadline
      )
        throw new Error('修改已在服务器提交，本机暂未同步，请联网后重试');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    if (
      this.stopped ||
      this.paused ||
      this.runner !== runner ||
      !runner.active ||
      !this.api.owns(this.owner)
    )
      throw new Error('聊天会话已改变');
  }
  private online = () => {
    this.replaced = false;
    this.connect();
    void this.poll();
  };
  private offline = () => {
    this.canSync = false;
    this.bootstrapping = false;
    this.socket?.close();
    this.observer.connection(false);
    void this.runner?.dispatch({ type: 'offline' }).catch(() => {});
  };
  private visibility = () => {
    this.presence();
    if (document.visibilityState === 'visible') {
      this.replaced = false;
      this.connect();
      void this.poll();
      if (this.focusId) this.focus(this.focusId);
    }
  };
  private presence(): void {
    this.send({
      v: 1,
      type: 'presence.focus',
      data: { conversationId: this.focusId, foreground: document.visibilityState === 'visible' },
    });
  }
  private send(frame: ClientFrame): void {
    if (this.authenticated && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(ClientFrame.parse(frame)));
  }
  private connect(): void {
    if (this.stopped || this.paused || this.replaced || !navigator.onLine || this.socket) return;
    window.clearTimeout(this.reconnectTimer);
    const url = new URL(WS_PATH, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    this.authenticated = false;
    this.openedAt = Date.now();
    const current = () => !this.stopped && this.socket === socket;
    socket.onopen = () => {
      if (!current()) return;
      socket.send(
        JSON.stringify(
          ClientFrame.parse({
            v: 1,
            type: 'auth',
            data: {
              token: this.session.session.token,
              contractVersion: CONTRACT_VERSION,
              device: {
                platform: 'web',
                name: '微伴网页',
                appVersion: '0.1.0',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
              lastUpdateSeq: this.runner?.state.lastUpdateSeq ?? 0,
            },
          }),
        ),
      );
    };
    socket.onmessage = (event) => {
      if (!current() || typeof event.data !== 'string') return;
      try {
        const frame = ServerFrame.parse(JSON.parse(event.data));
        switch (frame.type) {
          case 'auth.ok':
            if (
              frame.data.userId !== this.owner.userId ||
              frame.data.sessionId !== this.owner.sessionId
            ) {
              socket.close();
              return;
            }
            this.authenticated = true;
            this.reconnectAttempt = 0;
            this.lastPong = this.lastPing = Date.now();
            this.presence();
            void this.reconnect(frame.data.latestUpdateSeq);
            break;
          case 'pong':
            this.lastPong = Date.now();
            break;
          case 'update':
            if (this.authenticated)
              void this.runner?.dispatch({ type: 'update', update: frame.data }).catch(() => {});
            break;
          case 'typing':
            if (this.authenticated)
              this.observer.typing(
                frame.data.conversationId,
                frame.data.participantId,
                frame.data.state === 'start',
              );
            break;
          case 'error':
            if (frame.data.code === 'unauthenticated') void this.api.forgetIf(this.owner);
            break;
          default:
            break;
        }
      } catch {
        socket.close(1002, 'invalid frame');
      }
    };
    socket.onerror = () => {
      if (current()) socket.close();
    };
    socket.onclose = (event) => {
      if (!current()) return;
      this.socket = null;
      this.authenticated = false;
      this.observer.connection(false);
      if (this.paused) return;
      if (event.code === WsCloseCode.unauthenticated) {
        void this.api.forgetIf(this.owner);
        return;
      }
      if (event.code === WsCloseCode.clientTooOld) {
        this.observer.error('请更新微伴后继续');
        this.stop();
        return;
      }
      if (event.code === WsCloseCode.replaced) {
        this.replaced = true;
        return;
      }
      const seconds = [0.5, 1, 2, 4, 8, 10][Math.min(this.reconnectAttempt++, 5)]!;
      this.reconnectTimer = window.setTimeout(
        () => this.connect(),
        seconds * 1000 * (0.8 + Math.random() * 0.4),
      );
    };
  }
  private async reconnect(seq: number): Promise<void> {
    if (!this.runner || this.stopped || this.paused || !navigator.onLine || this.bootstrapping)
      return;
    this.bootstrapping = !this.runner.state.initialized;
    await this.runner.dispatch({ type: 'reconnect', latestUpdateSeq: seq, now: Date.now() });
    if (!this.stopped) {
      this.canSync = true;
      this.observer.connection(true);
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || this.stopped || this.paused || !navigator.onLine || this.bootstrapping)
      return;
    this.polling = true;
    this.lastPoll = Date.now();
    try {
      const state = await this.api.call(SyncEndpoints.getState, {
        networkOnly: true,
        signal: this.lifetime.signal,
      });
      await this.reconnect(state.latestUpdateSeq);
    } catch {
      if (!this.stopped) {
        this.canSync = false;
        this.observer.connection(false);
        this.bootstrapping = false;
      }
    } finally {
      this.polling = false;
    }
  }
  private tick(): void {
    if (this.stopped || this.paused) return;
    const now = Date.now();
    if (
      this.canSync &&
      navigator.onLine &&
      this.runner?.state.outbox.some((item) => item.state === 'pending' && item.retryAt <= now)
    )
      void this.runner.dispatch({ type: 'tick', now }).catch(() => {});
    if (now - this.lastPoll >= 5000) void this.poll();
    if (this.socket && !this.authenticated && now - this.openedAt > 12_000) this.socket.close();
    if (this.authenticated) {
      if (now - this.lastPong > 45_000) this.socket?.close();
      else if (now - this.lastPing >= 25_000) {
        this.lastPing = now;
        this.send({ v: 1, type: 'ping', data: {} });
        this.presence();
      }
    }
  }
}
