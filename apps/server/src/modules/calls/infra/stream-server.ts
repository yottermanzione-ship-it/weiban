/**
 * 通话音频流 WebSocket（ADR-0025）：地址 /api/v1/calls/{callId}/stream?token=凭证。
 * 二进制帧 = 音频（上行 PCM16LE 16 kHz 单声道；下行采样率见 call.ready），文本帧 = CallStream* 控制帧。
 *
 * 每通电话在持有音频流的实例上有一个 LiveCall：每秒从数据库读取状态（其他设备 / 实例的挂断、超时都会反映到这里），
 * 接通后打开 ai-runtime 的 CallAgentSession 并双向转发音频；结束时发 call.ending、关闭角色会话与连接。
 * 断线后角色会话保留 CALL_LIMITS.reconnectGraceSec，重连到同一实例可继续；超时由 CallService 结束为 failed。
 */
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CALL_LIMITS,
  CallStreamClientFrame,
  CallStreamServerFrame,
  type CallAgentSession,
} from '@weiban/contracts';
import { APP_CONFIG, CLOCK, newId, type AppConfig, type Clock } from '../../../platform/index.js';
import { CallService, type CallOutcomeValue, type CallRow } from '../application/calls.js';

const PATH = /^\/api\/v1\/calls\/([0-9a-f-]{36})\/stream(?:\?(.*))?$/;
/** 默认下行采样率（角色会话未打开前）。 */
const DEFAULT_OUTPUT_RATE = 24000;
/** 单个上行音频帧上限（100 ms PCM16 16 kHz = 3200 字节，留余量）。 */
const MAX_AUDIO_FRAME = 64 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const BALANCE_CHECK_EVERY_MS = 15_000;

interface LiveCall {
  callId: string;
  userId: string;
  ws: WebSocket | null;
  connection: string | null;
  helloReceived: boolean;
  session: CallAgentSession | null;
  opening: boolean;
  lastState: string | null;
  lastBalanceCheck: number;
  lostAt: number | null;
  closed: boolean;
  timer: NodeJS.Timeout;
}

type ServerFrame = ReturnType<typeof CallStreamServerFrame.parse>;

@Injectable()
export class CallStreamServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_AUDIO_FRAME,
    perMessageDeflate: false,
  });
  private readonly live = new Map<string, LiveCall>();
  private http: Server | null = null;
  constructor(
    @Inject(CallService) private readonly calls: CallService,
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.role === 'worker' || !this.adapter.httpAdapter) return;
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.http.on('upgrade', this.upgrade);
  }

  async onModuleDestroy(): Promise<void> {
    this.http?.off('upgrade', this.upgrade);
    for (const live of this.live.values()) {
      clearInterval(live.timer);
      live.ws?.close(1001, 'server_shutdown');
    }
    this.server.close();
  }

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const match = PATH.exec(request.url ?? '');
    if (!match) return; // 不是通话音频流：交给其他升级处理（实时同步 WebSocket）。
    const callId = match[1]!;
    const token = new URLSearchParams(match[2] ?? '').get('token') ?? '';
    if (!this.allowedOrigin(request) || this.live.size >= 512) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    void this.calls.verifyTicket(callId, token).then(
      (row) => {
        if (!row) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
        this.server.handleUpgrade(request, socket, head, (ws) => this.accept(ws, row));
      },
      () => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'),
    );
  };

  private allowedOrigin(request: IncomingMessage): boolean {
    if (!request.headers.origin) return true; // 原生客户端没有 Origin；仍必须带有效凭证。
    try {
      const origin = new URL(request.headers.origin);
      if (!['https:', 'http:'].includes(origin.protocol)) return false;
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

  private send(ws: WebSocket | null, frame: ServerFrame): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(CallStreamServerFrame.parse(frame)));
  }

  private accept(ws: WebSocket, row: CallRow): void {
    let live = this.live.get(row.id);
    if (live) {
      // 重连（或另一台设备）接管：旧连接关闭，角色会话保留。
      const old = live.ws;
      live.ws = null;
      old?.close(4000, 'replaced');
    } else {
      live = {
        callId: row.id,
        userId: row.userId,
        ws: null,
        connection: null,
        helloReceived: false,
        session: null,
        opening: false,
        lastState: null,
        lastBalanceCheck: 0,
        lostAt: null,
        closed: false,
        timer: setInterval(() => void this.tick(live!), 1000),
      };
      live.timer.unref();
      this.live.set(row.id, live);
    }
    const connection = newId();
    live.ws = ws;
    live.connection = connection;
    live.helloReceived = false;
    live.lostAt = null;
    live.lastState = null;
    void this.calls.streamAttached(row.id, connection).catch(() => undefined);
    const helloTimer = setTimeout(() => {
      if (live!.ws === ws && !live!.helloReceived) ws.close(4408, 'hello_timeout');
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref();
    ws.on('message', (data: RawData, isBinary: boolean) =>
      this.onMessage(live!, ws, data, isBinary),
    );
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (live!.ws !== ws) return;
      live!.ws = null;
      live!.connection = null;
      live!.lostAt = this.clock.nowMs();
      void this.calls.streamDetached(row.id, connection).catch(() => undefined);
    });
    ws.on('error', () => ws.terminate());
  }

  private onMessage(live: LiveCall, ws: WebSocket, data: RawData, isBinary: boolean): void {
    if (live.ws !== ws) return;
    if (isBinary) {
      if (!live.helloReceived || !live.session) return;
      const chunk = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      if (chunk.length === 0 || chunk.length > MAX_AUDIO_FRAME || chunk.length % 2 !== 0) return;
      try {
        live.session.onUserAudio(new Uint8Array(chunk));
      } catch {
        // 角色一侧的错误不应断开通话。
      }
      return;
    }
    let frame: CallStreamClientFrame;
    try {
      frame = CallStreamClientFrame.parse(JSON.parse(data.toString()));
    } catch {
      this.send(ws, {
        type: 'call.error',
        data: { code: 'bad_frame', message: '无法识别的控制帧' },
      });
      return;
    }
    switch (frame.type) {
      case 'hello':
        live.helloReceived = true;
        if (live.session)
          this.send(ws, {
            type: 'call.ready',
            data: {
              callId: live.callId,
              outputSampleRate: live.session.outputSampleRate,
              serverTime: this.clock.now().toISOString(),
            },
          });
        void this.tick(live);
        break;
      case 'barge_in':
        live.session?.onBargeIn();
        break;
      case 'mute':
        live.session?.onMute(frame.data.muted);
        break;
      case 'ping':
        this.send(ws, { type: 'pong', data: { serverTime: this.clock.now().toISOString() } });
        break;
    }
  }

  private running = new Set<string>();

  private async tick(live: LiveCall): Promise<void> {
    if (live.closed || this.running.has(live.callId)) return;
    this.running.add(live.callId);
    try {
      const row = await this.calls.find(live.callId);
      if (!row || row.state === 'ended') {
        await this.finish(live, (row?.outcome as CallOutcomeValue) ?? 'completed', row);
        return;
      }
      // 断线超过等待时间：结束交给 CallService（统一写记录），这里只收尾本地资源。
      if (
        !live.ws &&
        live.lostAt &&
        this.clock.nowMs() - live.lostAt > (CALL_LIMITS.reconnectGraceSec + 1) * 1000
      ) {
        await this.calls.reconnectCheck(live.callId);
        return;
      }
      const durationSec = this.calls.durationOf(row);
      if (live.helloReceived && live.lastState !== row.state) {
        live.lastState = row.state;
        this.send(live.ws, {
          type: 'call.state',
          data: { state: row.state as 'ringing' | 'connecting' | 'active', durationSec },
        });
      }
      if (row.state === 'active') {
        if (durationSec >= CALL_LIMITS.maxDurationSec) {
          await this.calls.end(row.id, 'time_limit');
          return;
        }
        if (!live.session && !live.opening && live.helloReceived) await this.openAgent(live, row);
        if (this.clock.nowMs() - live.lastBalanceCheck >= BALANCE_CHECK_EVERY_MS) {
          live.lastBalanceCheck = this.clock.nowMs();
          await this.calls.checkBalanceDuringCall(row);
        }
      }
    } catch {
      // 数据库暂时不可用：下一秒再试。
    } finally {
      this.running.delete(live.callId);
    }
  }

  private async openAgent(live: LiveCall, row: CallRow): Promise<void> {
    const agent = this.calls.agent;
    if (!agent) {
      await this.calls.end(row.id, 'failed');
      return;
    }
    live.opening = true;
    try {
      const result = await agent.openSession({
        callId: row.id,
        userId: row.userId,
        characterId: row.characterId,
        conversationId: row.conversationId,
        direction: row.direction as 'incoming' | 'outgoing',
      });
      if (!result.ok) {
        await this.calls.end(
          row.id,
          result.error === 'insufficient_balance' ? 'insufficient_balance' : 'failed',
        );
        return;
      }
      const session = result.value;
      if (live.closed) {
        await session.close({ durationSec: 0, outcome: 'failed' }).catch(() => undefined);
        return;
      }
      live.session = session;
      this.send(live.ws, {
        type: 'call.ready',
        data: {
          callId: row.id,
          outputSampleRate: session.outputSampleRate || DEFAULT_OUTPUT_RATE,
          serverTime: this.clock.now().toISOString(),
        },
      });
      void this.pumpAudio(live, session);
      void this.pumpSignals(live, session);
    } catch {
      await this.calls.end(row.id, 'failed').catch(() => undefined);
    } finally {
      live.opening = false;
    }
  }

  private async pumpAudio(live: LiveCall, session: CallAgentSession): Promise<void> {
    try {
      for await (const chunk of session.audio()) {
        if (live.closed) break;
        const ws = live.ws;
        // 客户端积压过多（弱网）时丢弃这一段，避免延迟越积越大。
        if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1024 * 1024)
          ws.send(chunk, { binary: true });
      }
    } catch {
      // 角色音频流出错：由角色会话的 end 信号或挂断收尾。
    }
  }

  private async pumpSignals(live: LiveCall, session: CallAgentSession): Promise<void> {
    try {
      for await (const signal of session.signals()) {
        if (live.closed) break;
        if (signal.kind === 'speaking')
          this.send(live.ws, { type: 'call.agent_speaking', data: { speaking: signal.speaking } });
        else if (signal.kind === 'end') {
          await this.calls.end(live.callId, signal.outcome);
          await this.tick(live);
        }
      }
    } catch {
      // 忽略：通话由挂断或巡检收尾。
    }
  }

  private async finish(
    live: LiveCall,
    outcome: CallOutcomeValue,
    row: CallRow | null,
  ): Promise<void> {
    if (live.closed) return;
    live.closed = true;
    clearInterval(live.timer);
    this.live.delete(live.callId);
    this.send(live.ws, { type: 'call.ending', data: { outcome } });
    live.ws?.close(1000, 'call_ended');
    if (live.session)
      await live.session
        .close({ durationSec: row?.durationSec ?? 0, outcome })
        .catch(() => undefined);
  }
}
