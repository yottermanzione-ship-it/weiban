/**
 * 滚动手感夹具（管理员 2026-10-25「聊天列表上下滑动卡手」自测用）：
 * 直接挂真实 VirtualList / PullMiniApps / useRowGesture，行内容用等价数据（几百行、可变行高），
 * 只补夹具布局，不复制应用逻辑。?page=conv 为固定 72 行高的会话列表，
 * ?page=chat 为可变行高、底部跟随的消息列表。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import '../../src/app/chat-old.css';
import '../../src/app/common-fixes.css';
import { VirtualList } from '../../src/features/virtual-list.js';
import { PullMiniApps } from '../../src/features/pull-panel.js';
import { useRowGesture } from '../../src/features/row-gesture.js';

const SWIPE = 3 * 68;

/** 会话行：与 conversation-list.tsx 同结构（swipe-host / swipe-track / conv-row），手势也用同一个状态机。 */
function ConvRow({ index }: { index: number }) {
  const track = useRef<HTMLDivElement>(null);
  const noop = () => {};
  useRowGesture(track, track, {
    swipeWidth: SWIPE,
    open: false,
    othersOpen: false,
    onOpenChange: noop,
    onCloseOthers: noop,
    onLongPress: noop,
  });
  return (
    <div className="swipe-host">
      <div className="swipe-actions" aria-hidden style={{ width: SWIPE }}>
        {['标为已读', '不显示', '删除'].map((label) => (
          <button key={label} type="button" className="read" tabIndex={-1}>
            {label}
          </button>
        ))}
      </div>
      <div ref={track} className="swipe-track">
        <a className="conv-row" href={`#conv-${index}`} draggable={false}>
          <span className="avatar-badge-host">
            <span className="character-avatar" style={{ width: 48, height: 48 }} />
          </span>
          <span className="conv-copy">
            <span className="conv-name">会话 {index}</span>
            <span className="conv-preview">
              <span>最后一条消息 {index}</span>
            </span>
          </span>
          <span className="conv-meta">
            <time>12:00</time>
            <span className="mute-slot" />
          </span>
        </a>
      </div>
    </div>
  );
}

function ConvFixture({ rows }: { rows: number }) {
  const items = Array.from({ length: rows }, (_, i) => i);
  const render = useCallback((index: number) => <ConvRow index={index} />, []);
  return (
    <div className="app-shell with-tabs">
      <main className="chat-list-page">
        <PullMiniApps title="微伴">
          <header className="chat-list-head">
            <span />
            <h1>微伴</h1>
            <button type="button" className="nav-bar-icon" aria-label="更多">
              +
            </button>
          </header>
          <div className="search-strip">
            <span className="search-entry">搜索</span>
          </div>
          <VirtualList
            items={items}
            itemKey={(index) => `conv-${index}`}
            label="会话列表"
            estimate={72}
            render={render}
          />
        </PullMiniApps>
      </main>
      <nav className="tabbar">微伴 通讯录 发现 我</nav>
    </div>
  );
}

type Msg = { key: string; seq: number; text: string };

function makeMessages(from: number, count: number): Msg[] {
  return Array.from({ length: count }, (_, i) => {
    const seq = from + i;
    // 文本长度随序号变化 → 自然换行成 1～5 行，行高不等（等价真实消息的可变高度）。
    return { key: `m-${seq}`, seq, text: `第 ${seq} 条 ${'内容'.repeat(Math.abs(seq) % 12)}` };
  });
}

type Hooks = {
  prepend(count: number): void;
  append(): void;
  locate(key: string): void;
  keys(): string[];
};

function ChatFixture({ rows }: { rows: number }) {
  const [items, setItems] = useState<Msg[]>(() => makeMessages(0, rows));
  const [bottomFlag, setBottomFlag] = useState(true);
  const [target, setTarget] = useState<{ key: string; nonce: number } | null>(null);
  const counter = useRef({ start: 0, bottom: 0 });
  const older = useRef(0);
  const hooks = useRef<Hooks | null>(null);

  hooks.current = {
    prepend: (count) => {
      const start = -(older.current + count);
      older.current += count;
      setItems((prev) => [...makeMessages(start, count), ...prev]);
    },
    append: () => setItems((prev) => [...prev, ...makeMessages((prev.at(-1)?.seq ?? 0) + 1, 1)]),
    locate: (key) => setTarget({ key, nonce: Date.now() }),
    keys: () => items.map((item) => item.key),
  };

  useEffect(() => {
    Object.assign(window, {
      __scrollHooks: {
        prepend: (count: number) => hooks.current?.prepend(count),
        append: () => hooks.current?.append(),
        locate: (key: string) => hooks.current?.locate(key),
        keys: () => hooks.current?.keys() ?? [],
      },
      __scrollStats: () => ({ start: counter.current.start, bottom: counter.current.bottom }),
      __scrollBottom: () => bottomFlag,
    });
  }, [bottomFlag]);

  const render = useCallback(
    (item: Msg) => (
      <div className="fixture-row">
        <div className="fixture-bubble">{item.text}</div>
      </div>
    ),
    [],
  );

  return (
    <div className="chat-fixture">
      <div className="wx-chat-body">
        <VirtualList
          items={items}
          itemKey={(item) => item.key}
          label="聊天消息"
          estimate={64}
          bottom
          onBottom={(value) => {
            counter.current.bottom += 1;
            setBottomFlag(value);
          }}
          onStart={() => {
            counter.current.start += 1;
          }}
          scrollTo={target}
          render={render}
        />
      </div>
    </div>
  );
}

const rows = Number(new URLSearchParams(location.search).get('rows') ?? '') || 0;
const page = new URLSearchParams(location.search).get('page') ?? 'conv';

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/']}>
    {page === 'chat' ? <ChatFixture rows={rows || 400} /> : <ConvFixture rows={rows || 300} />}
  </MemoryRouter>,
);
