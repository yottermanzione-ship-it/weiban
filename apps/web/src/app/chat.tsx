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
import { type SendMessageRequest } from '@weiban/contracts';
import { useAuth } from './auth.js';
import { resumeExistingPush } from '../notifications/client.js';
import { ChatDriver } from '../data/chat-driver.js';
import { api, localStore } from '../data/client.js';
interface ChatContextValue {
  state: LocalSyncState;
  online: boolean;
  error: string;
  typing: Record<string, number>;
  focus(id: string | null): void;
  send(id: string, text: string, quoteMessageId?: string): Promise<void>;
  retry(id: string, clientMsgId: string): Promise<void>;
  older(id: string, beforeSeq: number): Promise<boolean>;
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
  const [rawError, setError] = useState('');
  const [rawTyping, setTyping] = useState<Record<string, number>>({});
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const ownerKey = userId && sessionId ? `${userId}:${sessionId}` : null;
  const owned = view.owner === ownerKey;
  const state = owned ? view.state : freshSyncState();
  const online = owned && rawOnline;
  const error = owned ? rawError : '';
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
          if (value) setError('');
        }
      },
      error: (value) => {
        if (active) setError(value);
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
      if (active) setError('本机聊天数据无法读取，请稍后重新打开');
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
    if (!driver.current) throw new Error('聊天尚未准备好');
    return driver.current;
  }
  const focus = useCallback((id: string | null) => driver.current?.focus(id), []);
  return (
    <ChatContext.Provider
      value={{
        state,
        online,
        error,
        typing,
        focus,
        send: async (id, text, quoteMessageId) => {
          const body: SendMessageRequest = {
            clientMsgId: crypto.randomUUID(),
            content: { type: 'text', text },
            quoteMessageId: quoteMessageId ?? null,
          };
          await current().dispatch({ type: 'enqueue', conversationId: id, body, now: Date.now() });
        },
        retry: (id, clientMsgId) =>
          current().dispatch({ type: 'retry', conversationId: id, clientMsgId, now: Date.now() }),
        older: async (id, beforeSeq) => {
          return current().older(id, beforeSeq);
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
