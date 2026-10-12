/*
 * 会话列表下拉出现小程序面板（docs/refactor/02 第 4.3 节，P2）。
 * 列表在最顶端时继续下拉：列表跟手下移（只改 transform）；超过 80px 松手 → 面板从上铺满，底部露出一条「微伴」；
 * 不到 80px → 弹回。点底部那一条、按返回或在面板上往上滑 → 收起。不做模糊背景。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MiniAppBrowser } from './miniapps.js';

/** 手指移动 80px（阻尼后约 44px）即打开。 */
const THRESHOLD = 80;
const MAX_PULL = 140;

function atTop(target: EventTarget | null) {
  if (window.scrollY > 0) return false;
  const list = target instanceof Element ? target.closest('.virtual-list') : null;
  return !list || list.scrollTop <= 0;
}

export function PullMiniApps({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const start = useRef<{ y: number; x: number; active: boolean } | null>(null);
  const panelStart = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <div
        className={`pull-list ${pull ? 'dragging' : ''}`}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch || open || !atTop(event.target)) return;
          start.current = { y: touch.clientY, x: touch.clientX, active: false };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (!touch || !start.current) return;
          const dy = touch.clientY - start.current.y;
          const dx = Math.abs(touch.clientX - start.current.x);
          if (!start.current.active) {
            if (dy > 8 && dy > dx) start.current.active = true;
            else if (dy < 0 || dx > 8) {
              start.current = null;
              return;
            } else return;
          }
          // 阻尼：越拉越重
          setPull(Math.min(MAX_PULL, Math.max(0, dy * 0.55)));
        }}
        onTouchEnd={() => {
          if (start.current?.active && pull >= THRESHOLD * 0.55) setOpen(true);
          start.current = null;
          setPull(0);
        }}
        onTouchCancel={() => {
          start.current = null;
          setPull(0);
        }}
      >
        {pull > 0 && (
          <div className="pull-hint" aria-hidden>
            {pull >= THRESHOLD * 0.55 ? '松开打开小程序' : '下拉打开小程序'}
          </div>
        )}
        {children}
      </div>
      <div
        className={`pull-panel ${open ? 'open' : ''}`}
        aria-hidden={!open}
        role="dialog"
        aria-label="小程序"
        onTouchStart={(event) => {
          panelStart.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          const endY = event.changedTouches[0]?.clientY;
          if (panelStart.current !== null && endY !== undefined && panelStart.current - endY > 60)
            setOpen(false);
          panelStart.current = null;
        }}
      >
        {open && (
          <div className="pull-body">
            <h2 className="page-title">小程序</h2>
            <MiniAppBrowser onOpen={() => setOpen(false)} />
          </div>
        )}
        <button type="button" className="pull-tail" onClick={() => setOpen(false)}>
          微伴
        </button>
      </div>
    </>
  );
}
