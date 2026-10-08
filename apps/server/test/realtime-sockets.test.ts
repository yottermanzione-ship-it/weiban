import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthResponse, ServerFrame, type SyncPort } from '@weiban/contracts';
import { createWorker } from '../src/main.js';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  EVENT_BUS,
  EVENT_INBOX,
  OUTBOX,
  TestClock,
  newId,
  type Database,
  type EventBus,
  type EventInbox,
  type Outbox,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { SYNC_PORT } from '../src/modules/realtime/index.js';
import {
  SocketServer,
  UpdateLogService,
  PresenceService,
} from '../src/modules/realtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

/** 消息从建立连接起立即收集，避免请求/订阅时序掩盖实际丢帧。 */
class SocketClient {
  readonly frames: ServerFrame[] = [];
  private wake: (() => void) | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.frames.push(ServerFrame.parse(JSON.parse(data.toString())));
      this.wake?.();
    });
  }
  async next<T extends ServerFrame['type']>(type: T): Promise<Extract<ServerFrame, { type: T }>> {
    while (true) {
      const index = this.frames.findIndex((f) => f.type === type);
      if (index >= 0) return this.frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
  send(type: string, data: unknown, ref?: string) {
    this.ws.send(JSON.stringify({ v: 1, type, data, ...(ref === undefined ? {} : { ref }) }));
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const done = once(this.ws, 'close');
    this.ws.close();
    await done;
  }
}

describeDb('realtime 真实 WS：鉴权、提交推送、替换、前台、超时和注销', () => {
  let app: INestApplication;
  let db: Database;
  let log: UpdateLogService;
  let sync: SyncPort;
  let sockets: SocketServer;
  let userId: string;
  let token: string;
  let secondToken: string;
  let endpoint: string;
  const clock = new TestClock('2026-10-06T12:00:00Z');
  const logs = captureLogger();
  const ring = testKekRing().ring;
  const clients: SocketClient[] = [];
  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: logs.logger,
          kekRing: ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    endpoint = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/ws`;
    db = app.get(DATABASE);
    log = app.get(UpdateLogService);
    sync = app.get(SYNC_PORT);
    sockets = app.get(SocketServer);
    userId = await app.get(IdentityCommands).createAdmin('socket_user', 'correct horse battery');
    await app.get(IdentityCommands).setRole('socket_user', 'user');
    async function login(name: string) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          username: 'socket_user',
          password: 'correct horse battery',
          kind: 'app',
          device: { platform: 'web', name, appVersion: '0.1.0', timeZone: 'Asia/Shanghai' },
        })
        .expect(200);
      return AuthResponse.parse(response.body).session.token;
    }
    token = await login('one');
    secondToken = await login('two');
  });
  afterAll(async () => {
    for (const c of clients) await c.close();
    await app?.close();
  });
  async function open() {
    const c = new SocketClient(new WebSocket(endpoint));
    clients.push(c);
    await once(c.ws, 'open');
    return c;
  }
  async function authenticate(c: SocketClient, credential = token) {
    c.send(
      'auth',
      {
        token: credential,
        contractVersion: '2.1',
        device: {
          platform: 'web',
          name: 'socket test',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
        lastUpdateSeq: 0,
      },
      'auth-ref',
    );
    const frame = await c.next('auth.ok');
    expect(frame.ref).toBe('auth-ref');
    return frame;
  }
  it('首帧必须鉴权；错误令牌、旧契约和鉴权10秒超时关闭', async () => {
    const first = await open();
    const closed = once(first.ws, 'close');
    first.send('ping', {});
    expect((await closed)[0]).toBe(4401);
    const invalid = await open();
    const invalidClosed = once(invalid.ws, 'close');
    invalid.send('auth', {
      token: 'sk-weiban-canary-invalid-session-00000000',
      contractVersion: '2.1',
      device: { platform: 'web', name: 'x', appVersion: '0', timeZone: 'UTC' },
      lastUpdateSeq: 0,
    });
    expect((await invalidClosed)[0]).toBe(4401);
    const old = await open();
    const oldClosed = once(old.ws, 'close');
    old.send('auth', {
      token,
      contractVersion: '1.9',
      device: { platform: 'web', name: 'x', appVersion: '0', timeZone: 'UTC' },
      lastUpdateSeq: 0,
    });
    expect((await oldClosed)[0]).toBe(4426);
    const idle = await open();
    const idleClosed = once(idle.ws, 'close');
    clock.advance(10000);
    await sockets.sweep();
    expect((await idleClosed)[0]).toBe(4401);
  });
  it('拒绝 URL令牌、跨站浏览器、二进制、未知及超大帧', async () => {
    for (const [url, origin] of [
      [`${endpoint}?token=sk-weiban-canary-url-token`, undefined],
      [endpoint, 'https://attacker.example'],
    ]) {
      const ws = new WebSocket(url!, origin ? { origin } : {});
      const status = await new Promise<number>((resolve, reject) => {
        ws.on('unexpected-response', (_request, response) => {
          response.resume();
          resolve(response.statusCode!);
          ws.terminate();
        });
        ws.on('error', reject);
      });
      expect(status).toBe(403);
    }
    const binary = await open();
    const binaryClosed = once(binary.ws, 'close');
    binary.ws.send(Buffer.from('secret'));
    expect((await binaryClosed)[0]).toBe(1003);
    const unknown = await open();
    const unknownClosed = once(unknown.ws, 'close');
    unknown.send('future', {});
    expect((await unknownClosed)[0]).toBe(1008);
    const large = await open();
    const largeClosed = once(large.ws, 'close');
    large.ws.send('x'.repeat(65537));
    expect((await largeClosed)[0]).toBe(1009);
    const fragmented = await open();
    const fragmentedClosed = once(fragmented.ws, 'close');
    fragmented.ws.send('x'.repeat(32768), { fin: false });
    fragmented.ws.send('x'.repeat(32769), { fin: true });
    expect((await fragmentedClosed)[0]).toBe(1009);
    const invalidText = await open();
    const invalidTextClosed = once(invalidText.ws, 'close');
    invalidText.ws.send(Buffer.from([0xc3, 0x28]), { binary: false });
    expect((await invalidTextClosed)[0]).toBe(1007);
  });
  it('同用户不同会话收到同一提交更新；回滚不推，补拉与帧内容相同', async () => {
    const one = await open();
    const two = await open();
    await authenticate(one);
    await authenticate(two, secondToken);
    const payload = {
      type: 'settings.updated' as const,
      data: { section: 'preferences' as const, characterId: null },
    };
    await expect(
      db.transaction(async (tx) => {
        await sync.appendUpdate(tx, userId, payload);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await log.getState(userId)).toEqual({ latestUpdateSeq: 0 });
    await db.transaction((tx) => sync.appendUpdate(tx, userId, payload));
    const [a, b] = await Promise.all([one.next('update'), two.next('update')]);
    expect(a.data).toEqual(b.data);
    expect(a.data.updateSeq).toBe(1);
    expect((await log.getUpdates(userId, { since: 0 })).items).toEqual([a.data]);
    one.send('ping', {}, 'ping-ref');
    expect((await one.next('pong')).ref).toBe('ping-ref');
    expect(one.frames.filter((x) => x.type === 'update')).toEqual([]);
    await one.close();
    await two.close();
  });
  it('同一会话重连替换旧连接，其清理不能删除新连接的前台状态', async () => {
    const old = await open();
    await authenticate(old);
    const closed = once(old.ws, 'close');
    const fresh = await open();
    await authenticate(fresh);
    expect((await closed)[0]).toBe(4409);
    const cid = newId();
    fresh.send('presence.focus', { conversationId: cid, foreground: true });
    fresh.send('ping', {});
    await fresh.next('pong');
    expect(await sync.isViewingConversation(userId, cid)).toBe(true);
    expect(await sync.getLastUserActivityAt(userId)).toBeNull();
    fresh.send('presence.focus', { conversationId: null, foreground: false });
    fresh.send('ping', {});
    await fresh.next('pong');
    expect(await sync.isViewingConversation(userId, cid)).toBe(false);
    await fresh.close();
  });
  it('typing跨数据库通知实时转发，不消耗更新序号；断线后鉴权报告补拉位置', async () => {
    const c = await open();
    await authenticate(c);
    const before = await log.getState(userId);
    const conversationId = newId();
    const participantId = newId();
    await sync.sendEphemeral(userId, {
      type: 'typing',
      conversationId,
      participantId,
      state: 'start',
    });
    expect((await c.next('typing')).data).toEqual({
      conversationId,
      participantId,
      state: 'start',
    });
    expect(await log.getState(userId)).toEqual(before);
    await c.close();
    await db.transaction((tx) =>
      sync.appendUpdate(tx, userId, { type: 'contact.removed', data: { characterId: newId() } }),
    );
    const next = await open();
    expect((await authenticate(next)).data.latestUpdateSeq).toBe(2);
    await next.close();
  });
  it('独立worker应用共享数据库即可向web连接发送更新、typing并读取前台状态', async () => {
    const worker = await createWorker({
      config: testConfig({ APP_ROLE: 'worker' }),
      clock,
      logger: logs.logger,
      kekRing: ring,
      background: false,
    });
    const c = await open();
    await authenticate(c);
    try {
      const port = worker.get<SyncPort>(SYNC_PORT);
      const workerDb = worker.get<Database>(DATABASE);
      const cid = newId();
      c.send('presence.focus', { conversationId: cid, foreground: true });
      c.send('ping', {});
      await c.next('pong');
      expect(await port.isViewingConversation(userId, cid)).toBe(true);
      const seq = await workerDb.transaction((tx) =>
        port.appendUpdate(tx, userId, {
          type: 'settings.updated',
          data: { section: 'profile', characterId: null },
        }),
      );
      expect((await c.next('update')).data.updateSeq).toBe(seq);
      await port.sendEphemeral(userId, {
        type: 'typing',
        conversationId: cid,
        participantId: newId(),
        state: 'stop',
      });
      expect((await c.next('typing')).data.state).toBe('stop');
    } finally {
      await c.close();
      await worker.close();
    }
  });
  it('用户发消息事件才记录聊天活跃时间；重复与迟到事件保持幂等和时间不倒退', async () => {
    const bus = app.get<EventBus>(EVENT_BUS);
    const inbox = app.get<EventInbox>(EVENT_INBOX);
    const outbox = app.get<Outbox>(OUTBOX);
    const publish = () =>
      db.transaction((tx) =>
        outbox.publish(tx, 'chat.message_created', 'chat', {
          conversationId: newId(),
          conversationType: 'direct',
          messageId: newId(),
          seq: 1,
          senderParticipantId: newId(),
          senderKind: 'user',
          senderRefId: userId,
          contentType: 'text',
          scope: 'normal',
          quoteMessageId: null,
          mentionedParticipantIds: [],
          userRecipientIds: [userId],
        }),
      );
    const newer = await publish();
    clock.advance(-1000);
    const older = await publish();
    clock.advance(1000);
    for (const event of [newer, older, newer])
      for (const subscriber of bus.subscribersOf(event.type))
        await inbox.processOnce(subscriber.consumer, event.eventId, (tx) =>
          subscriber.handle(event, tx),
        );
    expect(await sync.getLastUserActivityAt(userId)).toBe(newer.occurredAt);
  });
  it('45秒没有客户端心跳后关闭，不继续抑制推送', async () => {
    const c = await open();
    await authenticate(c);
    const cid = newId();
    c.send('presence.focus', { conversationId: cid, foreground: true });
    c.send('ping', {});
    await c.next('pong');
    const closed = once(c.ws, 'close');
    clock.advance(45000);
    await sockets.sweep();
    expect((await closed)[0]).toBe(1001);
    expect(await sync.isViewingConversation(userId, cid)).toBe(false);
  });
  it('会话作废立即在下一帧拒绝；注销清除数据，迟到设置事件不能复活', async () => {
    const c = await open();
    await authenticate(c, secondToken);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(204);
    const closed = once(c.ws, 'close');
    c.send('ping', {});
    expect((await closed)[0]).toBe(4401);
    await request(app.getHttpServer())
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'correct horse battery', confirm: 'DELETE' })
      .expect(202);
    await log.purgeUser(userId);
    expect(await log.countUserData(userId)).toBe(0);
    const bus = app.get<EventBus>(EVENT_BUS);
    const inbox = app.get<EventInbox>(EVENT_INBOX);
    const outbox = app.get<Outbox>(OUTBOX);
    const event = await db.transaction((tx) =>
      outbox.publish(tx, 'identity.preferences_updated', 'identity', { userId }),
    );
    for (const subscriber of bus.subscribersOf(event.type))
      await inbox.processOnce(subscriber.consumer, event.eventId, (tx) =>
        subscriber.handle(event, tx),
      );
    expect(await log.countUserData(userId)).toBe(0);
    await expect(
      db.transaction((tx) =>
        sync.appendUpdate(tx, userId, {
          type: 'settings.updated',
          data: { section: 'preferences', characterId: null },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(logs.capture.text).not.toContain(token);
    expect(logs.capture.text).not.toContain(secondToken);
    expect(await app.get(PresenceService).getLastUserActivityAt(userId)).toBeNull();
  });
});
