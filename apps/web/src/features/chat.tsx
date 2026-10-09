import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ChatActionEndpoints,
  ChatEndpoints,
  IdentityEndpoints,
  CharacterEndpoints,
  ModelAccessEndpoints,
  type Conversation,
  type Message,
  type Participant,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { VirtualList } from './virtual-list.js';
import { HomeScreenGuide } from './home-screen-guide.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { WhileAwayCard, useWhileAway } from './while-away.js';
export function CharacterName({ id, fallback }: { id: string; fallback?: string | null }) {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId: id } });
  return <>{fallback || profile.data?.name || '角色'}</>;
}
/** 群里的角色成员（不含已退出的）。 */
export function groupMembers(conversation: Conversation): Participant[] {
  return conversation.participants.filter((item) => item.kind === 'character');
}
export function Name({ conversation }: { conversation: Conversation }) {
  const { state } = useChat();
  const members = groupMembers(conversation);
  const names = useCharacterNames(
    conversation.type === 'group' && !conversation.title ? members.map((m) => m.refId) : [],
  );
  const role = members[0];
  if (conversation.title)
    return (
      <>
        {conversation.title}
        {conversation.type === 'group' ? `（${members.length + 1}）` : ''}
      </>
    );
  if (conversation.type === 'group')
    return (
      <>
        {members
          .map(
            (m) =>
              state.contacts.find((c) => c.characterId === m.refId)?.remark ||
              names[m.refId] ||
              '角色',
          )
          .join('、')}
        （{members.length + 1}）
      </>
    );
  return role ? (
    <CharacterName
      id={role.refId}
      fallback={state.contacts.find((item) => item.characterId === role.refId)?.remark}
    />
  ) : (
    <>会话</>
  );
}

const modeNames: Record<string, string> = {
  daily: '日常',
  tsundere: '傲娇',
  romance: '恋爱',
  adult: '成人',
};
function systemText(code: string, params: Record<string, string | number | boolean>): string {
  const p = (key: string) => String(params[key] ?? '');
  switch (code) {
    case 'contact_accepted':
      return '已通过好友申请，现在可以开始聊天了';
    case 'scenario_mode_changed':
      if (params.reason === 'adult_mode_unavailable') return '成人模式已不可用，已回到日常模式';
      return `已切换到${modeNames[p('mode')] ?? '日常'}模式`;
    case 'scenario_mode_switched':
      if (params.reason === 'member_not_eligible') return '有新成员加入，群聊已回到日常模式';
      return `已切换到${modeNames[p('mode')] ?? '日常'}模式`;
    case 'group_created':
      return `你邀请 ${p('names')} 加入了群聊`;
    case 'group_invited_by_character':
      return `${p('name')} 邀请你和 ${p('names')} 加入了群聊`;
    case 'member_joined':
      return params.byName
        ? `${p('byName')} 邀请 ${p('names')} 加入了群聊`
        : `你邀请 ${p('names')} 加入了群聊`;
    case 'member_removed':
      return `你将 ${p('name')} 移出了群聊`;
    case 'member_left':
      return `${p('name')} 退出了群聊`;
    case 'group_renamed':
      return params.byName
        ? `${p('byName')} 修改群名为「${p('title')}」`
        : `你修改群名为「${p('title')}」`;
    case 'group_dissolved':
      return '群聊已解散';
    default:
      return '会话提示';
  }
}
export function content(message: Message): string {
  if (message.status === 'recalled') return '这条消息已撤回';
  switch (message.content?.type) {
    case 'text':
      return message.content.text;
    case 'nudge':
      return '拍了拍';
    case 'system':
      return systemText(message.content.code, message.content.params);
    case 'contact_card':
      return `[名片] ${message.content.name}`;
    case 'action_card':
      return message.content.text;
    default:
      return '当前版本不支持此消息';
  }
}

/** 名片消息（C 4.2）：点开是资料页，添加时带推荐人。 */
function ContactCardBubble({
  content: card,
}: {
  content: Extract<Message['content'], { type: 'contact_card' }>;
}) {
  return (
    <Link
      className="contact-card"
      to={`/characters/${card.characterId}?ref=${card.recommenderCharacterId}`}
    >
      <CharacterAvatar id={card.characterId} size={40} />
      <span>
        <strong>{card.name}</strong>
        <small>个人名片</small>
      </span>
    </Link>
  );
}

/** 带按钮的卡片（ADR-0026）：只能点一次。 */
function ActionCardBubble({
  message,
  onChosen,
}: {
  message: Message;
  onChosen(message: Message): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (message.content?.type !== 'action_card') return null;
  const chosen = message.actionChoice?.actionId;
  return (
    <div className="action-card">
      <p>{message.content.text}</p>
      <div className="button-row">
        {message.content.actions.map((action) => (
          <button
            key={action.actionId}
            className={action.style === 'primary' ? 'primary' : ''}
            disabled={pending || !!chosen}
            aria-pressed={chosen === action.actionId}
            onClick={() => {
              setPending(true);
              setError('');
              void api
                .call(ChatActionEndpoints.chooseMessageAction, {
                  params: { conversationId: message.conversationId, messageId: message.messageId },
                  body: { actionId: action.actionId },
                })
                .then(onChosen)
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setPending(false));
            }}
          >
            {chosen === action.actionId ? `已选择：${action.label}` : action.label}
          </button>
        ))}
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
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
  if (!conversation || (conversation.type === 'group' && conversation.state.hidden))
    return (
      <main>
        <Link to="/chat">返回微伴</Link>
        <p role="status" className="empty">
          {!chat.state.initialized
            ? '正在打开聊天…'
            : conversation
              ? '这个群聊已解散'
              : '会话不存在或已被删除'}
        </p>
      </main>
    );
  return <ConversationView key={conversationId} conversation={conversation} />;
}
function ConversationView({ conversation }: { conversation: Conversation }) {
  const chat = useChat();
  const id = conversation.conversationId;
  const group = conversation.type === 'group';
  const userProfile = useRemote(IdentityEndpoints.getProfile);
  const members = groupMembers(conversation);
  const role = members[0];
  const everyone = [
    ...conversation.participants,
    ...(conversation.group?.formerParticipants ?? []),
  ];
  const memberNames = useCharacterNames(
    group ? everyone.filter((p) => p.kind === 'character').map((p) => p.refId) : [],
  );
  const displayName = (characterId: string) =>
    chat.state.contacts.find((c) => c.characterId === characterId)?.remark ||
    memberNames[characterId] ||
    '角色';
  const status = useRemote(ModelAccessEndpoints.getModelStatus, {
    query: { characterId: group ? undefined : role?.refId },
  });
  const location = useLocation();
  const prefill = (location.state as { prefill?: string } | null)?.prefill;
  const [text, setText] = useState(prefill ?? '');
  const [mentions, setMentions] = useState<Array<{ participantId: string; name: string }>>([]);
  const [picking, setPicking] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Message>>({});
  const input = useRef<HTMLInputElement>(null);
  const whileAway = useWhileAway(id, group ? undefined : role?.refId);
  const [awayOpen, setAwayOpen] = useState<boolean | null>(null);
  const cardOpen = awayOpen ?? whileAway.autoOpen;
  const { markShown } = whileAway;
  useEffect(() => {
    if (whileAway.data && cardOpen) markShown();
  }, [whileAway.data, cardOpen, markShown]);
  useEffect(() => {
    if (prefill) input.current?.focus();
  }, [prefill]);
  useUpdates((update) => {
    if (update.type !== 'message.updated') return;
    const message = (update.data as { message?: Message } | undefined)?.message;
    if (message?.conversationId === id)
      setOverrides((o) => ({ ...o, [message.messageId]: message }));
  });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [older, setOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const messages = chat.state.messages
    .filter((item) => item.conversationId === id)
    .map((item) => overrides[item.messageId] ?? item)
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
  const typingNames = Object.entries(chat.typing)
    .filter(([key, expiry]) => key.startsWith(`${id}:`) && expiry > Date.now())
    .map(([key]) => {
      const participant = everyone.find((p) => p.participantId === key.slice(id.length + 1));
      return participant ? displayName(participant.refId) : '';
    });
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
  function insertMention(participant: Participant) {
    const name = displayName(participant.refId);
    setText((value) => `${value.endsWith('@') ? value.slice(0, -1) : value}@${name} `);
    setMentions((list) =>
      list.some((m) => m.participantId === participant.participantId)
        ? list
        : [...list, { participantId: participant.participantId, name }],
    );
    setPicking(false);
    input.current?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const mentioned = group
        ? mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.participantId)
        : [];
      await chat.send(id, text, quote?.messageId, mentioned);
      setText('');
      setMentions([]);
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
  const senderOf = (message: Message) =>
    everyone.find((participant) => participant.participantId === message.senderParticipantId);
  return (
    <main className="conversation-page">
      <header className="conversation-header">
        <Link to="/chat" aria-label="返回微伴">
          ‹ 微伴
        </Link>
        <h1>
          <Name conversation={conversation} />
        </h1>
        <Link to={group ? `/chat/${id}/group` : `/chat/${id}/settings`}>聊天信息</Link>
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
      {typingNames.length > 0 && status.data?.available && (
        <p role="status">
          {group ? `${typingNames.filter(Boolean).join('、')} 正在输入…` : '对方正在输入…'}
        </p>
      )}
      {(error || chat.error) && <p role="alert">{error || chat.error}</p>}
      {whileAway.data && role && !group && (
        <WhileAwayCard
          data={whileAway.data}
          open={cardOpen}
          characterId={role.refId}
          onOpenChange={setAwayOpen}
          onAsk={(value) => {
            setText(value);
            input.current?.focus();
          }}
        />
      )}
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
        render={(message) => {
          const sender = senderOf(message);
          const senderId = sender?.refId ?? role?.refId ?? '';
          return (
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
                  <Link
                    to={`/characters/${senderId}${group && conversation.title ? `?group=${encodeURIComponent(conversation.title)}` : ''}`}
                    aria-label="查看资料"
                  >
                    <CharacterAvatar id={senderId} size={40} />
                  </Link>
                )}
                <div className="message-details">
                  {group && message.senderKind === 'character' && message.status === 'normal' && (
                    <small className="sender-name">{displayName(senderId)}</small>
                  )}
                  {message.quote && (
                    <small className="quote-preview">
                      引用：{message.quote.preview ?? '原消息已不可见'}
                    </small>
                  )}
                  {message.content?.type === 'contact_card' && message.status === 'normal' ? (
                    <ContactCardBubble content={message.content} />
                  ) : message.content?.type === 'action_card' && message.status === 'normal' ? (
                    <ActionCardBubble
                      message={message}
                      onChosen={(next) => setOverrides((o) => ({ ...o, [next.messageId]: next }))}
                    />
                  ) : (
                    <p className="message-bubble">{content(message)}</p>
                  )}
                  {!group && message.senderKind === 'user' && message.status === 'normal' && (
                    <small>
                      {conversation.peerReadSeq !== null && conversation.peerReadSeq >= message.seq
                        ? '已读'
                        : '已送达'}
                    </small>
                  )}
                  {message.status === 'normal' &&
                    (message.content?.type === 'text' ||
                      message.content?.type === 'contact_card') && (
                      <details>
                        <summary aria-label="消息操作">•••</summary>
                        {message.content.type === 'text' && (
                          <button onClick={() => setQuoteId(message.messageId)}>引用</button>
                        )}
                        <button onClick={() => void action(message, 'hide')}>删除</button>
                        {message.senderKind === 'user' && (
                          <button onClick={() => void action(message, 'recall')}>撤回</button>
                        )}
                      </details>
                    )}
                </div>
              </div>
            </div>
          );
        }}
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
      {picking && (
        <div className="mention-sheet" role="dialog" aria-label="选择提醒的人">
          <header>
            <strong>选择提醒的人</strong>
            <button className="text-button" onClick={() => setPicking(false)}>
              关闭
            </button>
          </header>
          <div className="rows">
            {members.map((member) => (
              <button
                key={member.participantId}
                className="role-row"
                onClick={() => insertMention(member)}
              >
                <CharacterAvatar id={member.refId} size={40} />
                {displayName(member.refId)}
              </button>
            ))}
          </div>
        </div>
      )}
      <form className="message-composer" onSubmit={(event) => void submit(event)}>
        <label>
          消息
          <input
            ref={input}
            value={text}
            maxLength={4000}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              if (cardOpen && whileAway.data) setAwayOpen(false);
              if (group && value.endsWith('@') && value.length > text.length) {
                if (members.length === 1) insertMention(members[0]!);
                else if (members.length > 1) setPicking(true);
              }
            }}
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
