import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ChannelId } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  TestClock,
  type Database,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../src/modules/identity/index.js';
import { CHAT_READ_PORT, CHAT_USER_PORT } from '../src/modules/chat/index.js';
import {
  ChannelStore,
  ChannelBridge,
  ChannelsService,
  ChannelsWorker,
  WeiboRuntime,
  type BindingRow,
} from '../src/modules/channels/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

const OWNER = '9a76a467-fe83-41c1-9e3c-6270aefb8447';
const OTHER = '11111111-2222-3333-4444-555555555555';
const CHARACTER = '22222222-3333-4444-5555-666666666666';
const appId = 'helper-application-CANARY-12345';
const appSecret = 'helper-secret-CANARY-DO-NOT-LOG-12345';

describeDb('龙虾助手原凭据流程：假鉴权上游，真实 SQL / DEK / 消息桥', () => {
  let module: TestingModule;
  let fake: Server;
  let db: Database;
  let crypto: EnvelopeCrypto;
  let store: ChannelStore;
  let channels: ChannelsService;
  let bridge: ChannelBridge;
  let binding: BindingRow;
  let scope = 'normal';
  const requests: Record<string, unknown>[] = [];
  const logs = captureLogger();
  const send = vi.fn(async () => ({ message: { messageId: newId() } }));
  const clock = new TestClock('2026-10-28T00:00:00.000Z');
  beforeAll(async () => {
    await resetTestDatabase();
    fake = createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk.toString();
      requests.push(JSON.parse(text));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: { token: 'test-ws-token-CANARY', uid: 'shared-helper-account', expire_in: 3600 },
        }),
      );
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const port = (fake.address() as AddressInfo).port;
    module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({
            APP_ROLE: 'web',
            CHANNEL_WECHAT_ENABLED: '1',
            CHANNEL_WECHAT_ALLOWED_USER_IDS: OWNER,
            CHANNEL_WEIBO_ENABLED: '1',
            CHANNEL_WEIBO_ALLOWED_USER_IDS: `${OWNER},${OTHER}`,
            CHANNEL_WEIBO_TOKEN_ENDPOINT: `http://127.0.0.1:${port}/token`,
          }),
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CONTACTS_READ_PORT)
      .useValue({
        listActiveContacts: async () => [{ characterId: CHARACTER, remark: '测试角色' }],
      })
      .overrideProvider(IDENTITY_MEMBERSHIP_READ_PORT)
      .useValue({ isProPlus: async () => true })
      .overrideProvider(CHAT_READ_PORT)
      .useValue({
        findDirectConversation: async () => ({
          conversationId: 'test-conversation',
          contentScope: scope,
        }),
        getMessage: async (id: string) => ({
          messageId: id,
          content: { type: 'text', text: '测试回复' },
        }),
      })
      .overrideProvider(CHAT_USER_PORT)
      .useValue({ sendMessage: send })
      .compile();
    db = module.get(DATABASE);
    crypto = module.get(ENVELOPE_CRYPTO);
    store = module.get(ChannelStore);
    channels = module.get(ChannelsService);
    bridge = module.get(ChannelBridge);
  });
  beforeEach(async () => {
    scope = 'normal';
    send.mockClear();
    await channels.weiboConnect(OWNER, { characterId: CHARACTER, appId, appSecret });
    binding = (await store.bindingOf(OWNER, 'weibo'))!;
  });
  afterAll(async () => {
    await module?.close();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });

  const input = (peer = 'sender-from-helper', generation?: number) => ({
    externalId: newId(),
    senderId: peer,
    text: '测试文字',
    contextToken: '',
    createdAt: clock.now(),
    weiboSession: { bindingId: binding.id, generation: generation ?? binding.generation },
  });

  it('只交 AppID/AppSecret：同一助手账号下不同专属凭据互不挤掉，原文不进日志', async () => {
    expect(requests.at(-1)).toEqual({ app_id: appId, app_secret: appSecret });
    expect(binding.account_id).toMatch(/^weibo-app:[a-f0-9]{64}$/);
    expect(binding.account_id).not.toContain(appId);
    await channels.weiboConnect(OTHER, {
      characterId: CHARACTER,
      appId: 'other-private-helper-12345',
      appSecret,
    });
    const other = (await store.bindingOf(OTHER, 'weibo'))!;
    expect(other.bot_id).toBe(binding.bot_id);
    expect(other.account_id).not.toBe(binding.account_id);
    expect((await store.bindingOf(OWNER, 'weibo'))?.status).toBe('active');
    expect(JSON.stringify(binding)).not.toContain(appSecret);
    expect(logs.capture.text).not.toContain(appSecret);
  });
  it('凭据重复绑定不夺走其他用户的连接', async () => {
    await expect(
      channels.weiboConnect(OTHER, { characterId: CHARACTER, appId, appSecret }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.bindingOf(OWNER, 'weibo'))?.status).toBe('active');
  });
  it('由鉴权连接自动确定回信 peer；后来的不同发件人不能换主人或目标', async () => {
    expect(await bridge.ingest(binding, input())).toBe('accepted');
    const saved = (await store.bindingById(binding.id))!;
    expect(await channels.weiboReplyPeer(saved)).toBe('sender-from-helper');
    expect(saved.user_id).toBe(OWNER);
    expect(saved.account_id).toBe(binding.account_id);
    expect(saved.context_token_sealed?.toString()).not.toContain('sender-from-helper');
    expect(await bridge.ingest(binding, input('another-sender'))).toBe('rejected');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await channels.weiboReplyPeer((await store.bindingById(binding.id))!)).toBe(
      'sender-from-helper',
    );
  });
  it('没有鉴权连接标识、旧代际或私密会话均不触发模型与计费', async () => {
    const noSession = { ...input(), weiboSession: undefined };
    expect(await bridge.ingest(binding, noSession)).toBe('rejected');
    expect(await bridge.ingest(binding, input('sender', binding.generation - 1))).toBe('rejected');
    scope = 'adult';
    expect(await bridge.ingest(binding, input())).toBe('rejected');
    expect(send).not.toHaveBeenCalled();
  });
  it('保存新出口角色后，长连接的旧快照也不能继续投递给旧角色', async () => {
    const updatedCharacter = '33333333-4444-5555-6666-777777777777';
    await db.transaction((tx) =>
      store.setCharacter(tx, OWNER, 'weibo', updatedCharacter, '新角色', clock.now()),
    );
    const read = module.get(CHAT_READ_PORT);
    const find = vi.spyOn(read, 'findDirectConversation');
    try {
      expect(await bridge.ingest(binding, input())).toBe('accepted');
      expect(find).toHaveBeenCalledWith(OWNER, updatedCharacter);
    } finally {
      find.mockRestore();
    }
  });
  it('并发固定 peer 是原子的，重绑后旧代际不能写回上下文', async () => {
    const a = await crypto.seal(OWNER, `channels:binding:${binding.id}:weibo_peer`, 'peer-a');
    const b = await crypto.seal(OWNER, `channels:binding:${binding.id}:weibo_peer`, 'peer-b');
    const selected = await Promise.all([
      store.pinWeiboPeer(binding.id, binding.generation, a, clock.now()),
      store.pinWeiboPeer(binding.id, binding.generation, b, clock.now()),
    ]);
    expect(selected[0]?.equals(selected[1]!)).toBe(true);
    await channels.weiboConnect(OWNER, { characterId: CHARACTER, appId, appSecret });
    expect(await store.pinWeiboPeer(binding.id, binding.generation, a, clock.now())).toBeNull();
    expect((await store.bindingById(binding.id))?.context_token_sealed).toBeNull();
  });
  it('同角色同时绑微信与微博时，两份日常队列互不覆盖；私密回复不排队', async () => {
    const wxId = (await store.bindingOf(OWNER, 'wechat'))?.id ?? newId();
    await db.transaction((tx) =>
      store.saveBinding(tx, {
        id: wxId,
        userId: OWNER,
        channel: 'wechat',
        characterId: CHARACTER,
        characterName: '测试角色',
        accountId: 'test-wx-peer',
        accountName: null,
        botId: 'test-wx-bot',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        botTokenSealed: Buffer.from('not-a-real-token'),
        weiboAppIdSealed: null,
        weiboAppSecretSealed: null,
        now: clock.now(),
      }),
    );
    const event = {
      conversationId: 'test-conversation',
      conversationType: 'direct' as const,
      messageId: newId(),
      senderKind: 'character' as const,
      senderRefId: CHARACTER,
      contentType: 'text',
      scope: 'normal' as const,
      userRecipientIds: [OWNER],
    };
    await db.transaction((tx) => bridge.enqueueCharacterReply(tx, event));
    const rows = (
      await db.query<{ channel: ChannelId }>(
        'SELECT channel FROM channels.outbound_messages WHERE chat_message_id=$1',
        [event.messageId],
      )
    ).rows;
    expect(rows.map((r) => r.channel).sort()).toEqual(['wechat', 'weibo']);
    expect(
      await db.transaction((tx) =>
        bridge.enqueueCharacterReply(tx, { ...event, messageId: newId(), scope: 'adult' }),
      ),
    ).toBeNull();
  });
  it('出站发给入站 peer，不误发 token.uid；重绑取消已领取的旧回复', async () => {
    await bridge.ingest(binding, input());
    const id = await db.transaction(async (tx) =>
      store.enqueueOutbound(tx, {
        bindingId: binding.id,
        userId: OWNER,
        channel: 'weibo',
        chatMessageId: newId(),
        textSealed: Buffer.from('placeholder'),
        now: clock.now(),
      }),
    );
    const row = (await store.claimOutbound(50, clock.now())).find((r) => r.id === id)!;
    const text = await crypto.seal(
      OWNER,
      `channels:outbound:${binding.id}:${row.chat_message_id}:text`,
      '测试回复',
    );
    await db.query('UPDATE channels.outbound_messages SET text_sealed=$2 WHERE id=$1', [
      row.id,
      text,
    ]);
    row.text_sealed = text;
    const runtime = module.get(WeiboRuntime);
    const sendSpy = vi.spyOn(runtime, 'send').mockResolvedValue(true);
    try {
      await module.get(ChannelsWorker)['deliverOne'](row);
      expect(sendSpy).toHaveBeenCalledWith(
        binding.id,
        'sender-from-helper',
        '测试回复',
        binding.generation,
        `out-${row.id}`,
      );
      await channels.weiboConnect(OWNER, { characterId: CHARACTER, appId, appSecret });
      expect(await store.isOutboundCurrent(row.id, binding.id, binding.generation)).toBe(false);
    } finally {
      sendSpy.mockRestore();
    }
  });
});
