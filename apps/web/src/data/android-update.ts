import { ReleaseEndpoints } from '@weiban/contracts';
import { api } from './client.js';
import { shellVersion } from './device-info.js';

// Official shells through build 127 share the display version and don't report their build number.
const LAST_LEGACY_BUILD = 127;
const BROWSER_DOWNLOAD_ORIGIN = 'https://dl.weiban.online';
const DOWNLOAD_ORIGINS = new Set(['https://weiban.online', 'https://app.weiban.online']);

export function installedAndroidBuild(userAgent = navigator.userAgent) {
  const version = shellVersion(userAgent);
  if (!version || version.endsWith('-debug')) return null;
  const value = /(?:^|\s)WeibanBuild\/(\d{1,10})(?=\s|$)/.exec(userAgent)?.[1];
  const code = Number(value);
  const known = Number.isSafeInteger(code) && code > 0 && code <= 2_100_000_000;
  return { code: known ? code : LAST_LEGACY_BUILD, known };
}

export interface AndroidPackageUpdate {
  versionCode: number;
  url: string;
  browserUrl: string;
}

interface AndroidUpdateResult {
  message: string;
  available?: AndroidPackageUpdate;
}

function officialDownloadUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      DOWNLOAD_ORIGINS.has(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/download-assets\/weiban-[a-zA-Z0-9.-]{1,96}\.apk$/.test(url.pathname)
    )
      return url;
  } catch {
    // Treat an invalid published URL as unavailable.
  }
  return null;
}

export async function checkAndroidUpdate(
  installed: NonNullable<ReturnType<typeof installedAndroidBuild>>,
): Promise<AndroidUpdateResult> {
  const release = await api.call(ReleaseEndpoints.checkVersion, {
    query: { platform: 'android', versionCode: installed.code },
    networkOnly: true,
  });
  if (!release.latestVersion || !release.latestVersionCode)
    return { message: '暂未公布安卓安装包' };
  if (!release.updateAvailable)
    return {
      message: installed.known ? '安卓安装包已是最新版本' : '暂无面向当前安卓应用的新版安装包',
    };

  const url = officialDownloadUrl(release.downloadUrl);
  if (!url) return { message: '发现新版安卓安装包，下载地址暂不可用' };
  return {
    message: `发现安卓安装包新版 ${release.latestVersion}（${release.latestVersionCode}）`,
    available: {
      versionCode: release.latestVersionCode,
      url: url.href,
      // The download host bypasses the chat worker and stale connections to the old main domain.
      browserUrl: new URL(url.pathname, BROWSER_DOWNLOAD_ORIGIN).href,
    },
  };
}

type UpdateBridge = {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
};

declare global {
  interface Window {
    weibanAppUpdate?: UpdateBridge;
  }
}

export function downloadAndroidUpdate(
  bridge: UpdateBridge,
  update: AndroidPackageUpdate,
  onProgress: (message: string) => void,
): Promise<void> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const previous = bridge.onmessage;
    let timer: ReturnType<typeof setTimeout>;
    const fail = '安卓安装包下载未完成，请重新检查更新后再试';
    function finish(message?: string) {
      clearTimeout(timer);
      if (bridge.onmessage === receive) bridge.onmessage = previous;
      if (message) reject(new Error(message));
      else resolve();
    }
    function wait(ms: number) {
      clearTimeout(timer);
      timer = setTimeout(() => finish(fail), ms);
    }
    function receive(event: { data: string }) {
      let reply: { id?: string; status?: string };
      try {
        reply = JSON.parse(event.data) as { id?: string; status?: string };
      } catch {
        return;
      }
      if (reply?.id !== id) return previous?.(event);
      switch (reply.status) {
        case 'permission':
          onProgress('请在系统设置允许微伴安装应用，然后返回微伴');
          wait(5 * 60_000);
          break;
        case 'downloading':
          onProgress('正在下载并验证安卓安装包…');
          wait(140_000);
          break;
        case 'installer_opened':
          finish();
          break;
        case 'permission_denied':
          finish('系统尚未允许微伴安装应用，请重试并开启安装权限');
          break;
        case 'busy':
          finish('请先完成正在进行的安装包下载或安装');
          break;
        case 'failed':
        case 'cancelled':
          finish(fail);
          break;
      }
    }

    bridge.onmessage = receive;
    wait(140_000);
    try {
      bridge.postMessage(JSON.stringify({ id, url: update.url, versionCode: update.versionCode }));
    } catch {
      finish(fail);
    }
  });
}
