import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
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
  ChannelsService,
  ChannelBridge,
  ChannelsWorker,
  QqSessionStore,
  QqRuntime,
  QQ_CLIENT_FACTORY,
  QQ_WS_FACTORY,
  createQqClient,
  type BindingRow,
  type OutboundRow,
} from '../src/modules/channels/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const OWNER = '9a76a467-fe83-41c1-9e3c-6270aefb8447',
  OTHER = '11111111-2222-4333-8444-555555555555';
const CHARACTER = '22222222-3333-4444-8555-666666666666',
  SECOND = '33333333-4444-4555-8666-777777777777';
const credentials = { appId: '1234567890', appSecret: 'QQ-CANARY-SECRET-NOT-REAL-DO-NOT-LOG' };

describeDb('新QQ机器人：真实SQL/DEK + 本地假HTTP/WS，绝无真实消息或付费模型', () => {
  let module: TestingModule, fake: Server, websocket: WebSocketServer, base: string;
  let db: Database,
    store: ChannelStore,
    sessions: QqSessionStore,
    channels: ChannelsService,
    bridge: ChannelBridge,
    runtime: QqRuntime,
    worker: ChannelsWorker,
    crypto: EnvelopeCrypto;
  let binding: BindingRow,
    code = '',
    scope = 'normal',
    pro = true,
    identify = 0,
    replyFailures = 0;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const send = vi.fn(async (_user: string, _conversation: string, _body: unknown) => ({
    message: { messageId: newId() },
  }));
  const clock = new TestClock('2026-10-28T12:00:00Z'),
    logs = captureLogger();
  beforeAll(async () => {
    await resetTestDatabase();
    fake = createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk.toString();
      const body = text ? JSON.parse(text) : {};
      requests.push({ path: req.url!, body });
      if (req.url?.endsWith('/getAppAccessToken'))
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ access_token: 'QQ-TOKEN-CANARY', expires_in: 7200 }));
      else if (req.url === '/gateway')
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ url: 'wss://api.bot.qq.com/websocket/' }));
      else if (req.url?.startsWith('/v2/users/')) {
        const fail = replyFailures-- > 0;
        res
          .writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(fail ? { code: 1 } : { id: 'sent' }));
      } else res.writeHead(404).end();
    });
    websocket = new WebSocketServer({ server: fake, path: '/ws' });
    websocket.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10000 } }));
      socket.on('message', (raw) => {
        const packet = JSON.parse(String(raw));
        if (packet.op === 2 || packet.op === 6) {
          identify++;
          expect(packet.d.token).toBe('QQBot QQ-TOKEN-CANARY');
          socket.send(
            JSON.stringify({
              op: 0,
              s: 1,
              t: 'READY',
              d: { session_id: 'session-test', user: { id: 'BOT-NOT-A-CHAT-USER' } },
            }),
          );
        }
        if (packet.op === 1) socket.send(JSON.stringify({ op: 11 }));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({
            APP_ROLE: 'web',
            CHANNEL_QQ_ENABLED: '1',
            CHANNEL_QQ_ALLOWED_USER_IDS: `${OWNER},${OTHER}`,
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
        listActiveContacts: async () => [
          { characterId: CHARACTER, remark: '角色一' },
          { characterId: SECOND, remark: '角色二' },
        ],
      })
      .overrideProvider(IDENTITY_MEMBERSHIP_READ_PORT)
      .useValue({ isProPlus: async () => pro })
      .overrideProvider(CHAT_READ_PORT)
      .useValue({
        findDirectConversation: async (_user: string, character: string) => ({
          conversationId: character,
          contentScope: scope,
        }),
        getMessage: async (id: string) => ({
          messageId: id,
          content: { type: 'text', text: '假模型的普通回复' },
        }),
      })
      .overrideProvider(CHAT_USER_PORT)
      .useValue({ sendMessage: send })
      .overrideProvider(QQ_CLIENT_FACTORY)
      .useValue((input: typeof credentials, now: () => number) =>
        createQqClient(input, now, (url, init) =>
          fetch(base + new URL(String(url)).pathname, init),
        ),
      )
      .overrideProvider(QQ_WS_FACTORY)
      .useValue(() => new WebSocket(base.replace('http:', 'ws:') + '/ws'))
      .compile();
    db = module.get(DATABASE);
    store = module.get(ChannelStore);
    sessions = module.get(QqSessionStore);
    channels = module.get(ChannelsService);
    bridge = module.get(ChannelBridge);
    runtime = module.get(QqRuntime);
    worker = module.get(ChannelsWorker);
    crypto = module.get(ENVELOPE_CRYPTO);
  });
  beforeEach(async () => {
    scope = 'normal';
    pro = true;
    replyFailures = 0;
    send.mockClear();
    await channels.unbind(OWNER, 'qq');
    await channels.unbind(OTHER, 'qq');
    await runtime.reconcile();
    identify = 0;
    requests.length = 0;
    const result = await channels.qqConnect(OWNER, { characterId: CHARACTER, ...credentials });
    code = result.pairingCode;
    binding = (await store.bindingOf(OWNER, 'qq'))!;
    await runtime.reconcile();
    await vi.waitFor(() => expect(identify).toBeGreaterThan(0), { timeout: 8000 });
  });
  afterAll(async () => {
    await module?.close();
    for (const client of websocket?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => websocket?.close(() => resolve()));
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });
  function input(text: string, peer = 'MY-QQ-OPENID', snapshot = binding) {
    return {
      externalId: newId(),
      senderId: peer,
      text,
      contextToken: '',
      createdAt: clock.now(),
      qqSession: { bindingId: snapshot.id, generation: snapshot.generation },
    };
  }
  async function paired() {
    expect(await bridge.pairQq(binding, input('绑定 ' + code))).toBe(true);
    binding = (await store.bindingById(binding.id))!;
  }
  async function enqueue(): Promise<OutboundRow> {
    const event = {
      conversationId: CHARACTER,
      conversationType: 'direct' as const,
      messageId: newId(),
      senderKind: 'character' as const,
      senderRefId: CHARACTER,
      contentType: 'text',
      scope: 'normal' as const,
      userRecipientIds: [OWNER],
    };
    const queued = await db.transaction((tx) => bridge.enqueueCharacterReply(tx, event));
    expect(queued).not.toBeNull();
    return (await store.claimOutbound(20, clock.now())).find(
      (row) => row.id === queued!.outboundId,
    )!;
  }
  async function deliver(row: OutboundRow) {
    await (worker as unknown as { deliverOne(value: OutboundRow): Promise<void> }).deliverOne(row);
  }

  it('凭据加密存储，短码只存摘要，服务连接不等于本人配对', async () => {
    const session = (await sessions.get(binding.id))!;
    expect(session.app_secret_sealed.toString()).not.toContain(credentials.appSecret);
    const opened = await crypto.open(
      OWNER,
      `channels:binding:${binding.id}:qq_secret`,
      session.app_secret_sealed,
    );
    try {
      expect(opened.toString('utf8')).toBe(credentials.appSecret);
    } finally {
      opened.fill(0);
    }
    expect(session.pairing_hash?.toString()).not.toContain(code);
    expect((await channels.list(OWNER)).items.find((item) => item.channel === 'qq')?.status).toBe(
      'pending',
    );
    expect(binding.status).toBe('unbound');
    expect(binding.context_token_sealed).toBeNull();
    expect(JSON.stringify(await channels.list(OWNER))).not.toContain(credentials.appSecret);
    expect(logs.capture.text).not.toContain(credentials.appSecret);
    expect(logs.capture.text).not.toContain('QQ-TOKEN-CANARY');
  });
  it('未配对普通消息、错码、群事件不进AI、不扣费、不写聊天流水', async () => {
    expect(await bridge.ingest(binding, input('普通文字'))).toBe('rejected');
    expect(await bridge.pairQq(binding, input('绑定 FFFFFFFFFF'))).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await db.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM channels.inbound_messages WHERE binding_id=$1',
          [binding.id],
        )
      ).rows[0]?.count,
    ).toBe('0');
  });
  it('真实假WSS的私聊配对成功，机器人READY里的UID不当作本人', async () => {
    for (const socket of websocket.clients)
      socket.send(
        JSON.stringify({
          op: 0,
          t: 'C2C_MESSAGE_CREATE',
          d: {
            id: newId(),
            content: '绑定 ' + code,
            author: { user_openid: 'REAL-PEER-FROM-EVENT' },
            timestamp: clock.now().toISOString(),
          },
        }),
      );
    await vi.waitFor(
      async () => expect((await store.bindingById(binding.id))?.status).toBe('active'),
      { timeout: 8000 },
    );
    const current = (await store.bindingById(binding.id))!;
    expect(await channels.qqReplyPeer(current)).toBe('REAL-PEER-FROM-EVENT');
    expect(send).not.toHaveBeenCalled();
    await vi.waitFor(
      () =>
        expect(requests.some((row) => row.path.includes('/v2/users/REAL-PEER-FROM-EVENT/'))).toBe(
          true,
        ),
      { timeout: 8000 },
    );
  });
  it('本人正常消息复用聊天链路；他人及重复短码不能换主人或回信目标', async () => {
    await paired();
    expect(await bridge.ingest(binding, input('冒名消息', 'OTHER-PEER'))).toBe('rejected');
    expect(await bridge.pairQq(binding, input('绑定 ' + code, 'OTHER-PEER'))).toBe(false);
    const own = input('普通文字');
    expect(await bridge.ingest(binding, own)).toBe('accepted');
    expect(await bridge.ingest(binding, own)).toBe('duplicate');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe(OWNER);
    expect(await channels.qqReplyPeer((await store.bindingById(binding.id))!)).toBe('MY-QQ-OPENID');
  });
  it('私密范围与会员门禁在调用聊天/模型之前生效', async () => {
    scope = 'adult';
    expect(await bridge.pairQq(binding, input('绑定 ' + code))).toBe(false);
    scope = 'normal';
    await paired();
    scope = 'adult';
    expect(await bridge.ingest(binding, input('不允许外发的范围'))).toBe('rejected');
    scope = 'normal';
    pro = false;
    expect(await bridge.ingest(binding, input('会员已到期'))).toBe('rejected');
    expect(send).not.toHaveBeenCalled();
  });
  it('重复凭据不能夺走他人的绑定，拒绝前也不刷新他人的上游token', async () => {
    const calls = requests.length;
    await expect(
      channels.qqConnect(OTHER, { characterId: CHARACTER, ...credentials }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(requests).toHaveLength(calls);
    expect((await store.bindingOf(OTHER, 'qq'))?.status ?? 'unbound').toBe('unbound');
    expect((await sessions.get(binding.id))?.pairing_hash).not.toBeNull();
  });
  it('旧代际事件、过期短码、刷新前的码均不能配对', async () => {
    const old = binding;
    clock.advance(6 * 60000);
    expect(await bridge.pairQq(old, input('绑定 ' + code))).toBe(false);
    const next = await channels.qqPairing(OWNER, CHARACTER);
    binding = (await store.bindingById(binding.id))!;
    expect(await bridge.pairQq(old, input('绑定 ' + next.pairingCode, 'MY-QQ-OPENID', old))).toBe(
      false,
    );
    expect(await bridge.pairQq(binding, input('绑定 ' + code))).toBe(false);
    expect(await bridge.pairQq(binding, input('绑定 ' + next.pairingCode))).toBe(true);
  });
  it('出站保留被动msg_id与稳定msg_seq，重试不借新消息重复发送', async () => {
    await paired();
    const first = input('请回复');
    expect(await bridge.ingest(binding, first)).toBe('accepted');
    const row = await enqueue();
    replyFailures = 1;
    await deliver(row);
    const firstRequest = requests.filter((item) => item.path.startsWith('/v2/users/')).at(-1)!;
    expect(firstRequest.body).toMatchObject({ msg_type: 0, msg_id: first.externalId, msg_seq: 1 });
    expect(await bridge.ingest(binding, input('后来的新消息'))).toBe('accepted');
    clock.advance(60000);
    const retry = (await store.claimOutbound(20, clock.now())).find((item) => item.id === row.id)!;
    await deliver(retry);
    expect(requests.filter((item) => item.path.startsWith('/v2/users/')).at(-1)?.body).toEqual(
      firstRequest.body,
    );
  });
  it('QQ回复窗口到期不变成主动发送', async () => {
    await paired();
    expect(await bridge.ingest(binding, input('窗口内文字'))).toBe('accepted');
    const row = await enqueue();
    const before = requests.length;
    clock.advance(6 * 60000);
    await deliver(row);
    expect(requests).toHaveLength(before);
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM channels.outbound_messages WHERE id=$1',
          [row.id],
        )
      ).rows[0]?.status,
    ).toBe('skipped');
  });
  it('解绑清空QQ凭据与peer，旧帧失效，原微信微博行不被修改', async () => {
    for (const channel of ['wechat', 'weibo'] as const)
      await db.transaction((tx) =>
        store.saveBinding(tx, {
          id: newId(),
          userId: OWNER,
          channel,
          characterId: CHARACTER,
          characterName: '已有角色',
          accountId: 'existing-' + channel,
          accountName: '保留',
          botId: null,
          baseUrl: '',
          botTokenSealed: Buffer.from('existing-cipher'),
          weiboAppIdSealed: null,
          weiboAppSecretSealed: null,
          now: clock.now(),
        }),
      );
    const before = (await store.bindingsOf(OWNER)).filter((row) => row.channel !== 'qq');
    await paired();
    const snapshot = binding;
    await channels.unbind(OWNER, 'qq');
    await runtime.reconcile();
    expect(await sessions.get(binding.id)).toBeNull();
    expect((await store.bindingById(binding.id))?.context_token_sealed).toBeNull();
    expect(await bridge.ingest(snapshot, input('迟到消息', 'MY-QQ-OPENID', snapshot))).toBe(
      'rejected',
    );
    expect((await store.bindingsOf(OWNER)).filter((row) => row.channel !== 'qq')).toEqual(before);
  });
  it('注销计数与物理删除涵盖QQ专属密文，不能留下孤立凭据', async () => {
    expect(await store.countUserData(OWNER)).toBeGreaterThanOrEqual(2);
    await store.purgeUser(OWNER);
    await runtime.reconcile();
    expect(await sessions.get(binding.id)).toBeNull();
    expect(await store.countUserData(OWNER)).toBe(0);
  });
});
