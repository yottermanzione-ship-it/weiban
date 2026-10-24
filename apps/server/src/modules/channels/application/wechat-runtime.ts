/**
 * 微信 iLink 长轮询运行时（worker / all 角色）。
 *
 * 只处理**本新站用户自己扫码新绑**的 channels.bindings 行（status = active）。
 * 没有任何导入旧站凭据的入口，也不会去轮询旧站的记录：这里的每一条都是本轮 binds 流程写进来的。
 *
 * 机制（和旧版 channel_runner 一致）：
 * - 每分钟 reconcile 一次：为每个 active 绑定起一个长轮询循环；解绑 / 重建 / 不再是 active 的自动停。
 * - 每个循环：getupdates（上游长轮询 35 秒）→ 逐条投给聊天 → 保存游标 → 立刻继续。
 * - errcode -14（session timeout）= 绑定永久失效：停循环、清凭据、标记 revoked（页面会提示重新扫码）。
 * - 超时 / 网络错误退避 15 秒；配额错误（ret -2）等用户说话后自然恢复。
 *
 * 多进程：用 PostgreSQL 咨询锁（weiban:channels:wechat）保证同一时刻只有一个进程在长轮询；
 * 拿不到锁的进程只做 HTTP，不去连微信。锁存在专用连接上，进程退出即释放。
 */
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { IdentityMembershipReadPort } from '@weiban/contracts';
import {
  APP_CONFIG,
  CLOCK,
  DATABASE,
  LOGGER,
  type AppConfig,
  type Clock,
  type Database,
  type Logger,
} from '../../../platform/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { ChannelBridge } from './channel-bridge.js';
import { channelRuntimeConfig } from './channel-config.js';
import { ChannelStore, type BindingRow } from './channel-store.js';
import { ChannelsService } from './channels.service.js';
import {
  IlinkHttpError,
  createIlinkClient,
  dedupeKeyOf,
  describeIlinkError,
  extractInboundText,
  isRevoked,
} from '../domain/ilink.js';

const ERROR_BACKOFF_MS = 15_000;
const LOCK_KEY = 'weiban:channels:wechat';

interface LoopState {
  stop: boolean;
  /** 已经告诉过微信「这条绑定上线了」；退出时要发 stop（旧版 channel_runner 同样处理）。 */
  notified: boolean;
  token: string;
  baseUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

@Injectable()
export class WechatRuntime implements OnApplicationShutdown {
  private readonly loops = new Map<string, LoopState>();
  private lock: { query(sql: string): Promise<{ rows: unknown[] }>; release(): void } | null = null;
  private lockClient: unknown = null;
  private stopping = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(ChannelBridge) private readonly bridge: ChannelBridge,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
  ) {}

  /** 拿进程级咨询锁；拿不到说明另一个 worker 在长轮询，本进程不碰微信。 */
  private async acquireLock(): Promise<boolean> {
    if (this.lock) return true;
    if (channelRuntimeConfig(this.config, 'wechat').integration !== 'live') return false;
    const client = await this.db.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [LOCK_KEY],
      );
      if (result.rows[0]?.locked !== true) {
        client.release();
        return false;
      }
      this.lockClient = client;
      this.lock = client;
      return true;
    } catch (error) {
      client.release();
      this.logger.warn({ err: error }, '微信渠道咨询锁获取失败');
      return false;
    }
  }

  /** 每分钟由 ChannelsWorker 调用：对齐 active 绑定与本进程的循环。 */
  async reconcile(): Promise<void> {
    if (this.stopping) return;
    if (channelRuntimeConfig(this.config, 'wechat').integration !== 'live') return;
    if (!(await this.acquireLock())) return;
    let rows: BindingRow[];
    try {
      rows = await this.store.activeBindings('wechat', 200);
    } catch (error) {
      this.logger.warn({ err: error }, '微信渠道读取绑定失败');
      return;
    }
    const alive = new Set<string>();
    for (const binding of rows) {
      if (!binding.bot_token_sealed) continue;
      alive.add(binding.id);
      if (!this.loops.has(binding.id)) this.startLoop(binding.id, binding.generation);
    }
    for (const [bindingId, state] of this.loops) {
      if (!alive.has(bindingId)) {
        state.stop = true;
        this.loops.delete(bindingId);
      }
    }
  }

  private startLoop(bindingId: string, generation: number): void {
    const state: LoopState = { stop: false, notified: false, token: '', baseUrl: '' };
    this.loops.set(bindingId, state);
    void this.runLoop(bindingId, generation, state)
      .catch((error) => this.logger.warn({ err: error, bindingId }, '微信长轮询循环异常退出'))
      .finally(() => {
        if (this.loops.get(bindingId) === state) this.loops.delete(bindingId);
        // 下线告知（失败不影响任何事情，只是让微信那边知道这条绑定不在线了）
        if (state.notified && state.token) {
          const client = createIlinkClient({ baseUrl: state.baseUrl || undefined });
          void client
            .notifyPresence({
              token: state.token,
              kind: 'stop',
              baseUrl: state.baseUrl || undefined,
            })
            .catch(() => undefined);
        }
      });
  }

  private async runLoop(bindingId: string, generation: number, state: LoopState): Promise<void> {
    while (!state.stop && !this.stopping) {
      const binding = await this.store.bindingById(bindingId).catch(() => null);
      if (!binding || binding.status !== 'active' || binding.generation !== generation) return;
      const cfg = channelRuntimeConfig(this.config, 'wechat');
      if (cfg.integration !== 'live') return;
      // 会员到期就停轮询（页面仍可解绑）；恢复后下一轮 reconcile 会重新起循环。
      if (!(await this.membership.isProPlus(binding.user_id))) {
        await this.store.touchPollError(
          bindingId,
          'PRO+ 已到期，暂停接收微信消息',
          this.clock.now(),
        );
        return;
      }
      let botToken: string;
      try {
        botToken = (await this.channels.wechatSecret(binding)).botToken;
      } catch (error) {
        this.logger.warn({ err: error, bindingId }, '微信凭据解密失败');
        await this.store.markRevokedQuiet(
          bindingId,
          '凭据无法解密，请重新扫码绑定',
          this.clock.now(),
        );
        return;
      }
      if (!botToken) return;

      const client = createIlinkClient({ baseUrl: binding.base_url || cfg.ilinkBaseUrl });
      if (!state.notified) {
        // 告诉微信这条绑定上线（旧版同样在循环起点发一次）；失败不阻塞收消息。
        state.notified = true;
        state.token = botToken;
        state.baseUrl = binding.base_url || cfg.ilinkBaseUrl;
        void client
          .notifyPresence({
            token: botToken,
            kind: 'start',
            baseUrl: binding.base_url || undefined,
          })
          .catch(() => undefined);
      }
      let updates: Awaited<ReturnType<typeof client.getUpdates>>;
      try {
        updates = await client.getUpdates(botToken, binding.cursor, binding.base_url || undefined);
      } catch (error) {
        const body = error instanceof IlinkHttpError ? error.body : null;
        if (isRevoked(body)) {
          await this.store.markRevokedQuiet(
            bindingId,
            '微信会话已失效，请重新扫码绑定',
            this.clock.now(),
          );
          return;
        }
        const name = (error as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') continue; // 长轮询无消息 = 正常
        const problem = describeIlinkError(error);
        this.logger.warn({ problem, bindingId }, '微信拉取消息失败，稍后重试');
        await this.store.touchPollError(
          bindingId,
          `拉取微信消息失败（${problem}）`,
          this.clock.now(),
        );
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }

      if (updates.revoked) {
        await this.store.markRevokedQuiet(
          bindingId,
          '微信会话已失效，请重新扫码绑定',
          this.clock.now(),
        );
        return;
      }

      let contextToken = '';
      for (const message of updates.messages) {
        const externalId = dedupeKeyOf(message);
        if (!externalId) continue;
        const text = extractInboundText(message);
        const messageCreatedAt = Number(message.create_time_ms);
        const outcome = await this.bridge
          .ingest(binding, {
            externalId,
            senderId: String(message.from_user_id ?? ''),
            text,
            contextToken: String(message.context_token ?? ''),
            createdAt:
              Number.isFinite(messageCreatedAt) && messageCreatedAt > 0
                ? new Date(messageCreatedAt)
                : null,
          })
          .catch((error) => {
            this.logger.warn({ err: error, bindingId }, '微信消息入站处理失败');
            return 'failed' as const;
          });
        if (outcome === 'accepted' && message.context_token) {
          contextToken = String(message.context_token);
        }
      }

      let sealed: Buffer | null = null;
      if (contextToken) {
        sealed = await this.channels.sealWechatContext(binding, contextToken).catch(() => null);
      }
      const alive = await this.db
        .transaction((tx) =>
          this.store.recordPoll(tx, {
            bindingId,
            generation,
            cursor: updates.cursor || binding.cursor,
            contextTokenSealed: sealed,
            now: this.clock.now(),
          }),
        )
        .catch(() => false);
      if (!alive) return;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const state of this.loops.values()) state.stop = true;
    this.loops.clear();
    const client = this.lockClient as { release(): void } | null;
    this.lock = null;
    this.lockClient = null;
    try {
      client?.release();
    } catch {
      /* 已释放 */
    }
  }
}
