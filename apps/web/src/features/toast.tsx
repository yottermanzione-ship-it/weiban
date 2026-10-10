import { useEffect, useState, type ReactNode } from 'react';

/** 轻提示（C 13 Toast）：任意位置调用 showToast，Shell 里的 ToastHost 显示 2 秒。 */
const EVENT = 'weiban:toast';
export function showToast(text: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}
export function ToastHost() {
  const [text, setText] = useState('');
  useEffect(() => {
    let timer = 0;
    const listener = (event: Event) => {
      setText((event as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(''), 2000);
    };
    window.addEventListener(EVENT, listener);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.clearTimeout(timer);
    };
  }, []);
  if (!text) return null;
  return (
    <div role="status" className="toast">
      {text}
    </div>
  );
}

/** 简单确认 / 说明弹窗（C 11 Dialog）。 */
export function Dialog({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions: Array<{ label: string; primary?: boolean; onClick(): void }>;
}) {
  return (
    <div className="dialog-scrim">
      <div className="dialog" role="dialog" aria-label={title}>
        <strong>{title}</strong>
        {children}
        <div className="button-row">
          {actions.map((action) => (
            <button
              key={action.label}
              className={action.primary ? 'primary' : ''}
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
