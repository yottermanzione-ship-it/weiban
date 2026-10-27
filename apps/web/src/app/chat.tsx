import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { freshSyncState, type LocalSyncState } from '@weiban/client-core';
import { type Message, type SendMessageRequest, type UserSendableContent } from '@weiban/contracts';
import { useAuth } from './auth.js';
import { resumeExistingPush } from '../notifications/client.js';
import { ChatDriver } from '../data/chat-driver.js';
import { api, localStore } from '../data/client.js';
import { useUpdates } from '../data/updates.js';
import { playMessageSound, playNoticeSound } from '../features/message-sound.js';
interface ChatContextValue {
  state: LocalSyncState;
  online: boolean;
  error: string;
  /** 同步已停止、需要重新打开微伴（本机写不进去、版本过旧）。 */
  errorFatal: boolean;
  /** 关掉顶部提示条；同一条提示不再出现，直到出现新的问题。 */
  dismissError(): void;
  typing: Record<string, number>;
  focus(id: string | null): void;
  send(id: string, text: string, quoteMessageId?: string, mentions?: string[]): Promise<void>;
  /** 3.0：发图片、语音、表情、链接（离线时排队，联网后发送）。 */
  sendContent(id: string, content: UserSendableContent): Promise<void>;
  retry(id: string, clientMsgId: string): Promise<void>;
  older(id: string, beforeSeq: number): Promise<boolean>;
  clearHistory(id: string): Promise<void>;
  synchronize(): Promise<void>;
  restoreHistory(): Promise<void>;
  assertOwner(): void;
}
const ChatContext = createContext<ChatContextValue | null>(null);
export function ChatProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const driver = useRef<ChatDriver | null>(null);
  const [view, setView] = useState<{ owner: string | null; state: LocalSyncState }>({
    owner: null,
    state: freshSyncState(),
  });
  const [rawOnline, setOnline] = useState(false);
  const [rawError, setRawError] = useState<{ text: string; fatal: boolean; closed: boolean }>({
    text: '',
    fatal: false,
    closed: false,
  });
  const setError = (text: string, fatal = false) =>
    setRawError((previous) =>
      previous.text === text && previous.fatal === fatal
        ? previous
        : { text, fatal, closed: false },
    );
  const [rawTyping, setTyping] = useState<Record<string, number>>({});
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const ownerKey = userId && sessionId ? `${userId}:${sessionId}` : null;
  const owned = view.owner === ownerKey;
  const state = owned ? view.state : freshSyncState();
  const online = owned && rawOnline;
  const error = owned && !rawError.closed ? rawError.text : '';
  const errorFatal = owned && rawError.fatal;
  const dismissError = useCallback(
    () => setRawError((previous) => ({ ...previous, closed: true })),
    [],
  );
  const typing = owned ? rawTyping : {};
  useEffect(() => {
    if (!session) return;
    let active = true;
    setView({ owner: ownerKey, state: freshSyncState() });
    setTyping({});
    setOnline(false);
    setError('');
    const instance = new ChatDriver(api, localStore, session, {
      state: (value) => {
        if (active) setView({ owner: ownerKey, state: value });
      },
      connection: (value) => {
        if (active) {
          setOnline(value);
          // 自动恢复的提示在连上后消失；需要重新打开的提示保留。
          if (value) setRawError((previous) => (previous.fatal ? previous : { text: '', fatal: false, closed: false }));
        }
      },
      error: (value, kind) => {
        if (active) setError(value, kind === 'fatal');
      },
      typing: (id, participantId, value) => {
        if (active)
          setTyping((previous) => ({
            ...previous,
            [`${id}:${participantId}`]: value ? Date.now() + 6000 : 0,
          }));
      },
    });
    driver.current = instance;
    void resumeExistingPush(session).catch(() => {});
    const beforeUpdate = (event: Event) => {
      const request = event as CustomEvent<{ waitUntil(work: Promise<void>): void }>;
      request.detail.waitUntil(instance.pause());
    };
    const updateFailed = () => instance.resume();
    window.addEventListener('weiban:before-update', beforeUpdate);
    window.addEventListener('weiban:update-failed', updateFailed);
    void instance.start().catch(() => {
      if (active) setError('本机聊天数据无法读取，请重新打开微伴', true);
    });
    const timer = window.setInterval(() => {
      setTyping((previous) => {
        const entries = Object.entries(previous).filter(([, expiry]) => expiry > Date.now());
        return entries.length === Object.keys(previous).length
          ? previous
          : Object.fromEntries(entries);
      });
    }, 1000);
    return () => {
      active = false;
      instance.stop();
      window.removeEventListener('weiban:before-update', beforeUpdate);
      window.removeEventListener('weiban:update-failed', updateFailed);
      window.clearInterval(timer);
      if (driver.current === instance) driver.current = null;
    };
    // 用户资料刷新不重启同一会话的驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionId]);
  function current() {
    if (
      !driver.current ||
      driver.current.ownerKey !== ownerKey ||
      !userId ||
      !sessionId ||
      !api.owns({ userId, sessionId })
    )
      throw new Error('聊天会话已改变，请重新打开微伴');
    return driver.current;
  }
  const focusedId = useRef<string | null>(null);
  const focus = useCallback((id: string | null) => {
    focusedId.current = id;
    driver.current?.focus(id);
  }, []);
  // 提示音（message-sound.ts）：只响刚收到的角色消息；补拉旧消息、自己发的、免打扰会话不响。
  const conversations = useRef(state.conversations);
  conversations.current = state.conversations;
  const sounded = useRef(new Set<string>());
  useUpdates((update) => {
    if (update.type !== 'message.created') return;
    // 实时帧与补拉页在 chat-driver / sync-http 里已按契约解析过。
    const message = (update.data as { message?: Message } | undefined)?.message;
    if (!message || message.senderKind !== 'character' || message.recalledAt) return;
    if (Date.now() - Date.parse(message.createdAt) > 30_000) return;
    if (sounded.current.has(message.messageId)) return;
    sounded.current.add(message.messageId);
    if (sounded.current.size > 200) sounded.current.clear();
    if (document.visibilityState !== 'visible') return;
    if (focusedId.current === message.conversationId) {
      playMessageSound();
      return;
    }
    const conversation = conversations.current.find(
      (item) => item.conversationId === message.conversationId,
    );
    if (conversation?.state.muted || message.labels?.includes('self_chat')) return;
    playNoticeSound();
  });
  return (
    <ChatContext.Provider
      value={{
        state,
        online,
        error,
        errorFatal,
        dismissError,
        typing,
        focus,
        send: async (id, text, quoteMessageId, mentions) => {
          const body: SendMessageRequest = {
            clientMsgId: crypto.randomUUID(),
            content: mentions?.length ? { type: 'text', text, mentions } : { type: 'text', text },
            quoteMessageId: quoteMessageId ?? null,
          };
          await current().dispatch({ type: 'enqueue', conversationId: id, body, now: Date.now() });
          playMessageSound();
        },
        sendContent: async (id, content) => {
          const body: SendMessageRequest = {
            clientMsgId: crypto.randomUUID(),
            content,
            quoteMessageId: null,
          };
          await current().dispatch({ type: 'enqueue', conversationId: id, body, now: Date.now() });
          playMessageSound();
        },
        retry: (id, clientMsgId) =>
          current().dispatch({ type: 'retry', conversationId: id, clientMsgId, now: Date.now() }),
        older: async (id, beforeSeq) => {
          return current().older(id, beforeSeq);
        },
        clearHistory: (id) => current().clearHistory(id),
        synchronize: () => current().synchronize(),
        restoreHistory: () => current().restoreHistory(),
        assertOwner: () => {
          current();
        },
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error('ChatProvider missing');
  return value;
}
