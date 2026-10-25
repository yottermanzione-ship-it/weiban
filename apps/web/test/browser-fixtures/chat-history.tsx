/**
 * 开发浏览器夹具（T-20261025，聊天历史手动分页）：真的挂载聊天页与会话消息，
 * 同步状态是本机预置的快照，历史接口是固定假数据，不连接真实服务、数据库或旧站。
 * 用于验证：普通上滑到顶不请求历史；点一次只取一批且不并发；prepend 后用户眼前的消息不跳位；
 * 失败可重试；取到最早一条后显示「没有更多消息」。
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ChatEndpoints,
  IdentityEndpoints,
  ModelAccessEndpoints,
  SyncEndpoints,
  type AuthResponse,
  type Conversation,
  type Message,
  type MessagePage,
} from '@weiban/contracts';
import { freshSyncState } from '@weiban/client-core';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/media-call.css';
import '../../src/app/l6.css';
import '../../src/app/l6b.css';
import '../../src/app/plaza.css';
import '../../src/app/play.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/chat-old.css';
import '../../src/app/pages-old.css';
import '../../src/app/ecology.css';
import { AuthProvider } from '../../src/app/auth.js';
import { ChatProvider } from '../../src/app/chat.js';
import { api, localStore } from '../../src/data/client.js';
import { ToastHost } from '../../src/features/toast.js';
import { CallProvider } from '../../src/features/call.js';
import { ConversationPage } from '../../src/features/chat.js';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const P_USER = '55555555-5555-4555-8555-555555555555';
const P_CHARACTER = '66666666-6666-4666-8666-666666666666';
const PAGE_SIZE = 50;
const AT = (seq: number) => new Date(Date.UTC(2026, 9, 25, 8, 0, seq)).toISOString();

const auth: AuthResponse = {
  session: {
    sessionId: SESSION,
    token: 'test-token-'.padEnd(40, 'x'),
    kind: 'app',
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
  user: {
    userId: USER,
    username: 'history_fixture',
    role: 'user',
    profileCompleted: true,
    createdAt: AT(0),
  },
};
const conversation: Conversation = {
  conversationId: CONVERSATION,
  type: 'direct',
  title: null,
  participants: [
    { participantId: P_USER, kind: 'user', refId: USER, joinedAt: AT(0) },
    { participantId: P_CHARACTER, kind: 'character', refId: CHARACTER, joinedAt: AT(0) },
  ],
  contentScope: 'normal',
  lastSeq: 150,
  lastMessage: {
    messageId: crypto.randomUUID(),
    seq: 150,
    senderParticipantId: P_CHARACTER,
    text: '消息 150',
    createdAt: AT(150),
  },
  state: {
    pinned: false,
    muted: false,
    hidden: false,
    clearedThroughSeq: 0,
    readSeq: 150,
    markedUnread: false,
  },
  unreadCount: 0,
  peerReadSeq: null,
  createdAt: AT(0),
  updatedAt: AT(150),
};

function message(seq: number, sender: 'character' | 'user'): Message {
  return {
    messageId: crypto.randomUUID(),
    conversationId: CONVERSATION,
    seq,
    senderParticipantId: sender === 'character' ? P_CHARACTER : P_USER,
    senderKind: sender,
    content: { type: 'text', text: `消息 ${seq}` },
    quote: null,
    status: 'normal',
    scope: 'normal',
    clientMsgId: null,
    createdAt: AT(seq),
    recalledAt: null,
  };
}
function range(from: number, through: number): Message[] {
  const items: Message[] = [];
  for (let seq = from; seq <= through; seq++)
    items.push(message(seq, seq % 2 ? 'character' : 'user'));
  return items;
}

const state = {
  ...freshSyncState(),
  initialized: true,
  lastUpdateSeq: 1,
  messages: range(101, 150),
  conversations: [conversation],
  scannedThrough: { [CONVERSATION]: 150 },
};

const calls: number[] = [];
const harness = { calls, failNext: false };
Object.assign(window, { historyHarness: harness });

// 聊天驱动会连 WebSocket；夹具用只读空壳替身，避免真实连接与重连噪音。
class IdleSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  get readyState() {
    return IdleSocket.OPEN;
  }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
Object.assign(window, { WebSocket: IdleSocket });

void (async () => {
  await api.authenticate(auth);
  await localStore.setOwned(
    { userId: USER, sessionId: SESSION },
    `sync-state:${USER}:${SESSION}`,
    state,
  );
  // 历史分页：从当前最老一条往前取 PAGE_SIZE 条；两批后到最早一条。
  const olderPages: MessagePage[] = [
    { items: range(51, 100), hasMore: true },
    { items: range(1, 50), hasMore: false },
  ];
  let page = 0;
  Object.assign(api, {
    call: async (
      endpoint: unknown,
      options: { query?: { beforeSeq?: number; afterSeq?: number } } = {},
    ) => {
      if (endpoint === ChatEndpoints.listMessages) {
        if (options.query?.afterSeq !== undefined) return { items: [], hasMore: false };
        calls.push(options.query?.beforeSeq ?? 0);
        if (harness.failNext) {
          harness.failNext = false;
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          throw new Error('history fixture failure');
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        return olderPages[page++] ?? { items: [], hasMore: false };
      }
      if (endpoint === SyncEndpoints.getState) return { latestUpdateSeq: state.lastUpdateSeq };
      if (endpoint === ModelAccessEndpoints.getModelStatus)
        return {
          characterId: CHARACTER,
          available: true,
          reason: null,
          canFallbackToDefault: false,
        };
      if (endpoint === IdentityEndpoints.me) return auth.user;
      return {};
    },
  });
  createRoot(document.getElementById('root')!).render(
    <MemoryRouter initialEntries={[`/chat/${CONVERSATION}`]}>
      <AuthProvider>
        <ToastHost />
        <ChatProvider>
          <CallProvider>
            <Routes>
              <Route path="/chat/:conversationId" element={<ConversationPage />} />
            </Routes>
          </CallProvider>
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
})();
