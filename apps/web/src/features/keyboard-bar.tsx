/*
 * 贴键盘输入条（2026-10-27 批 U5，朋友圈评论 #26）：微信式——点「评论」后底部升起一条输入栏贴在键盘上方，
 * 页面不被半屏面板盖住；点输入条以外的地方收起键盘和输入条，已输入的文字保留（下次再点同一处评论接着写）。
 * 输入条挂到 body 上（不受列表行定位影响）；iOS 键盘不缩小布局视口时按 visualViewport 把输入条抬到键盘上方。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './shell-kit.js';

function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export function KeyboardBar({
  onDismiss,
  children,
  label,
}: {
  /** 点输入条以外的地方 / Esc：收起（不清空草稿，由调用方决定）。 */
  onDismiss(): void;
  children: ReactNode;
  label?: string;
}) {
  const inset = useKeyboardInset();
  useEscape(onDismiss);
  return createPortal(
    <div className="keyboard-bar-host">
      <div className="keyboard-bar-scrim" aria-hidden onPointerDown={onDismiss} />
      <div className="keyboard-bar" role="dialog" aria-label={label} style={{ bottom: inset }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
