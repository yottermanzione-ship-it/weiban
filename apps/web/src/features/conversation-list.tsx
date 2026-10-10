import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useChat } from '../app/chat.js';
import { VirtualList } from './virtual-list.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupAvatar } from './groups.js';
export function ConversationListPage() {
  const { state, online, error } = useChat();
  const navigate = useNavigate();
  // 电脑浏览器：Ctrl / ⌘ + F 在会话列表页打开全局搜索（search.md 第 5 节）。
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [navigate]);
  const items = state.conversations
    .filter((item) => !item.state.hidden)
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
      <div className="button-row">
        <Link className="plain" to="/groups/new">
          发起群聊
        </Link>
        <Link className="plain" to="/discover">
          添加角色
        </Link>
      </div>
      <Link className="search-entry" to="/search">
        <MagnifyingGlass size={16} aria-hidden />
        搜索
      </Link>
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
            {item.type === 'group' ? (
              <GroupAvatar
                ids={item.participants.filter((p) => p.kind === 'character').map((p) => p.refId)}
              />
            ) : (
              <CharacterAvatar
                id={
                  item.participants.find((participant) => participant.kind === 'character')
                    ?.refId ?? item.conversationId
                }
              />
            )}
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
