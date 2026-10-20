import { useEffect, useState, type ReactNode } from 'react';

/*
 * 轻提示（规格 3.11）：屏幕正中深色块，停留 2 秒；可带 ✓ / ! / ✕ / i 图标。
 * 任意位置调用 showToast，Shell 里的 ToastHost 显示。
 */
export type ToastKind = 'success' | 'warning' | 'error' | 'info';
const EVENT = 'weiban:toast';
interface ToastDetail {
  text: string;
  durationMs: number;
  kind?: ToastKind;
}
export function showToast(text: string, durationMs = 2000, kind?: ToastKind) {
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail: { text, durationMs, kind } }));
}
const glyph: Record<ToastKind, string> = { success: '✓', warning: '!', error: '✕', info: 'i' };
export function ToastHost() {
  const [toast, setToast] = useState<(ToastDetail & { id: number }) | null>(null);
  useEffect(() => {
    let timer = 0;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      setToast({ ...detail, id: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), detail.durationMs);
    };
    window.addEventListener(EVENT, listener);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.clearTimeout(timer);
    };
  }, []);
  if (!toast) return null;
  const short = Array.from(toast.text).length <= 8;
  return (
    <div
      key={toast.id}
      role="status"
      className={`toast ${short && toast.kind ? 'short' : 'long'} ${toast.kind ? 'with-icon' : ''}`}
    >
      {toast.kind && (
        <span className={`toast-icon ${toast.kind}`} aria-hidden>
          {glyph[toast.kind]}
        </span>
      )}
      <span>{toast.text}</span>
    </div>
  );
}

/**
 * 确认框（规格 3.9）：白底圆角 12；无标题时正文居中 17；底部两个等宽按钮，中间竖线。
 * primary = 确认键（普通操作用 link 色）；danger = 危险操作红字。
 */
export function Dialog({
  title,
  children,
  actions,
}: {
  title?: string;
  children?: ReactNode;
  actions: Array<{
    label: string;
    primary?: boolean;
    danger?: boolean;
    /** 10-21 G2：输入型确认框没改动或为空时，确认键置灰不可点。 */
    disabled?: boolean;
    onClick(): void;
  }>;
}) {
  return (
    <div className="dialog-scrim">
      <div className={`dialog ${title ? 'titled' : ''}`} role="dialog" aria-label={title}>
        <div className="dialog-body">
          {title && <strong>{title}</strong>}
          {children}
        </div>
        <div className="dialog-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.danger ? 'danger' : action.primary ? 'confirm' : ''}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
