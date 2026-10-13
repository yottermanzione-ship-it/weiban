/*
 * 会话列表下拉出现小程序面板（docs/refactor/06-old-ui-spec.md 4.3，按微信手势与动画）。
 * - 列表在最顶端时继续下拉：整块跟手下移（阻尼 0.5），手指下移 ≥ 24 出现三个小圆点，≥ 80 圆点变实心并轻震；
 *   松手不到 80 → 200ms 弹回；到 80 → 打开面板（列表下移到只露出底部 64 高的一条、面板内容淡入、标签栏收起）。
 * - 触屏用手指；电脑浏览器可按住鼠标往下拖，或在列表顶端继续向上滚动滚轮。
 * - 收起：点底部露出条、按返回（打开时写一条历史记录）、Esc、或在面板里向上滑超过 60。
 * - 手势过程中直接改 DOM 的 transform / opacity，不触发 React 重渲染；面板首次打开前已用 visibility 预渲染。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { OldIcon } from './old-icons.js';
import { LongPressMenu, type ActionItem } from './shell-kit.js';
import { MiniAppCell, useMiniAppPrefs, type MiniApp } from './miniapps.js';

const DAMPING = 0.5;
const DOTS_FROM = 24;
const THRESHOLD = 80;
const MAX_FINGER = 220;
const TAIL = 64;

function listAtTop(root: HTMLElement | null) {
  const list = root?.querySelector<HTMLElement>('.virtual-list');
  return !list || list.scrollTop <= 0;
}

export function PullMiniApps({ title, children }: { title: ReactNode; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const open = (location.state as { miniPanel?: boolean } | null)?.miniPanel === true;
  const listRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const finger = useRef(0);
  const armed = useRef(false);
  const drag = useRef<{ y: number; x: number; active: boolean; mouse: boolean } | null>(null);
  const moved = useRef(false);
  const wheelTimer = useRef(0);
  const [visible, setVisible] = useState(open);

  const paint = useCallback((value: number, dragging: boolean) => {
    finger.current = value;
    const list = listRef.current;
    const dots = dotsRef.current;
    if (list) {
      list.classList.toggle('dragging', dragging);
      list.style.transform = value > 0 ? `translateY(${value * DAMPING}px)` : '';
    }
    if (dots) {
      const t = Math.max(0, Math.min(1, (value - DOTS_FROM) / (THRESHOLD - DOTS_FROM)));
      dots.style.opacity = String(value >= DOTS_FROM ? t : 0);
      dots.style.transform = `translateY(${Math.max(0, (value * DAMPING) / 2 - 3)}px)`;
      dots.style.setProperty('--dots-gap', `${12 * t}px`);
      const nowArmed = value >= THRESHOLD;
      dots.classList.toggle('armed', nowArmed);
      if (nowArmed && !armed.current) navigator.vibrate?.(10);
      armed.current = nowArmed;
    }
  }, []);

  const openPanel = useCallback(() => {
    setVisible(true);
    navigate(location.pathname, { state: { miniPanel: true } });
  }, [navigate, location.pathname]);
  const close = useCallback(() => {
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate(location.pathname, { replace: true, state: null });
  }, [navigate, location.pathname]);

  const release = useCallback(() => {
    const reached = finger.current >= THRESHOLD;
    const list = listRef.current;
    list?.classList.remove('dragging');
    if (reached) {
      finger.current = 0;
      if (dotsRef.current) dotsRef.current.style.opacity = '0';
      armed.current = false;
      openPanel();
    } else {
      list?.classList.add('bounce');
      paint(0, false);
      window.setTimeout(() => list?.classList.remove('bounce'), 220);
    }
  }, [openPanel, paint]);

  // 打开 / 收起：列表移到只露出底部 64、标签栏收起（只动 transform）。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (open) {
      setVisible(true);
      list.classList.remove('dragging', 'closing');
      const distance = window.innerHeight - TAIL - list.offsetTop;
      list.style.transform = `translateY(${Math.max(0, distance)}px)`;
    } else {
      list.classList.add('closing');
      list.style.transform = '';
      const timer = window.setTimeout(() => {
        list.classList.remove('closing');
        setVisible(false);
      }, 260);
      return () => window.clearTimeout(timer);
    }
  }, [open]);
  useEffect(() => {
    document.body.classList.toggle('pull-open', open);
    return () => document.body.classList.remove('pull-open');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 鼠标拖拽：在窗口上跟踪，松开后吞掉这次点击。
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start?.mouse) return;
      const dy = event.clientY - start.y;
      if (!start.active) {
        if (dy > 6) start.active = true;
        else if (dy < -6) {
          drag.current = null;
          return;
        } else return;
      }
      moved.current = true;
      paint(Math.min(MAX_FINGER, Math.max(0, dy)), true);
    };
    const up = () => {
      const start = drag.current;
      drag.current = null;
      if (start?.mouse && start.active) release();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [paint, release]);

  return (
    <>
      <div ref={dotsRef} className="pull-dots" aria-hidden style={{ opacity: 0 }}>
        <i />
        <i />
        <i />
      </div>
      <MiniPanel open={open} visible={visible} onClose={close} />
      <button
        type="button"
        className="pull-tail"
        aria-label="收起小程序，回到微伴"
        tabIndex={open ? 0 : -1}
        onClick={close}
      >
        {title}
      </button>
      <div
        ref={listRef}
        className="pull-list"
        aria-hidden={open}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch || open || !listAtTop(listRef.current)) return;
          drag.current = { y: touch.clientY, x: touch.clientX, active: false, mouse: false };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          const start = drag.current;
          if (!touch || !start || start.mouse) return;
          const dy = touch.clientY - start.y;
          const dx = Math.abs(touch.clientX - start.x);
          if (!start.active) {
            if (dy > 8 && dy > dx && listAtTop(listRef.current)) start.active = true;
            else if (dy < 0 || dx > 8) {
              drag.current = null;
              return;
            } else return;
          }
          paint(Math.min(MAX_FINGER, Math.max(0, dy)), true);
        }}
        onTouchEnd={() => {
          const start = drag.current;
          drag.current = null;
          if (start?.active) release();
        }}
        onTouchCancel={() => {
          drag.current = null;
          paint(0, false);
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || open) return;
          if (!listAtTop(listRef.current)) return;
          moved.current = false;
          drag.current = { y: event.clientY, x: event.clientX, active: false, mouse: true };
        }}
        onClickCapture={(event) => {
          if (moved.current) {
            event.preventDefault();
            event.stopPropagation();
            moved.current = false;
          }
        }}
        onDragStart={(event) => event.preventDefault()}
        onWheel={(event) => {
          if (open || event.deltaY >= 0 || !listAtTop(listRef.current)) {
            if (finger.current > 0 && event.deltaY > 0) paint(0, false);
            return;
          }
          // 滚轮在顶端继续向上：累积成「下拉」，停顿 200ms 后按松手处理。
          paint(Math.min(MAX_FINGER, finger.current + Math.min(40, -event.deltaY) * 0.6), true);
          window.clearTimeout(wheelTimer.current);
          wheelTimer.current = window.setTimeout(release, 200);
        }}
      >
        {children}
      </div>
    </>
  );
}

function MiniPanel({
  open,
  visible,
  onClose,
}: {
  open: boolean;
  visible: boolean;
  onClose(): void;
}) {
  const prefs = useMiniAppPrefs();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ActionItem[] } | null>(
    null,
  );
  const startY = useRef<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const go = (app: MiniApp) => navigate(app.home, { replace: true });
  const recent = prefs.recent.slice(0, 8);
  return (
    <div
      className={`pull-panel ${visible ? 'visible' : ''} ${open ? 'open' : ''}`}
      role="dialog"
      aria-label="小程序"
      aria-hidden={!open}
      onTouchStart={(event) => {
        startY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(event) => {
        const endY = event.changedTouches[0]?.clientY;
        const el = scroll.current;
        const atEnd = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (startY.current !== null && endY !== undefined && startY.current - endY > 60 && atEnd)
          onClose();
        startY.current = null;
      }}
    >
      <div className="pull-panel-inner">
        <h2>小程序</h2>
        <Link className="search-entry" to="/miniapps" replace tabIndex={open ? 0 : -1}>
          <OldIcon name="wechat/search" size={17} />
          搜索小程序
        </Link>
        <div ref={scroll} className="pull-scroll">
          {recent.length > 0 && (
            <>
              <h3 className="pull-section">最近使用</h3>
              <div className="miniapp-grid">
                {recent.map((app) => (
                  <MiniAppCell
                    key={app.id}
                    app={app}
                    onPick={() => go(app)}
                    onMenu={(at) =>
                      setMenu({
                        at,
                        items: [
                          { label: '移出最近使用', onClick: () => prefs.removeRecent(app) },
                          ...(prefs.inMine(app)
                            ? []
                            : [
                                { label: '添加到我的小程序', onClick: () => prefs.toggleMine(app) },
                              ]),
                        ],
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}
          <h3 className="pull-section">我的小程序</h3>
          <div className="miniapp-grid">
            {prefs.mine.map((app) => (
              <MiniAppCell
                key={app.id}
                app={app}
                onPick={() => go(app)}
                onMenu={(at) =>
                  setMenu({
                    at,
                    items: [
                      { label: '移到最前', onClick: () => prefs.moveToFront(app) },
                      { label: '移出我的小程序', onClick: () => prefs.toggleMine(app) },
                    ],
                  })
                }
              />
            ))}
          </div>
        </div>
      </div>
      {menu && <LongPressMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
