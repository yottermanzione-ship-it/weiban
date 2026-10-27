/*
 * 全屏看图 Lightbox（26 号 §2；2026-10-27 批 U5）：黑底、左右滑切换、双指缩放 / 双击放大、下滑关闭、单击关闭。
 * 聊天图片（ImageViewer）、聊天记录里的图片、收藏里的图片都用它；打开时进浏览器历史，返回键只关看图。
 *
 * 动效性格（U5）：手指拖动时图片跟手、不加过渡；松手后吸附 / 回弹统一用 --ui-motion-snap。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLayerHistory } from './layer-history.js';
import { MediaImg } from './media.js';
import { CaretLeft, CaretRight, OldIcon, X } from './old-icons.js';
import { ActionSheet, type ActionItem } from './shell-kit.js';

export interface LightboxItem {
  mediaId: string;
  key?: string;
}

/** 下滑超过这么多像素松手就关闭。 */
const CLOSE_DRAG = 110;
/** 左右滑超过这么多像素松手就切换。 */
const SWIPE = 60;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 260;

interface View {
  scale: number;
  x: number;
  y: number;
}
const REST: View = { scale: 1, x: 0, y: 0 };

export function Lightbox({
  items,
  index,
  onClose,
  menu,
  hint,
  label = '查看图片',
}: {
  items: LightboxItem[];
  index: number;
  onClose(): void;
  /** 长按 / 右上角「…」的动作；不传就不显示「…」。 */
  menu?(item: LightboxItem, index: number): ActionItem[];
  hint?: string;
  label?: string;
}) {
  const [current, setCurrent] = useState(() => Math.min(Math.max(0, index), items.length - 1));
  const [view, setView] = useState<View>(REST);
  /** 下滑关闭 / 左右切换时的整体位移（缩放为 1 时）。 */
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const [sheet, setSheet] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    axis: 'none' | 'x' | 'y' | 'pan' | 'pinch';
    base: View;
    distance: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(0);
  useLayerHistory(onClose);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const item = items[current];
  if (!item) return null;
  function go(step: number) {
    setCurrent((value) => Math.min(items.length - 1, Math.max(0, value + step)));
    setView(REST);
    setDrag({ x: 0, y: 0 });
  }
  function distance() {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      gesture.current = {
        startX: event.clientX,
        startY: event.clientY,
        axis: 'pinch',
        base: view,
        distance: distance(),
        moved: true,
      };
    } else if (pointers.current.size === 1) {
      gesture.current = {
        startX: event.clientX,
        startY: event.clientY,
        axis: view.scale > 1 ? 'pan' : 'none',
        base: view,
        distance: 0,
        moved: false,
      };
    }
    setMoving(true);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
    if (g.axis === 'pinch') {
      const d = distance();
      if (!d || !g.distance) return;
      const scale = Math.min(MAX_SCALE, Math.max(1, (g.base.scale * d) / g.distance));
      setView({ ...g.base, scale });
      return;
    }
    if (g.axis === 'pan') {
      setView({ ...g.base, x: g.base.x + dx, y: g.base.y + dy });
      return;
    }
    if (g.axis === 'none' && g.moved)
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 ? 'y' : 'x';
    if (g.axis === 'x') setDrag({ x: dx, y: 0 });
    if (g.axis === 'y') setDrag({ x: 0, y: Math.max(0, dy) });
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (!g) return;
    if (pointers.current.size > 0) {
      // 双指松开一根：剩下那根继续拖动（缩放后平移）。
      const [rest] = [...pointers.current.values()];
      if (rest)
        gesture.current = {
          startX: rest.x,
          startY: rest.y,
          axis: view.scale > 1 ? 'pan' : 'none',
          base: view,
          distance: 0,
          moved: true,
        };
      return;
    }
    gesture.current = null;
    setMoving(false);
    if (g.axis === 'pinch' || g.axis === 'pan') {
      if (view.scale <= 1.02) setView(REST);
      return;
    }
    if (g.axis === 'x') {
      if (drag.x < -SWIPE && current < items.length - 1) go(1);
      else if (drag.x > SWIPE && current > 0) go(-1);
      else setDrag({ x: 0, y: 0 });
      return;
    }
    if (g.axis === 'y') {
      if (drag.y > CLOSE_DRAG) onClose();
      else setDrag({ x: 0, y: 0 });
      return;
    }
    if (g.moved) return;
    // 点按：双击放大 / 还原；单击（等一下确认不是双击）关闭。
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      window.clearTimeout(tapTimer.current);
      setView(view.scale > 1 ? REST : { scale: 2, x: 0, y: 0 });
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = 0;
      onClose();
    }, DOUBLE_TAP_MS);
  }
  const fade = drag.y > 0 ? Math.max(0.2, 1 - drag.y / 500) : 1;
  const shrink = drag.y > 0 ? Math.max(0.7, 1 - drag.y / 1200) : 1;
  const actions = menu?.(item, current) ?? [];
  return (
    <div
      className={`image-viewer lightbox ${moving ? 'moving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{ backgroundColor: `rgb(0 0 0 / ${fade})` }}
    >
      <header style={{ opacity: drag.y > 0 ? 0 : 1 }}>
        <button type="button" className="viewer-button" aria-label="关闭" onClick={onClose}>
          <X size={24} />
        </button>
        <span className="numeric">{items.length > 1 ? `${current + 1} / ${items.length}` : ''}</span>
        {actions.length > 0 ? (
          <button
            type="button"
            className="viewer-button"
            aria-label="更多"
            onClick={() => setSheet(true)}
          >
            <OldIcon name="wechat/more" size={24} />
          </button>
        ) : (
          <span className="viewer-button" aria-hidden />
        )}
      </header>
      <div
        className="viewer-stage lightbox-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(event) => {
          event.preventDefault();
          if (actions.length > 0) setSheet(true);
        }}
      >
        <div
          className="lightbox-image"
          style={{
            transform: `translate3d(${drag.x + view.x}px, ${drag.y + view.y}px, 0) scale(${
              view.scale * shrink
            })`,
          }}
        >
          <MediaImg
            key={item.key ?? item.mediaId}
            mediaId={item.mediaId}
            thumbnail={false}
            className="viewer-image"
            cache={false}
          />
        </div>
      </div>
      {current > 0 && (
        <button
          type="button"
          className="viewer-button viewer-prev"
          aria-label="上一张"
          onClick={() => go(-1)}
        >
          <CaretLeft size={24} />
        </button>
      )}
      {current < items.length - 1 && (
        <button
          type="button"
          className="viewer-button viewer-next"
          aria-label="下一张"
          onClick={() => go(1)}
        >
          <CaretRight size={24} />
        </button>
      )}
      {hint && <p className="viewer-hint">{hint}</p>}
      {sheet && <ActionSheet onClose={() => setSheet(false)} items={actions} />}
    </div>
  );
}
