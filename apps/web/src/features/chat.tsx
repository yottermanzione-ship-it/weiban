import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChatEndpoints,
  IdentityEndpoints,
  CharacterEndpoints,
  ModelAccessEndpoints,
  type Conversation,
  type Message,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { VirtualList } from './virtual-list.js';
import { HomeScreenGuide } from './home-screen-guide.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
export function CharacterName({ id, fallback }: { id: string; fallback?: string | null }) {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId: id } });
  return <>{fallback || profile.data?.name || '角色'}</>;
}
export function Name({ conversation }: { conversation: Conversation }) {
  const { state } = useChat();
  const role = conversation.participants.find((item) => item.kind === 'character');
  if (conversation.title) return <>{conversation.title}</>;
  return role ? (
    <CharacterName
      id={role.refId}
      fallback={state.contacts.find((item) => item.characterId === role.refId)?.remark}
    />
  ) : (
    <>会话</>
  );
}

function content(message: Message): string {
  if (message.status === 'recalled') return '这条消息已撤回';
  switch (message.content?.type) {
    case 'text':
      return message.content.text;
    case 'nudge':
      return '拍了拍';
    case 'system':
      return message.content.code === 'contact_accepted'
        ? '已通过好友申请，现在可以开始聊天了'
        : '会话提示';
    default:
      return '当前版本不支持此消息';
  }
}
export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const chat = useChat();
  const { focus } = chat;
  const conversation = chat.state.conversations.find(
    (item) => item.conversationId === conversationId,
  );
  useEffect(() => {
    focus(conversationId);
    return () => focus(null);
  }, [conversationId, focus]);
  if (!conversation)
    return (
      <main>
        <Link to="/chat">返回微伴</Link>
        <p role="status">{chat.state.initialized ? '会话不存在或角色已被删除' : '正在打开聊天…'}</p>
      </main>
    );
  return <ConversationView key={conversationId} conversation={conversation} />;
}
function ConversationView({ conversation }: { conversation: Conversation }) {
  const chat = useChat();
  const id = conversation.conversationId;
  const userProfile = useRemote(IdentityEndpoints.getProfile);
  const role = conversation.participants.find((item) => item.kind === 'character');
  const status = useRemote(ModelAccessEndpoints.getModelStatus, {
    query: { characterId: role?.refId },
  });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [older, setOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const messages = chat.state.messages
    .filter((item) => item.conversationId === id)
    .sort((a, b) => a.seq - b.seq);
  const pending = chat.state.outbox.filter((item) => item.conversationId === id);
  const quote =
    messages.find((item) => item.messageId === quoteId && item.status === 'normal') ?? null;
  const lastVisibleSeq = messages.at(-1)?.seq ?? 0;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const hasTyping = Object.entries(chat.typing).some(
    ([key, expiry]) => key.startsWith(`${id}:`) && expiry > Date.now(),
  );
  useEffect(() => {
    if (!visible || !atBottom || lastVisibleSeq < 1 || conversation.state.readSeq >= lastVisibleSeq)
      return;
    void api
      .call(ChatEndpoints.markRead, {
        params: { conversationId: id },
        body: { readSeq: lastVisibleSeq },
      })
      .catch(() => {});
  }, [id, lastVisibleSeq, conversation.state.readSeq, visible, atBottom]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await chat.send(id, text, quote?.messageId);
      setText('');
      setQuoteId(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }
  async function action(message: Message, operation: 'recall' | 'hide') {
    setError('');
    try {
      await api.call(
        operation === 'recall' ? ChatEndpoints.recallMessage : ChatEndpoints.hideMessage,
        { params: { conversationId: id, messageId: message.messageId } },
      );
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  return (
    <main className="conversation-page">
      <header className="conversation-header">
        <Link to="/chat" aria-label="返回微伴">
          ‹ 微伴
        </Link>
        <h1>
          <Name conversation={conversation} />
        </h1>
        <Link to={`/chat/${id}/settings`}>聊天信息</Link>
      </header>
      <HomeScreenGuide
        received={messages.some(
          (message) =>
            message.senderKind === 'character' &&
            message.status === 'normal' &&
            message.content !== null,
        )}
      />
      {conversation.contentScope === 'adult' && <p className="hint">成人模式</p>}
      {!chat.online && <p className="offline">网络暂不可用，消息保存在本机，联网后继续发送</p>}
      {status.data && !status.data.available && (
        <p className="offline">
          {status.data.reason === 'insufficient_balance'
            ? '余额不足，角色暂时无法回复'
            : '模型服务暂时不可用，角色暂时无法回复'}{' '}
          <Link to={status.data.reason === 'insufficient_balance' ? '/wallet' : '/models'}>
            去查看
          </Link>
        </p>
      )}
      {hasTyping && status.data?.available && <p role="status">对方正在输入…</p>}
      {(error || chat.error) && <p role="alert">{error || chat.error}</p>}
      {older && messages.length > 0 && (
        <button
          disabled={loadingOlder}
          onClick={() => {
            setLoadingOlder(true);
            void chat
              .older(id, messages[0]!.seq)
              .then(setOlder)
              .catch((e) => setError(friendlyError(e)))
              .finally(() => setLoadingOlder(false));
          }}
        >
          {loadingOlder ? '正在读取…' : '加载更早消息'}
        </button>
      )}
      <VirtualList
        items={messages}
        itemKey={(item) => item.messageId}
        label="聊天消息"
        estimate={90}
        bottom
        onBottom={setAtBottom}
        render={(message) => (
          <div
            className={`message-row ${message.senderKind === 'user' && message.status === 'normal' ? 'mine' : ''} ${message.senderKind === 'system' || message.status === 'recalled' ? 'system-message' : ''}`}
          >
            <time>
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
            <div className="message-body">
              {message.status === 'normal' && message.senderKind === 'user' && (
                <UserAvatar profile={userProfile.data} />
              )}
              {message.status === 'normal' && message.senderKind === 'character' && (
                <CharacterAvatar
                  id={
                    conversation.participants.find(
                      (participant) => participant.participantId === message.senderParticipantId,
                    )?.refId ??
                    role?.refId ??
                    ''
                  }
                  size={40}
                />
              )}
              <div className="message-details">
                {message.quote && (
                  <small className="quote-preview">
                    引用：{message.quote.preview ?? '原消息已不可见'}
                  </small>
                )}
                <p className="message-bubble">{content(message)}</p>
                {message.senderKind === 'user' && message.status === 'normal' && (
                  <small>
                    {conversation.peerReadSeq !== null && conversation.peerReadSeq >= message.seq
                      ? '已读'
                      : '已送达'}
                  </small>
                )}
                {message.status === 'normal' && message.content?.type === 'text' && (
                  <details>
                    <summary aria-label="消息操作">•••</summary>
                    <button onClick={() => setQuoteId(message.messageId)}>引用</button>
                    <button onClick={() => void action(message, 'hide')}>删除</button>
                    {message.senderKind === 'user' && (
                      <button onClick={() => void action(message, 'recall')}>撤回</button>
                    )}
                  </details>
                )}
              </div>
            </div>
          </div>
        )}
      />
      {pending.map((item) => (
        <div className="pending-message" key={item.body.clientMsgId}>
          <UserAvatar profile={userProfile.data} />
          <div className="message-details">
            <p>{item.body.content.type === 'text' ? item.body.content.text : '拍了拍'}</p>
            {item.state === 'failed' ? (
              <button
                onClick={() =>
                  void chat
                    .retry(id, item.body.clientMsgId)
                    .catch((e) => setError(friendlyError(e)))
                }
              >
                发送失败，点击重试
              </button>
            ) : (
              <span role="status">{item.state === 'sending' ? '发送中…' : '等待发送'}</span>
            )}
          </div>
        </div>
      ))}
      {quote && (
        <div className="quote-preview">
          引用：{content(quote)} <button onClick={() => setQuoteId(null)}>取消引用</button>
        </div>
      )}
      <form className="message-composer" onSubmit={(event) => void submit(event)}>
        <label>
          消息
          <input
            value={text}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="primary" disabled={sending || !text.trim()}>
          发送
        </button>
      </form>
    </main>
  );
}
