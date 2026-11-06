import { linkedAbort } from '@weiban/client-core';

export interface WebBuild {
  version: string;
  versionCode: number;
}
const RECEIPT = 'weiban:requested-web-build';
const guards = new Set<() => string | null>();
export function addRefreshGuard(guard: () => string | null): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
function assertCanRefresh() {
  for (const guard of guards) {
    const reason = guard();
    if (reason) throw new Error(reason);
  }
}
export async function readDeployedWebBuild(): Promise<WebBuild> {
  const cancellation = linkedAbort([], 15_000);
  try {
    const response = await fetch(`/build-info.json?check=${Date.now()}`, {
      cache: 'no-store',
      redirect: 'error',
      signal: cancellation.signal,
    });
    if (!response.ok) throw new Error('检查更新失败，请联网后重试');
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('versionCode' in value) ||
      !Number.isSafeInteger(value.versionCode) ||
      Number(value.versionCode) < 0 ||
      !('version' in value) ||
      typeof value.version !== 'string'
    )
      throw new Error('版本信息不完整，请稍后重试');
    return { version: value.version, versionCode: Number(value.versionCode) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('版本信息')) throw error;
    throw new Error('检查更新失败，请联网后重试', { cause: error });
  } finally {
    cancellation.dispose();
  }
}
function deadline<T>(work: Promise<T>, message: string, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function prepareWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await deadline(
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }),
    '新版下载没有完成，请稍后重试',
  );
  await deadline(registration.update(), '新版下载没有完成，请稍后重试');
  const worker = registration.installing;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (worker.state === 'installed' || worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('新版下载失败，请重新检查更新'));
    };
    const timer = setTimeout(() => finish(new Error('新版下载没有完成，请稍后重试')), 30_000);
    worker.addEventListener('statechange', changed);
    changed();
  });
}
/** Called only after the user's refresh confirmation. Never unregister workers or erase app data. */
export async function refreshToLatestWeb(): Promise<void> {
  assertCanRefresh();
  let savingStarted = false;
  try {
    const latest = await readDeployedWebBuild();
    await prepareWorker();
    assertCanRefresh();
    const pending: Promise<void>[] = [];
    savingStarted = true;
    window.dispatchEvent(
      new CustomEvent('weiban:before-update', {
        detail: { waitUntil: (work: Promise<void>) => pending.push(work) },
      }),
    );
    const settled = Promise.allSettled(pending);
    let results: PromiseSettledResult<void>[];
    try {
      results = await deadline(settled, '本机消息尚未保存完成，请稍后再刷新', 15_000);
    } catch (error) {
      void settled.then(() => window.dispatchEvent(new Event('weiban:update-failed')));
      throw error;
    }
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('本机消息尚未保存完成，请稍后再刷新');
    sessionStorage.setItem(RECEIPT, JSON.stringify(latest));
    // At reload bootstrap, adoptWaitingWorker activates the prepared worker before app requests restart.
    window.location.reload();
  } catch (error) {
    if (savingStarted) window.dispatchEvent(new Event('weiban:update-failed'));
    throw error;
  }
}
export function consumeWebRefreshResult(currentBuild: number): string | null {
  const raw = sessionStorage.getItem(RECEIPT);
  if (!raw) return null;
  sessionStorage.removeItem(RECEIPT);
  try {
    const value = JSON.parse(raw) as Partial<WebBuild>;
    return value.versionCode === currentBuild
      ? '已刷新到刚才检查到的网页版本'
      : '本次刷新尚未切换到目标版本，请再次检查更新并刷新';
  } catch {
    return '无法确认刷新结果，请再次检查更新';
  }
}
