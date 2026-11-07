import { Id, type DeviceInfo } from '@weiban/contracts';

/** A software installation marker only; never infer hardware identity from an IP or device name. */
export function shellVersion(userAgent = navigator.userAgent): string | undefined {
  return /(?:^|\s)WeibanShell\/(\d+(?:\.\d+){0,2}(?:-debug)?)(?=\s|$)/.exec(userAgent)?.[1];
}

export function describeDevice(
  userAgent = navigator.userAgent,
  standalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      ('standalone' in navigator && navigator.standalone === true)),
): DeviceInfo {
  const shell = shellVersion(userAgent);
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const system = /Android/.test(userAgent)
    ? '安卓'
    : ios
      ? '苹果手机或平板'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Macintosh/.test(userAgent)
          ? 'Mac'
          : '其他系统';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : '浏览器';
  return {
    platform: shell ? 'android' : ios && standalone ? 'ios_pwa' : 'web',
    name: shell
      ? '微伴安卓应用'
      : `${browser} · ${system}${ios && standalone ? ' · 主屏幕版' : ''}`,
    appVersion: shell ?? (typeof __WEB_BUILD__ === 'number' ? String(__WEB_BUILD__) : 'web'),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Separate from the account cache: logging out or updating the page must not create a new device. */
export async function installationId(): Promise<string | undefined> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const opened = indexedDB.open('weiban-installation', 1);
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        reject(new Error('device storage unavailable'));
      }, 3000);
      opened.onupgradeneeded = () => opened.result.createObjectStore('identity');
      opened.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('device storage unavailable'));
      };
      opened.onsuccess = () => {
        const db = opened.result;
        if (timedOut) {
          db.close();
          return;
        }
        // One read/write transaction serializes first creation even in concurrent tabs.
        const tx = db.transaction('identity', 'readwrite');
        const store = tx.objectStore('identity');
        let id: string;
        const read = store.get('id');
        read.onsuccess = () => {
          id = Id.safeParse(read.result).success ? read.result : crypto.randomUUID();
          store.put(id, 'id');
        };
        tx.oncomplete = () => {
          window.clearTimeout(timer);
          db.close();
          resolve(id);
        };
        tx.onabort = tx.onerror = () => {
          window.clearTimeout(timer);
          db.close();
          reject(new Error('device storage unavailable'));
        };
      };
    });
  } catch {
    // Storage denial must not block password login or invent a different persistent identity.
    return undefined;
  }
}

export async function currentDevice(): Promise<DeviceInfo> {
  const id = await installationId();
  return { ...describeDevice(), ...(id ? { installationId: id } : {}) };
}

export function devicePlatformLabel(platform: DeviceInfo['platform']): string {
  return platform === 'android'
    ? '安卓应用'
    : platform === 'ios_pwa'
      ? '苹果主屏幕版'
      : '浏览器网页版';
}
