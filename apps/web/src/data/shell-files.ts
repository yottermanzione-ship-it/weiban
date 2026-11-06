type ShellReply = { id: string; status: 'saved' | 'cancelled' | 'failed' };
type ShellBridge = {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
};
declare global {
  interface Window {
    weibanShell?: ShellBridge;
  }
}

const MAX_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
let saving = false;
export function isAndroidShell(): boolean {
  return /\bWeibanShell\/1\b/.test(navigator.userAgent);
}

/** The native shell reports success only after the user chooses a destination and writing completes. */
export async function saveImageFile(
  blob: Blob,
  name: string,
): Promise<'saved' | 'cancelled' | 'started'> {
  if (!isAndroidShell()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'started';
  }
  const bridge = window.weibanShell;
  if (!bridge) throw new Error('手机的系统网页组件过旧，请更新后再保存图片');
  if (!IMAGE_TYPES.has(blob.type) || blob.size < 1 || blob.size > MAX_BYTES)
    throw new Error('图片格式不支持或超过十六兆，请在浏览器里保存');
  if (saving) throw new Error('请先完成或取消正在保存的图片');
  saving = true;
  try {
    return await requestNativeSave(bridge, blob, name);
  } finally {
    saving = false;
  }
}

async function requestNativeSave(
  bridge: ShellBridge,
  blob: Blob,
  name: string,
): Promise<'saved' | 'cancelled'> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取图片失败，请重试'));
    reader.readAsDataURL(blob);
  });
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const previous = bridge.onmessage;
    const timer = window.setTimeout(() => finish('failed'), 5 * 60_000);
    function finish(status: ShellReply['status']) {
      window.clearTimeout(timer);
      if (bridge.onmessage === receive) bridge.onmessage = previous;
      if (status === 'saved' || status === 'cancelled') resolve(status);
      else reject(new Error('图片尚未保存，请重新尝试'));
    }
    function receive(event: { data: string }) {
      let reply: Partial<ShellReply>;
      try {
        reply = JSON.parse(event.data) as Partial<ShellReply>;
      } catch {
        return;
      }
      if (reply.id !== id) return previous?.(event);
      if (reply.status === 'saved' || reply.status === 'cancelled' || reply.status === 'failed')
        finish(reply.status);
    }
    bridge.onmessage = receive;
    try {
      bridge.postMessage(JSON.stringify({ type: 'save-image', id, name, mime: blob.type, base64 }));
    } catch {
      finish('failed');
    }
  });
}
