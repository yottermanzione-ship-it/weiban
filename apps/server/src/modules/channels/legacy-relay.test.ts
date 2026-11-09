import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { LegacyRelayService, type LegacyBindingRow } from './application/legacy-relay.service.js';
import {
  LegacyEnvelope,
  LegacyRequest,
  legacyMessageId,
  legacySignature,
  validLegacySignature,
} from './domain/legacy-relay-protocol.js';
import { loadConfig } from '../../platform/config/config.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const CHARACTER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const BINDING = '44444444-4444-4444-8444-444444444444';
const CHARACTER_PARTICIPANT = '55555555-5555-4555-8555-555555555555';
const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-09T12:30:00.000Z');
const PEER = 'a'.repeat(64);

function signed(payload: unknown, id = BINDING) {
  const envelope = {
    sentAt: NOW.getTime(),
    nonce: '66666666-6666-4666-8666-666666666666',
    payload: JSON.stringify(payload),
  };
  return { ...envelope, signature: legacySignature(KEY, id, envelope) };
}

function fixture() {
  const binding: LegacyBindingRow = {
    id: BINDING,
    channel: 'wechat',
    legacy_binding_id: OWNER,
    generation: 3,
    user_id: OWNER,
    character_id: CHARACTER,
    conversation_id: CONVERSATION,
    peer_hash: PEER,
    persona_hash: 'b'.repeat(64),
    auth_key_sealed: Buffer.from('auth'),
    enabled: true,
    after_seq: '10',
    offered_seq: '10',
    cutover_at: new Date('2026-11-09T12:00:00.000Z'),
  };
  const receipts = new Map<
    string,
    { text_sealed: Buffer; outcome: string; chat_message_id: string | null }
  >();
  let native = false;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT * FROM channels.legacy_bindings'))
      return { rows: [binding], rowCount: 1 };
    if (sql.startsWith('SELECT 1 FROM channels.legacy_bindings'))
      return { rows: binding.enabled ? [{}] : [], rowCount: binding.enabled ? 1 : 0 };
    if (sql.startsWith('SELECT 1 FROM channels.bindings'))
      return { rows: native ? [{}] : [], rowCount: native ? 1 : 0 };
    if (sql.includes('INSERT INTO channels.inbound_messages')) {
      const id = String(values[0]);
      if (!receipts.has(id))
        receipts.set(id, {
          text_sealed: values[6] as Buffer,
          outcome: 'pending',
          chat_message_id: null,
        });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT text_sealed'))
      return { rows: [receipts.get(String(values[0]))], rowCount: 1 };
    if (sql.startsWith('UPDATE channels.inbound_messages')) {
      const row = receipts.get(String(values[0]))!;
      row.outcome = 'accepted';
      row.chat_message_id = String(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SET offered_seq')) {
      binding.offered_seq = String(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SET after_seq')) {
      if (Number(values[2]) > Number(binding.offered_seq)) return { rows: [], rowCount: 0 };
      binding.after_seq = String(Math.max(Number(binding.after_seq), Number(values[2])));
      return { rows: [], rowCount: 1 };
    }
    throw new Error('UNEXPECTED_SQL');
  });
  const conversation = {
    conversationId: CONVERSATION,
    type: 'direct',
    contentScope: 'normal',
    participants: [
      { kind: 'user', refId: OWNER, participantId: OWNER },
      { kind: 'character', refId: CHARACTER, participantId: CHARACTER_PARTICIPANT },
    ],
  };
  const read = {
    findDirectConversation: vi.fn(async () => conversation),
    readMessages: vi.fn(async () => [] as unknown[]),
  };
  const send = vi.fn(async () => ({
    message: { messageId: '77777777-7777-4777-8777-777777777777' },
  }));
  const accounts = {
    getAccountStatus: vi.fn(async () => 'active'),
    isBanned: vi.fn(async () => false),
  };
  const contacts = { getActiveContact: vi.fn(async () => ({})) };
  const service = new LegacyRelayService(
    { query } as never,
    {
      open: vi.fn(async (_owner: string, aad: string, bytes: Buffer) =>
        aad.endsWith(':auth') ? Buffer.from(KEY) : Buffer.from(bytes),
      ),
      seal: vi.fn(async (_owner: string, _aad: string, text: string) => Buffer.from(text)),
    } as never,
    { now: () => NOW } as never,
    loadConfig({
      DATABASE_URL: 'postgres://unused',
      CHANNEL_WECHAT_ENABLED: '1',
      CHANNEL_WECHAT_PUBLIC_ACCESS: '1',
    }),
    read as never,
    { sendMessage: send } as never,
    contacts as never,
    accounts as never,
    { isProPlus: vi.fn(async () => false) } as never,
  );
  return {
    service,
    binding,
    receipts,
    query,
    conversation,
    read,
    send,
    accounts,
    contacts,
    setNative: () => {
      native = true;
    },
  };
}

const incoming = {
  op: 'ingest',
  generation: 3,
  externalId: 'provider-message-1',
  peerHash: PEER,
  text: 'synthetic ordinary message',
  createdAt: NOW.toISOString(),
};

describe('legacy channel fixed mapping and one billing path', () => {
  it('binds signatures to mapping, bytes and short timestamp; rejects caller identity/destination fields', () => {
    const envelope = LegacyEnvelope.parse(signed(incoming));
    expect(validLegacySignature(KEY, BINDING, envelope, NOW.getTime())).toBe(true);
    expect(validLegacySignature(KEY, OWNER, envelope, NOW.getTime())).toBe(false);
    expect(
      validLegacySignature(
        KEY,
        BINDING,
        { ...envelope, payload: envelope.payload + ' ' },
        NOW.getTime(),
      ),
    ).toBe(false);
    expect(validLegacySignature(KEY, BINDING, envelope, NOW.getTime() + 60_001)).toBe(false);
    expect(LegacyRequest.safeParse({ ...incoming, userId: OWNER }).success).toBe(false);
    expect(LegacyRequest.safeParse({ op: 'poll', generation: 3, peer: 'other' }).success).toBe(
      false,
    );
  });

  it('replay returns the existing receipt and never calls chat twice', async () => {
    const f = fixture();
    await f.service.handle(BINDING, signed(incoming));
    await f.service.handle(BINDING, signed(incoming));
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith(OWNER, CONVERSATION, {
      clientMsgId: legacyMessageId(BINDING, incoming.externalId),
      content: { type: 'text', text: incoming.text },
    });
    await expect(
      f.service.handle(BINDING, signed({ ...incoming, text: 'changed replay' })),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('timeout retries exactly the same chat idempotency key instead of the old generator', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error('simulated response loss'));
    await expect(f.service.handle(BINDING, signed(incoming))).rejects.toThrow(
      'simulated response loss',
    );
    await f.service.handle(BINDING, signed(incoming));
    expect(f.send.mock.calls[0]).toEqual(f.send.mock.calls[1]);
  });

  it.each(['peer', 'generation', 'disabled', 'native', 'scope', 'owner', 'deleted'] as const)(
    'rejects %s changes before chat or billing',
    async (kind) => {
      const f = fixture();
      const payload = { ...incoming };
      if (kind === 'peer') payload.peerHash = 'c'.repeat(64);
      if (kind === 'generation') payload.generation = 4;
      if (kind === 'disabled') f.binding.enabled = false;
      if (kind === 'native') f.setNative();
      if (kind === 'scope') f.conversation.contentScope = 'adult';
      if (kind === 'owner') f.conversation.participants[0]!.refId = CHARACTER;
      if (kind === 'deleted') f.accounts.getAccountStatus.mockResolvedValue('deleting');
      await expect(f.service.handle(BINDING, signed(payload))).rejects.toBeDefined();
      expect(f.send).not.toHaveBeenCalled();
    },
  );

  it('only offers normal text by the exact mapped character and acknowledges an offered range', async () => {
    const f = fixture();
    const message = {
      messageId: '77777777-7777-4777-8777-777777777777',
      seq: 11,
      senderKind: 'character',
      senderParticipantId: CHARACTER_PARTICIPANT,
      status: 'normal',
      scope: 'normal',
      content: { type: 'text', text: 'safe synthetic reply' },
      createdAt: NOW.toISOString(),
    };
    f.read.readMessages.mockResolvedValue([
      message,
      { ...message, seq: 12, scope: 'adult' },
      { ...message, seq: 13, senderKind: 'user' },
      { ...message, seq: 14, labels: ['health'] },
      { ...message, seq: 15, status: 'recalled' },
      { ...message, seq: 16, senderParticipantId: OWNER },
    ]);
    const result = (await f.service.handle(BINDING, signed({ op: 'poll', generation: 3 }))) as {
      messages: unknown[];
      throughSeq: number;
    };
    expect(result.messages).toHaveLength(1);
    expect(result.throughSeq).toBe(16);
    expect(f.read.readMessages).toHaveBeenCalledWith({
      conversationId: CONVERSATION,
      scopes: ['normal'],
      afterSeq: 10,
      limit: 50,
    });
    await expect(
      f.service.handle(BINDING, signed({ op: 'ack', generation: 3, throughSeq: 17 })),
    ).rejects.toMatchObject({ code: 'conflict' });
    await f.service.handle(BINDING, signed({ op: 'ack', generation: 3, throughSeq: 16 }));
    expect(f.binding.after_seq).toBe('16');
  });
});
