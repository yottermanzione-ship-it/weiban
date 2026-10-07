/** 跨端本地同步状态：协议一致性JSON向量的共享准绳；不含会话令牌。 */
import { z } from 'zod';
import { Id } from './common.js';
import { Message, Conversation, SendMessageRequest, MessagePageCoverage } from './http/chat.js';
import { Contact } from './http/contacts.js';
import { UserUpdate, SyncEndpoints } from './http/sync.js';
import { ModelStatus } from './http/model-access.js';
import { MessageAck, MessagePage } from './http/chat.js';
export const ClientPendingSend = z.object({
  conversationId: Id,
  body: SendMessageRequest,
  state: z.enum(['pending', 'sending', 'failed']),
  failures: z.number().int().nonnegative(),
  retryAt: z.number().int().nonnegative(),
});
export type ClientPendingSend = z.infer<typeof ClientPendingSend>;
export const ClientSyncState = z.object({
  initialized: z.boolean(),
  lastUpdateSeq: z.number().int().nonnegative(),
  messages: z.array(Message),
  recalled: z.array(z.object({ messageId: Id, recalledAt: Message.shape.recalledAt.unwrap() })),
  conversations: z.array(Conversation),
  contacts: z.array(Contact),
  outbox: z.array(ClientPendingSend),
  excluded: z.array(
    z.object({ conversationId: Id, range: MessagePageCoverage.shape.excludedRanges.element }),
  ),
  scannedThrough: z.record(Id, z.number().int().nonnegative()),
  pendingUpdates: z.array(UserUpdate),
  settings: z.record(z.string(), z.json()),
});
export type ClientSyncState = z.infer<typeof ClientSyncState>;
export const emptyClientSyncState = (): ClientSyncState => ({
  initialized: false,
  lastUpdateSeq: 0,
  messages: [],
  recalled: [],
  conversations: [],
  contacts: [],
  outbox: [],
  excluded: [],
  scannedThrough: {},
  pendingUpdates: [],
  settings: {},
});
export const ClientFullSyncSnapshot = z.object({
  conversations: z.array(Conversation),
  messages: z.array(Message),
  contacts: z.array(Contact),
  settings: z.record(z.string(), z.json()),
  coverages: z.array(z.object({ conversationId: Id, coverage: MessagePageCoverage })),
});
export type ClientFullSyncSnapshot = z.infer<typeof ClientFullSyncSnapshot>;

/** 输入事件JSON也用于Kotlin/JUnit；网络驱动必须校验账号/请求归属后投递。 */
const millis = z.number().int().nonnegative();
const seq = z.number().int().nonnegative();
export const ClientSyncOperation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offline') }),
  z.object({ type: z.literal('reconnect'), latestUpdateSeq: seq, now: millis }),
  z.object({
    type: z.literal('enqueue'),
    conversationId: Id,
    body: SendMessageRequest,
    now: millis,
  }),
  z.object({ type: z.literal('ack'), ack: MessageAck, now: millis }),
  z.object({
    type: z.literal('send.failed'),
    conversationId: Id,
    clientMsgId: Id,
    httpStatus: z.number().int().min(400).max(599).nullable(),
    now: millis,
  }),
  z.object({ type: z.literal('retry'), conversationId: Id, clientMsgId: Id, now: millis }),
  z.object({ type: z.literal('tick'), now: millis }),
  z.object({ type: z.literal('update'), update: UserUpdate }),
  z.object({
    type: z.literal('updates.page'),
    page: SyncEndpoints.getUpdates.response,
    now: millis,
  }),
  z.object({ type: z.literal('cursor.expired') }),
  z.object({ type: z.literal('rebuild.state'), latestUpdateSeq: seq }),
  z.object({ type: z.literal('snapshot'), startSeq: seq, snapshot: ClientFullSyncSnapshot }),
  z.object({ type: z.literal('inspect'), conversationId: Id }),
  z.object({ type: z.literal('messages.page'), conversationId: Id, page: MessagePage }),
  z.object({ type: z.literal('account.reset') }),
  z.object({ type: z.literal('restart') }),
]);
export type ClientSyncOperation = z.infer<typeof ClientSyncOperation>;

export const ClientSyncEffect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send'), conversationId: Id, body: SendMessageRequest }),
  z.object({ type: z.literal('updates'), since: seq, limit: z.literal(500) }),
  z.object({ type: z.literal('state') }),
  z.object({ type: z.literal('snapshot'), startSeq: seq }),
  z.object({
    type: z.literal('messages'),
    conversationId: Id,
    afterSeq: seq,
    limit: z.literal(200),
  }),
  z.object({ type: z.literal('settings'), section: z.string(), characterId: Id.nullable() }),
  z.object({ type: z.literal('model-status'), status: ModelStatus }),
]);
export type ClientSyncEffect = z.infer<typeof ClientSyncEffect>;
export const ProtocolVector = z.strictObject({
  formatVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  initialState: ClientSyncState,
  steps: z.array(
    z.strictObject({
      operation: ClientSyncOperation,
      expectError: z.boolean().optional(),
      expectState: ClientSyncState.optional(),
    }),
  ),
  expected: z.strictObject({ state: ClientSyncState, effects: z.array(ClientSyncEffect) }),
});
export type ProtocolVector = z.infer<typeof ProtocolVector>;
