import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChatEndpoints, UserCustomEndpoints, type Message } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';

export function CharacterTrial({
  conversationId,
  name,
  owner,
  onClose,
}: {
  conversationId: string;
  name: string;
  owner: { userId: string; sessionId: string };
  onClose(): void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ text: string; id: string } | null>(null);
  const owned = () => api.owns(owner);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (!api.owns(owner) || abort.signal.aborted) return;
      try {
        const page = await api.call(ChatEndpoints.listMessages, {
          params: { conversationId },
          query: { limit: 200 },
          networkOnly: true,
          signal: abort.signal,
        });
        if (!abort.signal.aborted && api.owns(owner)) setMessages(page.items);
      } catch (e) {
        if (!abort.signal.aborted && api.owns(owner)) setError(friendlyError(e));
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 1000);
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
      if (api.owns(owner))
        void api
          .call(UserCustomEndpoints.endTrial, { params: { conversationId }, networkOnly: true })
          .catch(() => {});
    };
  }, [conversationId, owner]);
  async function close() {
    if (!owned() || closing) return;
    setClosing(true);
    setError('');
    try {
      await api.call(UserCustomEndpoints.endTrial, {
        params: { conversationId },
        networkOnly: true,
      });
      if (owned()) onClose();
    } catch (e) {
      if (owned()) setError(friendlyError(e));
    } finally {
      setClosing(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || sending || closing || !owned()) return;
    const pending =
      retry.current?.text === text ? retry.current : { text, id: crypto.randomUUID() };
    retry.current = pending;
    setSending(true);
    setError('');
    try {
      await api.call(ChatEndpoints.sendMessage, {
        params: { conversationId },
        body: { clientMsgId: pending.id, content: { type: 'text', text: pending.text } },
        networkOnly: true,
      });
      if (owned()) {
        setText('');
        retry.current = null;
      }
    } catch (e) {
      if (owned()) setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }
  if (!owned()) return null;
  return (
    <div className="dialog-scrim" role="dialog" aria-modal="true" aria-label="角色试聊">
      <section className="dialog stack">
        <h2>和{name}试聊</h2>
        <p className="muted">关闭后不保留这次试聊；返回编辑器可继续修改或保存角色。</p>
        <div className="stack" aria-live="polite" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
          {messages.map((message) => (
            <p
              key={message.messageId}
              className={message.senderKind === 'user' ? 'trial-mine' : ''}
            >
              <strong>{message.senderKind === 'user' ? '我' : name}：</strong>
              {message.status === 'recalled'
                ? '这条消息已撤回'
                : message.content?.type === 'text'
                  ? message.content.text
                  : ''}
            </p>
          ))}
        </div>
        <form className="stack" onSubmit={(e) => void send(e)}>
          <label>
            试聊消息
            <textarea
              maxLength={4000}
              value={text}
              disabled={closing}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="primary" disabled={sending || closing || !text.trim()}>
            {sending ? '发送中…' : '发送'}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={closing} onClick={() => void close()}>
          {closing ? '正在结束…' : '结束试聊，返回编辑'}
        </button>
      </section>
    </div>
  );
}
