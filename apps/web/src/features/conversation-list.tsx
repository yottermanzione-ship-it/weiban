/*
 * 会话列表（docs/refactor/06-old-ui-spec.md 4.2）：行高 72、头像 48 圆角 4、未读角标、
 * 左滑三键（标为未读 / 不显示 / 删除）、浅色长按菜单、下拉出现小程序面板（4.3）。
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChatEndpoints, type Conversation } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { VirtualList } from './virtual-list.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupAvatar } from './groups.js';
import { NewCharacterSheet } from './contacts.js';
import { OldIcon } from './old-icons.js';
import { EmptyState, LongPressMenu, PopMenu, useLongPress, type ActionItem } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';
import { PullMiniApps } from './pull-panel.js';
import { listTime } from './time-format.js';

const SWIPE_BUTTON = 68;

/** 每分钟刷新一次时间文字。 */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
}

/** 左滑露出按钮（180ms easeOut；甩动 > 250 像素/秒直接展开 / 收起；同时只展开一行）。 */
function SwipeRow({
  open,
  onOpenChange,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  actions: Array<{ label: string; kind: 'read' | 'hide' | 'delete'; onClick(): void }>;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const width = actions.length * SWIPE_BUTTON;
  const start = useRef<{ x: number; y: number; t: number; active: boolean } | null>(null);
  const last = useRef({ x: 0, t: 0 });
  const swallow = useRef(false);
  const set = (x: number, dragging: boolean) => {
    const el = track.current;
    if (!el) return;
    el.classList.toggle('dragging', dragging);
    el.style.transform = x ? `translateX(${x}px)` : '';
  };
  useEffect(() => set(open ? -width : 0, false), [open, width]);
  function down(event: ReactPointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY, t: Date.now(), active: false };
    last.current = { x: event.clientX, t: Date.now() };
  }
  function move(event: ReactPointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        s.active = true;
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      } else if (Math.abs(dy) > 8) {
        start.current = null;
        return;
      } else return;
    }
    swallow.current = true;
    last.current = { x: event.clientX, t: Date.now() };
    set(Math.max(-width, Math.min(0, dx + (open ? -width : 0))), true);
  }
  function up(event: ReactPointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s?.active) return;
    const dx = event.clientX - s.x;
    const dt = Math.max(1, Date.now() - last.current.t + 16);
    const velocity = ((event.clientX - last.current.x) / dt) * 1000;
    const position = Math.max(-width, Math.min(0, dx + (open ? -width : 0)));
    const next =
      velocity < -250 ? true : velocity > 250 ? false : Math.abs(position) > width / 2;
    set(next ? -width : 0, false);
    onOpenChange(next);
  }
  return (
    <div className="swipe-host">
      <div className="swipe-actions" aria-hidden={!open}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={action.kind}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onOpenChange(false);
              action.onClick();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        ref={track}
        className="swipe-track"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          start.current = null;
          set(open ? -width : 0, false);
        }}
        onClickCapture={(event) => {
          if (swallow.current || open) {
            event.preventDefault();
            event.stopPropagation();
            if (!swallow.current) onOpenChange(false);
            swallow.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ConversationRow({
  item,
  onMenu,
}: {
  item: Conversation;
  onMenu(item: Conversation, at: { x: number; y: number }): void;
}) {
  const press = useLongPress((at) => onMenu(item, at));
  const muted = item.state.muted;
  const unread = item.unreadCount;
  const marked = item.state.markedUnread && unread === 0;
  const characterId =
    item.participants.find((participant) => participant.kind === 'character')?.refId ??
    item.conversationId;
  return (
    <Link
      to={`/chat/${item.conversationId}`}
      className={`conv-row ${item.state.pinned ? 'pinned' : ''}`}
      draggable={false}
      {...press}
    >
      <span className="avatar-badge-host">
        {item.type === 'group' ? (
          <GroupAvatar
            ids={item.participants.filter((p) => p.kind === 'character').map((p) => p.refId)}
          />
        ) : (
          <CharacterAvatar id={characterId} size={48} radius={4} />
        )}
        {(muted && unread > 0) || marked ? (
          <span className="avatar-dot" aria-label="有未读消息" />
        ) : (
          unread > 0 && (
            <span className="avatar-badge" aria-label={`${unread} 条未读`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )
        )}
      </span>
      <span className="conv-copy">
        <span className="conv-name">
          <Name conversation={item} />
        </span>
        <span className="conv-preview">
          <span>
            {muted && unread > 1 ? `[${unread}条] ` : ''}
            {item.lastMessage?.text || '开始聊天吧'}
          </span>
        </span>
      </span>
      <span className="conv-meta">
        <time>{listTime(item.lastMessage?.createdAt ?? item.updatedAt)}</time>
        <span className="mute-slot">
          {muted && <OldIcon name="wechat/bell_mute" size={15} label="消息免打扰" />}
        </span>
      </span>
    </Link>
  );
}

export function ConversationListPage() {
  const { state, online, error, synchronize, clearHistory } = useChat();
  const navigate = useNavigate();
  useMinuteTick();
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<{ item: Conversation; at: { x: number; y: number } } | null>(
    null,
  );
  const [swiped, setSwiped] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
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
  const unread = items
    .filter((item) => !item.state.muted)
    .reduce((total, item) => total + item.unreadCount, 0);
  const title = `微伴${unread > 0 ? `(${unread > 99 ? '99+' : unread})` : ''}`;
  async function act(work: () => Promise<unknown>, done?: string) {
    try {
      await work();
      await synchronize();
      if (done) showToast(done);
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  const patch = (
    item: Conversation,
    body: { pinned?: boolean; muted?: boolean; hidden?: boolean },
  ) =>
    api.call(ChatEndpoints.updateState, { params: { conversationId: item.conversationId }, body });
  const markUnread = (item: Conversation) =>
    api.call(ChatEndpoints.markUnread, { params: { conversationId: item.conversationId } });
  const markRead = (item: Conversation) =>
    api.call(ChatEndpoints.markRead, {
      params: { conversationId: item.conversationId },
      body: { readSeq: item.lastSeq },
    });
  const hide = (item: Conversation) =>
    act(
      () => patch(item, { hidden: true }),
      item.type === 'group'
        ? '已不显示该聊天，可在 通讯录 › 群聊 找回'
        : '已不显示该聊天，有新消息时会重新出现',
    );
  const hasUnread = (item: Conversation) => item.unreadCount > 0 || item.state.markedUnread;
  const menuItems = (item: Conversation): ActionItem[] => [
    {
      label: item.state.pinned ? '取消置顶' : '置顶该聊天',
      onClick: () => void act(() => patch(item, { pinned: !item.state.pinned })),
    },
    ...(hasUnread(item)
      ? []
      : [{ label: '标为未读', onClick: () => void act(() => markUnread(item)) }]),
    {
      label: item.state.muted ? '允许消息通知' : '消息免打扰',
      onClick: () => void act(() => patch(item, { muted: !item.state.muted })),
    },
    { label: '不显示该聊天', onClick: () => void hide(item) },
    { label: '删除该聊天', danger: true, onClick: () => setDeleting(item) },
  ];
  return (
    <main className="chat-list-page">
      <PullMiniApps title={title}>
        <header className="chat-list-head">
          <span />
          <h1>
            {title}
            {!online && '(未连接)'}
          </h1>
          <button
            type="button"
            className="nav-bar-icon"
            aria-label="更多"
            aria-haspopup="menu"
            onClick={() => setMenu(true)}
          >
            <OldIcon name="wechat/add_circle" size={26} />
          </button>
        </header>
        <div className="search-strip">
          <Link className="search-entry" to="/search" draggable={false}>
            <OldIcon name="wechat/search" size={17} />
            搜索
          </Link>
        </div>
        {error && (
          <p role="alert" className="notice-bar">
            {error}
          </p>
        )}
        {!state.initialized && (
          <p role="status" className="empty">
            正在读取聊天…
          </p>
        )}
        {state.initialized && items.length === 0 && (
          <div className="chat-list-empty">
            <EmptyState
              icon="wechat/chat"
              title="还没有对话"
              desc="去添加一位角色，聊起来"
              action={
                <Link className="button primary" to="/discover/plaza">
                  去添加角色
                </Link>
              }
            />
          </div>
        )}
        <VirtualList
          items={items}
          itemKey={(item) => item.conversationId}
          label="会话列表"
          estimate={72}
          render={(item) => (
            <SwipeRow
              open={swiped === item.conversationId}
              onOpenChange={(open) => setSwiped(open ? item.conversationId : null)}
              actions={[
                {
                  label: hasUnread(item) ? '标为已读' : '标为未读',
                  kind: 'read',
                  onClick: () =>
                    void act(() => (hasUnread(item) ? markRead(item) : markUnread(item))),
                },
                { label: '不显示', kind: 'hide', onClick: () => void hide(item) },
                { label: '删除', kind: 'delete', onClick: () => setDeleting(item) },
              ]}
            >
              <ConversationRow item={item} onMenu={(it, at) => setTarget({ item: it, at })} />
            </SwipeRow>
          )}
        />
      </PullMiniApps>
      {menu && (
        <PopMenu
          onClose={() => setMenu(false)}
          items={[
            { label: '发起群聊', icon: 'wechat/chat', onClick: () => navigate('/groups/new') },
            {
              label: '添加角色',
              icon: 'wechat/add_circle',
              onClick: () => navigate('/discover/plaza'),
            },
            { label: '新建角色', icon: 'wechat/person', onClick: () => setCreating(true) },
            { label: '导入角色', icon: 'wechat/note', onClick: () => navigate('/imports') },
          ]}
        />
      )}
      {creating && <NewCharacterSheet onClose={() => setCreating(false)} />}
      {target && (
        <LongPressMenu
          at={target.at}
          items={menuItems(target.item)}
          onClose={() => setTarget(null)}
        />
      )}
      {deleting && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setDeleting(null) },
            {
              label: '删除',
              danger: true,
              onClick: () => {
                const item = deleting;
                setDeleting(null);
                void act(async () => {
                  await clearHistory(item.conversationId);
                  await patch(item, { hidden: true });
                });
              },
            },
          ]}
        >
          <p>删除该聊天？TA 的记忆和养成数据会保留</p>
        </Dialog>
      )}
    </main>
  );
}
