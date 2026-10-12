import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChatsCircle,
  DownloadSimple,
  MagnifyingGlass,
  PencilSimpleLine,
  PlusCircle,
  Scan,
  UserPlus,
  Wallet,
} from '@phosphor-icons/react';
import { ChatEndpoints, type Conversation } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { VirtualList } from './virtual-list.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupAvatar } from './groups.js';
import { NewCharacterSheet } from './contacts.js';
import { PopMenu, Sheet, comingSoonPath } from './shell-kit.js';
import { showToast } from './toast.js';
import { PullMiniApps } from './pull-panel.js';

/** 长按（触屏 500ms）或右键打开会话菜单；长按后吞掉这次点击。 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown(event: ReactPointerEvent) {
      if (event.pointerType === 'mouse') return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, 500);
    },
    onPointerMove(event: ReactPointerEvent) {
      if (
        start.current &&
        Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: React.MouseEvent) {
      event.preventDefault();
      cancel();
      fired.current = true;
      onLongPress();
    },
    onClickCapture(event: React.MouseEvent) {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    },
  };
}

function ConversationRow({
  item,
  onMenu,
}: {
  item: Conversation;
  onMenu(item: Conversation): void;
}) {
  const press = useLongPress(() => onMenu(item));
  return (
    <Link
      to={`/chat/${item.conversationId}`}
      className={`conversation-row ${item.state.pinned ? 'pinned' : ''}`}
      {...press}
    >
      {item.type === 'group' ? (
        <GroupAvatar
          ids={item.participants.filter((p) => p.kind === 'character').map((p) => p.refId)}
        />
      ) : (
        <CharacterAvatar
          id={
            item.participants.find((participant) => participant.kind === 'character')?.refId ??
            item.conversationId
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
          {new Date(item.lastMessage?.createdAt ?? item.updatedAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        {(item.unreadCount > 0 || item.state.markedUnread) && (
          <span className="unread-badge">
            {item.state.muted || item.unreadCount === 0 ? '●' : item.unreadCount}
          </span>
        )}
        {item.state.muted && <small>免打扰</small>}
      </span>
    </Link>
  );
}

export function ConversationListPage() {
  const { state, online, error, synchronize } = useChat();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<Conversation | null>(null);
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
  async function act(
    item: Conversation,
    work: () => Promise<unknown>,
    done?: string,
  ): Promise<void> {
    setTarget(null);
    try {
      await work();
      await synchronize();
      if (done) showToast(done);
    } catch (e) {
      showToast(friendlyError(e));
    }
    void item;
  }
  const patch = (
    item: Conversation,
    body: { pinned?: boolean; muted?: boolean; hidden?: boolean },
  ) =>
    api.call(ChatEndpoints.updateState, { params: { conversationId: item.conversationId }, body });
  return (
    <main className="chat-list-page">
      <PullMiniApps>
        <header className="list-head">
          <span />
          <h1>
            微伴{unread > 0 ? `（${unread}）` : ''}
            {!online && '（未连接）'}
          </h1>
          <button
            type="button"
            className="nav-bar-icon"
            aria-label="更多"
            aria-haspopup="menu"
            onClick={() => setMenu(true)}
          >
            <PlusCircle size={24} />
          </button>
        </header>
        <Link className="search-entry" to="/search">
          <MagnifyingGlass size={16} aria-hidden />
          搜索
        </Link>
        {error && <p role="alert">{error}</p>}
        {!state.initialized && <p role="status">正在读取聊天…</p>}
        {state.initialized && items.length === 0 && (
          <div className="empty">
            <p>还没有聊天，去加一个你喜欢的 TA 吧</p>
            <Link to="/discover/plaza">去角色广场</Link>
          </div>
        )}
        <VirtualList
          items={items}
          itemKey={(item) => item.conversationId}
          label="会话列表"
          render={(item) => <ConversationRow item={item} onMenu={setTarget} />}
        />
      </PullMiniApps>
      {menu && (
        <PopMenu
          onClose={() => setMenu(false)}
          items={[
            { label: '发起群聊', icon: ChatsCircle, onClick: () => navigate('/groups/new') },
            { label: '添加角色', icon: UserPlus, onClick: () => navigate('/discover/plaza') },
            { label: '新建角色', icon: PencilSimpleLine, onClick: () => setCreating(true) },
            { label: '导入角色', icon: DownloadSimple, onClick: () => navigate('/imports') },
            { label: '扫一扫', icon: Scan, onClick: () => navigate(comingSoonPath('scan')) },
            { label: '收付款', icon: Wallet, onClick: () => navigate(comingSoonPath('pay')) },
          ]}
        />
      )}
      {creating && <NewCharacterSheet onClose={() => setCreating(false)} />}
      {target && (
        <Sheet onClose={() => setTarget(null)}>
          <div className="menu-group">
            <button
              type="button"
              className="menu-row"
              onClick={() =>
                void act(target, () => patch(target, { pinned: !target.state.pinned }))
              }
            >
              <span className="menu-label">{target.state.pinned ? '取消置顶' : '置顶'}</span>
            </button>
            {target.unreadCount === 0 && !target.state.markedUnread && (
              <button
                type="button"
                className="menu-row"
                onClick={() =>
                  void act(target, () =>
                    api.call(ChatEndpoints.markUnread, {
                      params: { conversationId: target.conversationId },
                    }),
                  )
                }
              >
                <span className="menu-label">标为未读</span>
              </button>
            )}
            <button
              type="button"
              className="menu-row"
              onClick={() => void act(target, () => patch(target, { muted: !target.state.muted }))}
            >
              <span className="menu-label">
                {target.state.muted ? '允许消息通知' : '消息免打扰'}
              </span>
            </button>
            <button
              type="button"
              className="menu-row"
              onClick={() =>
                void act(
                  target,
                  () => patch(target, { hidden: true }),
                  target.type === 'group'
                    ? '已不显示该聊天，可在 通讯录 › 群聊 找回'
                    : '已不显示该聊天，有新消息时会重新出现',
                )
              }
            >
              <span className="menu-label">不显示该聊天</span>
            </button>
          </div>
          <button type="button" className="full" onClick={() => setTarget(null)}>
            取消
          </button>
        </Sheet>
      )}
    </main>
  );
}
