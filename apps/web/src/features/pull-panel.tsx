/*
 * 会话列表「下拉二楼」：下拉出现小程序面板（06 §4.3；总经理 10-14 总对照表 T1.3 / T1.3.4 意见后重写）。
 *
 * 做法参照成熟的「下拉二楼」实现（微信下拉小程序、淘宝 / 京东二楼）与手势库 @use-gesture、react-spring 的处理方式，
 * 没有引入第三方库，只取它们的三个核心：
 * 1. 跟手阻尼：位移 = use-gesture 的 rubberband 公式 (d·D·c)/(D + c·d)，越拉越沉；
 * 2. 速度判定：记录最近 100ms 的手指采样算速度，快速甩动即使距离不够也能打开 / 收起；
 * 3. 松手弹簧：按 react-spring 的「张力 + 摩擦」弹簧逐帧推进（带初速度），不是固定时长的 CSS 过渡。
 * 滚动冲突：只有列表滚到最顶、且第一段移动是向下时才接管；接管后用非被动监听阻止浏览器滚动，
 * 否则浏览器一接管 touchmove 会降到每秒约 5 次，跟手一顿一顿。会话行的点按 / 长按 / 左滑另有状态机，互不干扰。
 *
 * 面板：只有一个宫格（微伴自己的十来个功能，不是小程序平台）——不能删除；长按图标可拖动换位，
 * 原地松手弹出「移到最前」。收起：面板底部露出的那一条微伴聊天列表（高 120）上滑或轻点、面板里上滑、
 * 浏览器返回、Esc。电脑：按住鼠标拖、滚轮 / 触控板在顶端继续上滚可打开；在露出条上往上拖或往下滚可收起。
 * 全程只改 transform / opacity，不触发 React 重渲染。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LongPressMenu, type ActionItem } from './shell-kit.js';
import { MiniAppIcon, useMiniAppPrefs, type MiniApp } from './miniapps.js';

/** 手指移动多少像素后才算拖动（与会话行状态机的 10 像素配合：先于行判定为竖滚）。 */
const SLOP = 8;
/** 打开阈值（位移）；手指约需拉 150 像素。 */
const THRESHOLD = 90;
/** 打开后底部露出的聊天列表高度（总经理要求拉高一些，便于上滑收起）。 */
const TAIL = 120;
/** 快速甩动判定：像素 / 毫秒。 */
const FLICK = 0.5;
/** 收起需要上拉的距离。 */
const CLOSE_DISTANCE = 80;
const WHEEL_GAP = 260;

/** use-gesture 的橡皮筋公式。 */
function rubberband(distance: number, dimension: number, constant = 0.7) {
  if (distance <= 0) return 0;
  return (distance * dimension * constant) / (dimension + constant * distance);
}

/** 最近 100ms 的采样算速度（像素 / 毫秒）。 */
class Velocity {
  private samples: Array<{ v: number; t: number }> = [];
  reset(v: number) {
    this.samples = [{ v, t: performance.now() }];
  }
  push(v: number) {
    const t = performance.now();
    this.samples.push({ v, t });
    while (this.samples.length > 2 && t - this.samples[0]!.t > 100) this.samples.shift();
  }
  get() {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t - first.t < 8) return 0;
    return (last.v - first.v) / (last.t - first.t);
  }
}

/** react-spring 式弹簧：张力 280、摩擦 30（略欠阻尼，有一点回弹感）。 */
function runSpring(
  from: number,
  to: number,
  velocity: number,
  onFrame: (x: number) => void,
  onDone: () => void,
) {
  const tension = 280;
  const friction = 30;
  let x = from;
  let v = velocity * 1000; // 像素 / 秒
  let last = performance.now();
  let handle = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    onFrame(to);
    onDone();
    return () => {};
  }
  const step = (now: number) => {
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    // 细分步长保证稳定
    while (dt > 0) {
      const h = Math.min(dt, 0.008);
      const a = -tension * (x - to) - friction * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 8) {
      onFrame(to);
      onDone();
      return;
    }
    onFrame(x);
    handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}

function listAtTop(root: HTMLElement | null) {
  const list = root?.querySelector<HTMLElement>('.virtual-list');
  return !list || list.scrollTop <= 0;
}

type Drag = {
  /** closed：从列表顶端往下拉；open：从露出条 / 面板往上推。 */
  from: 'closed' | 'open';
  startX: number;
  startY: number;
  active: boolean;
  mouse: boolean;
};

export function PullMiniApps({ title, children }: { title: ReactNode; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const open = (location.state as { miniPanel?: boolean } | null)?.miniPanel === true;
  const listRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLButtonElement>(null);
  const y = useRef(0);
  const target = useRef(0);
  const stopAnim = useRef<() => void>(() => {});
  const armed = useRef(false);
  const drag = useRef<Drag | null>(null);
  const velocity = useRef(new Velocity());
  const swallowClick = useRef(false);
  const wheel = useRef({ last: 0, blocked: false, timer: 0, sum: 0 });
  const openRef = useRef(open);
  const [visible, setVisible] = useState(open);

  const openY = useCallback(() => {
    const list = listRef.current;
    if (!list) return 600;
    const naturalTop = list.getBoundingClientRect().top - y.current;
    return Math.max(THRESHOLD + 40, window.innerHeight - TAIL - naturalTop);
  }, []);

  /** 画出位移 value（只改 transform / opacity）。 */
  const paint = useCallback(
    (value: number) => {
      y.current = value;
      const list = listRef.current;
      const hint = hintRef.current;
      const panel = panelRef.current;
      const full = openY();
      if (list) list.style.transform = value > 0.5 ? `translateY(${value}px)` : '';
      const progress = Math.max(0, Math.min(1, value / full));
      if (panel) {
        panel.style.setProperty('--pull-progress', String(progress));
        if (value > 0.5) panel.classList.add('visible');
      }
      if (hint) {
        // 提示只在「从关闭往下拉」的前半程出现
        const t = Math.max(0, Math.min(1, value / THRESHOLD));
        const fade = openRef.current
          ? 0
          : Math.max(0, 1 - Math.max(0, value - THRESHOLD * 1.6) / 80);
        hint.style.opacity = String(t < 0.12 ? 0 : Math.min(1, (t - 0.12) / 0.5) * fade);
        hint.style.transform = `translateY(${Math.max(0, value / 2 - 18)}px)`;
        hint.style.setProperty('--dots-gap', `${4 + 10 * t}px`);
        hint.classList.toggle('half', t >= 0.5);
        const nowArmed = !openRef.current && value >= THRESHOLD;
        hint.classList.toggle('armed', nowArmed);
        if (nowArmed && !armed.current) navigator.vibrate?.(10);
        armed.current = nowArmed;
      }
    },
    [openY],
  );

  const animateTo = useCallback(
    (to: number, v = 0, done?: () => void) => {
      stopAnim.current();
      target.current = to;
      stopAnim.current = runSpring(y.current, to, v, paint, () => {
        stopAnim.current = () => {};
        if (to === 0) {
          panelRef.current?.classList.remove('visible');
          setVisible(false);
        }
        done?.();
      });
    },
    [paint],
  );

  const pushOpen = useCallback(() => {
    if (openRef.current) return;
    setVisible(true);
    navigate(location.pathname, { state: { miniPanel: true } });
  }, [navigate, location.pathname]);
  const pushClose = useCallback(() => {
    if (!openRef.current) return;
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate(location.pathname, { replace: true, state: null });
  }, [navigate, location.pathname]);

  // 打开状态变化（手势、返回键、Esc）→ 弹簧到对应位置
  useEffect(() => {
    openRef.current = open;
    document.body.classList.toggle('pull-open', open);
    if (open) {
      setVisible(true);
      if (target.current !== openY() || y.current === 0) animateTo(openY());
    } else if (target.current !== 0 || y.current !== 0) animateTo(0);
  }, [open, animateTo, openY]);
  useEffect(() => () => document.body.classList.remove('pull-open'), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pushClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pushClose]);

  /** 松手：按位置与速度决定打开还是收起。 */
  const release = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const v = velocity.current.get();
    const full = openY();
    if (d.from === 'closed') {
      const go = y.current >= THRESHOLD || (v > FLICK && y.current > 24);
      if (go) {
        animateTo(full, v);
        pushOpen();
      } else animateTo(0, v);
    } else {
      const shut = full - y.current > CLOSE_DISTANCE || v < -FLICK;
      if (shut) {
        animateTo(0, v);
        pushClose();
      } else animateTo(full, v);
    }
  }, [animateTo, openY, pushOpen, pushClose]);

  /** 拖动中：返回 true 表示已接管（调用方阻止默认滚动）。 */
  const moveTo = useCallback(
    (x: number, py: number): boolean => {
      const d = drag.current;
      if (!d) return false;
      const dx = x - d.startX;
      const dy = py - d.startY;
      if (!d.active) {
        if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
          if (d.from === 'closed' && (dy < 0 || !listAtTop(listRef.current))) {
            drag.current = null;
            return false;
          }
          d.active = true;
          d.startY = py - (dy > 0 ? SLOP : -SLOP);
          stopAnim.current();
          velocity.current.reset(y.current);
        } else if (Math.abs(dx) > SLOP) {
          drag.current = null;
          return false;
        } else return false;
      }
      const full = openY();
      const delta = py - d.startY;
      if (d.from === 'closed') paint(rubberband(Math.max(0, delta), full));
      else {
        // 往上推 1:1 跟手；往下超出打开位置时加阻尼
        const next = full + delta;
        paint(next > full ? full + rubberband(next - full, 200, 0.4) : Math.max(0, next));
      }
      velocity.current.push(y.current);
      swallowClick.current = true;
      return true;
    },
    [openY, paint],
  );

  // 触屏：列表（关闭时下拉）、露出条与面板（打开时上推）。原生监听，touchmove 非被动。
  useEffect(() => {
    const list = listRef.current;
    const tail = tailRef.current;
    const panel = panelRef.current;
    if (!list || !tail || !panel) return;
    const start = (from: Drag['from']) => (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        drag.current = null;
        return;
      }
      if (from === 'closed' && (openRef.current || !listAtTop(list))) return;
      if (from === 'open' && !openRef.current) return;
      if (from === 'open' && (event.target as HTMLElement).closest('.pull-grid-cell.lifted'))
        return;
      swallowClick.current = false;
      drag.current = {
        from,
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        mouse: false,
      };
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !drag.current || drag.current.mouse) return;
      if (moveTo(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      if (drag.current?.active && event.cancelable) event.preventDefault();
      release();
    };
    const pairs: Array<[HTMLElement, Drag['from']]> = [
      [list, 'closed'],
      [tail, 'open'],
      [panel, 'open'],
    ];
    const handlers = pairs.map(([el, from]) => {
      const s = start(from);
      el.addEventListener('touchstart', s, { passive: true });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      return () => {
        el.removeEventListener('touchstart', s);
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', end);
        el.removeEventListener('touchcancel', end);
      };
    });
    return () => handlers.forEach((off) => off());
  }, [moveTo, release]);

  // 鼠标：按下后在窗口上跟踪，松开后吞掉这次点击
  const mouseDown = (from: Drag['from']) => (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (from === 'closed' && (openRef.current || !listAtTop(listRef.current))) return;
    if (from === 'open' && !openRef.current) return;
    swallowClick.current = false;
    drag.current = {
      from,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      mouse: true,
    };
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current?.mouse) moveTo(event.clientX, event.clientY);
    };
    const up = () => {
      if (drag.current?.mouse) release();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [moveTo, release]);
  const swallow = (event: ReactMouseEvent) => {
    if (swallowClick.current) {
      event.preventDefault();
      event.stopPropagation();
      swallowClick.current = false;
    }
  };

  // 滚轮 / 触控板
  useEffect(() => {
    const state = wheel.current;
    return () => window.clearTimeout(state.timer);
  }, []);
  const onWheel = (event: ReactWheelEvent) => {
    const w = wheel.current;
    const now = Date.now();
    const fresh = now - w.last > WHEEL_GAP;
    w.last = now;
    if (openRef.current) {
      // 打开时在露出条 / 面板上往下滚 = 收起
      if (fresh) w.sum = 0;
      w.sum += event.deltaY;
      if (w.sum > 60) {
        w.sum = 0;
        pushClose();
      }
      return;
    }
    const top = listAtTop(listRef.current);
    if (fresh) w.blocked = !top;
    else if (!top) w.blocked = true;
    if (y.current > 0 && event.deltaY > 0) {
      stopAnim.current();
      w.sum = Math.max(0, w.sum - event.deltaY);
    } else if (event.deltaY < 0 && top && !w.blocked) {
      stopAnim.current();
      w.sum += Math.min(60, -event.deltaY);
    } else return;
    paint(rubberband(w.sum, openY()));
    window.clearTimeout(w.timer);
    w.timer = window.setTimeout(() => {
      const reached = y.current >= THRESHOLD;
      w.sum = 0;
      if (reached) {
        animateTo(openY());
        pushOpen();
      } else animateTo(0);
    }, 250);
  };

  return (
    <>
      <MiniPanel
        ref={panelRef}
        open={open}
        visible={visible}
        onPointerDown={mouseDown('open')}
        onWheel={onWheel}
      />
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
      <button
        ref={tailRef}
        type="button"
        className={`pull-tail ${open ? 'shown' : ''}`}
        aria-label="收起小程序，回到微伴"
        tabIndex={open ? 0 : -1}
        onPointerDown={mouseDown('open')}
        onClickCapture={swallow}
        onClick={pushClose}
        onWheel={onWheel}
      >
        <span className="pull-tail-grip" aria-hidden />
        <span className="sr-only">{title}</span>
      </button>
      <div
        ref={listRef}
        className={`pull-list ${open ? 'lifted' : ''}`}
        aria-hidden={open}
        onPointerDown={mouseDown('closed')}
        onClickCapture={swallow}
        onDragStart={(event) => event.preventDefault()}
        onWheel={onWheel}
      >
        {children}
      </div>
    </>
  );
}

// ---------- 面板：一个宫格，长按拖动换位 / 移到最前 ----------

const LIFT_MS = 400;

function MiniPanel({
  ref,
  open,
  visible,
  onPointerDown,
  onWheel,
}: {
  ref: Ref<HTMLDivElement>;
  open: boolean;
  visible: boolean;
  onPointerDown(event: ReactPointerEvent): void;
  onWheel(event: ReactWheelEvent): void;
}) {
  const prefs = useMiniAppPrefs();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ActionItem[] } | null>(
    null,
  );
  const go = (app: MiniApp) => navigate(app.home, { replace: true });
  return (
    <div
      ref={ref}
      className={`pull-panel ${visible ? 'visible' : ''} ${open ? 'open' : ''}`}
      role="dialog"
      aria-label="小程序"
      aria-hidden={!open}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <div className="pull-panel-inner">
        <h2>小程序</h2>
        <div className="pull-scroll">
          <div className="miniapp-grid pull-grid">
            {prefs.ordered.map((app) => (
              <GridCell
                key={app.id}
                app={app}
                tabIndex={open ? 0 : -1}
                onPick={() => go(app)}
                onDrop={(targetId) => {
                  const to = prefs.ordered.find((a) => a.id === targetId);
                  if (to) prefs.orderMove(app, to);
                }}
                onMenu={(at) =>
                  setMenu({
                    at,
                    items: [{ label: '移到最前', onClick: () => prefs.orderFront(app) }],
                  })
                }
              />
            ))}
          </div>
          <p className="pull-tip">长按图标可拖动调整顺序</p>
        </div>
      </div>
      {menu && <LongPressMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * 宫格图标手势：轻点 = 打开；长按 400ms = 「拿起」（放大）——拿起后移动 = 拖动换位，原地松手 = 弹「移到最前」菜单；
 * 没拿起前出现明显移动 = 交给面板（上推收起）。触屏用 touch 事件，鼠标用 pointer 事件。
 */
function GridCell({
  app,
  tabIndex,
  onPick,
  onDrop,
  onMenu,
}: {
  app: MiniApp;
  tabIndex: number;
  onPick(): void;
  onDrop(targetId: string): void;
  onMenu(at: { x: number; y: number }): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onPick, onDrop, onMenu });
  useEffect(() => {
    latest.current = { onPick, onDrop, onMenu };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let state: 'idle' | 'pending' | 'lifted' | 'dragging' | 'cancelled' = 'idle';
    let start = { x: 0, y: 0 };
    let timer = 0;
    let swallow = false;
    let over: HTMLElement | null = null;
    const clearOver = () => {
      over?.classList.remove('drop-target');
      over = null;
    };
    const begin = (x: number, y: number) => {
      state = 'pending';
      swallow = false;
      start = { x, y };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (state !== 'pending') return;
        state = 'lifted';
        swallow = true;
        el.classList.add('lifted');
        navigator.vibrate?.(10);
      }, LIFT_MS);
    };
    /** 返回 true = 本图标接管这次移动。 */
    const move = (x: number, y: number) => {
      const dx = x - start.x;
      const dy = y - start.y;
      if (state === 'pending') {
        if (Math.hypot(dx, dy) > 8) {
          window.clearTimeout(timer);
          state = 'cancelled';
        }
        return false;
      }
      if (state === 'lifted' && Math.hypot(dx, dy) > 6) state = 'dragging';
      if (state === 'dragging') {
        el.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
        el.style.pointerEvents = 'none';
        const below = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>('.pull-grid-cell:not(.lifted)');
        if (below !== over) {
          clearOver();
          over = below ?? null;
          over?.classList.add('drop-target');
        }
        return true;
      }
      return state === 'lifted';
    };
    const finish = (x: number, y: number) => {
      window.clearTimeout(timer);
      const was = state;
      state = 'idle';
      el.classList.remove('lifted');
      el.style.transform = '';
      el.style.pointerEvents = '';
      const targetId = over?.dataset.app;
      clearOver();
      if (was === 'dragging' && targetId) latest.current.onDrop(targetId);
      else if (was === 'lifted') latest.current.onMenu({ x, y });
      return was;
    };
    const onTouchStart = (event: TouchEvent) => {
      const t = event.touches[0];
      if (t && event.touches.length === 1) begin(t.clientX, t.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!t) return;
      if (move(t.clientX, t.clientY)) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      const t = event.changedTouches[0];
      const was = finish(t?.clientX ?? start.x, t?.clientY ?? start.y);
      if ((was === 'lifted' || was === 'dragging') && event.cancelable) event.preventDefault();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      begin(event.clientX, event.clientY);
      const onMove = (e: PointerEvent) => {
        if (move(e.clientX, e.clientY)) e.stopPropagation();
      };
      const onUp = (e: PointerEvent) => {
        finish(e.clientX, e.clientY);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (swallow || state === 'cancelled') {
        swallow = false;
        return;
      }
      latest.current.onPick();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('click', onClick);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      className="miniapp-cell pull-grid-cell"
      data-app={app.id}
      tabIndex={tabIndex}
    >
      <MiniAppIcon app={app} />
      <small>{app.name}</small>
    </button>
  );
}
