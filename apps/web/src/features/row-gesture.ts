/*
 * 列表行统一手势状态机（总经理 2026-10-14 总对照表 T1.4～T1.6）：
 * 一次按下只会落到下面四种之一，互不串台——
 *   轻点 tap      ：按下到抬起移动 < 10 像素且不到 500ms → 只触发点击（进入会话），绝不出现菜单；
 *   长按 long     ：按住不动满 500ms → 只弹长按菜单；之后再怎么移动都不会左滑，抬手后补发的点击被吞掉；
 *   横滑 swipe    ：先出现明显的水平移动 → 只做左滑露出按钮，长按计时立刻作废；
 *   竖滚 scroll   ：先出现竖直移动 → 交给浏览器滚动 / 下拉，长按计时作废，这一行什么都不做。
 * 触屏只用 touch 事件判断（有的手机内置浏览器抬手不发 pointerup，但 touchend 一定发）；
 * 鼠标用 pointer 事件（鼠标一定有 pointerup），右键 = 长按。
 * 左滑跟手：只改 transform；松手按「位置过半 或 甩动速度 > 0.3 像素/毫秒」吸附（参考旧版 swipe_action_row 的 ±250 速度判定）。
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type RowGestureKind = 'idle' | 'pending' | 'long' | 'swipe' | 'scroll';

const LONG_MS = 500;
const SLOP = 10;

export interface RowGestureOptions {
  /** 左滑按钮总宽；0 表示这一行不能左滑。 */
  swipeWidth: number;
  open: boolean;
  /** 别的行正展开：这一行的轻点只负责收起。 */
  othersOpen: boolean;
  onOpenChange(open: boolean): void;
  onCloseOthers(): void;
  onLongPress(at: { x: number; y: number }): void;
}

export function useRowGesture(
  host: RefObject<HTMLElement | null>,
  track: RefObject<HTMLElement | null>,
  options: RowGestureOptions,
) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  // 展开 / 收起状态变化时把前景放到对应位置（带 180ms 过渡）
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.classList.remove('dragging');
    el.style.transform = options.open ? `translateX(${-options.swipeWidth}px)` : '';
  }, [options.open, options.swipeWidth, track]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let kind: RowGestureKind = 'idle';
    let start = { x: 0, y: 0 };
    let base = 0;
    let offset = 0;
    let samples: Array<{ x: number; t: number }> = [];
    let timer = 0;
    let swallowClick = false;
    let viaTouch = false;
    const o = () => latest.current;
    const paint = (x: number, dragging: boolean) => {
      const t = track.current;
      if (!t) return;
      t.classList.toggle('dragging', dragging);
      t.style.transform = x ? `translateX(${x}px)` : '';
    };
    const reset = () => {
      window.clearTimeout(timer);
      kind = 'idle';
    };
    const begin = (x: number, y: number) => {
      window.clearTimeout(timer);
      kind = 'pending';
      swallowClick = false;
      start = { x, y };
      base = o().open ? -o().swipeWidth : 0;
      offset = base;
      samples = [{ x, t: performance.now() }];
      timer = window.setTimeout(() => {
        if (kind !== 'pending') return;
        kind = 'long';
        swallowClick = true;
        o().onLongPress({ x, y });
      }, LONG_MS);
    };
    /** 返回 true 表示这一下由本行接管（调用方应阻止默认行为 / 冒泡）。 */
    const move = (x: number, y: number): boolean => {
      const dx = x - start.x;
      const dy = y - start.y;
      if (kind === 'pending') {
        if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.2 && o().swipeWidth > 0) {
          window.clearTimeout(timer);
          kind = 'swipe';
          swallowClick = true;
          if (!o().open && o().othersOpen) o().onCloseOthers();
        } else if (Math.abs(dy) > SLOP || Math.abs(dx) > SLOP) {
          window.clearTimeout(timer);
          kind = 'scroll';
          return false;
        } else return false;
      }
      if (kind === 'swipe') {
        const width = o().swipeWidth;
        let next = base + dx;
        // 超出两端时加阻尼
        if (next > 0) next = next * 0.25;
        if (next < -width) next = -width + (next + width) * 0.25;
        offset = next;
        samples.push({ x, t: performance.now() });
        if (samples.length > 6) samples.shift();
        paint(offset, true);
        return true;
      }
      // 长按后不再左滑、也不让列表下拉
      return kind === 'long';
    };
    const end = () => {
      window.clearTimeout(timer);
      if (kind === 'swipe') {
        const width = o().swipeWidth;
        const first = samples[0]!;
        const last = samples[samples.length - 1]!;
        const velocity = (last.x - first.x) / Math.max(1, last.t - first.t);
        const next = velocity < -0.3 ? true : velocity > 0.3 ? false : Math.abs(offset) > width / 2;
        paint(next ? -width : 0, false);
        if (next !== o().open) o().onOpenChange(next);
      }
      const was = kind;
      kind = 'idle';
      return was;
    };

    // ---- 触屏 ----
    const onTouchStart = (event: TouchEvent) => {
      viaTouch = true;
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        if (kind === 'swipe') end();
        reset();
        return;
      }
      begin(touch.clientX, touch.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || kind === 'idle' || kind === 'scroll') return;
      if (move(touch.clientX, touch.clientY)) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      const was = end();
      if ((was === 'long' || was === 'swipe') && event.cancelable) event.preventDefault();
    };
    const onTouchCancel = () => {
      if (kind === 'swipe') {
        paint(o().open ? -o().swipeWidth : 0, false);
      }
      reset();
    };
    // ---- 鼠标 ----
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      viaTouch = false;
      if (event.button !== 0) return;
      begin(event.clientX, event.clientY);
      const onMove = (e: PointerEvent) => {
        if (kind !== 'idle' && kind !== 'scroll') move(e.clientX, e.clientY);
      };
      const onUp = () => {
        end();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // 触屏长按由计时器负责，这里只处理鼠标右键
      if (viaTouch || kind === 'long') return;
      reset();
      swallowClick = true;
      o().onLongPress({ x: event.clientX, y: event.clientY });
    };
    const onClick = (event: MouseEvent) => {
      const opts = o();
      if (swallowClick || opts.open || opts.othersOpen) {
        event.preventDefault();
        event.stopPropagation();
        if (!swallowClick) {
          if (opts.open) opts.onOpenChange(false);
          else opts.onCloseOthers();
        }
      }
      swallowClick = false;
    };
    const onScroll = () => {
      if (kind === 'pending') reset();
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', onDragStart);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [host, track]);
}
