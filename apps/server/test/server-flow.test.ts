import 'reflect-metadata';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AdminCharacter,
  AuthResponse,
  Contact,
  ContactsEndpoints,
  Conversation,
  MessageAck,
  MessagePage,
  ServerFrame,
  SyncEndpoints,
  Wallet,
  BillingEndpoints,
  CONTRACT_VERSION,
} from '@weiban/contracts';
import {
  DATABASE,
  newId,
  P30_CONTACT_ACCEPT_DELAY,
  P01_REPLY_DELAY,
  type Database,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import {
  FLOW_DEVICE,
  FLOW_GREETING,
  FLOW_INPUT,
  FLOW_KEY,
  FLOW_MODEL,
  FLOW_REPLY,
  startFlowApp,
} from './support/server-flow-fixture.js';

describeDb('T041真实启动：注册→延迟接受→HTTP上游→计费/消息/WS补拉', () => {
  let fixture: Awaited<ReturnType<typeof startFlowApp>>;
  let socket: WebSocket | undefined;
  let db: Database;
  const frames: ServerFrame[] = [];
  const http = () => request(fixture.app.getHttpServer());
  beforeAll(async () => {
    await resetTestDatabase();
    fixture = await startFlowApp();
    db = fixture.app.get(DATABASE);
  });
  afterAll(async () => {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }
    await fixture?.app.close();
    await fixture?.upstream.close();
  });

  async function publishThroughWorker() {
    const path = `/api/v1/admin/characters/${fixture.character.characterId}/publish`;
    await http().post(path).set('Authorization', `Bearer ${fixture.adminToken}`).expect(422);
    await vi.waitFor(
      async () => {
        const list = await http()
          .get('/api/v1/admin/characters')
          .set('Authorization', `Bearer ${fixture.adminToken}`)
          .expect(200);
        const role = (list.body.items as unknown[])
          .map((item) => AdminCharacter.parse(item))
          .find((item) => item.characterId === fixture.character.characterId);
        expect(role?.publishChecks.personaStabilityPassed).toBe(true);
        expect(role?.publishChecks.hardBoundaryCasesPassed).toBe(true);
      },
      { timeout: 15_000, interval: 200 },
    );
    await http().post(path).set('Authorization', `Bearer ${fixture.adminToken}`).expect(200);
    expect(fixture.upstream.calls).toHaveLength(7);
  }
  async function openSocket(token: string) {
    const port = (fixture.app.getHttpServer().address() as AddressInfo).port;
    socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`);
    socket.on('message', (data) => frames.push(ServerFrame.parse(JSON.parse(data.toString()))));
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'auth',
        data: {
          token,
          contractVersion: CONTRACT_VERSION,
          device: FLOW_DEVICE,
          lastUpdateSeq: 0,
        },
      }),
    );
    await vi.waitFor(() => expect(frames.some((f) => f.type === 'auth.ok')).toBe(true), {
      timeout: 5000,
    });
  }
  async function messages(token: string, cid: string) {
    return MessagePage.parse(
      (
        await http()
          .get(`/api/v1/conversations/${cid}/messages`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    ).items;
  }
  async function waitCharacterText(token: string, cid: string, text: string) {
    let result: Awaited<ReturnType<typeof messages>>[number] | undefined;
    await vi.waitFor(
      async () => {
        result = (await messages(token, cid)).find(
          (m) =>
            m.senderKind === 'character' && m.content?.type === 'text' && m.content.text === text,
        );
        expect(result).toBeDefined();
      },
      { timeout: P01_REPLY_DELAY.firstBubbleDeadlineMs + 5000, interval: 200 },
    );
    return result!;
  }

  it('实际3～30秒通过，首回复通过真实网关扣费；重复ACK不重复回复，WS与补拉一致', async () => {
    await publishThroughWorker();
    const initialCalls = fixture.upstream.calls.length;
    const bonusMicros = 1_000_000;
    const invite = await fixture.app.get(IdentityCommands).createInvite(null, bonusMicros);
    const registered = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/register')
          .send({
            username: 'flow_new_user',
            password: 'correct horse battery',
            inviteCode: invite.code,
            device: FLOW_DEVICE,
          })
          .expect(201)
      ).body,
    );
    const auth = `Bearer ${registered.session.token}`;
    expect(registered.user.role).toBe('user');
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', auth)
      .send({ nickname: '第一天' })
      .expect(200);
    expect(
      Wallet.parse(
        (await http().get('/api/v1/billing/wallet').set('Authorization', auth).expect(200)).body,
      ).balanceMicros,
    ).toBe(bonusMicros);
    await openSocket(registered.session.token);
    const characterId = fixture.character.characterId;
    const requestedAt = Date.now();
    const pending = Contact.parse(
      (
        await http()
          .post('/api/v1/contacts')
          .set('Authorization', auth)
          .send({ characterId, greeting: '你好，这是我的好友招呼' })
          .expect(200)
      ).body,
    );
    expect(pending.status).toBe('pending');
    expect(pending.conversationId).toBeNull();
    expect(
      (await http().get('/api/v1/conversations').set('Authorization', auth).expect(200)).body.items,
    ).toEqual([]);
    await vi.waitFor(() =>
      expect(
        frames.some(
          (f) =>
            f.type === 'update' &&
            f.data.type === 'contact.upserted' &&
            f.data.data.contact.status === 'pending',
        ),
      ).toBe(true),
    );
    let active: Contact | undefined;
    await vi.waitFor(
      async () => {
        const list = ContactsEndpoints.list.response.parse(
          (await http().get('/api/v1/contacts').set('Authorization', auth).expect(200)).body,
        );
        active = list.items.find((c) => c.characterId === characterId && c.status === 'active');
        expect(active?.conversationId).toBeTruthy();
      },
      { timeout: P30_CONTACT_ACCEPT_DELAY.maxMs, interval: 100 },
    );
    expect(Date.now() - requestedAt).toBeGreaterThanOrEqual(P30_CONTACT_ACCEPT_DELAY.minMs);
    expect(Date.now() - requestedAt).toBeLessThanOrEqual(P30_CONTACT_ACCEPT_DELAY.maxMs);
    const cid = active!.conversationId!;
    const conversation = Conversation.parse(
      (await http().get(`/api/v1/conversations/${cid}`).set('Authorization', auth).expect(200))
        .body,
    );
    expect(conversation.type).toBe('direct');
    expect(conversation.participants.map((p) => [p.kind, p.refId])).toEqual(
      expect.arrayContaining([
        ['user', registered.user.userId],
        ['character', characterId],
      ]),
    );
    await vi.waitFor(() =>
      expect(
        frames.some(
          (f) =>
            f.type === 'update' &&
            f.data.type === 'contact.upserted' &&
            f.data.data.contact.conversationId === cid &&
            f.data.data.contact.status === 'active',
        ),
      ).toBe(true),
    );
    const greeting = await waitCharacterText(registered.session.token, cid, FLOW_GREETING);
    await http()
      .patch(`/api/v1/characters/${characterId}/companion-settings`)
      .set('Authorization', auth)
      .send({ instantReply: true, splitBubbles: false })
      .expect(200);
    const body = { clientMsgId: newId(), content: { type: 'text', text: FLOW_INPUT } };
    const sentAt = Date.now();
    const ack = MessageAck.parse(
      (
        await http()
          .post(`/api/v1/conversations/${cid}/messages`)
          .set('Authorization', auth)
          .send(body)
          .expect(200)
      ).body,
    );
    const duplicate = MessageAck.parse(
      (
        await http()
          .post(`/api/v1/conversations/${cid}/messages`)
          .set('Authorization', auth)
          .send(body)
          .expect(200)
      ).body,
    );
    expect(duplicate).toEqual(ack);
    const reply = await waitCharacterText(registered.session.token, cid, FLOW_REPLY);
    const afterReplyRetry = MessageAck.parse(
      (
        await http()
          .post(`/api/v1/conversations/${cid}/messages`)
          .set('Authorization', auth)
          .send(body)
          .expect(200)
      ).body,
    );
    expect(afterReplyRetry).toEqual(ack);
    expect(Date.now() - sentAt).toBeLessThanOrEqual(P01_REPLY_DELAY.firstBubbleDeadlineMs);
    expect(reply.seq).toBeGreaterThan(ack.message.seq);
    expect(greeting.seq).toBeLessThan(ack.message.seq);
    await verifyDeliveryAndBilling(registered, cid, ack, reply.messageId, bonusMicros);
    expect(fixture.upstream.calls).toHaveLength(initialCalls + 2);
    expect(
      fixture.upstream.calls.every(
        (call) => call.authorization === `Bearer ${FLOW_KEY}` && call.body.model === 'flow-http',
      ),
    ).toBe(true);
    expect(fixture.logs.capture.text).not.toContain(FLOW_KEY);
    expect(fixture.logs.capture.text).not.toContain(FLOW_INPUT);
    expect(fixture.logs.capture.text).not.toContain(FLOW_REPLY);
  }, 120_000);

  async function verifyDeliveryAndBilling(
    registered: AuthResponse,
    cid: string,
    ack: MessageAck,
    replyId: string,
    bonusMicros: number,
  ) {
    const auth = `Bearer ${registered.session.token}`;
    await vi.waitFor(
      () =>
        expect(
          frames.some(
            (f) =>
              f.type === 'update' &&
              f.data.type === 'message.created' &&
              f.data.data.message.messageId === replyId,
          ),
        ).toBe(true),
      { timeout: 5000 },
    );
    const sync = SyncEndpoints.getUpdates.response.parse(
      (await http().get('/api/v1/sync/updates?since=0').set('Authorization', auth).expect(200))
        .body,
    );
    expect(sync.hasMore).toBe(false);
    expect(
      sync.items.filter((u) => u.type === 'message.created').map((u) => u.data.message.messageId),
    ).toContain(replyId);
    const page = await messages(registered.session.token, cid);
    expect(page.filter((m) => m.clientMsgId === ack.clientMsgId)).toHaveLength(1);
    expect(page.filter((m) => m.senderKind === 'character')).toHaveLength(2);
    await vi.waitFor(async () => {
      const rows = await db.query<{
        charged_micros: string;
        model_key: string;
        status: string;
        purpose: string;
      }>(
        'SELECT charged_micros,model_key,status,purpose FROM model_access.usage_records WHERE user_id=$1',
        [registered.user.userId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(
        rows.rows.every(
          (r) =>
            r.status === 'succeeded' &&
            r.model_key === FLOW_MODEL &&
            Number(r.charged_micros) === 360 &&
            r.purpose === 'chat_reply',
        ),
      ).toBe(true);
    });
    const ledger = BillingEndpoints.listLedger.response.parse(
      (await http().get('/api/v1/billing/ledger').set('Authorization', auth).expect(200)).body,
    );
    const charges = ledger.items.filter((e) => e.type === 'charge');
    expect(charges).toHaveLength(2);
    expect(
      charges.every(
        (e) =>
          e.characterId === fixture.character.characterId &&
          e.modelKey === FLOW_MODEL &&
          e.category === 'chat' &&
          e.amountMicros === -360,
      ),
    ).toBe(true);
    const wallet = Wallet.parse(
      (await http().get('/api/v1/billing/wallet').set('Authorization', auth).expect(200)).body,
    );
    expect(wallet.balanceMicros).toBe(bonusMicros - 720);
    expect(wallet.heldMicros).toBe(0);
    await vi.waitFor(async () => {
      const plans = await db.query<{ kind: string; status: string }>(
        'SELECT kind,status FROM ai_runtime.reply_plans WHERE conversation_id=$1',
        [cid],
      );
      expect(plans.rows).toHaveLength(2);
      expect(plans.rows.every((plan) => plan.status === 'done')).toBe(true);
      expect(plans.rows.map((plan) => plan.kind).sort()).toEqual(['greeting', 'message']);
    });
  }
});
