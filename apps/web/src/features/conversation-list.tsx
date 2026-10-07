import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChat } from '../app/chat.js';
import { VirtualList } from './virtual-list.js';
import { useCharacterNames } from '../data/character-names.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
export function ConversationListPage() {
  const { state, online, error } = useChat();
  const [query, setQuery] = useState('');
  const names = useCharacterNames(state.contacts.map((contact) => contact.characterId));
  const items = state.conversations
    .filter(
      (item) =>
        !item.state.hidden &&
        (!query ||
          item.title?.includes(query) ||
          item.lastMessage?.text.includes(query) ||
          item.participants.some(
            (participant) =>
              participant.kind === 'character' &&
              ((names[participant.refId] || '').includes(query) ||
                state.contacts
                  .find((contact) => contact.characterId === participant.refId)
                  ?.remark?.includes(query)),
          )),
    )
    .sort(
      (a, b) =>
        Number(b.state.pinned) - Number(a.state.pinned) ||
        (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(
          a.lastMessage?.createdAt ?? a.updatedAt,
        ),
    );
  const unread = items.reduce((total, item) => total + item.unreadCount, 0);
  return (
    <main className="chat-list-page">
      <h1 className="page-title">
        微伴{unread > 0 ? `（${unread}）` : ''}
        {!online && '（未连接）'}
      </h1>
      <Link className="plain" to="/discover">
        添加角色
      </Link>
      <label className="search-label">
        搜索会话
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="角色、群名或消息内容"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!state.initialized && <p role="status">正在读取聊天…</p>}
      {state.initialized && items.length === 0 && (
        <div className="empty">
          <p>还没有聊天，去加一个你喜欢的 TA 吧</p>
          <Link to="/discover">去角色广场</Link>
        </div>
      )}
      <VirtualList
        items={items}
        itemKey={(item) => item.conversationId}
        label="会话列表"
        render={(item) => (
          <Link
            to={`/chat/${item.conversationId}`}
            className={`conversation-row ${item.state.pinned ? 'pinned' : ''}`}
          >
            <CharacterAvatar
              id={
                item.participants.find((participant) => participant.kind === 'character')?.refId ??
                item.conversationId
              }
            />
            <span className="conversation-copy">
              <strong>
                <Name conversation={item} />
              </strong>
              <small>{item.lastMessage?.text || '开始聊天吧'}</small>
            </span>
            <span className="conversation-meta">
              <time>
                {new Date(item.lastMessage?.createdAt ?? item.updatedAt).toLocaleTimeString(
                  'zh-CN',
                  { hour: '2-digit', minute: '2-digit' },
                )}
              </time>
              {item.unreadCount > 0 && (
                <span className="unread-badge">{item.state.muted ? '●' : item.unreadCount}</span>
              )}
              {item.state.muted && <small>免打扰</small>}
            </span>
          </Link>
        )}
      />
    </main>
  );
}
