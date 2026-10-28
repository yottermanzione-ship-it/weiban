import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import WebSocket from 'ws';
import {
  APP_CONFIG,
  CLOCK,
  ENVELOPE_CRYPTO,
  LOGGER,
  type AppConfig,
  type Clock,
  type EnvelopeCrypto,
  type Logger,
} from '../../../platform/index.js';
import { ChannelBridge } from './channel-bridge.js';
import { ChannelStore, type BindingRow } from './channel-store.js';
import { ChannelsService } from './channels.service.js';
import { QqSessionStore } from './qq-session-store.js';
import { channelRuntimeConfig, isChannelUserAllowed } from './channel-config.js';
import {
  QQ_CLIENT_FACTORY,
  QQ_WS_FACTORY,
  QQ_INTENTS,
  parseQqInbound,
  readQqPairingCode,
  qqAad,
  type QqClient,
  type QqClientFactory,
} from '../domain/qq-openapi.js';
export type QqWebSocketFactory = (url: string) => WebSocket;
interface Connection {
  binding: BindingRow;
  client: QqClient | null;
  socket: WebSocket | null;
  stopped: boolean;
  ready: boolean;
  heartbeat: ReturnType<typeof setInterval> | null;
  retry: ReturnType<typeof setTimeout> | null;
  session: string;
  sequence: number | null;
  awaitingAck: boolean;
  token: string;
  abort: AbortController;
  work: Promise<void>;
  queued: number;
}
@Injectable()
export class QqRuntime implements OnApplicationShutdown {
  private readonly connections = new Map<string, Connection>();
  private stopping = false;
  constructor(
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(QqSessionStore) private readonly sessions: QqSessionStore,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(ChannelBridge) private readonly bridge: ChannelBridge,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(QQ_CLIENT_FACTORY) private readonly clientFactory: QqClientFactory,
    @Inject(QQ_WS_FACTORY) private readonly socketFactory: QqWebSocketFactory,
  ) {}
  async reconcile(): Promise<void> {
    if (this.stopping) return;
    const rows =
      channelRuntimeConfig(this.config, 'qq').integration === 'live'
        ? await this.sessions.runnable(this.clock.now())
        : [];
    const alive = new Set<string>();
    for (const binding of rows) {
      if (!isChannelUserAllowed(this.config, 'qq', binding.user_id)) continue;
      alive.add(binding.id);
      const previous = this.connections.get(binding.id);
      if (previous && previous.binding.generation !== binding.generation) this.close(previous);
      if (!this.connections.has(binding.id)) {
        const connection: Connection = {
          binding,
          client: null,
          socket: null,
          stopped: false,
          ready: false,
          heartbeat: null,
          retry: null,
          session: '',
          sequence: null,
          awaitingAck: false,
          token: '',
          abort: new AbortController(),
          work: Promise.resolve(),
          queued: 0,
        };
        this.connections.set(binding.id, connection);
        void this.open(connection);
      }
    }
    for (const connection of this.connections.values())
      if (!alive.has(connection.binding.id)) this.close(connection);
  }
  private current(connection: Connection): boolean {
    return (
      !this.stopping &&
      !connection.stopped &&
      this.connections.get(connection.binding.id) === connection
    );
  }
  private async problem(connection: Connection, message: string): Promise<void> {
    await this.sessions
      .recordError(connection.binding, message, this.clock.now())
      .catch(() => undefined);
    this.logger.warn({ bindingId: connection.binding.id, channel: 'qq' }, message);
  }
  private async open(connection: Connection): Promise<void> {
    if (!this.current(connection)) return;
    try {
      const credentials = await this.channels.qqSecret(connection.binding);
      if (!credentials.appId || !credentials.appSecret || !this.current(connection)) return;
      connection.client = this.clientFactory(credentials, () => this.clock.nowMs());
      const gateway = await connection.client.gateway();
      if (!this.current(connection)) return;
      const currentBinding = await this.store.bindingById(connection.binding.id);
      if (
        !currentBinding ||
        currentBinding.generation !== connection.binding.generation ||
        !(await this.sessions.get(connection.binding.id))
      ) {
        this.close(connection);
        return;
      }
      connection.token = gateway.token;
      const socket = this.socketFactory(gateway.url);
      connection.socket = socket;
      connection.ready = false;
      socket.on('message', (raw) => {
        if (!this.current(connection) || connection.socket !== socket) return;
        let packet: { op?: number; s?: number; t?: string; d?: Record<string, unknown> };
        try {
          packet = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!packet || typeof packet !== 'object') return;
        if (typeof packet.s === 'number' && Number.isSafeInteger(packet.s))
          connection.sequence = packet.s;
        if (packet.op === 10) {
          const milliseconds = Math.min(
            120000,
            Math.max(5000, Number(packet.d?.heartbeat_interval) || 40000),
          );
          if (connection.heartbeat) clearInterval(connection.heartbeat);
          connection.awaitingAck = false;
          connection.heartbeat = setInterval(() => {
            if (
              !this.current(connection) ||
              connection.socket !== socket ||
              socket.readyState !== WebSocket.OPEN
            )
              return;
            if (connection.awaitingAck) {
              socket.terminate();
              return;
            }
            connection.awaitingAck = true;
            socket.send(JSON.stringify({ op: 1, d: connection.sequence }));
          }, milliseconds);
          connection.heartbeat.unref();
          socket.send(
            JSON.stringify(
              connection.session && connection.sequence !== null
                ? {
                    op: 6,
                    d: {
                      token: `QQBot ${connection.token}`,
                      session_id: connection.session,
                      seq: connection.sequence,
                    },
                  }
                : {
                    op: 2,
                    d: { token: `QQBot ${connection.token}`, intents: QQ_INTENTS, shard: [0, 1] },
                  },
            ),
          );
          return;
        }
        if (packet.op === 11) {
          connection.awaitingAck = false;
          return;
        }
        if (packet.op === 1) {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ op: 1, d: connection.sequence }));
          return;
        }
        if (packet.op === 7 || packet.op === 9) {
          if (packet.op === 9) {
            connection.session = '';
            connection.sequence = null;
          }
          socket.close();
          return;
        }
        if (packet.op === 0 && (packet.t === 'READY' || packet.t === 'RESUMED')) {
          if (typeof packet.d?.session_id === 'string') connection.session = packet.d.session_id;
          connection.ready = true;
          void this.sessions
            .recordError(connection.binding, null, this.clock.now())
            .catch(() => undefined);
          return;
        }
        const inbound = parseQqInbound(packet, this.clock.now());
        if (!inbound || !connection.ready || connection.queued >= 32) return;
        connection.queued++;
        connection.work = connection.work
          .then(async () => {
            if (!this.current(connection)) return;
            const input = {
              externalId: inbound.messageId,
              senderId: inbound.peer,
              text: inbound.text,
              contextToken: '',
              createdAt: inbound.createdAt,
              qqSession: {
                bindingId: connection.binding.id,
                generation: connection.binding.generation,
              },
            };
            if (readQqPairingCode(inbound.text)) {
              if (await this.bridge.pairQq(connection.binding, input)) {
                const latest = await this.store.bindingById(connection.binding.id);
                if (
                  latest?.status === 'active' &&
                  latest.generation === connection.binding.generation &&
                  this.current(connection)
                )
                  await connection.client?.send(
                    inbound.peer,
                    '已连接到微伴，可以发送日常文字了。',
                    inbound.messageId,
                    1,
                    connection.abort.signal,
                  );
              }
            } else await this.bridge.ingest(connection.binding, input);
          })
          .catch(() => this.problem(connection, 'QQ消息处理未完成，请返回新站查看连接状态'))
          .finally(() => {
            connection.queued--;
          });
      });
      socket.on('close', (code) => {
        if (connection.socket !== socket) return;
        if (connection.heartbeat) clearInterval(connection.heartbeat);
        connection.heartbeat = null;
        connection.socket = null;
        connection.ready = false;
        if (this.current(connection))
          void this.problem(
            connection,
            `QQ事件连接断开（${code}），将自动重连；若持续失败请核对平台事件权限`,
          );
        this.retry(connection);
      });
      socket.on('error', () => {
        void this.problem(
          connection,
          'QQ事件连接暂不可用，稍后自动重连；若持续失败请核对平台事件权限',
        );
      });
    } catch {
      await this.problem(connection, 'QQ官方鉴权或事件网关未就绪，请核对凭据及平台权限');
      this.retry(connection);
    }
  }
  private retry(connection: Connection): void {
    if (!this.current(connection) || connection.retry) return;
    connection.retry = setTimeout(() => {
      connection.retry = null;
      void this.open(connection);
    }, 5000);
    connection.retry.unref();
  }
  async send(
    binding: BindingRow,
    outboundId: string,
    text: string,
  ): Promise<'sent' | 'not_ready' | 'no_window'> {
    const connection = this.connections.get(binding.id);
    if (
      !connection ||
      !this.current(connection) ||
      !connection.ready ||
      !connection.client ||
      connection.binding.generation !== binding.generation
    )
      return 'not_ready';
    const peer = await this.channels.qqReplyPeer(binding);
    if (!peer) return 'no_window';
    const reference = await this.sessions.reserveDelivery(outboundId, binding, this.clock.now());
    if (!reference) return 'no_window';
    const message = await this.crypto.open(
      binding.user_id,
      qqAad(binding.id, 'reply'),
      reference.sealed,
    );
    try {
      if (
        !this.current(connection) ||
        !(await this.store.isOutboundCurrent(outboundId, binding.id, binding.generation))
      )
        return 'no_window';
      await connection.client.send(
        peer,
        text,
        message.toString('utf8'),
        reference.sequence,
        connection.abort.signal,
      );
      return 'sent';
    } finally {
      message.fill(0);
    }
  }
  private close(connection: Connection): void {
    connection.abort.abort();
    connection.stopped = true;
    connection.ready = false;
    if (connection.heartbeat) clearInterval(connection.heartbeat);
    if (connection.retry) clearTimeout(connection.retry);
    connection.socket?.terminate();
    connection.token = '';
    connection.client = null;
    if (this.connections.get(connection.binding.id) === connection)
      this.connections.delete(connection.binding.id);
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const connection of this.connections.values()) this.close(connection);
  }
}
