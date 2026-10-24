/**
 * 微信 / 微博接入（3.42，2026-10-25 按真实旧协议重做）。
 *
 * 真实链路（与旧版服务器一致，没有「外部网关」、没有 webhook）：
 *   微信  POST/GET iLink：get_bot_qrcode → get_qrcode_status → （worker）getupdates / sendmessage
 *   微博  OpenIM：AppSecret 换 ws_token → （worker）WSS stream 收发
 *
 * 这个服务只做**用户主动发起**的部分：出码、查码、换出口角色、提交微博凭据、解绑、看状态。
 * 轮询与收发在 ChannelsWorker（只在 worker / all 角色里跑，且只处理本新站用户自己刚绑好的行）。
 *
 * 安全：
 * - bot_token / 微博 AppSecret / qrcode / context_token 全部用**该用户 DEK** 信封加密后落库；
 *   接口只返回掩码与展示名，明文不进数据库、不进日志、不下发客户端。
 * - 解绑会清空凭据与账号字段（tombstone），并丢弃该绑定的排队消息。
 * - 本服务不读任何旧站数据：没有任何导入旧凭据的入口。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_QR_TTL_MS,
  type ChannelCharacter,
  type ChannelId,
  type ChannelState,
  type WechatQrAttempt,
  type WeiboConnectRequest,
  type Plugin,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  LOGGER,
  newId,
  type AppConfig,
  type Clock,
  type Database,
  type EnvelopeCrypto,
  type JobQueue,
  type Logger,
} from '../../../platform/index.js';
import { CHARACTER_NAME_READ_PORT } from '../../characters/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import type {
  CharacterNameReadPort,
  ContactsReadPort,
  IdentityMembershipReadPort,
} from '@weiban/contracts';
import { channelRuntimeConfig, type ChannelRuntimeConfig } from './channel-config.js';
import { assertChannelProPlus } from './channel-access.js';
import { ChannelStore, type AttemptRow, type BindingRow } from './channel-store.js';
import { fetchWeiboToken, WeiboError } from '../domain/weibo-openim.js';
import { createIlinkClient, describeIlinkError } from '../domain/ilink.js';

/** 后台 worker 的任务名（登记在 ChannelsWorker）。 */
export const CHANNELS_RECONCILE_JOB = 'channels.reconcile';
export const CHANNELS_DELIVER_JOB = 'channels.deliver';

const CHANNEL_ORDER: readonly ChannelId[] = ['wechat', 'weibo'];

const CHANNEL_INFO: Record<ChannelId, { name: string; description: string }> = {
  wechat: {
    name: '微信接入',
    description: '用微信扫一扫，把这个角色接到微信里聊（微信 ClawBot）',
  },
  weibo: {
    name: '微博接入',
    description: '用微博开放平台的 AppID / AppSecret 把角色接到微博私信（OpenIM）',
  },
};

/** 掩码只留前 4 位：完整对面账号 id 不下发客户端。 */
export function maskAccountId(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.length <= 4 ? '****' : `${text.slice(0, 4)}****`;
}

interface ChannelCharacterRef {
  characterId: string;
  name: string;
}

@Injectable()
export class ChannelsService {
  /** 同一张二维码同时只允许一个上游状态查询，避免并发把长轮询打爆。 */
  private readonly qrPolls = new Map<string, Promise<WechatQrAttempt>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHARACTER_NAME_READ_PORT) private readonly names: CharacterNameReadPort,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  private runtime(channel: ChannelId): ChannelRuntimeConfig {
    return channelRuntimeConfig(this.config, channel);
  }

  /** 依赖没配 / 没开通时一律 422，绝不冒称可用。 */
  private assertLive(cfg: ChannelRuntimeConfig): void {
    const name = CHANNEL_INFO[cfg.channel].name;
    if (cfg.integration === 'not_integrated') {
      throw new AppError('service_disabled', `${name}通道尚未开通，暂时不能绑定`, {
        details: { channel: cfg.channel, integration: cfg.integration },
      });
    }
    if (cfg.integration === 'not_configured') {
      throw new AppError('service_disabled', `${name}通道缺少服务器配置，请联系管理员`, {
        details: { channel: cfg.channel, integration: cfg.integration },
      });
    }
  }

  /** 投递后台任务失败不影响已经提交的业务写入；只记日志。 */
  private async safeSend(
    name: string,
    data: Record<string, unknown>,
    singletonKey?: string,
  ): Promise<void> {
    try {
      await this.jobs.send(name, data, singletonKey ? { singletonKey } : {});
    } catch (error) {
      this.logger.warn({ err: error, job: name }, '渠道后台任务投递失败');
    }
  }

  // ---------- 读取 ----------

  async list(userId: string): Promise<{ items: ChannelState[]; characters: ChannelCharacter[] }> {
    const [bindings, characters] = await Promise.all([
      this.store.bindingsOf(userId),
      this.availableCharacters(userId),
    ]);
    const now = this.clock.now();
    const byChannel = new Map(bindings.map((row) => [row.channel, row]));
    const items: ChannelState[] = [];
    for (const channel of CHANNEL_ORDER) {
      const binding = byChannel.get(channel) ?? null;
      const attempt = channel === 'wechat' ? await this.pendingAttempt(userId, channel, now) : null;
      items.push(this.toState(channel, binding, attempt));
    }
    return { items, characters };
  }

  private async stateOf(userId: string, channel: ChannelId): Promise<ChannelState> {
    const [binding, attempt] = await Promise.all([
      this.store.bindingOf(userId, channel),
      channel === 'wechat' ? this.pendingAttempt(userId, channel, this.clock.now()) : null,
    ]);
    return this.toState(channel, binding, attempt);
  }

  private async pendingAttempt(
    userId: string,
    channel: ChannelId,
    now: Date,
  ): Promise<AttemptRow | null> {
    try {
      return await this.store.pendingAttempt(userId, channel, now);
    } catch (error) {
      this.logger.warn({ err: error }, '读取待扫码会话失败');
      return null;
    }
  }

  private toState(
    channel: ChannelId,
    binding: BindingRow | null,
    attempt: AttemptRow | null,
  ): ChannelState {
    const cfg = this.runtime(channel);
    const active = binding?.status === 'active';
    const pending = !active && Boolean(attempt);
    const status: ChannelState['status'] = active
      ? 'active'
      : pending
        ? 'pending'
        : binding?.status === 'revoked'
          ? 'revoked'
          : 'unbound';
    return {
      channel,
      name: CHANNEL_INFO[channel].name,
      description: CHANNEL_INFO[channel].description,
      status,
      integration: cfg.integration,
      characterId: binding?.character_id ?? attempt?.character_id ?? null,
      characterName: binding?.character_name ?? attempt?.character_name ?? null,
      accountName: active ? (binding.account_name ?? null) : null,
      accountMasked: active ? maskAccountId(binding.account_id) : null,
      boundAt: active && binding.bound_at ? binding.bound_at.toISOString() : null,
      lastEventAt: binding?.last_event_at ? binding.last_event_at.toISOString() : null,
      lastError: binding?.last_error ?? attempt?.last_error ?? null,
      pendingExpiresAt: pending && attempt ? attempt.expires_at.toISOString() : null,
    };
  }

  /** 可选出口角色：通讯录里 active 的角色；名字用「备注优先，其次角色名」。 */
  private async availableCharacters(userId: string): Promise<ChannelCharacter[]> {
    let rows: Awaited<ReturnType<ContactsReadPort['listActiveContacts']>>;
    try {
      rows = await this.contacts.listActiveContacts(userId);
    } catch (error) {
      this.logger.warn({ err: error }, '读取通讯录失败，出口角色列表为空');
      return [];
    }
    const characters: ChannelCharacter[] = [];
    for (const contact of rows) {
      const name = contact.remark?.trim() || (await this.displayName(userId, contact.characterId));
      if (!name) continue;
      characters.push({ characterId: contact.characterId, name: name.slice(0, 64) });
    }
    return characters;
  }

  private async displayName(userId: string, characterId: string): Promise<string> {
    try {
      return (await this.names.getDisplayName(userId, characterId))?.trim() ?? '';
    } catch {
      return '';
    }
  }

  /** 校验「这个角色确实是我的好友」，并给出当时的展示名快照。 */
  private async resolveCharacter(
    userId: string,
    characterId: string,
  ): Promise<ChannelCharacterRef> {
    let rows: Awaited<ReturnType<ContactsReadPort['listActiveContacts']>>;
    try {
      rows = await this.contacts.listActiveContacts(userId);
    } catch (error) {
      this.logger.warn({ err: error }, '读取通讯录失败');
      throw new AppError('service_unavailable', '通讯录暂时读不到，请稍后再试');
    }
    const contact = rows.find((row) => row.characterId === characterId);
    if (!contact) throw new AppError('bad_request', '请选择通讯录里已有的好友');
    const name = contact.remark?.trim() || (await this.displayName(userId, characterId));
    if (!name) throw new AppError('bad_request', '这个好友还没有名字，请先设置备注');
    return { characterId, name: name.slice(0, 64) };
  }

  // ---------- 微信：扫码绑定 ----------

  async wechatQr(userId: string, characterId: string): Promise<WechatQrAttempt> {
    const cfg = this.runtime('wechat');
    this.assertLive(cfg);
    await assertChannelProPlus(this.membership, userId, 'new_qr');
    const character = await this.resolveCharacter(userId, characterId);
    const client = createIlinkClient({ baseUrl: cfg.ilinkBaseUrl });
    let qrcode: { qrcode: string; bindUrl: string };
    try {
      qrcode = await client.createBindQrcode();
    } catch (error) {
      this.logger.warn({ problem: describeIlinkError(error), channel: 'wechat' }, '微信出码失败');
      throw new AppError('service_unavailable', '微信暂时没有出码，请稍后再试');
    }
    if (!qrcode.qrcode)
      throw new AppError('service_unavailable', '微信没有返回有效二维码，请稍后再试');
    const now = this.clock.now();
    const attemptId = newId();
    const expiresAt = new Date(now.getTime() + CHANNEL_QR_TTL_MS);
    const qrcodeSealed = await this.crypto.seal(
      userId,
      `channels:attempt:${attemptId}:qrcode`,
      qrcode.qrcode,
    );
    await this.db.transaction(async (tx) => {
      // 每调一次 get_bot_qrcode 上游就把旧码作废了：本地也立刻标记过期，避免页面还拿着旧码等。
      await this.store.discardPendingAttempts(tx, userId, 'wechat', now);
      await this.store.insertAttempt(tx, {
        id: attemptId,
        userId,
        channel: 'wechat',
        characterId: character.characterId,
        characterName: character.name,
        qrcodeSealed,
        bindUrl: qrcode.bindUrl,
        expiresAt,
        now,
      });
    });
    return {
      attemptId,
      status: 'wait',
      bindUrl: qrcode.bindUrl,
      characterId: character.characterId,
      characterName: character.name,
      expiresAt: expiresAt.toISOString(),
      lastError: null,
    };
  }

  /** 查一次扫码状态：上游长轮询，这里最多挂 8 秒就返回 wait（页面 2 秒后再问）。 */
  async wechatQrStatus(userId: string, attemptId: string): Promise<WechatQrAttempt> {
    const attempt = await this.store.attemptOf(userId, attemptId);
    if (!attempt) throw new AppError('not_found', '二维码不存在或已失效');
    if (attempt.status === 'confirmed') {
      return this.attemptPayload(attempt, 'confirmed', await this.stateOf(userId, 'wechat'));
    }
    if (attempt.status === 'expired' || attempt.status === 'failed') {
      return this.attemptPayload(attempt, 'expired', null);
    }
    const running = this.qrPolls.get(attemptId);
    if (running) return running;
    const task = this.pollWechatQr(userId, attempt).finally(() => {
      this.qrPolls.delete(attemptId);
    });
    this.qrPolls.set(attemptId, task);
    return task;
  }

  private async pollWechatQr(userId: string, attempt: AttemptRow): Promise<WechatQrAttempt> {
    const cfg = this.runtime('wechat');
    this.assertLive(cfg);
    await assertChannelProPlus(this.membership, userId, 'new_qr');
    const now = this.clock.now();
    if (attempt.expires_at.getTime() <= now.getTime()) {
      await this.db.transaction((tx) =>
        this.store.updateAttempt(
          tx,
          attempt.id,
          { status: 'expired', lastError: '二维码已过期，请重新生成' },
          now,
        ),
      );
      return this.attemptPayload({ ...attempt, status: 'expired' }, 'expired', null);
    }
    const qrcode = (
      await this.crypto.open(userId, `channels:attempt:${attempt.id}:qrcode`, attempt.qrcode_sealed)
    ).toString('utf8');
    const client = createIlinkClient({ baseUrl: cfg.ilinkBaseUrl });
    let upstream;
    try {
      upstream = await client.pollQrcodeStatus(qrcode, attempt.poll_base_url || undefined);
    } catch (error) {
      this.logger.warn(
        { problem: describeIlinkError(error), channel: 'wechat' },
        '微信扫码状态查询失败',
      );
      throw new AppError('service_unavailable', '暂时无法确认扫码状态，请稍后再试');
    }
    const status = upstream.status.toLowerCase();
    if (status === 'verify_code_blocked' || status === 'expired') {
      const message =
        status === 'verify_code_blocked'
          ? '微信要求输入验证码，这张码不能继续用了，请重新生成'
          : '二维码已过期，请重新生成';
      await this.db.transaction((tx) =>
        this.store.updateAttempt(tx, attempt.id, { status: 'expired', lastError: message }, now),
      );
      return this.attemptPayload(
        { ...attempt, status: 'expired', last_error: message },
        'expired',
        null,
      );
    }
    if (status === 'scaned_but_redirect' && upstream.nextPollBaseUrl) {
      await this.db.transaction((tx) =>
        this.store.updateAttempt(
          tx,
          attempt.id,
          { status: 'scanned', pollBaseUrl: upstream.nextPollBaseUrl },
          now,
        ),
      );
      return this.attemptPayload({ ...attempt, status: 'wait' }, 'wait', null);
    }
    if (
      (upstream.confirmed || status === 'confirmed') &&
      upstream.botToken &&
      upstream.botId &&
      upstream.ilinkUserId
    ) {
      const binding = await this.db.transaction(async (tx) => {
        // 密文的 AAD 与绑定行 id 绑定：重建绑定时必须复用已有 id，否则旧密文解不开。
        const existing = await this.store.bindingOf(userId, 'wechat');
        const bindingId = existing?.id ?? newId();
        const botTokenSealed = await this.crypto.seal(
          userId,
          `channels:binding:${bindingId}:token`,
          upstream.botToken,
          tx,
        );
        const saved = await this.store.saveBinding(tx, {
          id: bindingId,
          userId,
          channel: 'wechat',
          characterId: attempt.character_id,
          characterName: attempt.character_name,
          accountId: upstream.ilinkUserId,
          accountName: null,
          botId: upstream.botId,
          baseUrl: upstream.baseUrl,
          botTokenSealed,
          weiboAppIdSealed: null,
          weiboAppSecretSealed: null,
          now,
        });
        await this.store.updateAttempt(
          tx,
          attempt.id,
          { status: 'confirmed', lastError: null },
          now,
        );
        return saved;
      });
      // 绑定成功立刻让 worker 对齐长轮询；失败只记日志，页面状态不受影响。
      await this.safeSend(CHANNELS_RECONCILE_JOB, { reason: 'bound' });
      return this.attemptPayload(
        { ...attempt, status: 'confirmed' },
        'confirmed',
        this.toState('wechat', binding, null),
      );
    }
    if (upstream.confirmed || status === 'confirmed') {
      // 上游说确认了但凭据不全：不能当成功，作废这张码让用户重扫。
      const message = '微信确认结果不完整，请重新扫码';
      await this.db.transaction((tx) =>
        this.store.updateAttempt(tx, attempt.id, { status: 'expired', lastError: message }, now),
      );
      return this.attemptPayload(
        { ...attempt, status: 'expired', last_error: message },
        'expired',
        null,
      );
    }
    if (status === 'scaned') {
      await this.db.transaction((tx) =>
        this.store.updateAttempt(tx, attempt.id, { status: 'scanned' }, now),
      );
    }
    return this.attemptPayload(attempt, 'wait', null);
  }

  private attemptPayload(
    attempt: AttemptRow,
    status: WechatQrAttempt['status'],
    binding: ChannelState | null,
  ): WechatQrAttempt {
    return {
      attemptId: attempt.id,
      status,
      bindUrl: attempt.bind_url,
      characterId: attempt.character_id,
      characterName: attempt.character_name,
      expiresAt: attempt.expires_at.toISOString(),
      lastError: attempt.last_error ?? null,
      binding,
    };
  }

  // ---------- 换出口角色 / 微博连入 / 解绑 ----------

  async setCharacter(
    userId: string,
    channel: ChannelId,
    characterId: string,
  ): Promise<ChannelState> {
    const cfg = this.runtime(channel);
    this.assertLive(cfg);
    await assertChannelProPlus(this.membership, userId, 'switch_character');
    const binding = await this.store.bindingOf(userId, channel);
    if (!binding || binding.status !== 'active')
      throw new AppError('conflict', `还没有绑定${CHANNEL_INFO[channel].name.replace('接入', '')}`);
    const character = await this.resolveCharacter(userId, characterId);
    await this.db.transaction((tx) =>
      this.store.setCharacter(
        tx,
        userId,
        channel,
        character.characterId,
        character.name,
        this.clock.now(),
      ),
    );
    return this.stateOf(userId, channel);
  }

  async weiboConnect(userId: string, input: WeiboConnectRequest): Promise<ChannelState> {
    const cfg = this.runtime('weibo');
    this.assertLive(cfg);
    await assertChannelProPlus(this.membership, userId, 'bind');
    const character = await this.resolveCharacter(userId, input.characterId);
    let token: { token: string; uid: string };
    try {
      token = await fetchWeiboToken({
        appId: input.appId,
        appSecret: input.appSecret,
        ...(cfg.weibo?.tokenEndpoint ? { tokenEndpoint: cfg.weibo.tokenEndpoint } : {}),
      });
    } catch (error) {
      // 不写原始错误：微博 token 端点的错误里可能带请求体片段。
      this.logger.warn(
        {
          channel: 'weibo',
          problem:
            error instanceof WeiboError ? `weibo_http_${error.status}` : 'weibo_token_failed',
        },
        '微博凭据校验失败',
      );
      throw new AppError('upstream_test_failed', '微博凭据校验失败，请检查 AppID / AppSecret');
    }
    const now = this.clock.now();
    const binding = await this.db.transaction(async (tx) => {
      const existing = await this.store.bindingOf(userId, 'weibo');
      const bindingId = existing?.id ?? newId();
      const appIdSealed = await this.crypto.seal(
        userId,
        `channels:binding:${bindingId}:app_id`,
        input.appId,
        tx,
      );
      const appSecretSealed = await this.crypto.seal(
        userId,
        `channels:binding:${bindingId}:app_secret`,
        input.appSecret,
        tx,
      );
      return this.store.saveBinding(tx, {
        id: bindingId,
        userId,
        channel: 'weibo',
        characterId: character.characterId,
        characterName: character.name,
        accountId: token.uid || input.appId,
        accountName: null,
        botId: null,
        baseUrl: '',
        botTokenSealed: null,
        weiboAppIdSealed: appIdSealed,
        weiboAppSecretSealed: appSecretSealed,
        now,
      });
    });
    await this.safeSend(CHANNELS_RECONCILE_JOB, { reason: 'bind' });
    return this.toState('weibo', binding, null);
  }

  /** 解绑：幂等；清空凭据与账号，停掉后台任务。**不需要 PRO+**（会员到期也必须能解绑）。 */
  async unbind(userId: string, channel: ChannelId): Promise<ChannelState> {
    await this.db.transaction((tx) => this.store.unbind(tx, userId, channel, this.clock.now()));
    await this.safeSend(CHANNELS_RECONCILE_JOB, { reason: 'unbind' });
    return this.stateOf(userId, channel);
  }

  /** 兼容旧的 GET /api/v1/plugins（3.15 契约，字段只增不减）。 */
  async plugins(userId: string): Promise<{ items: Plugin[] }> {
    const { items } = await this.list(userId);
    const stateOf = (channel: ChannelId) => items.find((item) => item.channel === channel);
    const statusOf = (channel: ChannelId): Plugin['status'] => {
      const state = stateOf(channel);
      if (!state) return 'coming_soon';
      if (state.status === 'active') return 'enabled';
      return state.integration === 'live' ? 'available' : 'coming_soon';
    };
    return {
      items: [
        {
          pluginId: 'wechat',
          name: '微信接入',
          description: '用微信扫一扫，把这个角色接到微信里聊',
          status: statusOf('wechat'),
        },
        {
          pluginId: 'qq',
          name: 'QQ接入',
          description: '在QQ中与角色聊天，外部接入暂未开放',
          status: 'coming_soon',
        },
        {
          pluginId: 'weibo',
          name: '微博接入',
          description: '用微博 AppID / AppSecret 接到微博私信',
          status: statusOf('weibo'),
        },
      ],
    };
  }

  /** worker 用：解密该绑定的微信 bot token 与最近一次 context_token。 */
  async wechatSecret(binding: BindingRow): Promise<{ botToken: string; contextToken: string }> {
    if (!binding.bot_token_sealed) return { botToken: '', contextToken: '' };
    const botToken = (
      await this.crypto.open(
        binding.user_id,
        `channels:binding:${binding.id}:token`,
        binding.bot_token_sealed,
      )
    ).toString('utf8');
    let contextToken = '';
    if (binding.context_token_sealed) {
      try {
        contextToken = (
          await this.crypto.open(
            binding.user_id,
            `channels:binding:${binding.id}:context`,
            binding.context_token_sealed,
          )
        ).toString('utf8');
      } catch {
        contextToken = '';
      }
    }
    return { botToken, contextToken };
  }

  /** worker 用：把最近一次入站 context_token 加密（出站带上更稳）。 */
  async sealWechatContext(binding: BindingRow, contextToken: string): Promise<Buffer> {
    return this.crypto.seal(
      binding.user_id,
      `channels:binding:${binding.id}:context`,
      contextToken,
    );
  }

  /** worker 用：解密该绑定的微博 AppID / AppSecret。 */
  async weiboSecret(binding: BindingRow): Promise<{ appId: string; appSecret: string }> {
    if (!binding.weibo_app_id_sealed || !binding.weibo_app_secret_sealed)
      return { appId: '', appSecret: '' };
    const appId = (
      await this.crypto.open(
        binding.user_id,
        `channels:binding:${binding.id}:app_id`,
        binding.weibo_app_id_sealed,
      )
    ).toString('utf8');
    const appSecret = (
      await this.crypto.open(
        binding.user_id,
        `channels:binding:${binding.id}:app_secret`,
        binding.weibo_app_secret_sealed,
      )
    ).toString('utf8');
    return { appId, appSecret };
  }
}
