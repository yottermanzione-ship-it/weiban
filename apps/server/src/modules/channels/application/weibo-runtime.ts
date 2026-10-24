/**
 * 微博 OpenIM 运行时（worker / all 角色）。
 *
 * 真实协议（见 domain/weibo-openim.ts）：AppSecret 换 ws_token → 连 WSS stream → 收 message 帧 / 发 send_message 帧。
 * 复用服务器已有的 ws 依赖（apps/server 的 dependencies 里本来就有 ws，没有新增依赖）。
 *
 * 默认不运行：只有 CHANNEL_WEIBO_ENABLED=1 且用户自己绑定了 AppID / AppSecret 才会有连接。
 * **实网未验证**：这套代码按旧版微博接入的线协议实现，本轮没有可用的微博账号做联调，
 * 页面在通道未开通时如实显示「未联调」，绝不假装已经打通。
 *
 * 一个 AppID 只允许一个主人（旧版也是单用户），所以一个 active 绑定一条连接；
 * 连接断了按 5 秒退避重连；关闭码 4002 = token 失效，下次重连会重新换 token。
 */
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import WebSocket from 'ws';
import {
  APP_CONFIG,
  CLOCK,
  LOGGER,
  type AppConfig,
  type Clock,
  type Logger,
} from '../../../platform/index.js';
import { ChannelBridge } from './channel-bridge.js';
import { channelRuntimeConfig } from './channel-config.js';
import { ChannelStore, type BindingRow } from './channel-store.js';
import { ChannelsService } from './channels.service.js';
import {
  WEIBO_TOKEN_EXPIRED_CLOSE_CODE,
  WeiboError,
  buildWeiboSendFrames,
  fetchWeiboToken,
  parseWeiboInbound,
  weiboStreamUrl,
} from '../domain/weibo-openim.js';

const RECONNECT_MS = 5_000;
const PING_MS = 30_000;

interface Connection {
  binding: BindingRow;
  socket: WebSocket | null;
  stop: boolean;
  ping: ReturnType<typeof setInterval> | null;
  retry: ReturnType<typeof setTimeout> | null;
  botUid: string;
}

@Injectable()
export class WeiboRuntime implements OnApplicationShutdown {
  private readonly connections = new Map<string, Connection>();
  private stopping = false;

  constructor(
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(ChannelBridge) private readonly bridge: ChannelBridge,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** 按 active 绑定对齐连接（ChannelsWorker 每分钟调一次，绑定 / 解绑后也会调）。 */
  async reconcile(): Promise<void> {
    if (this.stopping) return;
    if (channelRuntimeConfig(this.config, 'weibo').integration !== 'live') return;
    const rows = await this.store.activeBindings('weibo', 200).catch(() => [] as BindingRow[]);
    const alive = new Set<string>();
    for (const binding of rows) {
      if (!binding.weibo_app_id_sealed || !binding.weibo_app_secret_sealed) continue;
      alive.add(binding.id);
      if (!this.connections.has(binding.id)) this.connect(binding);
    }
    for (const [bindingId, connection] of this.connections) {
      if (!alive.has(bindingId)) this.close(bindingId, connection);
    }
  }

  /** 发一条文字：连接没就绪时返回 false，调用方按失败重试。 */
  async send(bindingId: string, toUserId: string, text: string): Promise<boolean> {
    const connection = this.connections.get(bindingId);
    const socket = connection?.socket;
    if (!connection || !socket || socket.readyState !== WebSocket.OPEN) return false;
    const messageId = `out-${toUserId}-${this.clock.nowMs()}`;
    for (const frame of buildWeiboSendFrames({ toUserId, text, messageId })) {
      socket.send(JSON.stringify(frame));
    }
    return true;
  }

  private connect(binding: BindingRow): void {
    const connection: Connection = {
      binding,
      socket: null,
      stop: false,
      ping: null,
      retry: null,
      botUid: '',
    };
    this.connections.set(binding.id, connection);
    void this.open(connection);
  }

  private async open(connection: Connection): Promise<void> {
    if (connection.stop || this.stopping) return;
    const cfg = channelRuntimeConfig(this.config, 'weibo');
    if (cfg.integration !== 'live') return;
    let credentials: { appId: string; appSecret: string };
    try {
      credentials = await this.channels.weiboSecret(connection.binding);
    } catch (error) {
      this.logger.warn({ err: error, bindingId: connection.binding.id }, '微博凭据解密失败');
      connection.stop = true;
      return;
    }
    if (!credentials.appId || !credentials.appSecret) {
      connection.stop = true;
      return;
    }
    let token: { token: string; uid: string };
    try {
      token = await fetchWeiboToken({
        ...credentials,
        ...(cfg.weibo?.tokenEndpoint ? { tokenEndpoint: cfg.weibo.tokenEndpoint } : {}),
      });
    } catch (error) {
      // 不写原始错误：WSS 地址里带 token，有些运行时的错误信息会整条带上。
      this.logger.warn(
        {
          bindingId: connection.binding.id,
          problem:
            error instanceof WeiboError ? `weibo_http_${error.status}` : 'weibo_token_failed',
        },
        '微博换 token 失败',
      );
      this.scheduleReconnect(connection);
      return;
    }
    connection.botUid = token.uid;
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        weiboStreamUrl({
          appId: credentials.appId,
          token: token.token,
          ...(cfg.weibo?.wsEndpoint ? { wsEndpoint: cfg.weibo.wsEndpoint } : {}),
        }),
      );
    } catch {
      this.logger.warn(
        { bindingId: connection.binding.id, problem: 'weibo_bad_ws_url' },
        '微博长连地址无效',
      );
      this.scheduleReconnect(connection);
      return;
    }
    connection.socket = socket;
    socket.on('open', () => {
      this.logger.info({ bindingId: connection.binding.id }, '微博长连已建立');
      connection.ping = setInterval(() => {
        try {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          /* 断线由 close 处理 */
        }
      }, PING_MS);
    });
    socket.on('message', (raw) => {
      const inbound = parseWeiboInbound(String(raw), this.clock.nowMs());
      if (!inbound) return;
      void this.bridge
        .ingest(connection.binding, {
          externalId: inbound.messageId || `wb-${inbound.fromUserId}-${inbound.timestamp}`,
          senderId: inbound.fromUserId,
          text: inbound.text,
          contextToken: '',
          createdAt: new Date(inbound.timestamp),
        })
        .catch((error) =>
          this.logger.warn({ err: error, bindingId: connection.binding.id }, '微博入站处理失败'),
        );
    });
    socket.on('close', (code) => {
      if (connection.ping) clearInterval(connection.ping);
      connection.ping = null;
      connection.socket = null;
      if (code === WEIBO_TOKEN_EXPIRED_CLOSE_CODE) connection.botUid = '';
      if (!connection.stop && !this.stopping) this.scheduleReconnect(connection);
    });
    socket.on('error', () => {
      // socket 错误信息可能包含整条 WSS 地址（带 token），只记事实。
      this.logger.warn(
        { bindingId: connection.binding.id, problem: 'weibo_ws_error' },
        '微博长连出错',
      );
    });
  }

  private scheduleReconnect(connection: Connection): void {
    if (connection.stop || this.stopping || connection.retry) return;
    connection.retry = setTimeout(() => {
      connection.retry = null;
      void this.open(connection);
    }, RECONNECT_MS);
    if (typeof connection.retry.unref === 'function') connection.retry.unref();
  }

  private close(bindingId: string, connection: Connection): void {
    connection.stop = true;
    if (connection.ping) clearInterval(connection.ping);
    if (connection.retry) clearTimeout(connection.retry);
    try {
      connection.socket?.close();
    } catch {
      /* 已关闭 */
    }
    this.connections.delete(bindingId);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const [bindingId, connection] of [...this.connections]) this.close(bindingId, connection);
  }
}
