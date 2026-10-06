import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type pg from 'pg';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  ClientFrame,
  Id,
  ServerFrameStrict,
  ServerTypingFrame,
  WsCloseCode,
  WS_PATH,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  CLOCK,
  DATABASE,
  SESSION_VERIFIER,
  newId,
  type AppConfig,
  type AuthPrincipal,
  type Clock,
  type Database,
  type SessionVerifier,
} from '../../../platform/index.js';
import { UpdateLogService, REALTIME_UPDATE_CHANNEL } from '../application/update-log.js';
import {
  PresenceService,
  PRESENCE_TTL_MS,
  REALTIME_CONTROL_CHANNEL,
  REALTIME_TYPING_CHANNEL,
} from '../application/presence.js';

type Output = ReturnType<typeof ServerFrameStrict.parse>;
interface Connection {
  ws: WebSocket;
  id: string;
  token: string | null;
  principal: AuthPrincipal | null;
  createdAt: number;
  seenAt: number;
  cursor: number;
  chain: Promise<void>;
  queued: number;
  drainQueued: boolean;
}

/** 不使用 URL/Cookie 鉴权。提交通知由 PostgreSQL 转发，HTTP 与 worker 不依赖共享内存。 */
@Injectable()
export class SocketServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  private readonly connections = new Set<Connection>();
  private http: Server | null = null;
  private listener: pg.PoolClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private stopping = false;
  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
    @Inject(UpdateLogService) private readonly log: UpdateLogService,
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.config.role === 'worker' || !this.adapter.httpAdapter) return;
    await this.listenNotifications().catch(() => undefined);
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.http.on('upgrade', this.upgrade);
    this.server.on('connection', (ws) => this.accept(ws));
    this.timer = setInterval(() => void this.sweep(), 1000);
    this.timer.unref();
  }
  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (
      this.connections.size >= 1024 ||
      request.url !== WS_PATH ||
      !this.listener ||
      !this.allowedOrigin(request)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) =>
      this.server.emit('connection', ws, request),
    );
  };
  private allowedOrigin(request: IncomingMessage): boolean {
    if (!request.headers.origin) return true; // 原生客户端没有 Origin；仍必须发送首帧令牌。
    try {
      const origin = new URL(request.headers.origin);
      if (
        !['https:', 'http:'].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash
      )
        return false;
      if (
        this.config.nodeEnv !== 'production' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      )
        return true;
      return origin.host === request.headers.host;
    } catch {
      return false;
    }
  }
  private accept(ws: WebSocket): void {
    const c: Connection = {
      ws,
      id: newId(),
      token: null,
      principal: null,
      createdAt: this.clock.nowMs(),
      seenAt: this.clock.nowMs(),
      cursor: 0,
      chain: Promise.resolve(),
      queued: 0,
      drainQueued: false,
    };
    this.connections.add(c);
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      this.connections.delete(c);
      void this.presence.disconnect(c.id).catch(() => undefined);
    });
    ws.on('message', (bytes, binary) => {
      if (binary) {
        ws.close(1003, 'JSON required');
        return;
      }
      this.enqueue(c, () => this.receive(c, bytes));
    });
  }
  private enqueue(c: Connection, action: () => Promise<void>): void {
    if (c.queued >= 32) {
      c.ws.close(1013, 'Backpressure');
      return;
    }
    c.queued++;
    c.chain = c.chain
      .then(async () => {
        if (c.ws.readyState === WebSocket.OPEN) await action();
      })
      .catch(() => {
        c.ws.close(1011, 'Service unavailable');
      })
      .finally(() => {
        c.queued--;
      });
  }
  private send(c: Connection, frame: Output): void {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > 1048576) {
      c.ws.terminate();
      return;
    }
    c.ws.send(JSON.stringify(ServerFrameStrict.parse(frame)));
  }
  private async receive(c: Connection, bytes: RawData): Promise<void> {
    let frame: ClientFrame;
    try {
      frame = ClientFrame.parse(JSON.parse(bytes.toString()));
    } catch {
      this.send(c, { v: 1, type: 'error', data: { code: 'bad_request', message: '帧格式不正确' } });
      c.ws.close(1008, 'Invalid frame');
      return;
    }
    if (!c.principal) {
      if (frame.type !== 'auth' || this.clock.nowMs() - c.createdAt >= 10000) {
        c.ws.close(WsCloseCode.unauthenticated, 'Authentication required');
        return;
      }
      const version = /^2\.(\d+)(?:\.\d+)?$/.exec(frame.data.contractVersion);
      if (!version) {
        c.ws.close(WsCloseCode.clientTooOld, 'Unsupported contract');
        return;
      }
      const principal = await this.verifier.verify(frame.data.token, 'user');
      if (!principal) {
        c.ws.close(WsCloseCode.unauthenticated, 'Invalid session');
        return;
      }
      c.principal = principal;
      c.token = frame.data.token;
      // 先注册本地连接，再在用户锁中记录 presence/head；随后补拉可覆盖鉴权窗口的提交。
      const seq = await this.presence.connect(principal.userId, principal.sessionId, c.id);
      if (seq < 0 || c.ws.readyState !== WebSocket.OPEN) {
        c.ws.close(WsCloseCode.unauthenticated, 'Invalid account');
        await this.presence.disconnect(c.id);
        return;
      }
      c.cursor = seq;
      c.seenAt = this.clock.nowMs();
      for (const other of this.connections)
        if (other !== c && other.principal?.sessionId === principal.sessionId)
          other.ws.close(WsCloseCode.replaced, 'Replaced');
      this.send(c, {
        v: 1,
        type: 'auth.ok',
        ...(frame.ref === undefined ? {} : { ref: frame.ref }),
        data: {
          userId: principal.userId,
          sessionId: principal.sessionId,
          latestUpdateSeq: seq,
          minClientVersion: '2.0',
          serverTime: this.clock.now().toISOString(),
        },
      });
      await this.drain(c);
      return;
    }
    if (frame.type === 'auth') {
      c.ws.close(1008, 'Already authenticated');
      return;
    }
    if (!(await this.valid(c))) return;
    c.seenAt = this.clock.nowMs();
    await this.presence.touch(c.principal.userId, c.principal.sessionId, c.id);
    const ref = frame.ref === undefined ? {} : { ref: frame.ref };
    if (frame.type === 'ping')
      this.send(c, {
        v: 1,
        type: 'pong',
        ...ref,
        data: { serverTime: this.clock.now().toISOString() },
      });
    if (frame.type === 'presence.focus')
      await this.presence.focus(c.principal.userId, c.principal.sessionId, c.id, frame);
    // T-037 将装配同一个 ChatUserPort；未接入时明确拒绝，绝不伪造已送达 ack。
    if (frame.type === 'message.send')
      this.send(c, {
        v: 1,
        type: 'message.error',
        ...ref,
        data: {
          clientMsgId: frame.data.clientMsgId,
          code: 'service_unavailable',
          message: '聊天服务尚未接入',
          retryable: true,
        },
      });
  }
  private async valid(c: Connection): Promise<boolean> {
    const principal = c.token ? await this.verifier.verify(c.token, 'user') : null;
    if (!principal || principal.sessionId !== c.principal?.sessionId) {
      c.ws.close(WsCloseCode.unauthenticated, 'Session expired');
      return false;
    }
    if (!(await this.presence.isCurrent(principal.sessionId, c.id))) {
      c.ws.close(WsCloseCode.replaced, 'Replaced');
      return false;
    }
    return true;
  }
  private async drain(c: Connection): Promise<void> {
    if (!c.principal || !(await this.valid(c))) return;
    let more = true;
    let pages = 0;
    while (more && pages++ < 5 && c.ws.readyState === WebSocket.OPEN) {
      const page = await this.log.getUpdates(c.principal.userId, { since: c.cursor, limit: 100 });
      for (const item of page.items) {
        this.send(c, { v: 1, type: 'update', data: item });
        c.cursor = item.updateSeq;
      }
      more = page.hasMore;
    }
  }
  private scheduleDrain(c: Connection): void {
    if (c.drainQueued || c.ws.readyState !== WebSocket.OPEN) return;
    c.drainQueued = true;
    this.enqueue(c, async () => {
      try {
        await this.drain(c);
      } finally {
        c.drainQueued = false;
      }
    });
  }
  async sweep(): Promise<void> {
    if (this.sweeping || this.stopping) return;
    this.sweeping = true;
    try {
      for (const c of this.connections) {
        const limit = c.principal ? PRESENCE_TTL_MS : 10000;
        if (this.clock.nowMs() - (c.principal ? c.seenAt : c.createdAt) >= limit) {
          c.ws.close(c.principal ? 1001 : WsCloseCode.unauthenticated, 'Timeout');
          continue;
        }
        if (c.principal) this.scheduleDrain(c); // 兜底轮询防 LISTEN 通知丢失；同时校验作废会话。
      }
      if (!this.listener) await this.listenNotifications();
    } catch {
      /* 不记录令牌或用户帧；下一轮重新建立通知连接。 */
    } finally {
      this.sweeping = false;
    }
  }
  private async listenNotifications(): Promise<void> {
    const client = await this.db.pool.connect();
    if (this.stopping) {
      client.release();
      return;
    }
    try {
      for (const channel of [
        REALTIME_UPDATE_CHANNEL,
        REALTIME_CONTROL_CHANNEL,
        REALTIME_TYPING_CHANNEL,
      ])
        await client.query(`LISTEN ${channel}`);
      this.listener = client;
      client.on('error', () => {
        if (this.listener !== client) return;
        this.listener = null;
        client.release(true);
        for (const c of this.connections) c.ws.close(1012, 'Reconnect');
      });
      client.on('notification', (notification) =>
        this.notification(notification.channel, notification.payload),
      );
    } catch (error) {
      client.release(true);
      throw error;
    }
  }
  private notification(channel: string, text: string | undefined): void {
    if (!text) return;
    try {
      const input: unknown = JSON.parse(text);
      if (!input || typeof input !== 'object') return;
      if (channel === REALTIME_CONTROL_CHANNEL && 'sessionId' in input && 'connectionId' in input) {
        const sid = Id.parse(input.sessionId);
        const cid = Id.parse(input.connectionId);
        for (const c of this.connections)
          if (c.principal?.sessionId === sid && c.id !== cid)
            this.enqueue(c, async () => {
              await this.valid(c);
            });
      }
      if ('userId' in input) {
        const userId = Id.parse(input.userId);
        if (channel === REALTIME_UPDATE_CHANNEL)
          for (const c of this.connections)
            if (c.principal?.userId === userId) this.scheduleDrain(c);
        if (channel === REALTIME_TYPING_CHANNEL && 'frame' in input) {
          const frame = ServerTypingFrame.parse(input.frame);
          for (const c of this.connections)
            if (c.principal?.userId === userId)
              this.enqueue(c, async () => {
                if (await this.valid(c)) this.send(c, frame);
              });
        }
      }
    } catch {
      /* 无效数据库通知不能影响已有连接；durable 更新会通过补拉恢复。 */
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.http?.off('upgrade', this.upgrade);
    const active = [...this.connections];
    for (const c of active) c.ws.terminate();
    await Promise.all(active.map((c) => c.chain));
    await Promise.all(active.map((c) => this.presence.disconnect(c.id)));
    if (this.listener) {
      const client = this.listener;
      this.listener = null;
      await client.query('UNLISTEN *').catch(() => undefined);
      client.release();
    }
    this.server.close();
  }
}
