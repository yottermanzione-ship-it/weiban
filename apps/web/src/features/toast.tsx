import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/*
 * 反馈类公共组件（docs/web/ui-components.md；26 号方案 §2）：
 * - Toast 轻提示：屏幕正中深色块，默认 1.5 秒；可带 ✓ / ! / ✕ / i 图标。任意位置调用 showToast，Shell 里的 ToastHost 显示。
 * - Snackbar 底部撤销条：可撤销的轻操作用它代替二次确认，带「撤销」，默认 5 秒。showSnackbar + SnackbarHost。
 * - InlineAlert 行内提示：输入框下的红字，改对即消失，不弹窗。
 * - Dialog 普通对话框 / AlertDialog 危险确认。
 */
export type ToastKind = 'success' | 'warning' | 'error' | 'info';
const EVENT = 'weiban:toast';
interface ToastDetail {
  text: string;
  durationMs: number;
  kind?: ToastKind;
}
/** 轻提示停留时长（26 号 §2：1.5 秒）。 */
export const TOAST_MS = 1500;
export function showToast(text: string, durationMs = TOAST_MS, kind?: ToastKind) {
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

// ---------- Snackbar：底部撤销条 ----------

const SNACK_EVENT = 'weiban:snackbar';
/** 撤销条停留时长（26 号 §2：5 秒）。 */
export const SNACKBAR_MS = 5000;
/** 撤销条怎么消失的：到时（操作生效）、点了撤销、被下一条顶掉（也算生效）。 */
export type SnackbarEnd = 'timeout' | 'action' | 'replaced';
export interface SnackbarOptions {
  text: string;
  /** 右侧按钮文字，默认「撤销」。不传 onAction 就不显示按钮。 */
  actionLabel?: string;
  /** 点「撤销」：调用现有接口把刚才的操作恢复回去。 */
  onAction?(): void | Promise<void>;
  /** 撤销条消失时回调；「先隐藏、到时再真正提交」的写法在这里提交（reason !== 'action'）。 */
  onEnd?(reason: SnackbarEnd): void;
  durationMs?: number;
}
export function showSnackbar(options: SnackbarOptions) {
  window.dispatchEvent(new CustomEvent<SnackbarOptions>(SNACK_EVENT, { detail: options }));
}
export function SnackbarHost() {
  const [snack, setSnack] = useState<(SnackbarOptions & { id: number }) | null>(null);
  const current = useRef<(SnackbarOptions & { id: number }) | null>(null);
  const timer = useRef(0);
  useEffect(() => {
    const end = (reason: SnackbarEnd) => {
      const was = current.current;
      current.current = null;
      window.clearTimeout(timer.current);
      was?.onEnd?.(reason);
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<SnackbarOptions>).detail;
      if (current.current) end('replaced');
      const next = { ...detail, id: Date.now() };
      current.current = next;
      setSnack(next);
      timer.current = window.setTimeout(() => {
        end('timeout');
        setSnack(null);
      }, detail.durationMs ?? SNACKBAR_MS);
    };
    window.addEventListener(SNACK_EVENT, listener);
    return () => {
      window.removeEventListener(SNACK_EVENT, listener);
      window.clearTimeout(timer.current);
    };
  }, []);
  if (!snack) return null;
  return (
    <div key={snack.id} className="snackbar" role="status" aria-live="polite">
      <span className="snackbar-text">{snack.text}</span>
      {snack.onAction && (
        <button
          type="button"
          className="snackbar-action"
          onClick={() => {
            const was = current.current;
            current.current = null;
            window.clearTimeout(timer.current);
            setSnack(null);
            void was?.onAction?.();
            was?.onEnd?.('action');
          }}
        >
          {snack.actionLabel ?? '撤销'}
        </button>
      )}
    </div>
  );
}

// ---------- InlineAlert：行内提示 ----------

/**
 * 输入框正下方的红字提示（表单校验）。没有内容时什么都不渲染；改对后传空即消失。
 * 给输入框加 aria-describedby={id} 让读屏读到。
 */
export function InlineAlert({ children, id }: { children?: ReactNode; id?: string }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <p id={id} className="inline-alert" role="alert">
      {children}
    </p>
  );
}

// ---------- Dialog / AlertDialog ----------

/** 按钮语气：主操作（品牌绿）、危险（红字）、普通（黑字，取消用它）。全站没有蓝字按钮。 */
export type ButtonTone = 'primary' | 'danger' | 'default';
export interface DialogAction {
  /** 写动作（「删除聊天」「保存」），不写「是 / 确定」这类泛词；确定只用于无后果的设置确认。 */
  label: string;
  tone?: ButtonTone;
  /** @deprecated 用 tone: 'primary'。 */
  primary?: boolean;
  /** @deprecated 用 tone: 'danger'。 */
  danger?: boolean;
  /** 输入型确认框没改动或为空时，确认键置灰不可点（10-21 G2）。 */
  disabled?: boolean;
  /** 正在提交：按钮不可点并标记忙碌。 */
  busy?: boolean;
  onClick(): void;
}
const toneOf = (action: DialogAction): ButtonTone =>
  action.tone ?? (action.danger ? 'danger' : action.primary ? 'primary' : 'default');
const toneClass: Record<ButtonTone, string> = { primary: 'confirm', danger: 'danger', default: '' };

/**
 * 普通对话框（规格 3.9）：白底圆角 12；无标题时正文居中 17；底部两个等宽按钮，中间竖线。
 * 点蒙层 / Esc：传了 onDismiss 才关闭（等同取消）；不传则点蒙层无反应。
 */
export function Dialog({
  title,
  children,
  actions,
  onDismiss,
}: {
  title?: string;
  children?: ReactNode;
  actions: DialogAction[];
  onDismiss?(): void;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!onDismiss) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onDismiss]);
  return (
    <div className="dialog-scrim" onClick={onDismiss}>
      <div
        className={`dialog ${title ? 'titled' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-body">
          {title && <strong id={titleId}>{title}</strong>}
          {children}
        </div>
        <div className="dialog-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={toneClass[toneOf(action)]}
              disabled={action.disabled || action.busy}
              aria-busy={action.busy || undefined}
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

/**
 * 危险确认（不可撤销才用：删除好友、清空记录、注销、删除作品）：
 * 左「取消」黑字，右主按钮红字写清后果；点蒙层不关闭，Esc 等同取消。
 * 能撤销的轻操作不要用它，改用 showSnackbar。
 */
export function AlertDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = '取消',
  pending = false,
}: {
  title: string;
  message?: ReactNode;
  /** 写清后果的动作，如「删除作品」「清空聊天记录」。 */
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
  cancelLabel?: string;
  pending?: boolean;
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onCancel, pending]);
  return (
    <Dialog
      title={title}
      actions={[
        { label: cancelLabel, disabled: pending, onClick: onCancel },
        { label: confirmLabel, tone: 'danger', busy: pending, onClick: onConfirm },
      ]}
    >
      {message != null && (typeof message === 'string' ? <p>{message}</p> : message)}
    </Dialog>
  );
}
