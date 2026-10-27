/*
 * 会话列表（docs/refactor/06-old-ui-spec.md 4.2）：行高 72、头像 48 圆角 4、未读角标、
 * 左滑三键（标为未读 / 不显示 / 删除）、浅色长按菜单、下拉出现小程序面板（4.3）。
 * 手感（总经理 2026-10-14）：轻点进入会话；长按（或右键）才弹菜单；左滑露出按钮；有一行展开时轻点任意行只收起。
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChatEndpoints, type Conversation, type Message } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { VirtualList } from './virtual-list.js';
import { Name } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupAvatar } from './groups.js';
import { OldIcon } from './old-icons.js';
import { LongPressMenu, PopMenu, showComingSoon, type ActionItem } from './shell-kit.js';
import { AlertDialog, showSnackbar, showToast } from './toast.js';
import { PullMiniApps } from './pull-panel.js';
import { useRowGesture } from './row-gesture.js';
import { listTime } from './time-format.js';

const SWIPE_BUTTON = 68;

/**
 * 会话列表页不允许整页或外层容器被「滚」走（10-20 总经理反馈：标题栏「微伴」偶尔被吃掉、搜索框顶到最上面）。
 * 原因是整页比屏幕高、外层 overflow:hidden 的容器仍能被程序滚动；CSS 已堵住，这里再兜底：
 * 进入页面时复位，之后窗口、页面容器、列表外框一旦出现滚动立即归零（列表自身和小程序宫格照常滚动）。
 */
function usePinnedTop(page: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const main = page.current;
    if (!main) return;
    const pinWindow = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    const pinBox = (event: Event) => {
      const target = event.target as HTMLElement;
      if ((target === main || target.classList?.contains('pull-list')) && target.scrollTop !== 0)
        target.scrollTop = 0;
    };
    pinWindow();
    main.scrollTop = 0;
    window.addEventListener('scroll', pinWindow, { passive: true });
    main.addEventListener('scroll', pinBox, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', pinWindow);
      main.removeEventListener('scroll', pinBox, { capture: true });
    };
  }, [page]);
}

/**
 * 会话列表第二行的摘要（参照微信）：文字显示正文，其余类型显示 [图片] [语音] [链接] 标题 [语音通话] [名片] 名字
 * [聊天记录] 等。服务器的摘要对非文字（以及成人范围）消息一律给「[消息]」，所以优先用本机已同步的那条消息自己算；
 * 撤回、系统提示、拍一拍等服务器已给出可读文字的，照用服务器的。本机没有那条消息时绝不显示「[消息]」。
 * 3.25（G1-3）：私密模式消息一律显示「[私密消息]」，不露正文（与服务器一致）。
 */
/** 3.25：会话列表里私密模式消息的摘要（契约 MessagePreview）。 */
export const PRIVATE_MESSAGE_PREVIEW = '[私密消息]';

export function listPreview(last: Conversation['lastMessage'], local: Message | undefined): string {
  if (!last) return '';
  const server = last.text === '[消息]' ? '' : last.text;
  if (!local || local.status === 'recalled') return server;
  if (local.scope === 'adult') return PRIVATE_MESSAGE_PREVIEW;
  const c = local.content;
  switch (c?.type) {
    case 'text':
      return c.text;
    case 'image':
      return '[图片]';
    case 'voice':
      return '[语音]';
    case 'sticker':
      return '[动画表情]';
    case 'link':
      return `[链接] ${c.title}`;
    case 'contact_card':
      return `[名片] ${c.name}`;
    case 'call_record':
      return '[语音通话]';
    case 'letter':
      return '[信件]';
    case 'daily_question':
      return `[每日一问] ${c.question}`;
    case 'action_card':
      return c.text;
    case 'forwarded_record':
      return '[聊天记录]';
    case 'unsupported':
      return server || '[当前版本不支持此消息]';
    default:
      // system / nudge 等：服务器已按类型给出文字
      return server;
  }
}

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

/**
 * 一行会话。这里故意不加 React.memo：同步引擎是「原地改」会话对象的（未读数、摘要、免打扰都在原对象上改），
 * props 引用不变但内容会变，memo 会让未读角标和摘要停在旧值。
 * 滚动时不重渲染由 VirtualList 的行元素缓存保证（滚动只重算窗口，不重跑 render），
 * 头像 / 图片子树另有 memo（CharacterAvatar、MediaImg）。
 */
function ConversationRow({ item, local }: { item: Conversation; local: Message | undefined }) {
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
            {item.lastMessage ? listPreview(item.lastMessage, local) : '开始聊天吧'}
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
  const { state, error, errorFatal, dismissError, synchronize, clearHistory } = useChat();
  const navigate = useNavigate();
  useMinuteTick();
  const [menu, setMenu] = useState(false);
  const [target, setTarget] = useState<{ item: Conversation; at: { x: number; y: number } } | null>(
    null,
  );
  const [swiped, setSwiped] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const page = useRef<HTMLElement>(null);
  usePinnedTop(page);
  const byId = useMemo(
    () => new Map(state.messages.map((message) => [message.messageId, message])),
    [state.messages],
  );
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
  // U2：不显示该聊天可撤销——直接隐藏，底部撤销条「撤销」把它放回列表
  async function hide(item: Conversation) {
    try {
      await patch(item, { hidden: true });
      await synchronize();
    } catch (e) {
      showToast(friendlyError(e));
      return;
    }
    showSnackbar({
      text:
        item.type === 'group'
          ? '已不显示该聊天，可在 通讯录 › 群聊 找回'
          : '已不显示该聊天，有新消息时会重新出现',
      onAction: () => act(() => patch(item, { hidden: false })),
    });
  }
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
    <main ref={page} className="chat-list-page">
      <PullMiniApps title={title}>
        <header className="chat-list-head">
          <span />
          <h1>{title}</h1>
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
          <div role="alert" className="notice-bar">
            <span>{error}</span>
            {errorFatal && (
              <button
                type="button"
                className="notice-bar-action"
                onClick={() => window.location.reload()}
              >
                重新打开
              </button>
            )}
            <button
              type="button"
              className="notice-bar-close"
              aria-label="关闭提示"
              onClick={dismissError}
            >
              <OldIcon name="wechat/close" size={16} />
            </button>
          </div>
        )}
        {/* U7：首次读取只显示骨架屏，不再叠一行「正在读取聊天…」；已有本机列表时不显示加载态。 */}
        {!state.initialized && !items.length && (
          <div className="chat-list-loading" role="status" aria-label="正在读取聊天">
            <div className="conversation-skeleton" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div className="conversation-skeleton-row" key={row}>
                  <span className="conversation-skeleton-avatar" />
                  <span>
                    <span className="skeleton-line" />
                    <span className="skeleton-line" />
                  </span>
                </div>
              ))}
            </div>
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
              <ConversationRow
                item={item}
                local={item.lastMessage ? byId.get(item.lastMessage.messageId) : undefined}
              />
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
      {/* U2：删除聊天会清空记录，不可撤销 → Alert Dialog */}
      {deleting && (
        <AlertDialog
          title="删除该聊天？"
          message="聊天记录会清空，不能恢复；TA 的记忆和养成数据会保留。"
          confirmLabel="删除聊天"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const item = deleting;
            setDeleting(null);
            void act(async () => {
              await clearHistory(item.conversationId);
              await patch(item, { hidden: true });
            });
          }}
        />
      )}
    </main>
  );
}
