import { showToast } from './toast.js';

/** HTTP/IP installations cannot use Clipboard API. Keep a synchronous fallback for user gestures. */
export async function copyText(value: string): Promise<boolean> {
  const fallback = () => {
    const focus = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
      : [];
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('aria-label', '复制文本');
    Object.assign(field.style, { position: 'fixed', top: '0', left: '-9999px', fontSize: '16px' });
    document.body.append(field);
    try {
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, value.length);
      return document.execCommand('copy');
    } finally {
      field.remove();
      focus?.focus({ preventScroll: true });
      selection?.removeAllRanges();
      ranges.forEach((range) => selection?.addRange(range));
    }
  };
  let copied = false;
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        copied = fallback();
      }
    } else copied = fallback();
  } catch {
    /* Report failure when the browser denies both methods. */
  }
  showToast(copied ? '已复制' : '复制失败，请重试', 2000, copied ? 'success' : 'error');
  return copied;
}
