/*
 * 会话列表下拉出现小程序面板（06-old-ui-spec 4.3；总经理 2026-10-14 反馈：照微信的阻尼、阈值、回弹与半拉提示）。
 * - 列表在最顶端时继续下拉：整块（标题栏 + 列表）跟手下移，位移按「橡皮筋」曲线衰减（越拉越沉）；
 *   上方露出深色面板底色和三个小圆点：圆点随下拉渐显并向两侧散开，拉过一半出现「继续下拉进入小程序」，
 *   到阈值后圆点变大变亮、提示改为「松开进入小程序」并轻震。
 * - 松手：没到阈值 → 带一点回弹的动画收回；到了 → 列表滑到底部只露出 64 高的一条，面板内容淡入、标签栏收起。
 * - 触屏用手指；电脑可按住鼠标往下拖，或在列表顶端用滚轮 / 触控板继续向上滚
 *   （从下面惯性滚到顶的那一下不算，需停顿后再滚）。
 * - 收起：点底部露出条、浏览器返回（打开时写一条历史记录）、Esc、或在面板里向上滑超过 60。
 * - 手势过程中直接改 DOM 的 transform / opacity，不触发 React 重渲染。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { OldIcon } from './old-icons.js';
import { LongPressMenu, type ActionItem } from './shell-kit.js';
import { MiniAppCell, useMiniAppPrefs, type MiniApp } from './miniapps.js';

/** 手指移动多少像素后才算下拉（避免和点按、左滑冲突）。 */
const SLOP = 8;
/** 到阈值需要的「位移」（不是手指距离）；手指约需拉 150 像素。 */
const THRESHOLD = 96;
const TAIL = 64;
/** 鼠标滚轮：两次滚动间隔超过它算新的一次滚动。 */
const WHEEL_GAP = 260;

/** 橡皮筋：手指距离 → 列表位移。开始约 0.75 倍跟手，越往下越沉。 */
function rubber(finger: number, height: number) {
  const limit = Math.max(240, height * 0.55);
  return limit * (1 - 1 / ((finger * 0.75) / limit + 1));
}

function listAtTop(root: HTMLElement | null) {
  const list = root?.querySelector<HTMLElement>('.virtual-list');
  return !list || list.scrollTop <= 0;
}

export function PullMiniApps({ title, children }: { title: ReactNode; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const open = (location.state as { miniPanel?: boolean } | null)?.miniPanel === true;
  const listRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const finger = useRef(0);
  const offset = useRef(0);
  const armed = useRef(false);
  const drag = useRef<{ y: number; x: number; active: boolean; mouse: boolean } | null>(null);
  const moved = useRef(false);
  const wheel = useRef({ last: 0, blocked: false, timer: 0 });
  const [visible, setVisible] = useState(open);

  /** 按手指距离画出当前状态（只改 transform / opacity）。 */
  const paint = useCallback((value: number, dragging: boolean) => {
    finger.current = value;
    const list = listRef.current;
    const hint = hintRef.current;
    const y = value > 0 ? rubber(value, list?.clientHeight ?? 600) : 0;
    offset.current = y;
    if (list) {
      list.classList.toggle('dragging', dragging);
      list.style.transform = y > 0 ? `translateY(${y}px)` : '';
    }
    if (hint) {
      const t = Math.max(0, Math.min(1, y / THRESHOLD));
      hint.classList.toggle('dragging', dragging);
      hint.style.opacity = String(t < 0.12 ? 0 : Math.min(1, (t - 0.12) / 0.5));
      // 提示块居中在露出的深色区域里
      hint.style.transform = `translateY(${Math.max(0, y / 2 - 18)}px)`;
      hint.style.setProperty('--dots-gap', `${4 + 10 * t}px`);
      hint.classList.toggle('half', t >= 0.5);
      const nowArmed = y >= THRESHOLD;
      hint.classList.toggle('armed', nowArmed);
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
    const reached = offset.current >= THRESHOLD;
    const list = listRef.current;
    const hint = hintRef.current;
    list?.classList.remove('dragging');
    hint?.classList.remove('dragging');
    if (reached) {
      finger.current = 0;
      armed.current = false;
      if (hint) {
        hint.style.opacity = '0';
        hint.classList.remove('armed', 'half');
      }
      openPanel();
    } else {
      list?.classList.add('bounce');
      hint?.classList.add('bounce');
      paint(0, false);
      window.setTimeout(() => {
        list?.classList.remove('bounce');
        hint?.classList.remove('bounce');
      }, 360);
    }
  }, [openPanel, paint]);

  // 打开 / 收起：列表移到只露出底部 64、标签栏收起（只动 transform）。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (open) {
      setVisible(true);
      list.classList.remove('dragging', 'closing', 'bounce');
      const top = list.getBoundingClientRect().top - offset.current;
      offset.current = 0;
      list.style.transform = `translateY(${Math.max(0, window.innerHeight - TAIL - top)}px)`;
    } else {
      list.classList.add('closing');
      list.style.transform = '';
      const timer = window.setTimeout(() => {
        list.classList.remove('closing');
        setVisible(false);
      }, 320);
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

  // 鼠标拖拽：在窗口上跟踪（拖出列表也不断），松开后吞掉这次点击。
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start?.mouse) return;
      const dy = event.clientY - start.y;
      const dx = Math.abs(event.clientX - start.x);
      if (!start.active) {
        if (dy > SLOP && dy > dx) start.active = true;
        else if (dy < -SLOP || dx > SLOP) {
          drag.current = null;
          return;
        } else return;
      }
      moved.current = true;
      paint(Math.max(0, dy - SLOP), true);
    };
    const up = () => {
      const start = drag.current;
      drag.current = null;
      if (start?.mouse && start.active) release();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [paint, release]);
  useEffect(() => {
    const state = wheel.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  return (
    <>
      <div ref={hintRef} className="pull-hint" aria-hidden style={{ opacity: 0 }}>
        <span className="pull-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="pull-hint-text">
          <span className="more">继续下拉进入小程序</span>
          <span className="go">松开进入小程序</span>
        </span>
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
          if (!touch || event.touches.length > 1 || open || !listAtTop(listRef.current)) {
            drag.current = null;
            return;
          }
          drag.current = { y: touch.clientY, x: touch.clientX, active: false, mouse: false };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          const start = drag.current;
          if (!touch || !start || start.mouse) return;
          const dy = touch.clientY - start.y;
          const dx = Math.abs(touch.clientX - start.x);
          if (!start.active) {
            if (dy > SLOP && dy > dx && listAtTop(listRef.current)) start.active = true;
            else if (dy < -SLOP || dx > SLOP) {
              drag.current = null;
              return;
            } else return;
          }
          paint(Math.max(0, dy - SLOP), true);
        }}
        onTouchEnd={() => {
          const start = drag.current;
          drag.current = null;
          if (start?.active) release();
        }}
        onTouchCancel={() => {
          const start = drag.current;
          drag.current = null;
          if (start?.active) release();
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
          if (open) return;
          const w = wheel.current;
          const now = Date.now();
          const fresh = now - w.last > WHEEL_GAP;
          w.last = now;
          const top = listAtTop(listRef.current);
          // 从下面滚上来、惯性滚到顶的这一串不算下拉；停顿一下再滚才算
          if (fresh) w.blocked = !top;
          else if (!top) w.blocked = true;
          if (finger.current > 0 && event.deltaY > 0) {
            paint(Math.max(0, finger.current - event.deltaY), true);
          } else if (event.deltaY < 0 && top && !w.blocked) {
            paint(finger.current + Math.min(60, -event.deltaY), true);
          } else return;
          window.clearTimeout(w.timer);
          // 停止滚动 250ms 后按「松手」处理
          w.timer = window.setTimeout(() => {
            if (finger.current > 0) release();
          }, 250);
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
