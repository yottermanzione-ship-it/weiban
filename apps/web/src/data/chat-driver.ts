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
  LocalSaveError,
  LocalSyncState,
  SyncRunner,
  freshSyncState,
  type ApiClient,
  type IndexedLocalStore,
} from '@weiban/client-core';
import { syncHttp } from './sync-http.js';
import { announceUpdate } from './updates.js';
export interface ChatDriverObserver {
  state(state: LocalSyncState): void;
  connection(online: boolean): void;
  typing(conversationId: string, participantId: string, active: boolean): void;
  /** fatal：同步已停止，需要重新打开；否则会自动恢复。 */
  error(message: string, kind?: 'fatal' | 'retry'): void;
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
  private syncFailures = 0;
  private restoring = false;
  private canSync = false;
  /**
   * U8：最近一次 runner 交给界面的状态（只读）。以前每 250ms 的 tick、补拉等待循环都读 runner.state，
   * 而 runner.state 每读一次就把整份本机聊天数据（全部消息、会话、联系人）深拷贝一遍，消息越多越卡。
   */
  private view: LocalSyncState | null = null;
  /** U8：上一次对账成功、引擎在线且没有中途离线过；为真时「服务器没有新内容」的轮询不必再走一遍对账。 */
  private upToDate = false;
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
  private readonly historyPositions = new Map<string, { before: number; cursor: number }>();
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
        this.view = state;
        if (state.initialized) this.bootstrapping = false;
        this.observer.state(state);
      },
      failed: (error) => {
        if (this.stopped) return;
        this.syncFailures++;
        this.upToDate = false;
        // 只有真正写不进本机（IndexedDB）才停止同步并请用户处理；数据或网络问题自动重试。
        if (error instanceof LocalSaveError || this.runner?.active === false) {
          this.stop();
          this.observer.connection(false);
          this.observer.error(
            error instanceof LocalSaveError && error.quota
              ? '设备存储空间不足，聊天暂停保存。请清理空间后重新打开微伴'
              : '聊天没能保存到本机，请重新打开微伴',
            'fatal',
          );
          return;
        }
        this.bootstrapping = false;
        this.canSync = false;
        this.observer.connection(false);
        this.observer.error('同步暂未完成，将自动重试', 'retry');
        void this.runner?.dispatch({ type: 'offline' }).catch(() => {});
      },
    });
    this.view = this.runner.state;
    this.observer.state(this.view);
    this.connect();
    void this.poll();
    this.timer = window.setInterval(() => this.tick(), 250);
    window.addEventListener('online', this.online);
    window.addEventListener('offline', this.offline);
    document.addEventListener('visibilitychange', this.visibility);
  }
  stop(): void {
    this.stopped = true;
    this.upToDate = false;
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
    this.upToDate = false;
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
    const runner = this.runner;
    if (!runner || !runner.active || this.stopped || !this.api.owns(this.owner))
      throw new Error('聊天尚未准备好');
    const saved = this.historyPositions.get(id);
    let cursor = saved?.before === beforeSeq ? saved.cursor : beforeSeq;
    const cleared =
      this.view?.conversations.find((item) => item.conversationId === id)?.state
        .clearedThroughSeq ?? 0;
    for (let attempt = 0; attempt < 20 && cursor > cleared + 1; attempt++) {
      const page = await this.api.call(ChatEndpoints.listMessages, {
        params: { conversationId: id },
        query: { beforeSeq: cursor, limit: 50 },
        networkOnly: true,
        signal: this.lifetime.signal,
      });
      if (this.stopped || this.runner !== runner || !this.api.owns(this.owner))
        throw new Error('聊天会话已改变');
      await runner.history(id, cursor, page);
      if (!runner.active) throw new Error('聊天未保存，请检查本机存储后重试');
      const next = page.coverage?.fromSeq ?? Math.min(cursor, ...page.items.map((m) => m.seq));
      const more = page.hasMore && next > cleared + 1;
      // 空页也有扫描范围：继续往前，不能永远拿最早可见消息作为同一个游标重复请求。
      this.historyPositions.set(id, { before: beforeSeq, cursor: next });
      const visible = (this.view?.messages ?? []).some(
        (message) => message.conversationId === id && message.seq < beforeSeq,
      );
      if (visible || !more) {
        this.historyPositions.delete(id);
        return more;
      }
      if (!Number.isSafeInteger(next) || next <= 0 || next >= cursor)
        throw new Error('历史读取没有前进，请重试');
      cursor = next;
    }
    if (cursor <= cleared + 1) {
      this.historyPositions.delete(id);
      return false;
    }
    throw new Error('较早记录仍在读取，请点击重试继续');
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
  async restoreHistory(): Promise<void> {
    const runner = this.runner;
    if (
      !runner ||
      this.stopped ||
      this.paused ||
      !runner.active ||
      !this.api.owns(this.owner) ||
      !navigator.onLine
    )
      throw new Error('请联网后再恢复聊天记录');
    if (this.restoring || runner.isRebuilding) throw new Error('聊天记录正在同步，请稍后重试');
    this.restoring = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    const revision = runner.snapshotRevision,
      failures = this.syncFailures;
    try {
      // 中止旧网络回调，复用过期游标重建；保留待发消息和清除边界。
      this.upToDate = false;
      await runner.dispatch({ type: 'offline' });
      await runner.dispatch({ type: 'cursor.expired' });
      while (runner.snapshotRevision <= revision || runner.isRebuilding) {
        if (
          this.stopped ||
          this.paused ||
          this.runner !== runner ||
          !runner.active ||
          !navigator.onLine ||
          this.syncFailures !== failures ||
          !this.api.owns(this.owner) ||
          controller.signal.aborted
        )
          throw new Error('聊天记录恢复暂未完成，请联网后重试');
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
      await this.synchronize(controller.signal);
    } catch (error) {
      // 失败/超时终止本轮快照，下一次点击可真正重试，不留下重建锁。
      if (
        !this.stopped &&
        !this.paused &&
        this.runner === runner &&
        runner.active &&
        this.api.owns(this.owner)
      )
        await runner.dispatch({ type: 'offline' });
      throw error;
    } finally {
      window.clearTimeout(timer);
      controller.abort();
      this.restoring = false;
    }
  }
  async synchronize(signal: AbortSignal = this.lifetime.signal): Promise<void> {
    const runner = this.runner;
    if (!runner || this.stopped || this.paused || !runner.active || !this.api.owns(this.owner))
      throw new Error('聊天尚未准备好');
    const since = runner.lastUpdateSeq;
    const state = await this.api.call(SyncEndpoints.getState, {
      networkOnly: true,
      signal,
    });
    await this.reconnect(state.latestUpdateSeq, since);
    const deadline = Date.now() + 10_000;
    while (!this.view?.initialized || runner.lastUpdateSeq < state.latestUpdateSeq) {
      if (
        signal.aborted ||
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
    this.upToDate = false;
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
    let since = 0;
    this.authenticated = false;
    this.openedAt = Date.now();
    const current = () => !this.stopped && this.socket === socket;
    socket.onopen = () => {
      if (!current()) return;
      since = this.runner?.lastUpdateSeq ?? 0;
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
              lastUpdateSeq: since,
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
            runtimeLogs.connection(true);
            this.lastPong = this.lastPing = Date.now();
            this.presence();
            void this.reconnect(frame.data.latestUpdateSeq, since).catch(() => {});
            break;
          case 'pong':
            this.lastPong = Date.now();
            break;
          case 'update':
            if (this.authenticated) {
              announceUpdate(frame.data);
              void this.runner?.dispatch({ type: 'update', update: frame.data }).catch(() => {});
            }
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
        this.observer.error('请更新微伴后继续', 'fatal');
        this.stop();
        return;
      }
      if (event.code === WsCloseCode.replaced) {
        this.replaced = true;
        return;
      }
      const seconds = [0.5, 1, 2, 4, 8, 10][Math.min(this.reconnectAttempt++, 5)]!;
      runtimeLogs.connection(false, this.reconnectAttempt);
      this.reconnectTimer = window.setTimeout(
        () => this.connect(),
        seconds * 1000 * (0.8 + Math.random() * 0.4),
      );
    };
  }
  /** since：读到 seq 时本机的游标；排队期间被推送超过的读数不算服务器倒退。 */
  private async reconnect(seq: number, since: number): Promise<void> {
    if (!this.runner || this.stopped || this.paused || !navigator.onLine || this.bootstrapping)
      return;
    this.bootstrapping = !this.view?.initialized;
    await this.runner.reconnect(seq, since, Date.now());
    if (!this.stopped) {
      this.upToDate = this.runner.active;
      this.canSync = true;
      this.observer.connection(true);
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || this.stopped || this.paused || !navigator.onLine || this.bootstrapping)
      return;
    this.polling = true;
    this.lastPoll = Date.now();
    const since = this.runner?.lastUpdateSeq ?? 0;
    try {
      const state = await this.api.call(SyncEndpoints.getState, {
        networkOnly: true,
        signal: this.lifetime.signal,
      });
      /*
       * U8：服务器没有新内容（序号没涨，或只是排队期间被实时推送超过的过时读数）且上次对账成功时，
       * 不再走 reconnect：那一趟要把整份本机数据复制几遍、整份写回 IndexedDB、再通知界面整页重画，
       * 每 5 秒一次，滑动列表时正好撞上就卡一下（实测每次 50～140ms 长任务）。到期的待发消息由 tick 照常发出。
       * 读数比 since 还小（服务器真倒退）、有待合并的更新、还没初始化时照旧对账。
       */
      const runner = this.runner;
      if (
        runner &&
        this.upToDate &&
        this.canSync &&
        this.view?.initialized &&
        this.view.pendingUpdates.length === 0 &&
        !runner.isRebuilding &&
        state.latestUpdateSeq >= since &&
        state.latestUpdateSeq <= runner.lastUpdateSeq
      )
        return;
      await this.reconnect(state.latestUpdateSeq, since);
    } catch {
      if (!this.stopped) {
        this.upToDate = false;
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
    // U8：读缓存的 view，不读 runner.state（那是一次整份深拷贝，每秒 4 次）。
    if (
      this.runner &&
      this.canSync &&
      navigator.onLine &&
      this.view?.outbox.some((item) => item.state === 'pending' && item.retryAt <= now)
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
import { runtimeLogs } from './runtime-logs.js';
