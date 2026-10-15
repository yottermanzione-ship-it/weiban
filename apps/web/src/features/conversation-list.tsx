/*
 * 会话列表（docs/refactor/06-old-ui-spec.md 4.2）：行高 72、头像 48 圆角 4、未读角标、
 * 左滑三键（标为未读 / 不显示 / 删除）、浅色长按菜单、下拉出现小程序面板（4.3）。
 * 手感（总经理 2026-10-14）：轻点进入会话；长按（或右键）才弹菜单；左滑露出按钮；有一行展开时轻点任意行只收起。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChatEndpoints, type Conversation } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { VirtualList } from './virtual-list.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupAvatar } from './groups.js';
import { OldIcon } from './old-icons.js';
import { LongPressMenu, PopMenu, showComingSoon, type ActionItem } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';
import { PullMiniApps } from './pull-panel.js';
import { useRowGesture } from './row-gesture.js';
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

/**
 * 左滑露出按钮（参考旧版 swipe_action_row：按钮贴右撑满行高、每个 68 宽，前景完整盖住按钮；
 * 跟手、松手吸附 180ms easeOut、甩动直接展开 / 收起；同时只展开一行）。
 * 点按 / 长按 / 横滑 / 竖滚由 useRowGesture 状态机区分，互不串台。
 */
function SwipeRow({
  open,
  othersOpen,
  onOpenChange,
  onCloseOthers,
  onLongPress,
  actions,
  children,
}: {
  open: boolean;
  /** 别的行正展开着：这一行的轻点只负责把它收起（微信做法），不进入会话。 */
  othersOpen: boolean;
  onOpenChange(open: boolean): void;
  onCloseOthers(): void;
  onLongPress(at: { x: number; y: number }): void;
  actions: Array<{ label: string; kind: 'read' | 'hide' | 'delete'; onClick(): void }>;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const width = actions.length * SWIPE_BUTTON;
  // 手势只归前景行；右侧操作按钮必须收到自己的点击，不能被收起行的捕获监听吞掉。
  useRowGesture(track, track, {
    swipeWidth: width,
    open,
    othersOpen,
    onOpenChange,
    onCloseOthers,
    onLongPress,
  });
  return (
    <div className="swipe-host">
      <div className="swipe-actions" aria-hidden={!open} style={{ width }}>
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
      <div ref={track} className="swipe-track">
        {children}
      </div>
    </div>
  );
}

function ConversationRow({ item }: { item: Conversation }) {
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
    >
      <span className="avatar-badge-host">
        {item.type === 'group' ? (
          <GroupAvatar
            ids={item.participants.filter((p) => p.kind === 'character').map((p) => p.refId)}
            mediaId={item.group?.avatarMediaId}
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
    {
      label: hasUnread(item) ? '标为已读' : '标为未读',
      onClick: () => void act(() => (hasUnread(item) ? markRead(item) : markUnread(item))),
    },
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
        <VirtualList
          items={items}
          itemKey={(item) => item.conversationId}
          label="会话列表"
          estimate={72}
          render={(item) => (
            <SwipeRow
              open={swiped === item.conversationId}
              othersOpen={swiped !== null && swiped !== item.conversationId}
              onOpenChange={(open) => setSwiped(open ? item.conversationId : null)}
              onCloseOthers={() => setSwiped(null)}
              onLongPress={(at) => {
                setSwiped(null);
                setTarget({ item, at });
              }}
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
              <ConversationRow item={item} />
            </SwipeRow>
          )}
        />
      </PullMiniApps>
      {menu && (
        <PopMenu
          onClose={() => setMenu(false)}
          items={[
            { label: '发起群聊', icon: 'wechat/chat', onClick: () => navigate('/groups/new') },
            { label: '添加朋友', icon: 'wechat/person', onClick: () => navigate('/contacts/add') },
            { label: '扫一扫', icon: 'wechat/discover_scan', onClick: showComingSoon },
            { label: '收付款', icon: 'wechat/transfer', onClick: showComingSoon },
          ]}
        />
      )}
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
