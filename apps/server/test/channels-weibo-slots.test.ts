import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import WebSocket, { WebSocketServer } from 'ws';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AuthResponse,
  WEIBO_SLOTS,
  WeiboBindingState,
  WeiboBindingsEndpoints as W,
  type WeiboSlotId,
  type Tx,
  type SendMessageRequest,
  type ChatAdminPort,
  type ChatParticipantPort,
  type Message,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  TestClock,
  type Database,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { Migrator } from '../src/platform/db/migrator.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../src/modules/identity/index.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_PARTICIPANT_PORT,
  CHAT_READ_PORT,
  CHAT_USER_PORT,
} from '../src/modules/chat/index.js';
import { ChatReadService, ChatUserService } from '../src/modules/chat/testing.js';
import {
  ChannelStore,
  ChannelBridge,
  ChannelsService,
  ChannelsWorker,
  WeiboRuntime,
  WEIBO_WS_FACTORY,
} from '../src/modules/channels/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase, TEST_DATABASE_URL, MIGRATIONS_DIR } from './support/db.js';

const CHARACTERS = Array.from(
  { length: 6 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const key = (slot: string, userId: string) => `synthetic-${slot}-${userId}`;
const syntheticSecret = () => randomBytes(24).toString('hex');

describeDb('微博五槽：隔离HTTP / PostgreSQL / DEK / WSS合成链路', () => {
  let app: INestApplication,
    db: Database,
    store: ChannelStore,
    channels: ChannelsService,
    bridge: ChannelBridge,
    runtime: WeiboRuntime,
    worker: ChannelsWorker,
    crypto: EnvelopeCrypto;
  let tokenServer: Server,
    tlsServer: ReturnType<typeof createHttpsServer>,
    websocket: WebSocketServer;
  let tls: { key: Buffer; cert: Buffer },
    sequence = 0;
  const sockets = new Map<string, WebSocket>();
  const frames = new Map<string, Array<Record<string, unknown>>>();
  const tokenCalls: string[] = [];
  const logs = captureLogger('silent');
  const clock = new TestClock('2026-11-09T04:00:00.000Z');
  const send = vi.fn(
    async (_userId: string, _conversationId: string, _body: SendMessageRequest, _tx?: Tx) => ({
      message: { messageId: newId() },
    }),
  );
  const findDefault = async (_userId: string, characterId: string, _tx?: Tx) => ({
    conversationId: characterId,
    contentScope: 'normal',
    lastSeq: 0,
  });
  const find = vi.fn(findDefault);
  const messageDefault = async (
    messageId: string,
    _scopes?: unknown,
    _tx?: Tx,
  ): Promise<Pick<Message, 'messageId' | 'conversationId' | 'seq' | 'content'>> => ({
    messageId,
    conversationId: CHARACTERS[0]!,
    seq: 1,
    content: { type: 'text', text: '本机合成回复' },
  });
  const readMessage = vi.fn(messageDefault);
  const http = () => request(app.getHttpServer());
  async function user() {
    const n = ++sequence;
    return AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', `10.97.0.${n}`)
          .send({
            username: `weiboslot_${n}`,
            password: randomBytes(24).toString('hex'),
            device: {
              platform: 'web',
              name: 'Synthetic Weibo slots',
              appVersion: '7.10',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(201)
      ).body,
    );
  }
  type User = Awaited<ReturnType<typeof user>>;
  const headers = (u: User) => ({ Authorization: `Bearer ${u.session.token}` });
  const connect = async (
    u: User,
    slot: WeiboSlotId,
    characterId: string,
    appId = key(slot, u.user.userId),
  ) =>
    WeiboBindingState.parse(
      (
        await http()
          .post(W.connect.path)
          .set(headers(u))
          .send({ slot, characterId, appId, appSecret: syntheticSecret() })
          .expect(200)
      ).body,
    );
  const list = async (u: User) =>
    (await http().get(W.list.path).set(headers(u)).expect(200)).body.items as WeiboBindingState[];
  const received = (
    socket: WebSocket,
    peer: string,
    messageId: string,
    text = '本机合成微博消息',
  ) =>
    socket.send(
      JSON.stringify({
        type: 'message',
        payload: { fromUserId: peer, messageId, text, timestamp: clock.nowMs() },
      }),
    );

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const githubFixture =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      url.hostname === '127.0.0.1' &&
      url.port === '5432' &&
      url.pathname === '/weiban_test' &&
      url.username === 'weiban';
    if (
      url.protocol !== 'postgres:' ||
      url.hostname !== '127.0.0.1' ||
      url.search ||
      url.hash ||
      (!githubFixture && (url.port !== '56389' || url.pathname !== '/codex_migration_weibo_1109'))
    )
      throw new Error('DEDICATED_WEIBO_FIXTURE_REQUIRED');
    if (!githubFixture) {
      const check = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await check.connect();
      try {
        const marked = await check.query('SELECT synthetic FROM public.codex_weibo_fixture');
        if (marked.rows.length !== 1 || marked.rows[0]?.synthetic !== true)
          throw new Error('SYNTHETIC_WEIBO_MARKER_REQUIRED');
      } finally {
        await check.end();
      }
    }
    await resetTestDatabase();
    const { createLocalTls } = createRequire(import.meta.url)(
      fileURLToPath(new URL('../../../scripts/ops/migration-distribution.mjs', import.meta.url)),
    ) as { createLocalTls(): Promise<{ key: Buffer; cert: Buffer }> };
    tls = await createLocalTls();
    tokenServer = createHttpServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += String(part);
      const input = JSON.parse(body) as { app_id: string };
      tokenCalls.push(input.app_id);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: {
            token: 'synthetic-ws-token',
            uid: 'same-synthetic-assistant-account',
            expire_in: 3600,
          },
        }),
      );
    });
    await new Promise<void>((resolve) => tokenServer.listen(0, '127.0.0.1', resolve));
    tlsServer = createHttpsServer(tls);
    websocket = new WebSocketServer({ server: tlsServer });
    websocket.on('connection', (socket, req) => {
      const appId = new URL(req.url!, 'https://127.0.0.1').searchParams.get('app_id')!;
      sockets.set(appId, socket);
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>;
        if (frame.type === 'ping') socket.send('{"type":"pong"}');
        else {
          const items = frames.get(appId) ?? [];
          items.push(frame);
          frames.set(appId, items);
        }
      });
    });
    await new Promise<void>((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
    const config = testConfig({
      APP_ROLE: 'web',
      HTTP_TRUST_PROXY: 'true',
      CHANNEL_WEIBO_ENABLED: '1',
      CHANNEL_WEIBO_PUBLIC_ACCESS: '1',
      CHANNEL_WEIBO_TOKEN_ENDPOINT: `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}/token`,
      CHANNEL_WEIBO_WS_ENDPOINT: `wss://127.0.0.1:${(tlsServer.address() as AddressInfo).port}/stream`,
    });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CONTACTS_READ_PORT)
      .useValue({
        listActiveContacts: async () =>
          CHARACTERS.map((characterId, index) => ({ characterId, remark: `合成角色${index + 1}` })),
      })
      .overrideProvider(IDENTITY_MEMBERSHIP_READ_PORT)
      .useValue({ isProPlus: async () => true })
      .overrideProvider(CHAT_READ_PORT)
      .useValue({
        findDirectConversation: find,
        getMessage: readMessage,
      })
      .overrideProvider(CHAT_USER_PORT)
      .useValue({ sendMessage: send })
      .overrideProvider(WEIBO_WS_FACTORY)
      .useValue((url: string) => {
        if (new URL(url).hostname !== '127.0.0.1') throw new Error('LOOPBACK_ONLY');
        return new WebSocket(url, { ca: tls.cert, rejectUnauthorized: true });
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(DATABASE);
    store = app.get(ChannelStore);
    channels = app.get(ChannelsService);
    bridge = app.get(ChannelBridge);
    runtime = app.get(WeiboRuntime);
    worker = app.get(ChannelsWorker);
    crypto = app.get(ENVELOPE_CRYPTO);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    if (websocket) {
      for (const socket of websocket.clients) socket.terminate();
      await new Promise<void>((resolve) => websocket.close(() => resolve()));
    }
    if (tlsServer) await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
    if (tokenServer) await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
    tls?.key.fill(0);
  });

  it('0165 retains existing single-binding ID, generation, ciphertext and reply peer', async () => {
    const u = await user(),
      id = newId();
    const activeUser = await user(),
      missingUser = await user();
    const activeId = newId(),
      missingId = newId();
    const conversation = await db.transaction((tx) =>
      app.get<ChatAdminPort>(CHAT_ADMIN_PORT).ensureDirectConversation(tx, {
        userId: activeUser.user.userId,
        characterId: CHARACTERS[0]!,
        restoreHistory: true,
      }),
    );
    await db.query('UPDATE chat.conversations SET last_seq=17 WHERE id=$1', [
      conversation.conversationId,
    ]);
    const migrator = new Migrator(TEST_DATABASE_URL!, MIGRATIONS_DIR);
    expect(await migrator.down(1)).toEqual(['0165_weibo_slots']);
    const secret = await crypto.seal(
      u.user.userId,
      `channels:binding:${id}:app_secret`,
      syntheticSecret(),
    );
    const peer = await crypto.seal(
      u.user.userId,
      `channels:binding:${id}:weibo_peer`,
      'synthetic-existing-peer',
    );
    await db.query(
      "INSERT INTO channels.bindings(id,user_id,channel,status,character_id,character_name,generation,weibo_app_secret_sealed,context_token_sealed,created_at,updated_at) VALUES($1,$2,'weibo','unbound',$3,'原绑定',7,$4,$5,now(),now())",
      [id, u.user.userId, CHARACTERS[0], secret, peer],
    );
    const previous = new Map<string, { secret: Buffer; peer: Buffer }>();
    for (const [oldId, owner] of [
      [activeId, activeUser],
      [missingId, missingUser],
    ] as const) {
      const ownSecret = await crypto.seal(
        owner.user.userId,
        `channels:binding:${oldId}:app_secret`,
        syntheticSecret(),
      );
      const ownPeer = await crypto.seal(
        owner.user.userId,
        `channels:binding:${oldId}:weibo_peer`,
        `synthetic-existing-${oldId}`,
      );
      previous.set(oldId, { secret: ownSecret, peer: ownPeer });
      await db.query(
        "INSERT INTO channels.bindings(id,user_id,channel,status,character_id,character_name,generation,weibo_app_secret_sealed,context_token_sealed,created_at,updated_at) VALUES($1,$2,'weibo','active',$3,'既有合成绑定',9,$4,$5,now(),now())",
        [oldId, owner.user.userId, CHARACTERS[0], ownSecret, ownPeer],
      );
    }
    expect(await migrator.up()).toEqual(['0165_weibo_slots']);
    const row = (await store.bindingById(id))!;
    expect(row.slot).toBe('main');
    expect(row.generation).toBe(7);
    expect(row.status).toBe('unbound');
    expect(row.weibo_app_secret_sealed?.equals(secret)).toBe(true);
    expect(row.context_token_sealed?.equals(peer)).toBe(true);
    const active = (await store.bindingById(activeId))!;
    expect(active.reply_conversation_id).toBe(conversation.conversationId);
    expect(Number(active.reply_after_seq)).toBe(17);
    expect(active.generation).toBe(9);
    expect(active.context_token_sealed?.equals(previous.get(activeId)!.peer)).toBe(true);
    const missing = (await store.bindingById(missingId))!;
    expect(missing.reply_after_seq).toBeNull();
    expect(missing.last_error).toContain('待核对微博回复会话');
    expect(missing.weibo_app_secret_sealed?.equals(previous.get(missingId)!.secret)).toBe(true);
  });

  it('one user can connect all five independent slots with stable IDs and distinct characters', async () => {
    const u = await user();
    const ids: string[] = [];
    for (const [index, slot] of WEIBO_SLOTS.entries())
      ids.push((await connect(u, slot.slot, CHARACTERS[index]!)).bindingId!);
    expect(new Set(ids).size).toBe(5);
    const states = await list(u);
    expect(states.map((item) => item.slot)).toEqual(WEIBO_SLOTS.map((item) => item.slot));
    expect(states.every((item) => item.status === 'active')).toBe(true);
    const rows = await store.bindingsOf(u.user.userId);
    expect(new Set(rows.map((row) => row.account_id)).size).toBe(5);
    expect(new Set(rows.map((row) => row.bot_id)).size).toBe(1);
    const before = (await store.weiboBindingAt(u.user.userId, 'blue'))!;
    const rebound = await connect(u, 'blue', CHARACTERS[1]!);
    expect(rebound.bindingId).toBe(before.id);
    expect((await store.weiboBindingAt(u.user.userId, 'main'))!.generation).toBe(1);
    expect(JSON.stringify(states)).not.toContain('appSecret');
    expect(states.every((item) => !('accountId' in item))).toBe(true);
    await runtime.reconcile();
    await vi.waitFor(
      () => {
        for (const metadata of WEIBO_SLOTS)
          expect(sockets.get(key(metadata.slot, u.user.userId))?.readyState).toBe(WebSocket.OPEN);
      },
      { timeout: 8000 },
    );
    await http()
      .post(W.connect.path)
      .set(headers(u))
      .send({
        slot: 'sixth',
        characterId: CHARACTERS[5],
        appId: 'synthetic-extra',
        appSecret: syntheticSecret(),
      })
      .expect(400);
  });

  it('same-user duplicate role or credential and cross-user credential use are conflicts without displacing the original', async () => {
    const a = await user(),
      b = await user();
    const main = await connect(a, 'main', CHARACTERS[0]!);
    const row = (await store.bindingById(main.bindingId!))!;
    await http()
      .post(W.connect.path)
      .set(headers(a))
      .send({
        slot: 'blue',
        characterId: CHARACTERS[0],
        appId: key('blue', a.user.userId),
        appSecret: syntheticSecret(),
      })
      .expect(409);
    await http()
      .post(W.connect.path)
      .set(headers(a))
      .send({
        slot: 'blue',
        characterId: CHARACTERS[1],
        appId: key('main', a.user.userId),
        appSecret: syntheticSecret(),
      })
      .expect(409);
    await http()
      .post(W.connect.path)
      .set(headers(b))
      .send({
        slot: 'main',
        characterId: CHARACTERS[0],
        appId: key('main', a.user.userId),
        appSecret: syntheticSecret(),
      })
      .expect(409);
    const retained = (await store.bindingById(main.bindingId!))!;
    expect(retained.generation).toBe(row.generation);
    expect(retained.weibo_app_secret_sealed?.equals(row.weibo_app_secret_sealed!)).toBe(true);
    expect(retained.status).toBe('active');
  });

  it('binding-ID authorization prevents foreign role changes and unbind; changing one slot preserves others', async () => {
    const a = await user(),
      b = await user();
    const main = await connect(a, 'main', CHARACTERS[0]!),
      blue = await connect(a, 'blue', CHARACTERS[1]!);
    await http()
      .patch(`${W.list.path}/${blue.bindingId}`)
      .set(headers(b))
      .send({ characterId: CHARACTERS[2] })
      .expect(404);
    await http().delete(`${W.list.path}/${blue.bindingId}`).set(headers(b)).expect(404);
    await http()
      .patch(`${W.list.path}/${blue.bindingId}`)
      .set(headers(a))
      .send({ characterId: CHARACTERS[0] })
      .expect(409);
    await http()
      .patch(`${W.list.path}/${blue.bindingId}`)
      .set(headers(a))
      .send({ characterId: CHARACTERS[2] })
      .expect(200);
    expect((await store.bindingById(blue.bindingId!))!.character_id).toBe(CHARACTERS[2]);
    expect((await store.bindingById(main.bindingId!))!.character_id).toBe(CHARACTERS[0]);
    await http().get(W.list.path).expect(401);
  });

  it('simultaneous HTTP connects serialize same-owner roles and cross-owner AppID without displacement', async () => {
    const a = await user(),
      b = await user();
    const post = (owner: User, slot: WeiboSlotId, characterId: string, appId: string) =>
      http()
        .post(W.connect.path)
        .set(headers(owner))
        .send({ slot, characterId, appId, appSecret: syntheticSecret() });
    const sameRole = await Promise.all([
      post(a, 'main', CHARACTERS[0]!, key('main', a.user.userId)),
      post(a, 'blue', CHARACTERS[0]!, key('blue', a.user.userId)),
    ]);
    expect(sameRole.map((response) => response.status).sort()).toEqual([200, 409]);
    const sharedApp = `synthetic-contested-${newId()}`;
    const sameApp = await Promise.all([
      post(a, 'white', CHARACTERS[1]!, sharedApp),
      post(b, 'white', CHARACTERS[1]!, sharedApp),
    ]);
    expect(sameApp.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = sameApp.find((response) => response.status === 200)!.body as WeiboBindingState;
    expect((await store.bindingById(winner.bindingId!))!.status).toBe('active');
  });

  it('old single-slot endpoints retain compatibility but all ambiguous multi-slot writes fail explicitly', async () => {
    const u = await user();
    const one = (
      await http()
        .post('/api/v1/channels/weibo/binding')
        .set(headers(u))
        .send({
          characterId: CHARACTERS[0],
          appId: key('main', u.user.userId),
          appSecret: syntheticSecret(),
        })
        .expect(200)
    ).body;
    expect(one.status).toBe('active');
    await http()
      .patch('/api/v1/channels/weibo/binding')
      .set(headers(u))
      .send({ characterId: CHARACTERS[1] })
      .expect(200);
    await connect(u, 'blue', CHARACTERS[2]!);
    const before = tokenCalls.length;
    await http()
      .post('/api/v1/channels/weibo/binding')
      .set(headers(u))
      .send({
        characterId: CHARACTERS[3],
        appId: key('white', u.user.userId),
        appSecret: syntheticSecret(),
      })
      .expect(409);
    expect(tokenCalls.length).toBe(before);
    await http()
      .patch('/api/v1/channels/weibo/binding')
      .set(headers(u))
      .send({ characterId: CHARACTERS[3] })
      .expect(409);
    await http().delete('/api/v1/channels/weibo/binding').set(headers(u)).expect(409);
    const summary = (
      await http().get('/api/v1/channels').set(headers(u)).expect(200)
    ).body.items.find((state: { channel: string }) => state.channel === 'weibo');
    expect(summary).toMatchObject({ multipleBindings: true, bindingCount: 2, characterId: null });
  });

  it('TLS WebSockets isolate two peers/roles, duplicate events, replies and reconnects per binding', async () => {
    const u = await user();
    const main = await connect(u, 'main', CHARACTERS[0]!),
      blue = await connect(u, 'blue', CHARACTERS[1]!);
    await runtime.reconcile();
    const mainApp = key('main', u.user.userId),
      blueApp = key('blue', u.user.userId);
    await vi.waitFor(
      () => {
        expect(sockets.has(mainApp)).toBe(true);
        expect(sockets.has(blueApp)).toBe(true);
      },
      { timeout: 8000 },
    );
    const sameEvent = newId();
    received(sockets.get(mainApp)!, 'thread-main-synthetic', sameEvent);
    received(sockets.get(blueApp)!, 'thread-blue-synthetic', sameEvent);
    await vi.waitFor(async () =>
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM channels.inbound_messages WHERE user_id=$1 AND outcome='accepted'",
            [u.user.userId],
          )
        ).rows[0]!.n,
      ).toBe(2),
    );
    expect(await channels.weiboReplyPeer((await store.bindingById(main.bindingId!))!)).toBe(
      'thread-main-synthetic',
    );
    expect(await channels.weiboReplyPeer((await store.bindingById(blue.bindingId!))!)).toBe(
      'thread-blue-synthetic',
    );
    received(sockets.get(mainApp)!, 'thread-main-synthetic', sameEvent);
    received(sockets.get(mainApp)!, 'foreign-synthetic-thread', newId());
    await vi.waitFor(async () =>
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM channels.inbound_messages WHERE user_id=$1 AND outcome='rejected'",
            [u.user.userId],
          )
        ).rows[0]!.n,
      ).toBe(1),
    );
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM channels.inbound_messages WHERE user_id=$1 AND outcome='accepted'",
          [u.user.userId],
        )
      ).rows[0]!.n,
    ).toBe(2);
    const messageId = newId();
    await db.transaction((tx) =>
      bridge.enqueueCharacterReply(tx, {
        conversationId: CHARACTERS[0]!,
        conversationType: 'direct',
        messageId,
        senderKind: 'character',
        senderRefId: CHARACTERS[0]!,
        contentType: 'text',
        scope: 'normal',
        userRecipientIds: [u.user.userId],
      }),
    );
    const out = (await store.claimOutbound(1000, clock.now())).find(
      (row) => row.chat_message_id === messageId,
    )!;
    await worker['deliverOne'](out);
    await vi.waitFor(() => expect(frames.get(mainApp)?.length).toBe(1));
    expect((frames.get(mainApp)![0]!.payload as { toUserId: string }).toUserId).toBe(
      'thread-main-synthetic',
    );
    expect(frames.get(blueApp)).toBeUndefined();
    const oldMain = sockets.get(mainApp)!,
      unchangedBlue = sockets.get(blueApp)!;
    oldMain.close(4002, 'synthetic expiry');
    await vi.waitFor(() => expect(sockets.get(mainApp)).not.toBe(oldMain), { timeout: 9000 });
    expect(sockets.get(blueApp)).toBe(unchangedBlue);
    expect(tokenCalls.filter((value) => value === mainApp).length).toBeGreaterThanOrEqual(3);
    expect(await channels.weiboReplyPeer((await store.bindingById(main.bindingId!))!)).toBe(
      'thread-main-synthetic',
    );
  });

  it('unbinding one slot skips only its queue, never revives unbound rows and rejects late old-generation events', async () => {
    const u = await user();
    const main = await connect(u, 'main', CHARACTERS[0]!),
      blue = await connect(u, 'blue', CHARACTERS[1]!);
    const old = (await store.bindingById(main.bindingId!))!,
      other = (await store.bindingById(blue.bindingId!))!;
    const mainOut = await db.transaction((tx) =>
      store.enqueueOutbound(tx, {
        bindingId: old.id,
        userId: u.user.userId,
        channel: 'weibo',
        chatMessageId: newId(),
        textSealed: Buffer.from('synthetic-placeholder'),
        now: clock.now(),
      }),
    );
    const blueOut = await db.transaction((tx) =>
      store.enqueueOutbound(tx, {
        bindingId: other.id,
        userId: u.user.userId,
        channel: 'weibo',
        chatMessageId: newId(),
        textSealed: Buffer.from('synthetic-placeholder'),
        now: clock.now(),
      }),
    );
    await http().delete(`${W.list.path}/${main.bindingId}`).set(headers(u)).expect(200);
    expect((await store.bindingById(old.id))!).toMatchObject({
      status: 'unbound',
      weibo_app_secret_sealed: null,
    });
    expect((await store.bindingById(other.id))!).toMatchObject({
      status: 'active',
      generation: other.generation,
    });
    expect(
      (await db.query('SELECT status FROM channels.outbound_messages WHERE id=$1', [mainOut]))
        .rows[0]!.status,
    ).toBe('skipped');
    expect(
      (await db.query('SELECT status FROM channels.outbound_messages WHERE id=$1', [blueOut]))
        .rows[0]!.status,
    ).toBe('pending');
    expect(
      await bridge.ingest(old, {
        externalId: newId(),
        senderId: 'old-peer',
        text: 'synthetic late event',
        contextToken: '',
        createdAt: clock.now(),
        weiboSession: { bindingId: old.id, generation: old.generation },
      }),
    ).toBe('rejected');
    await runtime.reconcile();
    expect((await store.bindingById(old.id))!.status).toBe('unbound');
    const rebound = await connect(u, 'main', CHARACTERS[0]!);
    expect(rebound.bindingId).toBe(old.id);
    expect((await store.bindingById(old.id))!.generation).toBeGreaterThan(old.generation);
    expect((await store.bindingById(old.id))!.context_token_sealed).toBeNull();
  });

  it('role switch invalidates in-flight inbound and claimed replies, preserves its peer/credentials and leaves other slots unchanged', async () => {
    const u = await user();
    const main = await connect(u, 'main', CHARACTERS[0]!);
    const blue = await connect(u, 'blue', CHARACTERS[1]!);
    const old = (await store.bindingById(main.bindingId!))!;
    const other = (await store.bindingById(blue.bindingId!))!;
    const input = {
      externalId: newId(),
      senderId: 'switch-synthetic-peer',
      text: '本机合成切换消息',
      contextToken: '',
      createdAt: clock.now(),
      weiboSession: { bindingId: old.id, generation: old.generation },
    };
    expect(await bridge.ingest(old, { ...input, externalId: newId() })).toBe('accepted');
    const pinned = (await store.bindingById(old.id))!;
    const queued: string[] = [];
    for (const binding of [pinned, other]) {
      const messageId = newId();
      const sealed = await crypto.seal(
        u.user.userId,
        `channels:outbound:${binding.id}:${messageId}:text`,
        '合成旧回复',
      );
      queued.push(
        (await db.transaction((tx) =>
          store.enqueueOutbound(tx, {
            bindingId: binding.id,
            userId: u.user.userId,
            channel: 'weibo',
            chatMessageId: messageId,
            textSealed: sealed,
            now: clock.now(),
          }),
        ))!,
      );
    }
    const claimed = (await store.claimOutbound(1000, clock.now())).find(
      (item) => item.id === queued[0],
    )!;
    let releaseInbound!: () => void;
    const inboundGate = new Promise<void>((resolve) => {
      releaseInbound = resolve;
    });
    let inboundReady!: () => void;
    const inboundWaiting = new Promise<void>((resolve) => {
      inboundReady = resolve;
    });
    const openOriginal = crypto.open.bind(crypto);
    const open = vi.spyOn(crypto, 'open').mockImplementation(async (...args) => {
      const value = await openOriginal(...args);
      if (args[1] === `channels:binding:${old.id}:weibo_peer`) {
        inboundReady();
        await inboundGate;
      }
      return value;
    });
    let releaseReply!: () => void;
    const replyGate = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    let replyReady!: () => void;
    const replyWaiting = new Promise<void>((resolve) => {
      replyReady = resolve;
    });
    const peer = vi.spyOn(channels, 'weiboReplyPeer').mockImplementationOnce(async () => {
      replyReady();
      await replyGate;
      return 'switch-synthetic-peer';
    });
    const outbound = vi.spyOn(runtime, 'send');
    const callsBefore = send.mock.calls.length;
    try {
      const ingest = bridge.ingest(old, input);
      await inboundWaiting;
      const delivery = worker['deliverOne'](claimed);
      await replyWaiting;
      await http()
        .patch(`${W.list.path}/${old.id}`)
        .set(headers(u))
        .send({ characterId: CHARACTERS[2] })
        .expect(200);
      releaseInbound();
      releaseReply();
      expect(await ingest).toBe('rejected');
      await delivery;
      expect(send.mock.calls.length).toBe(callsBefore);
      expect(outbound).not.toHaveBeenCalled();
      const current = (await store.bindingById(old.id))!;
      expect(current.generation).toBe(old.generation + 1);
      expect(current.character_id).toBe(CHARACTERS[2]);
      expect(current.context_token_sealed?.equals(pinned.context_token_sealed!)).toBe(true);
      expect(current.weibo_app_id_sealed?.equals(pinned.weibo_app_id_sealed!)).toBe(true);
      expect(current.weibo_app_secret_sealed?.equals(pinned.weibo_app_secret_sealed!)).toBe(true);
      expect((await store.bindingById(other.id))!).toEqual(other);
      const statuses = await db.query<{ id: string; status: string }>(
        'SELECT id,status FROM channels.outbound_messages WHERE id=ANY($1::uuid[])',
        [queued],
      );
      expect(statuses.rows.find((row) => row.id === queued[0])?.status).toBe('skipped');
      expect(statuses.rows.find((row) => row.id === queued[1])?.status).toBe('sending');
      expect(await store.withCurrentWeiboBinding(old, async () => true)).toBeNull();
    } finally {
      releaseInbound();
      releaseReply();
      open.mockRestore();
      peer.mockRestore();
      outbound.mockRestore();
    }
  });

  it('real chat text writer shares the binding transaction with only one available pool connection and persists one message without model calls', async () => {
    const u = await user();
    const state = await connect(u, 'main', CHARACTERS[0]!);
    const binding = (await store.bindingById(state.bindingId!))!;
    const chatAdmin = app.get<ChatAdminPort>(CHAT_ADMIN_PORT);
    const conversation = await db.transaction((tx) =>
      chatAdmin.ensureDirectConversation(tx, {
        userId: u.user.userId,
        characterId: CHARACTERS[0]!,
        restoreHistory: true,
      }),
    );
    find.mockResolvedValueOnce({
      conversationId: conversation.conversationId,
      contentScope: 'normal',
      lastSeq: conversation.lastSeq,
    });
    const realChat = app.get(ChatUserService);
    send.mockImplementationOnce((userId, conversationId, body, tx) =>
      realChat.sendMessage(userId, conversationId, body, tx),
    );
    // The realtime LISTEN client occupies one pool slot for the lifetime of the app.
    // Reserve all other slots except one after setup, then exercise the real text writer.
    const permanent = db.pool.totalCount - db.pool.idleCount;
    const reserve = (db.pool.options.max ?? 10) - permanent - 1;
    expect(reserve).toBeGreaterThan(0);
    const held = await Promise.all(Array.from({ length: reserve }, () => db.pool.connect()));
    try {
      expect(
        await bridge.ingest(binding, {
          externalId: newId(),
          senderId: 'pool-one-synthetic-peer',
          text: '单连接合成消息',
          contextToken: '',
          createdAt: clock.now(),
          weiboSession: { bindingId: binding.id, generation: binding.generation },
        }),
      ).toBe('accepted');
      expect(db.pool.totalCount - held.length - permanent).toBe(1);
      expect(
        (
          await db.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM chat.messages WHERE conversation_id=$1',
            [conversation.conversationId],
          )
        ).rows[0]!.n,
      ).toBe(1);
      expect(send.mock.calls.at(-1)?.[3]).toMatchObject({ __brand: 'weiban.tx' });
    } finally {
      held.forEach((client) => client.release());
    }
  });

  it('first delayed outbox consumption cannot reroute an already generated reply after moving its role or rebinding its peer', async () => {
    const u = await user();
    const admin = app.get<ChatAdminPort>(CHAT_ADMIN_PORT);
    const participant = app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT);
    const realRead = app.get(ChatReadService);
    const conversations = await Promise.all(
      CHARACTERS.slice(0, 3).map((characterId) =>
        db.transaction((tx) =>
          admin.ensureDirectConversation(tx, {
            userId: u.user.userId,
            characterId,
            restoreHistory: true,
          }),
        ),
      ),
    );
    const a = conversations[0]!;
    const sender = a.participants.find((item) => item.kind === 'character')!;
    const generate = async () => {
      const result = await participant.postMessage({
        conversationId: a.conversationId,
        senderParticipantId: sender.participantId,
        content: { type: 'text', text: '合成延迟角色回复' },
        idempotencyKey: `synthetic:${newId()}`,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    const consume = (message: Message) =>
      db.transaction((tx) =>
        bridge.enqueueCharacterReply(tx, {
          conversationId: a.conversationId,
          conversationType: 'direct',
          messageId: message.messageId,
          senderKind: 'character',
          senderRefId: CHARACTERS[0]!,
          contentType: 'text',
          scope: 'normal',
          userRecipientIds: [u.user.userId],
        }),
      );
    find.mockImplementation(async (owner, characterId, tx) => {
      const value = await realRead.findDirectConversation(owner, characterId, tx);
      if (!value) throw new Error('missing synthetic conversation');
      return value;
    });
    readMessage.mockImplementation(async (messageId, _scopes, tx) => {
      const value = await realRead.getMessage(messageId, ['normal'], tx);
      if (!value) throw new Error('missing synthetic message');
      return value;
    });
    try {
      const main = await connect(u, 'main', CHARACTERS[0]!);
      const blue = await connect(u, 'blue', CHARACTERS[1]!);
      const old = await generate();
      expect(old.seq).toBe(1);
      await http()
        .patch(`${W.list.path}/${main.bindingId}`)
        .set(headers(u))
        .send({ characterId: CHARACTERS[2] })
        .expect(200);
      await http()
        .patch(`${W.list.path}/${blue.bindingId}`)
        .set(headers(u))
        .send({ characterId: CHARACTERS[0] })
        .expect(200);
      const moved = (await store.bindingById(blue.bindingId!))!;
      expect(moved.reply_conversation_id).toBe(a.conversationId);
      expect(Number(moved.reply_after_seq)).toBe(old.seq);
      expect(await consume(old)).toBeNull();
      expect(
        (
          await db.query('SELECT id FROM channels.outbound_messages WHERE chat_message_id=$1', [
            old.messageId,
          ])
        ).rows,
      ).toHaveLength(0);
      const newReply = await generate();
      expect((await consume(newReply))?.bindingId).toBe(blue.bindingId);
      const beforeNewPeer = await generate();
      const rebound = await connect(u, 'blue', CHARACTERS[0]!, `synthetic-rebound-${newId()}`);
      expect(rebound.bindingId).toBe(blue.bindingId);
      expect(Number((await store.bindingById(blue.bindingId!))!.reply_after_seq)).toBe(
        beforeNewPeer.seq,
      );
      expect(await consume(beforeNewPeer)).toBeNull();
      expect(
        (
          await db.query('SELECT id FROM channels.outbound_messages WHERE chat_message_id=$1', [
            beforeNewPeer.messageId,
          ])
        ).rows,
      ).toHaveLength(0);
      expect((await consume(await generate()))?.bindingId).toBe(blue.bindingId);
    } finally {
      find.mockImplementation(findDefault);
      readMessage.mockImplementation(messageDefault);
    }
  });

  it('non-Weibo channels remain single-slot and rollback refuses to discard non-main history', async () => {
    const u = await user();
    await expect(
      db.query(
        "INSERT INTO channels.bindings(id,user_id,channel,slot,status,created_at,updated_at) VALUES($1,$2,'wechat','blue','unbound',now(),now())",
        [newId(), u.user.userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const migrator = new Migrator(TEST_DATABASE_URL!, MIGRATIONS_DIR);
    await expect(migrator.down(1)).rejects.toThrow('WEIBO_MULTI_SLOT_ROLLBACK_BLOCKED');
    expect(
      (await migrator.status()).find((entry) => entry.tag === '0165_weibo_slots')?.applied,
    ).toBe(true);
  });
});
