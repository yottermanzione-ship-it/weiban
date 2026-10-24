/**
 * channels 的后台生命周期（worker / all 角色）。
 *
 * 做四件事，别的什么都不做：
 * 1. 每分钟对齐长轮询 / 微博长连（WechatRuntime / WeiboRuntime）——只处理本新站用户自己扫码绑好的行。
 * 2. 发送队列：角色在私聊里的回复 → 微信 sendmessage / 微博 WSS。失败按指数退避重试，上限后标 failed。
 * 3. 订阅 chat.message_created：只挑「绑定的角色在私聊里发的文字」进出站队列（同一事务）。
 * 4. 定期清理过期的二维码会话与已经发完的队列行；并登记注销删除清单（USER_DATA_REGISTRY）。
 *
 * 部署默认不触发：CHANNEL_*_ENABLED 没打开时，两个 Runtime 的 reconcile 直接返回，
 * 不连微信、不连微博、不发送任何东西；页面对应显示「未联调」。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { UserDataOwner } from '@weiban/contracts';
import {
  APP_CONFIG,
  CLOCK,
  ENVELOPE_CRYPTO,
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  USER_DATA_REGISTRY,
  type AppConfig,
  type Clock,
  type EnvelopeCrypto,
  type EventBus,
  type JobQueue,
  type Logger,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { ChannelBridge } from './channel-bridge.js';
import { channelRuntimeConfig } from './channel-config.js';
import { ChannelStore, type BindingRow, type OutboundRow } from './channel-store.js';
import {
  CHANNELS_DELIVER_JOB,
  CHANNELS_RECONCILE_JOB,
  ChannelsService,
} from './channels.service.js';
import { WechatRuntime } from './wechat-runtime.js';
import { WeiboRuntime } from './weibo-runtime.js';
import {
  IlinkHttpError,
  createIlinkClient,
  describeIlinkError,
  isRevoked,
} from '../domain/ilink.js';

const SWEEP_JOB = 'channels.sweep';
const DELIVER_BATCH = 20;
const MAX_SEND_ATTEMPTS = 5;

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

@Injectable()
export class ChannelsWorker implements OnModuleInit, UserDataOwner {
  readonly module = 'channels' as const;

  constructor(
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(ChannelBridge) private readonly bridge: ChannelBridge,
    @Inject(WechatRuntime) private readonly wechat: WechatRuntime,
    @Inject(WeiboRuntime) private readonly weibo: WeiboRuntime,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);

    await this.jobs.work(CHANNELS_RECONCILE_JOB, () => this.reconcile());
    await this.jobs.schedule(CHANNELS_RECONCILE_JOB, '* * * * *');
    await this.jobs.work(CHANNELS_DELIVER_JOB, () => this.deliverDue());
    await this.jobs.schedule(CHANNELS_DELIVER_JOB, '* * * * *');
    await this.jobs.work(SWEEP_JOB, () => this.sweep());
    await this.jobs.schedule(SWEEP_JOB, '*/5 * * * *');

    this.bus.subscribe({
      consumer: 'channels.on_message_created',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const queued = await this.bridge.enqueueCharacterReply(tx, event.payload);
        if (!queued) return;
        // 与业务写入同一事务：有消息就一定有投递任务；立即唤醒，不等下一分钟的定时。
        await this.jobs.send(
          CHANNELS_DELIVER_JOB,
          { wake: true },
          { tx, singletonKey: 'channels:deliver' },
        );
      },
    });
  }

  private async reconcile(): Promise<void> {
    // 后台隔离：AppModule 传 background:false（HTTP 测试）时任务队列不启动，这个处理器永远不会被调度到；
    // 这里再加一道显式检查，避免以后有人在别处直接调用而真的连上微信 / 微博。
    if (!this.jobs.isReady) return;
    try {
      await this.wechat.reconcile();
    } catch (error) {
      this.logger.warn({ err: error }, '微信渠道对齐失败');
    }
    try {
      await this.weibo.reconcile();
    } catch (error) {
      this.logger.warn({ err: error }, '微博渠道对齐失败');
    }
  }

  /** 发送到期的出站消息。同一条消息只发一次；失败按 5s / 10s / 20s … 退避，最多 5 次。 */
  private async deliverDue(): Promise<void> {
    const now = this.clock.now();
    const rows = await this.store.claimOutbound(DELIVER_BATCH, now).catch((error) => {
      this.logger.warn({ err: error }, '领取渠道出站消息失败');
      return [] as OutboundRow[];
    });
    for (const row of rows) {
      try {
        await this.deliverOne(row);
      } catch (error) {
        const problem = describeIlinkError(error);
        this.logger.warn({ problem, outboundId: row.id }, '渠道出站消息发送异常');
        await this.retryOrFail(row, `发送异常（${problem}）`);
      }
    }
  }

  private async deliverOne(row: OutboundRow): Promise<void> {
    const cfg = channelRuntimeConfig(this.config, row.channel);
    if (cfg.integration !== 'live') {
      await this.store.finishOutbound(row.id, {
        status: 'skipped',
        lastError: '通道未开通',
        now: this.clock.now(),
      });
      return;
    }
    const binding = await this.store.bindingById(row.binding_id);
    if (!binding || binding.status !== 'active') {
      await this.store.finishOutbound(row.id, {
        status: 'skipped',
        lastError: '绑定已解除',
        now: this.clock.now(),
      });
      return;
    }
    let text: string;
    try {
      text = (
        await this.crypto.open(
          row.user_id,
          `channels:outbound:${row.binding_id}:${row.chat_message_id}:text`,
          row.text_sealed,
        )
      ).toString('utf8');
    } catch (error) {
      this.logger.warn({ err: error, outboundId: row.id }, '出站正文解密失败');
      await this.store.finishOutbound(row.id, {
        status: 'failed',
        lastError: '正文无法解密',
        now: this.clock.now(),
      });
      return;
    }
    if (row.channel === 'weibo') {
      const ok = await this.weibo.send(row.binding_id, binding.account_id ?? '', text);
      if (ok) {
        await this.store.finishOutbound(row.id, { status: 'sent', now: this.clock.now() });
        await this.store.touchEvent(binding.id, this.clock.now());
      } else {
        await this.retryOrFail(row, '微博长连未就绪');
      }
      return;
    }
    await this.deliverWechat(row, binding, text, cfg.ilinkBaseUrl);
  }

  private async deliverWechat(
    row: OutboundRow,
    binding: BindingRow,
    text: string,
    fallbackBaseUrl: string,
  ): Promise<void> {
    if (!binding.account_id) {
      await this.store.finishOutbound(row.id, {
        status: 'failed',
        lastError: '缺少对面账号',
        now: this.clock.now(),
      });
      return;
    }
    const { botToken, contextToken } = await this.channels.wechatSecret(binding);
    if (!botToken) {
      await this.store.finishOutbound(row.id, {
        status: 'failed',
        lastError: '凭据已失效',
        now: this.clock.now(),
      });
      return;
    }
    const client = createIlinkClient({ baseUrl: binding.base_url || fallbackBaseUrl });
    let result: Awaited<ReturnType<typeof client.sendText>>;
    try {
      result = await client.sendText({
        token: botToken,
        toUserId: binding.account_id,
        text,
        ...(contextToken ? { contextToken } : {}),
        clientId: `wb-out-${row.id.replace(/-/g, '').slice(0, 24)}`,
        baseUrl: binding.base_url || undefined,
      });
    } catch (error) {
      const body = error instanceof IlinkHttpError ? error.body : null;
      if (isRevoked(body)) {
        await this.store.markRevokedQuiet(
          binding.id,
          '微信会话已失效，请重新扫码绑定',
          this.clock.now(),
        );
        await this.store.finishOutbound(row.id, {
          status: 'failed',
          lastError: '会话已失效',
          now: this.clock.now(),
        });
        return;
      }
      await this.retryOrFail(row, `发送失败（${describeIlinkError(error)}）`);
      return;
    }
    if (result.revoked) {
      await this.store.markRevokedQuiet(
        binding.id,
        '微信会话已失效，请重新扫码绑定',
        this.clock.now(),
      );
      await this.store.finishOutbound(row.id, {
        status: 'failed',
        lastError: '会话已失效',
        now: this.clock.now(),
      });
      return;
    }
    if (result.quotaExhausted) {
      // 连发太多条要等用户说话，恢复后重试；不算失败。
      await this.retryOrFail(row, '微信限流，等对方说话后重试', 60_000);
      return;
    }
    if (!result.submitted) {
      await this.retryOrFail(row, '微信未接受这条消息');
      return;
    }
    await this.store.finishOutbound(row.id, { status: 'sent', now: this.clock.now() });
    await this.store.touchEvent(binding.id, this.clock.now());
  }

  private async retryOrFail(row: OutboundRow, reason: string, delayMs?: number): Promise<void> {
    const now = this.clock.now();
    if (row.attempts >= MAX_SEND_ATTEMPTS) {
      await this.store.finishOutbound(row.id, {
        status: 'failed',
        lastError: reason,
        now,
      });
      return;
    }
    await this.store.finishOutbound(row.id, {
      status: 'retry',
      lastError: reason,
      nextAttemptAt: new Date(now.getTime() + (delayMs ?? retryDelayMs(row.attempts))),
      now,
    });
  }

  /** 清理：过期的二维码会话、7 天前的队列流水。 */
  private async sweep(): Promise<void> {
    const now = this.clock.now();
    try {
      await this.store.expireStaleAttempts(now);
      await this.store.pruneHistory(new Date(now.getTime() - 7 * 86_400_000));
    } catch (error) {
      this.logger.warn({ err: error }, '渠道清理失败');
    }
  }

  // ---------- 注销删除清单 ----------

  async purgeUser(userId: string): Promise<number> {
    return this.store.purgeUser(userId);
  }

  async countUserData(userId: string): Promise<number> {
    return this.store.countUserData(userId);
  }
}
